// app/tests/session.test.js — C19/R67/§15.11: real app-session tracking.
// `computeSessionNumber` is the pure, fully-testable core (no browser
// storage needed); `getOrCreateSessionNumber`'s thin localStorage/
// sessionStorage glue is exercised implicitly through it and is not,
// itself, unit-testable in Node without a DOM (same as the rest of
// app/ui/session.js -- see app/README.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSessionNumber, NEW_SESSION_GAP_MS } from '../ui/session.js';

test('computeSessionNumber: a brand-new install starts at session 1', () => {
  const { number, meta } = computeSessionNumber(null, { now: 1000 });
  assert.equal(number, 1);
  assert.equal(meta.number, 1);
  assert.equal(meta.startedAt, 1000);
});

test('C19: two deposits in the same session get the SAME sessionNumber', () => {
  const first = computeSessionNumber(null, { now: 1000 });
  // second call, a minute later, same tab (isNewTab: false), well under the gap
  const second = computeSessionNumber(first.meta, { now: 1000 + 60_000, isNewTab: false });
  assert.equal(second.number, first.number);
});

test('C19: a >=30-minute gap starts a NEW session (incremented number)', () => {
  const first = computeSessionNumber(null, { now: 1000 });
  const second = computeSessionNumber(first.meta, { now: 1000 + NEW_SESSION_GAP_MS, isNewTab: false });
  assert.equal(second.number, first.number + 1);
});

test('C19: just under the gap threshold stays the SAME session', () => {
  const first = computeSessionNumber(null, { now: 1000 });
  const second = computeSessionNumber(first.meta, { now: 1000 + NEW_SESSION_GAP_MS - 1, isNewTab: false });
  assert.equal(second.number, first.number);
});

test('C19: a fresh tab (isNewTab: true) starts a new session even with no time gap', () => {
  const first = computeSessionNumber(null, { now: 1000 });
  const second = computeSessionNumber(first.meta, { now: 1001, isNewTab: true });
  assert.equal(second.number, first.number + 1);
});

test('C19: three consecutive same-session calls keep advancing lastSeenAt without bumping the number', () => {
  let state = computeSessionNumber(null, { now: 0 });
  state = computeSessionNumber(state.meta, { now: 1000, isNewTab: false });
  state = computeSessionNumber(state.meta, { now: 2000, isNewTab: false });
  assert.equal(state.number, 1);
  assert.equal(state.meta.lastSeenAt, 2000);
});
