// app/ui/screens/lobby-entry.js — pick which ACTIVE character enters the
// sync bracket lobby next (§11).
import { mountScreen, el, cheddar } from '../components/dom.js';
import { bottomNav, truthBadge } from '../components/chrome.js';
import * as economy from '../../engine/economy.js';
import * as pve from '../../engine/pve.js';
import { loadOverrides, effectiveHypothesisId } from '../../engine/overrides.js';
import { hypothesisCard, nextMarqueeSlot } from '../../engine/hypotheses.js';
import { EVENT_TYPES } from '../../engine/ledger.js';

function formatCountdown(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * C13/O3/R26 card 4 ("Marquee scheduled brackets"): only rendered when that
 * hypothesis is ACTIVE (O3). "Simulated schedule is fine" (the brief) --
 * one marquee slot per day at a fixed hour (engine/hypotheses.js:
 * nextMarqueeSlot); the countdown is computed at render time (this screen
 * re-renders on every visit, which is enough for the card's minimum
 * fair-test scope -- a live-ticking clock would need an interval this
 * single-mount screen doesn't otherwise use). The reminder opt-in IS a real
 * ledger event (Game#optInMarqueeReminder), idempotent per slot.
 */
function renderMarqueeCard(ctx) {
  if (effectiveHypothesisId(loadOverrides()) !== 'marquee_brackets') return null;
  const card = hypothesisCard('marquee_brackets');
  const slot = nextMarqueeSlot(Date.now());
  const alreadyOptedIn = ctx.game.ledger
    .byType(EVENT_TYPES.MARQUEE_REMINDER_OPT_IN)
    .some((e) => e.payload && e.payload.slotStartsAt === slot.startsAt);
  return el('div', { class: 'cb-card' }, [
    el('div', { class: 'cb-display', style: 'font-size:18px;' }, 'Marquee bracket'),
    el('p', { class: 'cb-prose cb-prose-small' }, card.fairTestLine),
    el('div', { class: 'cb-data', style: 'margin-top:6px;color:var(--cb-yellow);' }, `Next marquee bracket in ${formatCountdown(slot.msRemaining)}`),
    el('button', {
      class: 'cb-btn secondary block',
      style: 'margin-top:8px;',
      'aria-disabled': alreadyOptedIn,
      onClick: () => {
        if (alreadyOptedIn) return;
        ctx.game.optInMarqueeReminder(slot.startsAt);
        ctx.toast('Reminder set — we\u2019ll notify you at T-15m.');
      },
    }, alreadyOptedIn ? 'Reminder set \u2713' : 'Remind me (opt in)'),
  ]);
}

export function mountLobbyEntry(ctx) {
  const { treatment, tunables } = ctx;
  const snap = ctx.game.snapshot();
  const characters = Object.values(snap.characters).filter((c) => c.kind === 'human' && !c.retired);

  const active = characters.filter((c) => c.state === 'ACTIVE');
  const sitting = characters.filter((c) => c.state === 'SITTING');

  mountScreen([
    el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
    el('h2', {}, treatment.copy.lobbyHeading),
    truthBadge(ctx),
    renderMarqueeCard(ctx),
    active.length === 0 && sitting.length === 0
      ? el('div', { class: 'cb-card' }, [
          el('p', {}, `No ${treatment.nouns.characterPlural} yet.`),
          el('button', { class: 'cb-btn block', onClick: () => ctx.router.navigate('summon') }, `Summon a ${treatment.nouns.character}`),
        ])
      : null,
    ...active.map((c) => {
      const floor = economy.floorForTier(tunables, c.tier);
      const meetsFloor = c.stakeCheddar >= floor;
      let submitting = false;
      return el('div', { class: 'cb-card' }, [
        el('div', { class: 'cb-display', style: 'font-size:20px;' }, c.name),
        el('div', { class: 'cb-micro' }, `TIER ${c.tier} · ${cheddar(c.stakeCheddar)} STAKED · ${treatment.elements[c.element].label.toUpperCase()}`),
        el('button', {
          class: 'cb-btn block',
          style: 'margin-top:10px;',
          'aria-disabled': !meetsFloor || submitting,
          onClick: () => {
            if (!meetsFloor) { ctx.toast(`Needs at least ${cheddar(floor)} to enter tier ${c.tier}.`); return; }
            if (submitting) return; // C1/R83: control disables until resolution
            submitting = true;
            // C1/R83: capture the join-epoch ONCE, before the press, and
            // reuse it on any retry -- see Game#peekLobbyJoinEpoch.
            const joinEpoch = ctx.game.peekLobbyJoinEpoch(c.id);
            const lobby = ctx.game.joinLobby(c.id, c.tier, Date.now(), { joinEpoch });
            ctx.patchSession({ activeCharacterId: c.id, lobby });
            ctx.router.navigate('lobby');
          },
        }, meetsFloor ? 'Find a Bracket' : `Below floor (${cheddar(floor)})`),
        !meetsFloor ? el('button', { class: 'cb-btn secondary block', onClick: () => { ctx.patchSession({ activeCharacterId: c.id }); ctx.router.navigate('pve'); } }, 'Build Power (PvE)') : null,
        // A8: needsPvERebuild had zero live callers -- wire it in as the UI
        // hint it was written to be ("not a hard gate"): warn a player who's
        // below floor AND wouldn't clear it even with a re-entry bonus that
        // PvE (not re-entry) is the path back.
        !meetsFloor && pve.needsPvERebuild(tunables, c)
          ? el('p', { class: 'cb-prose cb-prose-small', style: 'margin-top:6px;' }, 'Even a re-entry bonus would not clear the floor yet — PvE first.')
          : null,
      ]);
    }),
    ...sitting.map((c) => el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:20px;' }, c.name),
      el('div', { class: 'cb-micro' }, `SITTING · TIER ${c.tier} · ${cheddar(c.stakeCheddar)}`),
      el('button', { class: 'cb-btn secondary block', style: 'margin-top:10px;', onClick: () => { ctx.patchSession({ activeCharacterId: c.id }); ctx.router.navigate('sitting'); } }, 'Manage'),
    ])),
    active.length > 0 || sitting.length > 0
      ? el('button', { class: 'cb-btn secondary block', onClick: () => ctx.router.navigate('summon') }, `Summon another ${treatment.nouns.character}`)
      : null,
    el('div', { style: 'height:56px;' }),
    bottomNav(ctx, 'lobby-entry'),
  ]);
}
