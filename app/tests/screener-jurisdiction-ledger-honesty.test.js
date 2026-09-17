// app/tests/screener-jurisdiction-ledger-honesty.test.js — N-A2 re-probe
// fix (advisory, R41/AC0 ledger honesty).
//
// F1's A2 fix stopped `screener.js` from writing a fabricated `age18: true`
// attestation for a jurisdiction-blocked player (whose DOB is never
// collected -- R70's jurisdiction pre-check rejects before the DOB step
// ever renders), replacing it with the honest `age18: null` ("not
// attested"). But `Game#submitScreener` (game.js) derived its `reasons`
// array from `!age18` -- true for BOTH `age18 === false` (a genuine,
// attested "under 18" fact) AND `age18 === null` ("never asked at all") --
// so a jurisdiction-blocked player's SCREENER_RESULT ledger event landed
// with `reasons: ['under_18', 'jurisdiction_restricted']`: a NEW
// fabrication (a false age claim) replacing the old one. `SCREENER_RESULT`
// has no separate `age18` field of its own on the ledger at all -- `reasons`
// IS the durable record a later audit reads, so this was a real ledger
// honesty defect, not a cosmetic one.
//
// Fixed (game.js#submitScreener): only `age18 === false` (the genuine
// attested fact) writes `under_18`; `age18 === null` writes neither age
// reason. A jurisdiction-blocked row now carries EXACTLY
// `['jurisdiction_restricted']`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { installFakeDom, uninstallFakeDom } from './helpers/dom-harness.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGame(seed = 1) {
  const ledger = new Ledger(createMemoryStorage());
  return { ledger, game: new Game({ ledger, tunables, treatment, playerId: 'p1', seed }) };
}

test('N-A2/R41+AC0 (defect repro, pre-fix shape): a jurisdiction-blocked player with age18:null must NOT carry under_18 in reasons', () => {
  const { game } = freshGame();
  const result = game.submitScreener({ age18: null, jurisdictionOk: false }, 1000);
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ['jurisdiction_restricted'], 'expected EXACTLY jurisdiction_restricted -- no fabricated under_18 for a DOB that was never collected');
  assert.ok(!result.reasons.includes('under_18'), 'expected no under_18 reason when age18 was never attested (null)');
});

test('N-A2/R41+AC0: the SCREENER_RESULT ledger event itself (not just the return value) carries the honest reasons array', () => {
  const { game, ledger } = freshGame();
  game.submitScreener({ age18: null, jurisdictionOk: false }, 1000);
  const events = ledger.byType(EVENT_TYPES.SCREENER_RESULT);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload.reasons, ['jurisdiction_restricted']);
  assert.equal(events[0].payload.passed, false);
});

test('N-A2/R41+AC0: a GENUINE under-18 attestation (age18 === false, a real DOB was entered) still writes under_18 -- the fix narrows the check, it does not remove the real case', () => {
  const { game } = freshGame();
  const result = game.submitScreener({ age18: false, jurisdictionOk: true }, 1000);
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ['under_18']);
});

test('N-A2/R41+AC0: age18 === true (attested 18+) still passes cleanly when jurisdiction is also permitted -- no regression on the happy path', () => {
  const { game } = freshGame();
  const result = game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  assert.equal(result.passed, true);
  assert.deepEqual(result.reasons, []);
});

test('N-A2/R41+AC0: the defensive (not reachable via the shipped UI) case -- a GENUINE under-18 attestation that is ALSO jurisdiction-blocked -- still carries BOTH real reasons (this fix narrows null-vs-false, it does not suppress a genuine double failure)', () => {
  const { game } = freshGame();
  const result = game.submitScreener({ age18: false, jurisdictionOk: false }, 1000);
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ['under_18', 'jurisdiction_restricted']);
});

// ---- end to end: the real screener.js -> Game#submitScreener pipeline,
// through the fake-DOM harness, proves the UI's actual null-passing
// behavior (not just a hand-constructed engine call) lands honestly on
// the ledger.
test('N-A2/R41+AC0 end-to-end: the real screener.js jurisdiction pre-check path (age18: null) lands on the ledger as jurisdiction_restricted alone', async () => {
  installFakeDom();
  try {
    const { mountScreener } = await import('../ui/screens/screener.js');
    const { game, ledger } = freshGame();
    const ctx = {
      treatment, game,
      detectLocation: () => ({ permitted: false, region: 'XX' }),
      router: { navigate: () => {} },
    };
    mountScreener(ctx);
    const events = ledger.byType(EVENT_TYPES.SCREENER_RESULT);
    assert.equal(events.length, 1, 'expected the jurisdiction pre-check to submit exactly once, with no DOB step ever rendered');
    assert.deepEqual(events[0].payload.reasons, ['jurisdiction_restricted'], 'expected the real screener.js -> game.js pipeline to land the honest reasons array, not a fabricated under_18');
  } finally {
    uninstallFakeDom();
  }
});
