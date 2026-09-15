// app/tests/bracket.test.js — R56: 8-seat single elimination structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBracket, pendingMatches, recordMatchResult, bracketRoundName } from '../engine/bracket.js';

function seats() {
  return Array.from({ length: 8 }, (_, i) => ({ id: `s${i}` }));
}

test('createBracket: exactly 8 seats required', () => {
  assert.throws(() => createBracket(seats().slice(0, 7)));
});

test('createBracket: quarterfinal pairing is (0,1)(2,3)(4,5)(6,7)', () => {
  const b = createBracket(seats());
  const qf = b.rounds[0];
  assert.deepEqual(qf.map((m) => [m.seatA, m.seatB]), [[0, 1], [2, 3], [4, 5], [6, 7]]);
});

test('top half (seats 0-3) feeds the top semifinal; bottom half feeds the bottom semifinal', () => {
  const b = createBracket(seats());
  recordMatchResult(b, 0, 0, 0); // QF0 (0v1) -> 0 wins
  recordMatchResult(b, 0, 1, 2); // QF1 (2v3) -> 2 wins
  recordMatchResult(b, 0, 2, 4); // QF2 (4v5) -> 4 wins
  recordMatchResult(b, 0, 3, 6); // QF3 (6v7) -> 6 wins
  const sf = b.rounds[1];
  assert.deepEqual([sf[0].seatA, sf[0].seatB], [0, 2]); // top semi <- QF0, QF1 winners
  assert.deepEqual([sf[1].seatA, sf[1].seatB], [4, 6]); // bottom semi <- QF2, QF3 winners
});

test('bracket completes after the final and names a champion', () => {
  const b = createBracket(seats());
  recordMatchResult(b, 0, 0, 0);
  recordMatchResult(b, 0, 1, 2);
  recordMatchResult(b, 0, 2, 4);
  recordMatchResult(b, 0, 3, 6);
  recordMatchResult(b, 1, 0, 0);
  recordMatchResult(b, 1, 1, 4);
  assert.equal(b.complete, false);
  recordMatchResult(b, 2, 0, 0);
  assert.equal(b.complete, true);
  assert.equal(b.champion, 0);
});

test('pendingMatches only returns matches with both seats known and unresolved', () => {
  const b = createBracket(seats());
  const pending = pendingMatches(b);
  assert.equal(pending.length, 4); // all 4 QF matches
  recordMatchResult(b, 0, 0, 0);
  recordMatchResult(b, 0, 1, 2);
  const afterTwo = pendingMatches(b);
  assert.equal(afterTwo.length, 2); // remaining QF matches; SF not seeded yet
});

test('round names in order', () => {
  assert.deepEqual([0, 1, 2].map(bracketRoundName), ['quarterfinal', 'semifinal', 'final']);
});

// ---- f7/advisory-3: recordMatchResult must not regress currentRound -----

test('f7/advisory-3: replaying an EARLIER round\'s already-decided match onto a bracket object that already advanced past it does not regress currentRound backward', () => {
  const b = createBracket(seats());
  // Advance the bracket all the way to the semifinal round (currentRound 1)
  // via the normal QF sweep.
  recordMatchResult(b, 0, 0, 0);
  recordMatchResult(b, 0, 1, 2);
  recordMatchResult(b, 0, 2, 4);
  recordMatchResult(b, 0, 3, 6);
  assert.equal(b.currentRound, 1, 'precondition: bracket has advanced to the semifinal round');

  // A replayed/reconstructed call for an EARLIER round (roundIndex 0) --
  // e.g. a converge call replaying an already-decided quarterfinal result
  // onto this SAME bracket object a second time (idempotent: same winner).
  // Before the fix, completing round 0's own roundDone check here (every
  // QF match already has a winnerSeat) unconditionally reset
  // bracket.currentRound to roundIndex+1 (=1) -- harmless in THIS exact
  // case only because 1 === 1, but the SAME code path regresses a bracket
  // already at currentRound=2 (the final) back down to 1 if any single QF
  // match is ever replayed after the semifinal decided (see the next
  // assertion below for the actual regression).
  recordMatchResult(b, 0, 0, 0); // replay QF0's SAME already-decided winner
  assert.equal(b.currentRound, 1, 'expected currentRound to stay at 1, not regress or otherwise misbehave on a same-round replay');

  // Advance further, to the final (currentRound 2).
  recordMatchResult(b, 1, 0, 0);
  recordMatchResult(b, 1, 1, 4);
  assert.equal(b.currentRound, 2, 'precondition: bracket has advanced to the final');

  // Now replay an EARLIER round (QF1, roundIndex 0) onto this SAME bracket
  // object -- e.g. a reconstruct/converge call for a quarterfinal match
  // arriving after the bracket has already moved on to the final. Without
  // the f7/advisory-3 early-out, QF round 0's OWN roundDone check
  // (every QF match still shows winnerSeat !== null) would fire again and
  // reset bracket.currentRound to 1 -- a real regression from 2 back to 1
  // on input that is inconsistent BY CONSTRUCTION (this round is already
  // behind where the bracket stands).
  recordMatchResult(b, 0, 1, 2); // QF1's SAME already-decided winner, replayed
  assert.equal(b.currentRound, 2, 'expected currentRound to stay at 2 -- must NEVER regress backward to 1 on a replayed earlier-round result');
  assert.equal(b.complete, false, 'the final itself has not been decided yet');
});

