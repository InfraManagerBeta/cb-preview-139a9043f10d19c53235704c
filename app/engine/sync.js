// app/engine/sync.js
// §11 — the sync bracket (R80–R82): simulated realtime lobby, commit window,
// intermission, and elimination. Pure, timestamp-driven functions (no
// setTimeout inside the engine) so the UI layer can drive it with real
// timers while tests can drive it with fake clocks. Runtime timings are
// controlled by tunables.json; a UI-only demoTimeScale may compress wall
// time for playability without changing the tunable values themselves.

import { randInt, randFloat } from './rng.js';
import { generateNpcSeat } from './npc.js';

export const LOBBY_PHASE = Object.freeze({
  SEATING: 'SEATING',
  COUNTDOWN: 'COUNTDOWN',
  READY: 'READY',
});

/** Create a fresh 8-seat lobby with the human already seated at seat 0. */
export function createLobby(tunables, { humanEntry, tier, now }) {
  const seats = new Array(8).fill(null);
  seats[0] = { kind: 'human', ...humanEntry };
  const waitMs = tunables.timers.lobbyHumanWaitSec.default * 1000;
  return {
    tier,
    seats,
    createdAt: now,
    humanWaitDeadline: now + waitMs,
    boardStartAt: null,
    phase: LOBBY_PHASE.SEATING,
    fillPlan: null,
  };
}

/**
 * Build the NPC fill plan (R80: 2-10s natural join delays; the rest fill the
 * instant the human-wait deadline passes). Deterministic given `random`.
 *
 * C14/O7: actually reads `tunables.npcFillDensity.default.minHumans` (fed by
 * the console's O7 switch via `effectiveTunables`, previously read nowhere
 * -- the fill plan always filled every seat with an NPC regardless of the
 * O7 selection). When the active alternative requires >=2 humans and this
 * single-device build only ever has ONE real human seated, the honest
 * single-device semantics (documented on the console's O7 row too) are:
 * hold the shortfall seat(s) open ("waiting for a 2nd human") instead of
 * NPC-filling them immediately -- `lobby.reservedForHumanSeats` records
 * which -- released by `advanceLobby`'s own O7 fallback once the O6 wait
 * deadline passes (a lobby cannot wait forever; see advanceLobby below).
 */
export function buildFillPlan(lobby, tunables, treatment, random = Math.random) {
  const [minDelay, maxDelay] = tunables.timers.npcJoinDelayRangeSec;
  const usedNames = new Set(lobby.seats.filter(Boolean).map((s) => s.name));
  const currentHumans = lobby.seats.filter((s) => s && s.kind === 'human').length;
  const minHumans = (tunables.npcFillDensity && tunables.npcFillDensity.default && tunables.npcFillDensity.default.minHumans) || 0;
  const shortfall = Math.max(0, minHumans - currentHumans);

  const emptySeatIndexes = [];
  for (let i = 0; i < lobby.seats.length; i++) if (!lobby.seats[i]) emptySeatIndexes.push(i);
  const reservedForHuman = shortfall > 0 ? emptySeatIndexes.slice(0, shortfall) : [];
  lobby.reservedForHumanSeats = reservedForHuman;

  const plan = [];
  for (const i of emptySeatIndexes) {
    if (reservedForHuman.includes(i)) continue; // held open for a 2nd human, not NPC-filled (yet)
    const npc = generateNpcSeat(tunables, treatment, usedNames, random);
    usedNames.add(npc.name);
    const naturalDelayMs = randInt(minDelay, maxDelay, random) * 1000;
    const arrivesAt = Math.min(lobby.createdAt + naturalDelayMs, lobby.humanWaitDeadline);
    plan.push({ seatIndex: i, npc, arrivesAt });
  }
  plan.sort((a, b) => a.arrivesAt - b.arrivesAt);
  lobby.fillPlan = plan;
  return plan;
}

/** Apply any plan entries whose arrival time has passed; if the human-wait
 * deadline itself has passed, fill everything still empty immediately.
 *
 * C14/O7: once the wait deadline passes, any seat reserved for a 2nd human
 * that never arrived falls back to an NPC fill too (O7's own rule: the wait
 * is bounded by O6, not unbounded) -- `opts.treatment`/`opts.tunables` are
 * only needed for that fallback path; existing callers that never set the
 * alternative (or don't pass an opts object at all) are unaffected, since
 * `reservedForHumanSeats` is empty under the default O7 selection. */
