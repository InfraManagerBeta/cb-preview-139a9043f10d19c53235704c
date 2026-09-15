// app/tests/ledger.test.js — §15.7/R83: idempotent, append-only, every event
// timestamped with a schema version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, createMemoryStorage, EVENT_TYPES, actionKey, isQuotaExceededError } from '../engine/ledger.js';

test('append: replaying the same idempotency key changes nothing (invariant #7)', () => {
  const ledger = new Ledger(createMemoryStorage());
  const key = actionKey('summon', 'char-1');
  const first = ledger.append({ key, type: EVENT_TYPES.CHARACTER_SUMMONED, playerId: 'p1', ts: 1000, payload: { characterId: 'char-1', stakeCheddar: 100 } });
  const second = ledger.append({ key, type: EVENT_TYPES.CHARACTER_SUMMONED, playerId: 'p1', ts: 2000, payload: { characterId: 'char-1', stakeCheddar: 999 } });
  assert.equal(ledger.all().length, 1);
  assert.equal(first.id, second.id);
  assert.equal(second.payload.stakeCheddar, 100); // the original event wins; the replay is a no-op
});

test('append: every event carries a schema version and a timestamp', () => {
  const ledger = new Ledger(createMemoryStorage());
  const e = ledger.append({ key: 'k1', type: EVENT_TYPES.SIGNUP_GRANT, playerId: 'p1', ts: 5000, payload: {} });
  assert.equal(e.schemaVersion, 1);
  assert.equal(e.ts, 5000);
});

test('append: requires an idempotency key', () => {
  const ledger = new Ledger(createMemoryStorage());
  assert.throws(() => ledger.append({ type: EVENT_TYPES.SIGNUP_GRANT, playerId: 'p1', payload: {} }));
});

test('ledger persists across instances sharing the same storage (append-only, durable)', () => {
  const storage = createMemoryStorage();
  const ledgerA = new Ledger(storage);
  ledgerA.append({ key: 'a', type: EVENT_TYPES.SIGNUP_GRANT, playerId: 'p1', ts: 1, payload: { amountUSD: 25 } });
  const ledgerB = new Ledger(storage);
  assert.equal(ledgerB.all().length, 1);
});

test('byPlayer / byType filter correctly', () => {
  const ledger = new Ledger(createMemoryStorage());
  ledger.append({ key: 'a', type: EVENT_TYPES.SIGNUP_GRANT, playerId: 'p1', ts: 1, payload: {} });
  ledger.append({ key: 'b', type: EVENT_TYPES.SCREENER_RESULT, playerId: 'p1', ts: 2, payload: { passed: true } });
  ledger.append({ key: 'c', type: EVENT_TYPES.SIGNUP_GRANT, playerId: 'p2', ts: 3, payload: {} });
  assert.equal(ledger.byPlayer('p1').length, 2);
  assert.equal(ledger.byType(EVENT_TYPES.SIGNUP_GRANT).length, 2);
  assert.equal(ledger.byPlayerAndType('p1', EVENT_TYPES.SIGNUP_GRANT).length, 1);
});

// A6: corrupt localStorage JSON must not throw at boot / paint a stack trace.
test('A6: corrupt stored JSON is quarantined, not thrown -- ledger starts fresh with a plain-language notice', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  storage.setItem('cheddarBattles.ledger.v1', '{not valid json!!');
  const ledger = new Ledger(storage);
  assert.doesNotThrow(() => ledger.all());
  assert.deepEqual(ledger.all(), []);
  assert.ok(ledger.notice && /could not be read/i.test(ledger.notice));
  // the corrupt blob is quarantined under a side key, not silently destroyed
  const found = [...store.keys()].some((k) => k.startsWith('cheddarBattles.ledger.v1.corrupt.'));
  assert.equal(found, true, 'expected the corrupt blob to be quarantined under a side key');
});

test('A6: a non-array stored JSON value is treated as corrupt too, not thrown', () => {
  const storage = createMemoryStorage();
  storage.setItem('cheddarBattles.ledger.v1', JSON.stringify({ not: 'an array' }));
  const ledger = new Ledger(storage);
  assert.doesNotThrow(() => ledger.append({ key: 'k', type: EVENT_TYPES.SIGNUP_GRANT, playerId: 'p1', ts: 1, payload: {} }));
  assert.equal(ledger.all().length, 1);
  assert.ok(ledger.notice);
});

test('A6: a QuotaExceededError on persist is caught and surfaces a named notice, without losing the in-memory append', () => {
  const storage = createMemoryStorage();
  const realSetItem = storage.setItem.bind(storage);
  let failNext = false;
  storage.setItem = (k, v) => {
    if (failNext && k === 'cheddarBattles.ledger.v1') {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return realSetItem(k, v);
  };
  const ledger = new Ledger(storage);
  failNext = true;
  assert.doesNotThrow(() => ledger.append({ key: 'k', type: EVENT_TYPES.SIGNUP_GRANT, playerId: 'p1', ts: 1, payload: {} }));
  assert.equal(ledger.all().length, 1); // still visible in-memory this session
  assert.ok(ledger.notice && /storage is full/i.test(ledger.notice));
});

test('isQuotaExceededError: recognizes the standard DOMException name and legacy code/message forms', () => {
  assert.equal(isQuotaExceededError({ name: 'QuotaExceededError' }), true);
  assert.equal(isQuotaExceededError({ code: 22 }), true);
  assert.equal(isQuotaExceededError({ code: 1014 }), true);
  assert.equal(isQuotaExceededError({ message: 'Quota exceeded' }), true);
  assert.equal(isQuotaExceededError({ name: 'TypeError', message: 'oops' }), false);
  assert.equal(isQuotaExceededError(null), false);
});
