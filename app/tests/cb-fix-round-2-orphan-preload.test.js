// app/tests/cb-fix-round-2-orphan-preload.test.js
// CB-BUILD-fix-round-2 (re-review item A): an ORPHAN late-settling preload
// must never touch a LATER duel's live stage.
//
// Fix round 1 (#8) bounded the preload gate, but its late-settle guard was
// closure-local and fired AFTER `battleStage = createBattleStage(...)` —
// whose FIRST statement is the module-global destroyActiveBattleStage(). So
// a preload that outlived its own duel (degraded at the bound, skipped, or
// unmounted) and settled while duel N+1's stage was live would destroy that
// stage's 20 players and clear its layer map (setVisible early-returns on
// !nextPlayer, so every subsequent showStep became a silent no-op), and
// silently reassign freeze-hook ownership to the orphan — before
// self-destructing. destroy() also never released hook ownership.
//
// The fix: (1) the guard is HOISTED ABOVE the constructor in duel.js's
// prepareIncumbentStage — `if (stageFailed || cancelled ||
// !tugBarContainer.isConnected) return;` runs BEFORE createBattleStage, so
// an orphan constructs NOTHING and fires NO global side effect (the related
// advisory closes with it: the orphan no longer constructs-then-destroys
// the 20 players); (2) stage.destroy() releases the presentation freeze
// hook when — and only when — this stage still owns it (identity-compared
// in sound.js's releasePresentationFreezeHook).
//
// duel.js itself cannot execute in this Node harness (it touches
// `document` at module scope — see app/README.md's node:test gotcha), so
// this reproduces the EXACT orphan shape prepareIncumbentStage wires
// (boundStagePreload + the hoisted guard + createBattleStage) against the
// REAL createBattleStage / sound.js modules on a minimal DOM stub; the
// companion static scan in cb-fix-round-1-preload-gate.test.js pins the
// guard's position inside duel.js source itself.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM stub (createBattleStage builds nodes via components/dom.js's
// el(); player.js stays inert without window.lottie, so no rasterization) -----
class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.className = '';
    this._classes = new Set();
    const classes = this._classes;
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { (force === undefined ? !classes.has(c) : force) ? classes.add(c) : classes.delete(c); },
      contains: (c) => classes.has(c),
    };
  }
  appendChild(n) { this.children.push(n); return n; }
  replaceChildren(...n) { this.children = n; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
  querySelector() { return null; }
  set innerHTML(v) { this._html = v; }
}

before(() => {
  global.document = {
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => ({ text }),
    getElementById: () => null,
    querySelector: () => null,
  };
});
after(() => { delete global.document; });

const { createBattleStage } = await import('../ui/components/battle/stage.js');
const { LIBRARY_STATES } = await import('../ui/components/battle/rig.js');
const { stopAll, setPresentationFreezeHook } = await import('../ui/components/battle/sound.js');
const { boundStagePreload } = await import('../ui/screens/duel.js');

const TREATMENT = { id: 'incumbent', copy: { npcTagLabel: 'NPC' } };

function fakeActor(name) {
  const docs = new Map();
  for (const state of LIBRARY_STATES) docs.set(state, { doc: { nm: `${name}:${state}` } });
  return { rig: { name }, docs };
}

function stageArgs(tag) {
  return {
    treatment: TREATMENT,
    p1: { name: `${tag}-P1`, element: 'fire', isNpc: false },
    p2: { name: `${tag}-P2`, element: 'water', isNpc: false },
    actors: { p1: fakeActor(`${tag}-p1`), p2: fakeActor(`${tag}-p2`) },
    capes: { p1: { win: { nm: 'cw' }, lose: { nm: 'cl' } }, p2: { win: { nm: 'cw' }, lose: { nm: 'cl' } } },
    flags: { p1: { nm: 'flag' }, p2: { nm: 'flag' } },
  };
}

/** The EXACT orphan shape duel.js#runPresentation wires for the incumbent:
 * closure-local stageFailed/cancelled flags, a preload whose LAST await can
 * settle arbitrarily late, the fix-round-2 HOISTED guard before the
 * constructor, and the fix-round-1 bounded gate driving stageFailed. */
function makeIncumbentDuel({ connected = () => true } = {}) {
  const d = { stageFailed: false, cancelled: false, battleStage: null };
  let settle;
  const stalledBucket = new Promise((resolve) => { settle = resolve; });
  const tugBarContainer = { get isConnected() { return connected(); } };
  async function prepareIncumbentStage() {
    await stalledBucket; // the stalled shape fetch (may outlive the bound)
    // the hoisted guard — mirrors duel.js verbatim, BEFORE createBattleStage
    if (d.stageFailed || d.cancelled || !tugBarContainer.isConnected) return;
    d.battleStage = createBattleStage(stageArgs('N'));
  }
  const timers = [];
  d.gate = boundStagePreload(prepareIncumbentStage(), {
    setTimeoutFn: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; },
    clearTimeoutFn: (h) => { if (h) h.cleared = true; },
  }).then((gate) => { if (!gate.ok) d.stageFailed = true; return gate; });
  d.fireBound = () => { for (const h of timers) if (!h.cleared) h.fn(); };
  d.settleLate = () => settle();
  return d;
}

