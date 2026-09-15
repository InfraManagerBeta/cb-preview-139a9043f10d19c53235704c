// app/ui/screens/pve.js — R57: PvE power-building loop.
import { mountScreen, el, cheddar } from '../components/dom.js';
import { elementIndex } from '../../engine/duel.js';
import { tendencyLabel } from '../../engine/npc.js';
import * as pve from '../../engine/pve.js';
import { truthBadge, renderKillStopBanner } from '../components/chrome.js';
import { KillSwitchFrozenError } from '../../engine/game.js';
import { loadOverrides, effectiveHypothesisId } from '../../engine/overrides.js';
import { hypothesisCard } from '../../engine/hypotheses.js';

/**
 * C13/O3/R26 card 5 ("PvE depth"): only rendered when that hypothesis is
 * ACTIVE (O3). Wires the existing PvE + tendency data (already shipped)
 * into a roster panel: every canonical seed-roster bot, its tendency card,
 * and its own W/L record aggregated from the ledger's PVE_DUEL_RESOLVED
 * events (engine/pve.js:pveRosterRecords) -- real ledger data, not a
 * decorative mockup.
 */
function renderRosterPanel(ctx, treatment) {
  if (effectiveHypothesisId(loadOverrides()) !== 'pve_depth') return null;
  const card = hypothesisCard('pve_depth');
  const records = pve.pveRosterRecords(ctx.game.ledger.all());
  const canonical = (treatment.seedRoster || []).filter((r) => r.canonical);
  return el('div', { class: 'cb-card' }, [
    el('div', { class: 'cb-display', style: 'font-size:16px;' }, 'House roster'),
    el('p', { class: 'cb-prose cb-prose-small' }, card.fairTestLine),
    ...canonical.map((r) => {
      const rec = records[r.name] || { w: 0, l: 0 };
      return el('div', { class: 'cb-round-row' }, [
        el('span', {}, [r.name, el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel)]),
        el('span', { class: 'cb-micro' }, `${treatment.elements[r.element] ? treatment.elements[r.element].label : r.element} \u00b7 F/W/A ${tendencyLabel(r.tendency)} \u00b7 ${rec.w}-${rec.l}`),
      ]);
    }),
  ]);
}

export function mountPve(ctx) {
  const { treatment } = ctx;
  const session = ctx.refreshSession();
  const character = ctx.game.snapshot().characters[session.activeCharacterId];
  if (!character) { ctx.router.navigate('lobby-entry'); return; }

  let opponent = session.pveOpponent;
  if (!opponent) {
    opponent = ctx.game.startPveOpponent(character.id);
    ctx.patchSession({ pveOpponent: opponent });
  }

  const ELEMENTS = ['fire', 'water', 'air'];
  const moves = [null, null, null, null, null];
  let submitting = false;

  function render() {
    const c = ctx.game.snapshot().characters[character.id];
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('h2', {}, 'Power-Building (PvE)'),
      truthBadge(ctx),
      el('div', { class: 'cb-card' }, [
        el('div', { class: 'cb-micro' }, `${c.name} \u00b7 ${cheddar(c.stakeCheddar)}`),
        el('div', { class: 'cb-micro', style: 'margin-top:6px;' }, [
          `House opponent \u00b7 ${opponent.name ? `${opponent.name} \u00b7 ` : ''}${cheddar(opponent.stakeCheddar)} \u00b7 tendency ${tendencyLabel(opponent.tendency)}`,
          opponent.npcTag ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
        ]),
      ]),
      renderRosterPanel(ctx, treatment),
      ...moves.map((mv, i) => el('div', { class: 'cb-card' }, [
        el('div', { class: 'cb-micro' }, `ROUND ${i + 1}`),
        el('div', { class: 'cb-element-row' }, ELEMENTS.map((elName) =>
          el('button', {
            class: `cb-element-btn${moves[i] === elName ? ' selected' : ''}${elName === c.element ? ' affinity' : ''}`,
            onClick: () => { moves[i] = elName; render(); },
          }, treatment.elements[elName].label)
        )),
      ])),
      el('button', {
        class: 'cb-btn block',
        'aria-disabled': moves.some((m) => m == null) || submitting,
        onClick: () => {
          if (moves.some((m) => m == null)) return;
          if (submitting) return; // C1/R83: control disables until resolution
          submitting = true;
          // C1/R83: capture the duel-seq ONCE, before the press, and reuse
          // it on any retry -- see Game#peekPveDuelSeq.
          const duelSeq = ctx.game.peekPveDuelSeq(opponent.sessionId);
          // f4/A-h fix: a kill landing between the button press and
          // resolvePveDuel's ledger append (guarded, per f1's AC0 rule)
          // used to throw KillSwitchFrozenError straight out of this
          // handler -- uncaught, leaving the Fight button stuck disabled
          // (submitting never reset) with no feedback at all. Catch
          // specifically KillSwitchFrozenError and show the same stop
          // banner a fresh route mount would show; any other error still
          // propagates (a catch-site, not a guard change).
          let result;
          try {
            result = ctx.game.resolvePveDuel({ characterId: c.id, playerMoves: moves.map(elementIndex), opponent, duelSeq });
          } catch (err) {
            if (err instanceof KillSwitchFrozenError) { renderKillStopBanner(ctx); return; }
            throw err;
          }
          ctx.toast(result.playerDelta >= 0 ? `+${cheddar(result.playerDelta)}` : `${cheddar(result.playerDelta)}`);
          if (result.opponentZeroed) {
            const fresh = ctx.game.startPveOpponent(c.id);
            ctx.patchSession({ pveOpponent: fresh });
          } else {
            ctx.patchSession({ pveOpponent: opponent });
          }
          if (ctx.game.snapshot().characters[c.id].stakeCheddar <= 0) {
            ctx.router.navigate('wallet');
            return;
          }
          ctx.router.navigate('pve');
        },
      }, 'Fight'),
      el('button', { class: 'cb-btn secondary block', onClick: () => { ctx.patchSession({ pveOpponent: null }); ctx.router.navigate('lobby-entry'); } }, 'Done'),
    ]);
  }

  render();
}
