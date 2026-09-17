// app/tests/retention.test.js — R41-R50 exact per-player definitions, pure
// functions over synthetic ledger events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as retention from '../engine/retention.js';
import { EVENT_TYPES } from '../engine/ledger.js';

const DAY = 24 * 60 * 60 * 1000;

function ev(type, playerId, ts, payload = {}) {
  return { type, playerId, ts, payload, schemaVersion: 1, key: `${type}-${ts}-${Math.random()}` };
}

test('computeAnchor: the timestamp the first bracket concludes (elimination), all duels staked', () => {
  const t0 = 1_000_000;
  const events = [
    ev(EVENT_TYPES.CHARACTER_ELIMINATED, 'p1', t0, { bracketId: 'b1', allDuelsStaked: true }),
    ev(EVENT_TYPES.CHARACTER_ELIMINATED, 'p1', t0 + DAY, { bracketId: 'b2', allDuelsStaked: true }),
  ];
  assert.equal(retention.computeAnchor(events, 'p1'), t0);
});

test('computeAnchor: a bracket win also anchors', () => {
  const t0 = 5000;
  const events = [ev(EVENT_TYPES.CHARACTER_ADVANCED, 'p1', t0, { bracketId: 'b1', wonBracket: true })];
  assert.equal(retention.computeAnchor(events, 'p1'), t0);
});

test('dayIndex / weekIndex: anchor-relative, independent of calendar', () => {
  const anchor = 1_000_000;
  assert.equal(retention.dayIndex(anchor, anchor), 0);
  assert.equal(retention.dayIndex(anchor + DAY, anchor), 1);
  assert.equal(retention.dayIndex(anchor + DAY * 7.5, anchor), 7);
  assert.equal(retention.weekIndex(0), 0);
  assert.equal(retention.weekIndex(1), 1);
  assert.equal(retention.weekIndex(7), 1);
  assert.equal(retention.weekIndex(8), 2);
});

