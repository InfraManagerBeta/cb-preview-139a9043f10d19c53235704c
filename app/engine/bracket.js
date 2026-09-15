// app/engine/bracket.js
// R56: 8-seat single elimination. Quarterfinal -> semifinal -> final.
// Top half (seats 0-3) feeds the top semifinal; bottom half (seats 4-7)
// feeds the bottom semifinal. Pure structure/bookkeeping — actual duel
// resolution (moves, RNG) is supplied by the caller via recordMatchResult.

export const ROUND_NAMES = Object.freeze(['quarterfinal', 'semifinal', 'final']);

/**
 * @param {Array} seats exactly 8 entries, index = seed position 0..7.
 *   Each seat: { id, kind: 'human'|'npc', characterId, ... } — opaque to this module.
 */
export function createBracket(seats, { tier, createdAt } = {}) {
  if (!Array.isArray(seats) || seats.length !== 8) {
    throw new Error('createBracket: exactly 8 seats required');
  }
  const quarterfinals = [
    { seatA: 0, seatB: 1, winnerSeat: null, result: null },
    { seatA: 2, seatB: 3, winnerSeat: null, result: null },
    { seatA: 4, seatB: 5, winnerSeat: null, result: null },
    { seatA: 6, seatB: 7, winnerSeat: null, result: null },
  ];
  const semifinals = [
    { seatA: null, seatB: null, winnerSeat: null, result: null, feedsFrom: [0, 1] }, // top semi <- QF0, QF1
    { seatA: null, seatB: null, winnerSeat: null, result: null, feedsFrom: [2, 3] }, // bottom semi <- QF2, QF3
  ];
  const final = [
    { seatA: null, seatB: null, winnerSeat: null, result: null, feedsFrom: [0, 1] }, // <- semi0 (top), semi1 (bottom)
  ];
  return {
    tier,
    createdAt,
    seats,
    rounds: [quarterfinals, semifinals, final],
    currentRound: 0,
    champion: null,
    complete: false,
  };
}

export function getSeatEntry(bracket, seatIndex) {
  return bracket.seats[seatIndex];
}

/** Matches in the currently-live round that still need a result. */
export function pendingMatches(bracket) {
  const round = bracket.rounds[bracket.currentRound];
  return round
    .map((m, i) => ({ ...m, matchIndex: i, roundIndex: bracket.currentRound }))
    .filter((m) => m.winnerSeat === null && m.seatA !== null && m.seatB !== null);
}

/**
 * Record a match's winner (by seat index, one of the match's seatA/seatB),
 * propagate to the next round, and advance currentRound when the whole
 * round is decided.
 */
export function recordMatchResult(bracket, roundIndex, matchIndex, winnerSeat, resultMeta = null) {
  const round = bracket.rounds[roundIndex];
  const match = round[matchIndex];
  if (match.seatA !== winnerSeat && match.seatB !== winnerSeat) {
    throw new Error('recordMatchResult: winnerSeat must be one of the match seats');
  }
  match.winnerSeat = winnerSeat;
  match.result = resultMeta;

  if (roundIndex + 1 < bracket.rounds.length) {
    const nextRound = bracket.rounds[roundIndex + 1];
    for (const nextMatch of nextRound) {
      const [feedA, feedB] = nextMatch.feedsFrom;
      if (feedA === matchIndex) nextMatch.seatA = winnerSeat;
      if (feedB === matchIndex) nextMatch.seatB = winnerSeat;
    }
  }

  // f7/advisory-3: a replayed/reconstructed call for a round EARLIER than
  // where this bracket object already stands (bracket.currentRound already
  // advanced past roundIndex -- e.g. a reconstruct/converge call replaying
  // an earlier round's already-decided match onto an object that's moved
  // on) must not regress bracket.currentRound backward. Without this, a
  // bracket already at currentRound=2 (the final) that later replays a
  // quarterfinal (roundIndex=0) result onto itself -- completing that
  // round's OWN roundDone check -- would incorrectly reset currentRound to
  // 1, a real regression on inconsistent-by-construction input (the round
  // this call names is already behind where the bracket has progressed).
  // f8: the earlier "still idempotent/harmless either way" claim about the
  // stamping/feed-forward above was NOT universally true -- a replay of an
  // earlier round with a DIFFERENT winnerSeat than was originally recorded
  // would rewrite the next round's already-fed seatA/seatB out from under
  // it, a real corruption, not a no-op. That path is UNREACHABLE from the
  // Game layer in practice: every caller here is check-before-compute (it
  // returns the ledger's own already-persisted winner on a replay, never a
  // freshly recomputed one), so a real call can only ever replay the SAME
  // winnerSeat. This early-out only closes the round-advance (currentRound)
  // half of that gap; it does not by itself make the stamping/feed-forward
  // above safe against a different-winner replay -- that safety comes from
  // the caller's own check-before-compute discipline, not from this guard.
  if (roundIndex + 1 < bracket.currentRound) return bracket;

  const roundDone = round.every((m) => m.winnerSeat !== null);
  if (roundDone) {
    if (roundIndex + 1 < bracket.rounds.length) {
      bracket.currentRound = roundIndex + 1;
    } else {
      bracket.complete = true;
      bracket.champion = winnerSeat;
    }
  }
  return bracket;
}

export function bracketRoundName(roundIndex) {
  return ROUND_NAMES[roundIndex];
}
