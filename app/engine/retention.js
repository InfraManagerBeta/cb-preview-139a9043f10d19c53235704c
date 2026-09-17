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

/** R49/CB-BUILD-018: bust-to-top-up — seconds from a character reaching zero
 * stake to a confirmed Load Funds deposit, WHEREVER the bust occurs. Returns
 * an array of {characterId, seconds}.
 *
 * Two payload shapes reach this matcher: PVE_DUEL_RESOLVED (and some
 * hand-built fixtures typed DUEL_RESOLVED) carry the bust FLAT —
 * `payload.stakeAfter` / `payload.characterId` directly on the event — but a
 * real bracket-duel DUEL_RESOLVED carries it NESTED, one entry per seat in
 * `payload.combatants` (both seats' stake share the one event). A flat-only
 * matcher passes over every bracket-duel bust. Bracket combatants are
 * matched against the player's OWN character (derived from their
 * CHARACTER_SUMMONED events in the same ledger) so an opponent's zeroed
 * stake is never counted as the player's bust. */
export function bustToTopUp(events, playerId) {
  const ownCharacterIds = new Set(
    events
      .filter((e) => e.playerId === playerId && e.type === EVENT_TYPES.CHARACTER_SUMMONED && e.payload)
      .map((e) => e.payload.characterId)
  );
  const busts = [];
  for (const e of events) {
    if (e.playerId !== playerId || !e.payload) continue;
    if (e.type !== EVENT_TYPES.DUEL_RESOLVED && e.type !== EVENT_TYPES.PVE_DUEL_RESOLVED) continue;
    if (e.payload.stakeAfter === 0) {
      busts.push({ ts: e.ts, characterId: e.payload.characterId });
    } else if (Array.isArray(e.payload.combatants)) {
      // Advisory fix (costs nothing): an `else` here means an event
      // carrying BOTH the flat `stakeAfter` shape and a nested
      // `combatants` array (not reachable from any shipped writer today)
      // cannot double-count the same bust as two identical records.
      for (const combatant of e.payload.combatants) {
        if (combatant.stakeAfter === 0 && ownCharacterIds.has(combatant.characterId)) {
          busts.push({ ts: e.ts, characterId: combatant.characterId });
        }
      }
    }
  }
  const deposits = events
    .filter((e) => e.playerId === playerId && e.type === EVENT_TYPES.LOAD_FUNDS_DEPOSIT)
    .sort((a, b) => a.ts - b.ts);
  return busts.map((bust) => {
    const nextDeposit = deposits.find((d) => d.ts >= bust.ts);
    return {
      characterId: bust.characterId,
      bustTs: bust.ts,
      depositTs: nextDeposit ? nextDeposit.ts : null,
      seconds: nextDeposit ? Math.round((nextDeposit.ts - bust.ts) / 1000) : null,
    };
  });
}

/** CB-BUILD-017/AC1: "link → first duel" — the elapsed time from the
 * player first reaching the app (`LINK_OPENED`, written once at boot,
 * `Game#recordLinkOpened`, CB-BUILD-017 fix round f4/Finding 2) to their
 * FIRST submitted seal. AC1's own rule: the clock stops at the player's
 * OWN commit press (`SYNC_COMMIT`), not at the duel's resolution; a first
 * duel that times out (`SYNC_HESITATED` — an auto-commit, R81) is "a duel
 * that happened without them" and earns no credit toward the bar. This
 * function still RECORDS that a first duel occurred and that it hesitated
 * (`hesitated: true`, `seconds: null`) — a caller computing the
 * median/90th-percentile numerator must filter on `hesitated === false`
 * (or just drop nulls) to honor "excluded from the numerator" while still
 * being able to report how often it happens.
 *
 * f4/Finding 2 fix: this used to start the clock at `ACCOUNT_CREATED`
 * under the claim "opening the link spins up their account, R70" — the
 * reviewer found that claim FALSE: `Game#submitScreener` only calls
 * `ensureAccount` (which writes `ACCOUNT_CREATED`) on a PASSED screener
 * (A15), and `app/ui/app.js` deliberately no longer calls it
 * unconditionally at boot. So the old clock silently excluded the whole
 * landing + screener interval (R8a copy, date-of-birth entry, jurisdiction
 * check) from the metric, biasing it downward against AC1's "median under
 * two minutes" bar — a link at t=0 with screener pass at t=40s and a first
 * seal at t=100s used to report 60s, not the true 100s. Fixed by preferring
 * a real `LINK_OPENED` event (Game#recordLinkOpened, called once at boot,
 * independent of screener pass/fail) as the clock start, falling back to
 * `ACCOUNT_CREATED` only for ledgers that predate this event (e.g.
 * hand-built fixtures in tests that never call recordLinkOpened) so this
 * function still degrades sensibly rather than returning null for them.
 */
export function linkToFirstSeal(events, playerId) {
  const linkEvent =
    events.find((e) => e.playerId === playerId && e.type === EVENT_TYPES.LINK_OPENED) ||
    events.find((e) => e.playerId === playerId && e.type === EVENT_TYPES.ACCOUNT_CREATED);
  if (!linkEvent) return null;
  const firstDuel = events
    .filter((e) => e.playerId === playerId && (e.type === EVENT_TYPES.SYNC_COMMIT || e.type === EVENT_TYPES.SYNC_HESITATED))
    .sort((a, b) => a.ts - b.ts)[0];
  if (!firstDuel) return null;
  const hesitated = firstDuel.type === EVENT_TYPES.SYNC_HESITATED;
  return {
    linkTs: linkEvent.ts,
    firstDuelTs: firstDuel.ts,
    hesitated,
    seconds: hesitated ? null : Math.round((firstDuel.ts - linkEvent.ts) / 1000),
  };
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