test('d1Return: true iff a staked duel resolves inside day 1', () => {
  const anchor = 0;
  const events = [ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', DAY + 1000, { staked: true })];
  assert.equal(retention.d1Return(events, 'p1', anchor), true);
  const noReturn = [ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', DAY * 2 + 1000, { staked: true })];
  assert.equal(retention.d1Return(noReturn, 'p1', anchor), false);
});

test('d1Return: hesitated auto-commits do not count (R42 exclusion)', () => {
  const anchor = 0;
  const events = [ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', DAY + 1000, { staked: true, hesitated: true })];
  assert.equal(retention.d1Return(events, 'p1', anchor), false);
});

test('d7Return: true iff a staked duel resolves inside days 6-8', () => {
  const anchor = 0;
  assert.equal(retention.d7Return([ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', 6 * DAY + 1, { staked: true })], 'p1', anchor), true);
  assert.equal(retention.d7Return([ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', 8 * DAY + 1, { staked: true })], 'p1', anchor), true);
  assert.equal(retention.d7Return([ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', 9 * DAY + 1, { staked: true })], 'p1', anchor), false);
});

test('weeklyReturner: needs week 4 and >=2 of weeks 1-3', () => {
  const anchor = 0;
  const mk = (day) => ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', day * DAY + 1, { staked: true });
  const qualifies = [mk(2), mk(10), mk(25)]; // week1, week2, week4
  assert.equal(retention.weeklyReturner(qualifies, 'p1', anchor), true);
  const notEnough = [mk(2), mk(25)]; // only week1 + week4
  assert.equal(retention.weeklyReturner(notEnough, 'p1', anchor), false);
});

test('replayAfterLoss: a fresh bracket entry the same anchor-relative day as an elimination', () => {
  const anchor = 0;
  const elimTs = 2 * DAY + 1000;
  const sameDayEntry = elimTs + 5000;
  const events = [
    ev(EVENT_TYPES.CHARACTER_ELIMINATED, 'p1', elimTs, { bracketId: 'b1' }),
    ev(EVENT_TYPES.SYNC_LOBBY_JOINED, 'p1', sameDayEntry, { freshEntry: true }),
  ];
  assert.equal(retention.replayAfterLoss(events, 'p1', anchor), true);
});

test('replayAfterLoss: false when the next entry falls on a later day', () => {
  const anchor = 0;
  const elimTs = 2 * DAY + 1000;
  const nextDayEntry = 3 * DAY + 1000;
  const events = [
    ev(EVENT_TYPES.CHARACTER_ELIMINATED, 'p1', elimTs, { bracketId: 'b1' }),
    ev(EVENT_TYPES.SYNC_LOBBY_JOINED, 'p1', nextDayEntry, { freshEntry: true }),
  ];
  assert.equal(retention.replayAfterLoss(events, 'p1', anchor), false);
});

test('bustToTopUp: seconds from zero-stake to the next confirmed deposit (practice-mode flat payload shape)', () => {
  const bustTs = 10_000;
  const depositTs = 70_000;
  const events = [
    ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', bustTs, { staked: true, stakeAfter: 0, characterId: 'c1' }),
    ev(EVENT_TYPES.LOAD_FUNDS_DEPOSIT, 'p1', depositTs, { amountUSD: 10 }),
  ];
  const [result] = retention.bustToTopUp(events, 'p1');
  assert.equal(result.seconds, 60);
});

test('CB-BUILD-018/R49 (defect repro + fix): bustToTopUp pairs a BRACKET-duel bust (nested payload.combatants) with the next deposit, same as the flat-payload practice-mode case above', () => {
  const bustTs = 20_000;
  const depositTs = 50_000;
  const events = [
    ev(EVENT_TYPES.CHARACTER_SUMMONED, 'p1', 1000, { characterId: 'c-human' }),
    // A bracket DUEL_RESOLVED carries BOTH seats' stake nested in
    // `combatants` -- no flat `payload.stakeAfter` at all. The human's own
    // seat busts to zero; the NPC opponent's seat does not.
    ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', bustTs, {
      bracketId: 'b1', roundIndex: 0, matchIndex: 0, staked: true, hesitated: false,
      combatants: [
        { characterId: 'c-human', tier: 0, won: false, stakeBefore: 40, stakeAfter: 0 },
        { characterId: 'c-npc', tier: 0, won: true, stakeBefore: 60, stakeAfter: 100 },
      ],
    }),
    ev(EVENT_TYPES.LOAD_FUNDS_DEPOSIT, 'p1', depositTs, { amountUSD: 10 }),
  ];
  const results = retention.bustToTopUp(events, 'p1');
  assert.equal(results.length, 1, 'expected exactly one bust -- the opponent seat zeroing is not the player\'s bust');
  assert.equal(results[0].characterId, 'c-human');
  assert.equal(results[0].seconds, 30);
});

test('CB-BUILD-018/R49: an opponent seat reaching zero stake in a bracket duel is NOT counted as the player\'s bust', () => {
  const events = [
    ev(EVENT_TYPES.CHARACTER_SUMMONED, 'p1', 1000, { characterId: 'c-human' }),
    ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', 20_000, {
      bracketId: 'b1', roundIndex: 0, matchIndex: 0, staked: true, hesitated: false,
      combatants: [
        { characterId: 'c-human', tier: 0, won: true, stakeBefore: 100, stakeAfter: 140 },
        { characterId: 'c-npc', tier: 0, won: false, stakeBefore: 40, stakeAfter: 0 },
      ],
    }),
  ];
  assert.deepEqual(retention.bustToTopUp(events, 'p1'), []);
});

test('CB-BUILD-018 fix round f4 advisory: an event carrying BOTH the flat stakeAfter shape AND a nested combatants shape does not double-count the same bust as two identical records (not reachable from any shipped writer today, but the matcher must not do it if it ever happened)', () => {
  const events = [
    ev(EVENT_TYPES.CHARACTER_SUMMONED, 'p1', 1000, { characterId: 'c-human' }),
    ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', 20_000, {
      staked: true, hesitated: false, characterId: 'c-human', stakeAfter: 0,
      combatants: [{ characterId: 'c-human', tier: 0, won: false, stakeBefore: 40, stakeAfter: 0 }],
    }),
    ev(EVENT_TYPES.LOAD_FUNDS_DEPOSIT, 'p1', 50_000, { amountUSD: 10 }),
  ];
  const results = retention.bustToTopUp(events, 'p1');
  assert.equal(results.length, 1, 'expected exactly ONE bust record, not two identical ones, when an event carries both payload shapes');
});

test('reservationRecord: once per account, with day index/tier/character state', () => {
  const anchor = 0;
  const events = [ev(EVENT_TYPES.RESERVATION_PRESSED, 'p1', 3 * DAY, { tier: 1, characterState: 'ACTIVE' })];
  const rec = retention.reservationRecord(events, 'p1', anchor);
  assert.equal(rec.dayIndex, 3);
  assert.equal(rec.tier, 1);
  assert.equal(rec.characterState, 'ACTIVE');
});

test('qualifiedActivation: only counts a passed screener result', () => {
  const events = [ev(EVENT_TYPES.SCREENER_RESULT, 'p1', 100, { passed: false })];
  assert.equal(retention.qualifiedActivation(events, 'p1'), null);
  events.push(ev(EVENT_TYPES.SCREENER_RESULT, 'p1', 200, { passed: true }));
  assert.ok(retention.qualifiedActivation(events, 'p1'));
});

test('recomputation determinism (invariant #10): calling twice on the same raw events yields the same value', () => {
  const anchor = 0;
  const events = [ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', DAY + 1, { staked: true })];
  assert.equal(retention.d1Return(events, 'p1', anchor), retention.d1Return([...events], 'p1', anchor));
});

// ---- CB-BUILD-017/AC1: link -> first duel, measured to the first seal -----

test('CB-BUILD-017/AC1: linkToFirstSeal falls back to ACCOUNT_CREATED (no LINK_OPENED event present -- e.g. a ledger fixture that predates the f4 fix) measuring to the player\'s own SYNC_COMMIT (the real seal press), not the round\'s resolution', () => {
  const linkTs = 1_000;
  const sealTs = 1_000 + 90 * 1000; // 90s later
  const events = [
    ev(EVENT_TYPES.ACCOUNT_CREATED, 'p1', linkTs, {}),
    ev(EVENT_TYPES.SYNC_COMMIT, 'p1', sealTs, { bracketId: 'b1', roundIndex: 0, matchIndex: 0 }),
  ];
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.equal(result.hesitated, false);
  assert.equal(result.seconds, 90);
});

test('CB-BUILD-017 fix round f4/Finding 2: linkToFirstSeal measures from LINK_OPENED (the moment the player reaches the app), NOT from ACCOUNT_CREATED (which A15 restricted to firing only once the screener PASSES) -- the finding\'s own repro: link t=0, screener pass t=40s, first seal t=100s. The old code reported 60s (biased downward against AC1\'s bar); this must report the true 100s', () => {
  const events = [
    ev(EVENT_TYPES.LINK_OPENED, 'p1', 0, {}),
    ev(EVENT_TYPES.SCREENER_RESULT, 'p1', 40_000, { passed: true, reasons: [], attempt: 0 }),
    ev(EVENT_TYPES.ACCOUNT_CREATED, 'p1', 40_000, {}), // ensureAccount fires ON PASS (A15) -- same ts as the pass, NOT the link
    ev(EVENT_TYPES.SYNC_COMMIT, 'p1', 100_000, {}),
  ];
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.equal(result.hesitated, false);
  assert.equal(result.linkTs, 0, 'expected the clock to start at LINK_OPENED, not ACCOUNT_CREATED');
  assert.equal(result.seconds, 100, 'expected 100s (link t=0 to seal t=100s) -- the pre-fix code reported 60s (screener-pass t=40s to seal t=100s)');
});

test('CB-BUILD-017 fix round f4/Finding 2: a player who reaches the app, WAITS, then passes the screener -- the wait itself counts toward the clock (it used to be silently excluded)', () => {
  const events = [
    ev(EVENT_TYPES.LINK_OPENED, 'p1', 0, {}),
    // A long read of the R8a copy + DOB entry + jurisdiction check before submitting.
    ev(EVENT_TYPES.SCREENER_RESULT, 'p1', 75_000, { passed: true, reasons: [], attempt: 0 }),
    ev(EVENT_TYPES.ACCOUNT_CREATED, 'p1', 75_000, {}),
    ev(EVENT_TYPES.SYNC_COMMIT, 'p1', 95_000, {}),
  ];
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.equal(result.seconds, 95, 'expected the 75s screener wait to be included in the clock, not stripped out');
});

test('CB-BUILD-017 fix round f4/Finding 2: a hesitated first duel followed by a sealed second duel -- the FIRST duel (hesitated) still governs, measured from LINK_OPENED', () => {
  const events = [
    ev(EVENT_TYPES.LINK_OPENED, 'p1', 0, {}),
    ev(EVENT_TYPES.SCREENER_RESULT, 'p1', 20_000, { passed: true, reasons: [], attempt: 0 }),
    ev(EVENT_TYPES.ACCOUNT_CREATED, 'p1', 20_000, {}),
    ev(EVENT_TYPES.SYNC_HESITATED, 'p1', 50_000, {}), // first duel: hesitated (missed clock, R81)
    ev(EVENT_TYPES.SYNC_COMMIT, 'p1', 90_000, {}), // second duel: a real seal, but NOT the first
  ];
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.equal(result.hesitated, true, 'expected the FIRST duel (hesitated) to govern, not the later sealed one');
  assert.equal(result.seconds, null);
  assert.equal(result.firstDuelTs, 50_000);
});

test('CB-BUILD-017/AC1: a first duel that times out (SYNC_HESITATED) is recorded but earns no credit -- hesitated:true, seconds:null, excluded from any numerator a caller builds', () => {
  const linkTs = 1_000;
  const hesitatedTs = 1_000 + 30 * 1000;
  const events = [
    ev(EVENT_TYPES.ACCOUNT_CREATED, 'p1', linkTs, {}),
    ev(EVENT_TYPES.SYNC_HESITATED, 'p1', hesitatedTs, { bracketId: 'b1', roundIndex: 0, matchIndex: 0 }),
  ];
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.equal(result.hesitated, true, 'expected the timed-out first duel to be recorded as hesitated');
  assert.equal(result.seconds, null, 'expected no seconds figure -- it earns no credit toward the bar');
});

test('CB-BUILD-017/AC1: linkToFirstSeal reads only the FIRST of the player\'s SYNC_COMMIT/SYNC_HESITATED events, ignoring later duels entirely', () => {
  const linkTs = 0;
  const events = [
    ev(EVENT_TYPES.ACCOUNT_CREATED, 'p1', linkTs, {}),
    ev(EVENT_TYPES.SYNC_HESITATED, 'p1', 60_000, {}), // first duel: hesitated
    ev(EVENT_TYPES.SYNC_COMMIT, 'p1', 120_000, {}), // second duel: a real seal, but NOT the first
  ];
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.equal(result.hesitated, true, 'expected the FIRST duel (hesitated) to govern, not the later real seal');
  assert.equal(result.seconds, null);
});

test('CB-BUILD-017/AC1: linkToFirstSeal returns null when the player has no account-created event, or no duel yet', () => {
  assert.equal(retention.linkToFirstSeal([], 'p1'), null);
  const events = [ev(EVENT_TYPES.ACCOUNT_CREATED, 'p1', 0, {})];
  assert.equal(retention.linkToFirstSeal(events, 'p1'), null, 'expected null -- no first duel has happened yet');
});

test('CB-BUILD-017 fix round f4/Finding 2: when both LINK_OPENED and ACCOUNT_CREATED are present, LINK_OPENED strictly wins even if it sorts later in the array (defends against relying on array order instead of event type)', () => {
  const events = [
    ev(EVENT_TYPES.ACCOUNT_CREATED, 'p1', 40_000, {}),
    ev(EVENT_TYPES.LINK_OPENED, 'p1', 0, {}),
    ev(EVENT_TYPES.SYNC_COMMIT, 'p1', 100_000, {}),
  ];
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.equal(result.seconds, 100);
});


