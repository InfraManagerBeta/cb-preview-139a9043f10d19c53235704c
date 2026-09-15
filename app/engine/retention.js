// app/engine/retention.js
// R41–R50: exact per-player definitions, implemented as pure functions over
// the ledger's raw events (never a separately-maintained counter — every
// displayed figure derives from the ledger, and every gated metric must
// recompute to the same value from the delivered raw events, invariant #10).

import { EVENT_TYPES } from './ledger.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** R43: the timestamp the player's first bracket concludes for them
 * (elimination or final win), where every duel of theirs in that bracket
 * was a staked duel. Bracket duels are always staked by construction in
 * this build (zero-stake test battles never touch the bracket flow), so
 * this reduces to the earliest of the player's first
 * CHARACTER_ELIMINATED / CHARACTER_ADVANCED(wonBracket) events.
 */
export function computeAnchor(events, playerId) {
  const candidates = events.filter((e) =>
    e.playerId === playerId &&
    (e.type === EVENT_TYPES.CHARACTER_ELIMINATED ||
      (e.type === EVENT_TYPES.CHARACTER_ADVANCED && e.payload && e.payload.wonBracket)) &&
    e.payload && e.payload.bracketId && e.payload.allDuelsStaked !== false
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.ts - b.ts);
  return candidates[0].ts;
}

/** R44: day k, anchor-relative, independent of calendar/timezone. */
export function dayIndex(ts, anchorTs) {
  if (anchorTs == null) return null;
  const delta = ts - anchorTs;
  return Math.floor(delta / DAY_MS);
}

/** R45: week w = days 7(w-1)+1 .. 7w; week 1 = days 1-7; day 0 before week 1. */
export function weekIndex(dIndex) {
  if (dIndex == null || dIndex < 1) return 0;
  return Math.ceil(dIndex / 7);
}

function stakedDuelEvents(events, playerId) {
  return events.filter((e) =>
    e.playerId === playerId &&
    (e.type === EVENT_TYPES.DUEL_RESOLVED || e.type === EVENT_TYPES.PVE_DUEL_RESOLVED) &&
    e.payload && e.payload.staked === true && e.payload.hesitated !== true
  );
}

/** R46: return on day k — >=1 staked duel resolved inside day k. D1 = return on day 1. */
export function returnedOnDay(events, playerId, anchorTs, k) {
  const duels = stakedDuelEvents(events, playerId);
  return duels.some((e) => dayIndex(e.ts, anchorTs) === k);
}
export function d1Return(events, playerId, anchorTs) {
  return returnedOnDay(events, playerId, anchorTs, 1);
}

/** R47: D7 return — >=1 staked duel resolved inside days 6-8. */
export function d7Return(events, playerId, anchorTs) {
  const duels = stakedDuelEvents(events, playerId);
  return duels.some((e) => {
    const d = dayIndex(e.ts, anchorTs);
    return d >= 6 && d <= 8;
  });
}

/** R48: weekly returner — >=1 staked duel in week 4 and in >=2 of weeks 1-3. */
export function weeklyReturner(events, playerId, anchorTs) {
  const duels = stakedDuelEvents(events, playerId);
  const weeksHit = new Set();
  for (const e of duels) {
    const d = dayIndex(e.ts, anchorTs);
    if (d == null || d < 1) continue;
    weeksHit.add(weekIndex(d));
  }
  const early = [1, 2, 3].filter((w) => weeksHit.has(w)).length;
  return weeksHit.has(4) && early >= 2;
}

/** R49: replay-after-loss — a player-initiated fresh bracket entry within
 * the same anchor-relative day as an elimination. */
export function replayAfterLoss(events, playerId, anchorTs) {
  const eliminations = events.filter((e) => e.playerId === playerId && e.type === EVENT_TYPES.CHARACTER_ELIMINATED);
  const freshEntries = events.filter((e) =>
    e.playerId === playerId && e.type === EVENT_TYPES.SYNC_LOBBY_JOINED && e.payload && e.payload.freshEntry
  );
  return eliminations.some((elim) => {
    const elimDay = dayIndex(elim.ts, anchorTs);
    return freshEntries.some((entry) => entry.ts > elim.ts && dayIndex(entry.ts, anchorTs) === elimDay);
  });
}

/** R49: bust-to-top-up — seconds from a character reaching zero stake to a
 * confirmed Load Funds deposit. Returns an array of {characterId, seconds}. */
export function bustToTopUp(events, playerId) {
  const busts = events.filter((e) =>
    e.playerId === playerId &&
    (e.type === EVENT_TYPES.DUEL_RESOLVED || e.type === EVENT_TYPES.PVE_DUEL_RESOLVED) &&
    e.payload && e.payload.stakeAfter === 0
  );
  const deposits = events
    .filter((e) => e.playerId === playerId && e.type === EVENT_TYPES.LOAD_FUNDS_DEPOSIT)
    .sort((a, b) => a.ts - b.ts);
  return busts.map((bust) => {
    const nextDeposit = deposits.find((d) => d.ts >= bust.ts);
    return {
      characterId: bust.payload.characterId,
      bustTs: bust.ts,
      depositTs: nextDeposit ? nextDeposit.ts : null,
      seconds: nextDeposit ? Math.round((nextDeposit.ts - bust.ts) / 1000) : null,
    };
  });
}

/** R49a: reservation — recorded once per account, timestamp/day index/tier/character state. */
export function reservationRecord(events, playerId, anchorTs) {
  const ev = events.find((e) => e.playerId === playerId && e.type === EVENT_TYPES.RESERVATION_PRESSED);
  if (!ev) return null;
  return {
    ts: ev.ts,
    dayIndex: anchorTs != null ? dayIndex(ev.ts, anchorTs) : null,
    tier: ev.payload.tier,
    characterState: ev.payload.characterState,
  };
}

/** R41: qualified activation — screener-passed, age/jurisdiction gated,
 * assigned server-side at the timestamp the assignment is written. */
export function qualifiedActivation(events, playerId) {
  const ev = events.find((e) =>
    e.playerId === playerId && e.type === EVENT_TYPES.SCREENER_RESULT && e.payload && e.payload.passed === true
  );
  return ev ? { ts: ev.ts } : null;
}

/** Brackets per active player within 48 hours of anchor (ungated diagnostic, part of R51). */
export function bracketsWithin48h(events, playerId, anchorTs) {
  const completions = events.filter((e) =>
    e.playerId === playerId &&
    (e.type === EVENT_TYPES.CHARACTER_ELIMINATED || (e.type === EVENT_TYPES.CHARACTER_ADVANCED && e.payload.wonBracket))
  );
  return completions.filter((e) => anchorTs != null && e.ts - anchorTs <= 48 * HOUR_MS).length;
}

export { DAY_MS, HOUR_MS };