export function advanceLobby(lobby, now, opts = {}) {
  const { treatment = null, tunables = null, random = Math.random } = opts;
  if (!lobby.fillPlan) return lobby;
  const pastDeadline = now >= lobby.humanWaitDeadline;
  for (const entry of lobby.fillPlan) {
    if (lobby.seats[entry.seatIndex]) continue;
    if (now >= entry.arrivesAt || pastDeadline) {
      lobby.seats[entry.seatIndex] = { kind: 'npc', npcTag: true, ...entry.npc };
    }
  }
  if (pastDeadline && lobby.reservedForHumanSeats && lobby.reservedForHumanSeats.length && treatment && tunables) {
    const usedNames = new Set(lobby.seats.filter(Boolean).map((s) => s.name));
    for (const i of lobby.reservedForHumanSeats) {
      if (lobby.seats[i]) continue;
      const npc = generateNpcSeat(tunables, treatment, usedNames, random);
      usedNames.add(npc.name);
      lobby.seats[i] = { kind: 'npc', npcTag: true, ...npc };
    }
    lobby.reservedForHumanSeats = [];
  }
  if (lobby.seats.every(Boolean) && lobby.phase === LOBBY_PHASE.SEATING) {
    lobby.phase = LOBBY_PHASE.COUNTDOWN;
    lobby.boardStartAt = now + tunablesBoardCountdownMs(lobby);
  }
  return lobby;
}

// board countdown is fixed at 30s per R80; kept as a helper so a future
// tunables read can replace it without touching call sites.
function tunablesBoardCountdownMs(lobby) {
  return 30 * 1000;
}

export function isReadyForBoard(lobby, now) {
  return lobby.phase === LOBBY_PHASE.COUNTDOWN && lobby.boardStartAt != null && now >= lobby.boardStartAt;
}

// ---- Commit window (R81) ---------------------------------------------------

export function createCommitWindow(tunables, now, commitWindowSecOverride = null) {
  const sec = commitWindowSecOverride ?? tunables.timers.commitWindowSec.default;
  return { openedAt: now, deadline: now + sec * 1000, commits: {} };
}

/** Player (or NPC) commits real moves before the deadline. */
export function recordCommit(window, seatId, moves, now) {
  if (window.commits[seatId]) return window.commits[seatId]; // idempotent within a window
  if (now > window.deadline) throw new Error('recordCommit: window already closed for this seat');
  window.commits[seatId] = { moves, hesitated: false, ts: now };
  return window.commits[seatId];
}

/** A missed clock auto-commits — R81/CB-BUILD-009r: the OWNER reversed the
 * round-1 preserve-partial rule on 2026-09-15 (a rule that only holds when
 * the device is online at the instant of expiry is the worst experience of
 * all). A missed clock now commits a uniform-random FIVE-move sequence —
 * the WHOLE hand, including any rounds the player already picked — flagged
 * "hesitated" and excluded from staked-duel metrics (R42). The duel
 * proceeds without the player and earns nothing in their favour. This is
 * the untouched full-random path from before CB-BUILD-009's round-1 patch;
 * there is no picked-moves parameter to seed partial survival — every
 * round is re-rolled, every time.
 */
export function autoCommitHesitated(window, seatId, now, random = Math.random) {
  if (window.commits[seatId]) return window.commits[seatId];
  if (now < window.deadline) return null; // not missed yet
  const moves = [0, 1, 2, 3, 4].map(() => Math.floor(random() * 3));
  window.commits[seatId] = { moves, hesitated: true, ts: now };
  return window.commits[seatId];
}


// ---- Intermission (R81) -----------------------------------------------------

export function createIntermission(tunables, now, random = Math.random) {
  const [min, max] = tunables.timers.intermissionRangeSec;
  const durationSec = randInt(min, max, random);
  return { startedAt: now, endsAt: now + durationSec * 1000 };
}

export function intermissionOver(intermission, now) {
  return now >= intermission.endsAt;
}
