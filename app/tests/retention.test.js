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

test('bustToTopUp: seconds from zero-stake to the next confirmed deposit', () => {
  const bustTs = 10_000;
  const depositTs = 70_000;
  const events = [
    ev(EVENT_TYPES.DUEL_RESOLVED, 'p1', bustTs, { staked: true, stakeAfter: 0, characterId: 'c1' }),
    ev(EVENT_TYPES.LOAD_FUNDS_DEPOSIT, 'p1', depositTs, { amountUSD: 10 }),
  ];
  const [result] = retention.bustToTopUp(events, 'p1');
  assert.equal(result.seconds, 60);
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