function allPlayersIntact(stage) {
  const all = [...stage.players.values(), ...stage.fxPlayers.values()];
  return all.length > 0 && all.every((p) => !p.destroyed);
}

test('fix-round-2 A: duel N degrades at the bound; its orphan preload settles while duel N+1\'s stage is LIVE — N+1\'s players stay intact, its map uncleared, its freeze hook still armed', async () => {
  // duel N: the incumbent preload stalls past the bound and degrades
  const duelN = makeIncumbentDuel();
  duelN.fireBound();
  const gate = await duelN.gate;
  assert.deepEqual(gate, { ok: false, timedOut: true }, 'duel N must degrade at the bound (fix round 1 semantics unchanged)');
  assert.equal(duelN.stageFailed, true);

  // duel N+1: a later duel's stage goes live (owns the module-global slot
  // and the presentation freeze hook)
  const stageN1 = createBattleStage(stageArgs('N1'));
  const expectedPlayers = LIBRARY_STATES.length; // per side
  assert.equal(stageN1.players.size, expectedPlayers * 2, 'sanity: 2×10 wizard state players live');

  // the orphan lands
  duelN.settleLate();
  await new Promise((r) => setImmediate(r));

  // duel N+1's live stage is untouched
  assert.equal(duelN.battleStage, null, 'the orphan must construct NOTHING (hoisted guard fires before createBattleStage)');
  assert.equal(stageN1.players.size, expectedPlayers * 2, 'duel N+1\'s player map must not be cleared by the orphan');
  assert.ok(allPlayersIntact(stageN1), 'every one of duel N+1\'s players must remain undestroyed');

  // …and duel N+1 still OWNS the freeze hook: the teardown path (stopAll)
  // must freeze N+1's players, proving the orphan never stole ownership.
  let frozeN1 = false;
  const realFreeze = stageN1.freeze;
  stageN1.freeze = () => { frozeN1 = true; realFreeze.call(stageN1); };
  stopAll();
  assert.equal(frozeN1, true, 'duel N+1\'s freeze hook must still be armed after the orphan settles');
  stageN1.destroy();
});

test('fix-round-2 A: an orphan from a SKIPPED duel (cancelled) and from an UNMOUNTED duel (container disconnected) also construct nothing', async () => {
  // cancelled (skip pressed before the preload settled)
  const skipped = makeIncumbentDuel();
  skipped.cancelled = true;
  skipped.settleLate();
  await skipped.gate;
  await new Promise((r) => setImmediate(r));
  assert.equal(skipped.battleStage, null, 'a skip-orphaned preload must construct nothing');

  // unmounted (navigated away; shell no longer in the document)
  const unmounted = makeIncumbentDuel({ connected: () => false });
  unmounted.settleLate();
  await unmounted.gate;
  await new Promise((r) => setImmediate(r));
  assert.equal(unmounted.battleStage, null, 'an unmount-orphaned preload must construct nothing');
});

test('fix-round-2 A: stage.destroy() RELEASES freeze-hook ownership — a destroyed stage can no longer be frozen through stopAll', () => {
  const stage = createBattleStage(stageArgs('solo'));
  let froze = false;
  const realFreeze = stage.freeze;
  stage.freeze = () => { froze = true; realFreeze.call(stage); };
  stage.destroy();
  stopAll(); // pre-fix: the hook still pointed at the destroyed stage
  assert.equal(froze, false, 'destroy() must clear the presentation freeze hook it owns');
});

test('fix-round-2 A: hook release is OWNERSHIP-scoped — a stale stage\'s late destroy never disarms the newer stage\'s hook', () => {
  const stageA = createBattleStage(stageArgs('A'));
  const stageB = createBattleStage(stageArgs('B')); // constructor destroys A, then takes the hook
  stageA.destroy(); // late/extra destroy of the STALE stage — must not touch B's ownership
  let frozeB = false;
  const realFreeze = stageB.freeze;
  stageB.freeze = () => { frozeB = true; realFreeze.call(stageB); };
  stopAll();
  assert.equal(frozeB, true, 'the newer stage must keep freeze-hook ownership through a stale destroy');
  stageB.destroy();
});

test('fix-round-2 A: the hook is one-shot through stopAll and re-armable — leaving no dangling ownership between duels', () => {
  const stage = createBattleStage(stageArgs('reset'));
  let count = 0;
  const realFreeze = stage.freeze;
  stage.freeze = () => { count += 1; realFreeze.call(stage); };
  stopAll();
  stopAll(); // second teardown: the one-shot hook is already consumed
  assert.equal(count, 1, 'stopAll consumes the hook exactly once');
  stage.destroy(); // releasing an already-consumed hook is a harmless no-op
  setPresentationFreezeHook(null);
});
