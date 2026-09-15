// app/engine/hypotheses.js
// C13/O3/R26/R20/AC0 — the six retention-manifest cards (docs/retention-
// manifest.md), each at MINIMUM fair-test scope, switchable from the
// console's O3 item. `HYPOTHESIS_CARDS` is the manifest-order registry (id,
// title, and the card's own fair-test line -- "the card's fair-test line is
// the whole bar" per the brief, so every surface a card adds carries this
// exact line and nothing more). `effectiveHypothesisId` (app/engine/
// overrides.js) resolves which one is ACTIVE; each hypothesis's UI surface
// is wired to appear ONLY when its id is active (see the screens/console
// files that import HYPOTHESIS_CARDS).
//
// This module holds card 1's (scouting) and card 4's (marquee) pure data
// functions. Card 2 (pre-match brief) lives in engine/narrator.js (it needs
// the R73 discipline scanner already there). Card 5 (PvE depth roster) lives
// in engine/pve.js (it needs the PvE stake-range math already there).
// Card 3 (spectate) and card 6 (theme change) are pure wiring -- no new
// pure-data function of their own.

import { EVENT_TYPES } from './ledger.js';

export const HYPOTHESIS_CARDS = Object.freeze([
  { id: 'scouting_reports', order: 1, title: 'Scouting reports', fairTestLine: 'Opponent move-history panel on the pre-match screen, from the shared ledger (R26 card 1).' },
  { id: 'prematch_brief', order: 2, title: 'Pre-match Narrator brief', fairTestLine: 'A two-sentence Narrator brief per opponent, from the ledger, discipline-scanned (R26 card 2).' },
  { id: 'spectate', order: 3, title: 'Spectate after elimination', fairTestLine: 'The live board stays open to the eliminated player until the final (R26 card 3).' },
  { id: 'marquee_brackets', order: 4, title: 'Marquee scheduled brackets', fairTestLine: 'A scheduled bracket with countdown and reminder opt-in (R26 card 4).' },
  { id: 'pve_depth', order: 5, title: 'PvE depth', fairTestLine: 'A bot roster with readable tendencies and separate records (R26 card 5).' },
  { id: 'theme_change', order: 6, title: 'Theme change', fairTestLine: 'The door-race-winning theme applied to the retention configuration (R26 card 6).' },
]);

export function hypothesisCard(id) {
  return HYPOTHESIS_CARDS.find((c) => c.id === id) || null;
}

// ---- Card 1: Scouting reports ----------------------------------------------

/**
 * C13 card 1: an opponent's last-`limit` STAKED duels from the shared
 * ledger, most recent first.
 *
 * f7/N2: R26's card asks for "elements played by round" -- f1's original A6
 * ledger slimming DID drop the per-round `rounds` array outright, which is
 * what made this genuinely unreconstructable at the time (the stale claim
 * this fix corrects). f6/crucial-1 already changed that: every
 * `DUEL_RESOLVED` event since f6 persists a SLIM per-round record
 * (`move1`/`move2`/`result`/`p1Affinity`/`p2Affinity`, see
 * game.js:slimOutcomeForLedger) precisely so a per-round replay is
 * reconstructable -- this function now reads that same field for scouting,
 * not just for the reveal screen's reconstruct path. `playedByRound`/
 * `facedByRound` carry this character's own and its past opponent's played
 * elements, in round order, ORIENTED the same way game.js's combatants
 * array always is (`combatants[0]` = the duel's seat A / p1 perspective, so
 * `move1` is seat A's move and `move2` is seat B's) -- when `characterId`
 * sat in seat B (`selfIdx === 1`), `playedByRound` reads `move2` and
 * `facedByRound` reads `move1`, the mirror of `scoreFor`/`scoreAgainst`
 * below.
 *
 * A LEGACY (pre-f6) event has no `rounds` key at all (no migration) --
 * `roundsAvailable` is `false` for those rows and `playedByRound`/
 * `facedByRound` are both `null`, an honest fallback to summary-only, never
 * a fabricated per-round guess.
 */
export function opponentDuelHistory(ledgerEvents, characterId, limit = 10) {
  const rows = [];
  for (const e of ledgerEvents) {
    if (e.type !== EVENT_TYPES.DUEL_RESOLVED) continue;
    const combatants = e.payload.combatants || [];
    const selfIdx = combatants.findIndex((c) => c.characterId === characterId);
    if (selfIdx === -1) continue;
    const opp = combatants[1 - selfIdx];
    const o = e.payload.outcome || {};
    const isSeatA = selfIdx === 0;
    const rawRounds = Array.isArray(o.rounds) ? o.rounds : null;
    rows.push({
      ts: e.ts,
      won: !!combatants[selfIdx].won,
      opponentCharacterId: opp ? opp.characterId : null,
      scoreFor: isSeatA ? o.won : o.lost,
      scoreAgainst: isSeatA ? o.lost : o.won,
      draws: o.draws || 0,
      // affinity-play rate: the share of rounds where THIS duel carried a
      // BIG or CRITICAL tag (both require at least one side on its own
      // affinity) -- a proxy for "plays its affinity often," derived
      // entirely from summary fields A6 retained.
      affinityPlayRate: ((o.bigCount || 0) + (o.criticalCount || 0)) / 5,
      transfer: o.transfer || 0,
      floorDrain: !!o.floorDrain,
      tie: !!o.trueTie,
      // f7/N2: per-round elements, oriented via combatants (see header
      // comment) -- null for a legacy rounds-free event, never a guess.
      playedByRound: rawRounds ? rawRounds.map((r) => (isSeatA ? r.move1 : r.move2)) : null,
      facedByRound: rawRounds ? rawRounds.map((r) => (isSeatA ? r.move2 : r.move1)) : null,
      roundsAvailable: !!rawRounds,
    });
  }
  return rows.slice(-limit).reverse();
}

export function summarizeOpponentHistory(history) {
  const wins = history.filter((h) => h.won).length;
  const losses = history.filter((h) => !h.won && !h.tie).length;
  const avgAffinityPlayRate = history.length
    ? history.reduce((s, h) => s + h.affinityPlayRate, 0) / history.length
    : 0;
  return { wins, losses, ties: history.length - wins - losses, count: history.length, avgAffinityPlayRate };
}

// ---- Card 4: Marquee scheduled brackets ------------------------------------

/**
 * C13 card 4: "a scheduled bracket with countdown" -- a SIMULATED daily
 * schedule (no real ops calendar exists in this artifact): one marquee slot
 * per day at a fixed hour (UTC), computed purely from `now` so it is
 * deterministic and testable. Returns the next slot's start time and the
 * countdown remaining.
 */
export function nextMarqueeSlot(now, hourUTC = 20) {
  const d = new Date(now);
  const slot = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUTC, 0, 0, 0));
  if (slot.getTime() <= now) slot.setUTCDate(slot.getUTCDate() + 1);
  return { startsAt: slot.getTime(), msRemaining: slot.getTime() - now };
}
