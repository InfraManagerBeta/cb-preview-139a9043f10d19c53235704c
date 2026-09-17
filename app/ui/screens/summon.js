// app/ui/screens/summon.js — R58/R59: summon $10 -> 100C; the name pool
// names the character (naming is the pool's job alone), the player only
// picks an element (the character's affinity).
//
// CB-BUILD-002: R59 says the name is assigned and first revealed BY THE ACT
// OF SUMMONING -- on the summoned character, never on the pre-summon screen
// and never before an element is chosen. The delivered build called
// `pickUnusedName()` at MOUNT (before any element was picked) and displayed
// it in a "YOUR <CHARACTER>" preview card on the picker itself, which reads
// as a previewed, re-rollable attribute. Fixed: the picker no longer draws
// or shows any name. `summonCharacter({ element })` is called with no name
// argument, so the engine draws it AT COMMIT (see game.js:
// `summonCharacter`'s `name || this.pickUnusedName(now)`, unmodified by
// this patch). The drawn name is first shown on a small reveal card AFTER
// the Summon press, replacing the picker -- no name field, no re-roll.
//
// CB-BUILD-014/R74a: the summon is now a CEREMONY. The press no longer
// lands on a static card: it plays the full 2019 summon sequence for the
// chosen element (components/summon/ceremony.js, the shipped player per
// R78) and ends in the reveal of the ACTUAL summoned wizard, drawn live by
// the parametric rig from its own derived parts and palette, with its name
// (still drawn at commit, R59 -- CB-BUILD-002 unregressed) first shown
// beside it. Seal-to-reveal is instrumented on the ledger.
import { mountScreen, el, cheddar } from '../components/dom.js';
import { truthBadge, cashPill } from '../components/chrome.js';
import { openLoadFundsSheet } from '../components/money-sheets.js';
import { createSummonCeremony } from '../components/summon/ceremony.js';
import { playSummonCeremony, stopSummonCeremony, soundToggleButton } from '../components/battle/sound.js';
import { actionKey } from '../../engine/ledger.js';

/**
 * C15/R19: the summon button's copy must show the ACTIVE price door arm's
 * price (O2), not the incumbent's hand-authored "$10" hardcoded into
 * treatment.copy.summonButton -- the verb ("Summon"/"Build"/"Sign") is
 * still theme-bound copy; the price and stake-unit suffix are derived live
 * from tunables so a console O2 switch changes this button's text exactly
 * like it changes what `Game#summonCharacter` charges.
 */
export function summonButtonLabel(treatment, tunables) {
  const verb = (treatment.copy.summonButton || 'Summon').split('(')[0].trim();
  const priceUSD = tunables.priceDoorArms.displayedEntryPriceDefaultUSD;
  const stakeCheddar = tunables.economy.summonCheddar;
  const abbrev = treatment.nouns.stakeUnitAbbrev;
  return `${verb} ($${priceUSD} \u2014 ${stakeCheddar}${abbrev})`;
}

