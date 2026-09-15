// app/tests/cb-fix-round-1-preload-gate.test.js
// CB-BUILD-fix-round-1 #8: the incumbent's preload gate is BOUNDED. Before
// this fix, prepareIncumbentStage() had no timeout/cancel/cap — one stalled
// bucket (a fetch that never settles) stranded the player on "SUMMONING
// COMBATANTS…" forever, AFTER the ledger had already resolved the duel,
// with no navigation out. The bound degrades to the EXISTING stageFailed
// path (dark provisional field — duel watchable and completable, result
// card reachable); the happy path is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boundStagePreload, STAGE_PRELOAD_TIMEOUT_MS } from '../ui/screens/duel.js';

const duelSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/duel.js'), 'utf8');

// A minimal fake timer: captures scheduled callbacks; fire() runs them.
function fakeTimers() {
  const scheduled = [];
  return {
    setTimeoutFn: (fn, ms) => { const h = { fn, ms, cleared: false }; scheduled.push(h); return h; },
    clearTimeoutFn: (h) => { if (h) h.cleared = true; },
    fire: () => { for (const h of scheduled) if (!h.cleared) h.fn(); },
    scheduled,
  };
}

test('CB-BUILD-fix-round-1 #8: a loader that NEVER settles resolves the gate via the timeout, flagged as a degrade (ok:false, timedOut:true)', async () => {
  const timers = fakeTimers();
  const never = new Promise(() => {}); // the stalled bucket
  const gatePromise = boundStagePreload(never, { setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  assert.equal(timers.scheduled.length, 1, 'the bound must schedule exactly one timeout');
  assert.equal(timers.scheduled[0].ms, STAGE_PRELOAD_TIMEOUT_MS, 'the timeout uses the named constant');
  timers.fire(); // the budget elapses; the loader still has not settled
  const gate = await gatePromise;
  assert.deepEqual(gate, { ok: false, timedOut: true }, 'a stalled preload must resolve the gate as a timed-out degrade — never strand');
});

test('CB-BUILD-fix-round-1 #8: the happy path is unchanged — a preload that settles in time resolves ok:true and clears its timer', async () => {
  const timers = fakeTimers();
  const gate = await boundStagePreload(Promise.resolve(), { setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  assert.deepEqual(gate, { ok: true, timedOut: false });
  assert.equal(timers.scheduled[0].cleared, true, 'the timeout must be cleared once the preload fulfills');
  timers.fire(); // firing a cleared timer must not flip the settled result
  assert.deepEqual(gate, { ok: true, timedOut: false });
});

test('CB-BUILD-fix-round-1 #8: a preload that REJECTS still resolves the gate (ok:false) — the pre-existing degrade semantics are preserved, never a rejection', async () => {
  const timers = fakeTimers();
  const gate = await boundStagePreload(Promise.reject(new Error('no shape source')), { setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  assert.deepEqual(gate, { ok: false, timedOut: false });
});

test('CB-BUILD-fix-round-1 #8: the gate resolves exactly once even if the loader settles AFTER the timeout fired', async () => {
  const timers = fakeTimers();
  let settleLate;
  const late = new Promise((resolve) => { settleLate = resolve; });
  const gatePromise = boundStagePreload(late, { setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  timers.fire();
  const first = await gatePromise;
  assert.deepEqual(first, { ok: false, timedOut: true });
  settleLate(); // the stalled bucket finally lands — must not re-resolve
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await gatePromise, { ok: false, timedOut: true }, 'the gate is settle-once');
});

test('CB-BUILD-fix-round-1 #8: duel.js wires the bound into the incumbent gate — degrade sets stageFailed and STILL starts the timeline (result card reachable)', () => {
  assert.ok(
    /boundStagePreload\(prepareIncumbentStage\(\)\)\s*\.then\(\(gate\) => \{ if \(!gate\.ok\) stageFailed = true; \}\)\s*\.then\(\(\) => startTimeline\(\)\)/.test(duelSrc),
    'expected the incumbent preload gate to run through boundStagePreload, degrade to stageFailed on !ok, and always start the timeline'
  );
  // CB-BUILD-fix-round-2 (re-review A): the late-settle guard is HOISTED
  // ABOVE the constructor. createBattleStage's first statement is the
  // module-global destroyActiveBattleStage(), so the old post-constructor
  // guard let an orphan preload destroy a LATER duel's live stage before
  // self-destructing. The guard must now fire BEFORE createBattleStage —
  // an orphan (degraded, skipped, or unmounted duel) constructs nothing
  // and touches no module-global state.
  const guardRe = /if \(stageFailed \|\| cancelled \|\| !tugBarContainer\.isConnected\) return;/;
  assert.ok(guardRe.test(duelSrc), 'expected the hoisted orphan guard (stageFailed || cancelled || !tugBarContainer.isConnected) in prepareIncumbentStage');
  const guardIdx = duelSrc.search(guardRe);
  const ctorIdx = duelSrc.indexOf('battleStage = createBattleStage(');
  assert.ok(ctorIdx > -1, 'expected the incumbent stage constructor call');
  assert.ok(guardIdx < ctorIdx, 'the orphan guard must run BEFORE createBattleStage — the constructor\'s first statement destroys the module-global active stage');
  assert.ok(!/if \(stageFailed\) \{\s*battleStage\.destroy\(\);/.test(duelSrc), 'the old construct-then-destroy guard must be gone — an orphan never constructs at all');
});

test('CB-BUILD-fix-round-1 #8: the timeout is a named presentation constant in a sane band — no spec/economy/gate constant was touched', () => {
  assert.ok(STAGE_PRELOAD_TIMEOUT_MS >= 8000 && STAGE_PRELOAD_TIMEOUT_MS <= 12000, 'a sane 8–12s budget per the remediation order');
  assert.ok(duelSrc.includes('export const STAGE_PRELOAD_TIMEOUT_MS'), 'the constant is named and exported (tunable-style), not a magic number');
});