export function mountSummon(ctx) {
  const { treatment, tunables } = ctx;
  let element = null;

  function renderPicker() {
    mountScreen([
      el('div', { class: 'cb-topbar' }, [
        el('span', { class: 'cb-logo' }, treatment.logoMark),
        // CB-BUILD-012/R67: the CASH balance is itself a control that
        // opens Load Funds -- was a non-interactive <span> here.
        cashPill(ctx),
      ]),
      el('h2', {}, treatment.copy.summonHeading),
      el('p', { class: 'cb-legal' }, treatment.copy.summonBody),
      truthBadge(ctx),
      el('div', { class: 'cb-card' }, [
        el('div', { class: 'cb-micro', style: 'margin-bottom:8px;' }, 'CHOOSE AN AFFINITY ELEMENT'),
        el('div', { class: 'cb-element-row' }, ['fire', 'water', 'air'].map((elName) =>
          el('button', {
            class: `cb-element-btn${element === elName ? ' selected' : ''}`,
            'data-el': elName,
            onClick: () => { element = elName; renderPicker(); },
          }, treatment.elements[elName].label)
        )),
      ]),
      el('button', {
        class: 'cb-btn block',
        'aria-disabled': !element,
        onClick: () => {
          if (!element) return;
          attemptSummon(element);
        },
      }, summonButtonLabel(treatment, tunables)),
      el('p', { class: 'cb-legal' }, treatment.copy.signupGrantNotice),
    ]);
  }

  // CB-BUILD-012/R67: insufficient CASH is a funds wall, not a dead end --
  // open Load Funds INLINE and, on a completed deposit, retry this EXACT
  // summon (same chosen element) automatically, returning the player to
  // the blocked action instead of making them start over -- CB-BUILD-013/
  // §12/R83: and with NO error text at all, not even a mapped one (R67's
  // own wording: "a blocked action ... opens Load Funds inline"). Any OTHER
  // thrown error is mapped to player-safe copy, never the raw developer
  // string (`e.message` is never toasted).
  //
  // C4/R67+R83 fix: R67 says the wall "states the shortfall in player
  // language AND opens Load Funds inline" -- both, not just the second
  // half. The sheet itself now renders that line (money-sheets.js's
  // `shortfall` option) computed from the SAME price the summon button
  // already displays (tunables.priceDoorArms.displayedEntryPriceDefaultUSD,
  // O2-live, per summonButtonLabel above) -- never `e.message` (still no
  // raw error text at all, per CB-BUILD-013/no-raw-error-text.test.js).
  function attemptSummon(chosenElement) {
    try {
      // CB-BUILD-014/R74a: the SEAL — the moment of the press. The summon
      // transaction commits here (name drawn at commit, R59, unchanged);
      // what changed is what the player SEES next: the full 2019 summon
      // sequence for the chosen element, ending in the reveal of the actual
      // summoned wizard drawn by the fighting rig. Seal-to-reveal is
      // instrumented from this timestamp (see renderCeremony).
      const sealTs = Date.now();
      // R59: no name is threaded through here -- the engine draws it
      // at commit (game.js: summonCharacter's own pickUnusedName
      // fallback, unmodified by this patch).
      const summoned = ctx.game.summonCharacter({ element: chosenElement });
      ctx.patchSession({ activeCharacterId: summoned.characterId });
      renderCeremony(summoned, sealTs);
    } catch (e) {
      // A3: classify by the engine's stable `code` (game.js:
      // summonCharacter throws { code: 'INSUFFICIENT_CASH' } alongside its
      // message), not a `/insufficient CASH/.test(e.message)` regex -- a
      // future copy/i18n pass to the thrown message text can no longer
      // silently degrade this branch to the generic toast below.
      if (e.code === 'INSUFFICIENT_CASH') {
        const actionLabel = (treatment.copy.summonButton || 'Summon').split('(')[0].trim();
        const costUSD = tunables.priceDoorArms.displayedEntryPriceDefaultUSD;
        openLoadFundsSheet(ctx, { onDeposited: () => attemptSummon(chosenElement), shortfall: { actionLabel, costUSD } });
      } else {
        // CB-BUILD-013/§12/R83: no raw/developer error text reaches a
        // participant surface -- no other failure is currently reachable
        // from this screen, but this is the defensive floor so a future
        // thrown string never leaks here either.
        ctx.toast('That didn\u2019t go through. Please try again.');
      }
    }
  }

  // CB-BUILD-014/R74a [LAW]: the summon is a CEREMONY. The press plays the
  // full 2019 summon sequence for the chosen element (the bundle's summon
  // set, played by the shipped player — components/summon/ceremony.js) and
  // ends in the reveal of the ACTUAL summoned wizard — parts and colours
  // derived from its characterId and drawn live by the same parametric rig
  // path the duel stage uses (t4/CB-BUILD-022 coordination: derived at read
  // time from the id via wizardIdentity, never read off recorded ledger
  // fields). First sight of the wizard is the reveal; the name (R59, drawn
  // at commit) is first shown alongside it, by renderReveal below. The
  // seal-to-reveal duration is instrumented on the ledger through the
  // EXISTING append API (t3/CB-BUILD-017 owns engine/ledger.js — no edit
  // there; the event type is a new string on the same append path).
  function renderCeremony(summoned, sealTs) {
    const ceremony = createSummonCeremony({
      character: { id: summoned.characterId, element: summoned.element, tier: 0 },
      treatment,
    });
    const revealFooter = el('div', { class: 'cb-summon-footer' });
    mountScreen([
      el('div', { class: 'cb-topbar' }, [
        el('span', { class: 'cb-logo' }, treatment.logoMark),
        // CB-BUILD-016/R78a: a mute control visible wherever sound plays —
        // and sound plays HERE first (armed by this press's own pointerdown).
        soundToggleButton(),
      ]),
      el('div', { class: 'cb-micro cb-summon-phase-label' }, `${treatment.elements[summoned.element].label.toUpperCase()} SUMMON`),
      ceremony.root,
      revealFooter,
    ]);
    if (ctx.router && typeof ctx.router.onUnmount === 'function') {
      ctx.router.onUnmount(() => { stopSummonCeremony(); ceremony.destroy(); });
    }
    // CB-BUILD-016/R78a: the first thing the player hears — the summon
    // audio starts WITH the ceremony (the press that sealed it was the
    // arming tap).
    playSummonCeremony();
    ceremony.whenRevealed.then((report) => {
      stopSummonCeremony();
      // R74a instrumentation: seal (the press) to reveal (first sight of
      // the wizard), a real measured number in ms, on the ledger.
      const sealToRevealMs = Date.now() - sealTs;
      try {
        ctx.game.ledger.append({
          key: actionKey('summon-ceremony-reveal', summoned.characterId),
          type: 'SUMMON_CEREMONY_REVEALED',
          playerId: ctx.game.playerId,
          ts: Date.now(),
          payload: {
            characterId: summoned.characterId,
            element: summoned.element,
            sealToRevealMs,
            ceremonyDegraded: !!(report && (report.sequenceDegraded || report.revealDegraded)),
          },
        });
      } catch { /* instrumentation is best-effort — it never blocks the reveal */ }
      renderReveal(summoned, revealFooter);
    });
  }

  // R59: the reveal moment -- the FIRST place the drawn name is shown,
  // after the Summon press, on the summoned character (now at the END of
  // the R74a ceremony, alongside first sight of the rig-drawn wizard
  // itself). No re-roll, no name field: a read-only reveal appended under
  // the ceremony's revealed wizard, with one Continue action.
  function renderReveal(summoned, container) {
    container.appendChild(el('div', { class: 'cb-card cb-summon-reveal-card', style: 'text-align:center;' }, [
      el('div', { class: 'cb-micro' }, `YOUR ${treatment.nouns.character.toUpperCase()}`),
      el('div', { class: 'cb-display', style: 'font-size:28px;color:var(--cb-yellow);' }, summoned.name),
      el('div', { class: 'cb-micro', style: 'margin-top:8px;' }, `${treatment.elements[summoned.element].label.toUpperCase()} \u00b7 ${cheddar(summoned.stakeCheddar)}`),
    ]));
    container.appendChild(el('button', { class: 'cb-btn block', onClick: () => ctx.router.navigate('lobby-entry') }, 'Continue'));
  }

  renderPicker();
}
