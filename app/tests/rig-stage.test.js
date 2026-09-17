// app/tests/rig-stage.test.js — CB-BUILD-005 / R74 / AC1's battle-fidelity
// row, the app-side teeth:
//  - arena composite present (never a bare/white field),
//  - each combatant rendered from its OWN cosmetic set (two different
//    wizards produce different composited output),
//  - preload-before-play (every animation source in memory before the
//    timeline starts; NO fetch anywhere in the per-step path; no src swap),
//  - FX pass from the bundle's FX sources (affinity capes + the shape
//    sets' own baked element FX), not a flat colour fill,
//  - honest bucket-offline degradation (vendored fallback shapes, still
//    the wizard's own palette, recorded on the loadout report).
// Functional tests run the REAL loadout against the REAL vendored library
// files via an injected fetch; DOM-dependent wiring is checked by static
// scan (repo convention: no DOM in this harness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRigLoadout, DUEL_STATES } from '../ui/components/battle/rigAssets.js';
import { elementToken } from '../engine/wizardRig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const RIG_ASSETS = path.resolve(APP_ROOT, '..', 'assets', 'rig');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

/** A fetch fake that serves EVERY url (bucket or fallback) from the
 * vendored library files on disk — the tests never touch the network. */
function localFetch(log = []) {
  return async (url) => {
    log.push(url);
    let file = null;
    let m = /wizard-animations\/([a-z]+)-(FIRE|WATER|WIND|NEUTRAL)-.+\.json$/.exec(url);
    if (m) file = path.join(RIG_ASSETS, 'fallback', m[2], `${m[1].replace(/^affinitycape(win|lose)$/, '')}.json`);
    m = /wizard-animations\/affinitycape(win|lose)-(FIRE|WATER|WIND)-\d+\.json$/.exec(url);
    if (m) file = path.join(RIG_ASSETS, 'fx', `affinitycape${m[1]}-${m[2]}.json`);
    m = /assets\/rig\/(.+)$/.exec(url);
    if (m) file = path.join(RIG_ASSETS, m[1]);
    try {
      const text = await fs.readFile(file, 'utf8');
      return { ok: true, json: async () => JSON.parse(text) };
    } catch {
      return { ok: false, status: 404 };
    }
  };
}

/** A fetch fake where the bucket is unreachable but local fallback works. */
function bucketDownFetch(log = []) {
  const local = localFetch(log);
  return async (url) => {
    log.push(url);
    if (url.startsWith('https://')) return { ok: false, status: 503 };
    return local(url);
  };
}

const wizardA = { id: 'stage-wizard-A', element: 'fire', tier: 0 };
const wizardB = { id: 'stage-wizard-B', element: 'fire', tier: 0 };

test('preload covers EVERY animation source the duel needs, before play: all duel states + both affinity capes, both sides', async () => {
  const log = [];
  const loadout = createRigLoadout({ p1Character: wizardA, p2Character: wizardB, fetchImpl: localFetch(log), cache: new Map() });
  await loadout.ready;
  const { loaded, total } = loadout.progress();
  assert.equal(loaded, total, 'everything the duel needs is in memory');
  assert.equal(total, 2 * (DUEL_STATES.length + 2), 'both sides x (9 duel states + win/lose capes)');
  for (const side of ['p1', 'p2']) {
    for (const state of DUEL_STATES) {
      const animation = loadout.get(side, state);
      assert.ok(animation && animation.layers, `${side}/${state} present in memory`);
      assert.equal(animation.fr, 30, 'reference playback rate');
    }
    for (const kind of ['win', 'lose']) assert.ok(loadout.getCape(side, kind), `${side} affinity cape ${kind}`);
  }
});

test('distinct combatants: two different wizards produce different composited output (same-element duel included)', async () => {
  const loadout = createRigLoadout({ p1Character: wizardA, p2Character: wizardB, fetchImpl: localFetch(), cache: new Map() });
  await loadout.ready;
  assert.notEqual(loadout.identities.p1.comboKey + JSON.stringify(loadout.identities.p1.palette),
    loadout.identities.p2.comboKey + JSON.stringify(loadout.identities.p2.palette),
    'the two combatants must not share both shapes and palette');
  let differingStates = 0;
  for (const state of DUEL_STATES) {
    if (JSON.stringify(loadout.get('p1', state)) !== JSON.stringify(loadout.get('p2', state))) differingStates++;
  }
  // C7 fix round: the old assertion (`=== length || > 0`) reduced to `> 0`
  // and could never bind the "all states differ" arm. EVERY state's
  // recoloured output must differ between two distinct wizards — one shared
  // state would be a distinctness hole the cross-fade parades through.
  assert.equal(differingStates, DUEL_STATES.length,
    `recoloured output must differ between combatants in EVERY duel state (differed in ${differingStates}/${DUEL_STATES.length})`);
});

test('no re-fetch mid-duel: after ready, get()/getCape() are pure memory reads (zero new fetches)', async () => {
  const log = [];
  const loadout = createRigLoadout({ p1Character: wizardA, p2Character: wizardB, fetchImpl: localFetch(log), cache: new Map() });
  await loadout.ready;
  const fetchesAtReady = log.length;
  for (let i = 0; i < 3; i++) {
    for (const side of ['p1', 'p2']) {
      for (const state of DUEL_STATES) loadout.get(side, state);
      loadout.getCape(side, 'win'); loadout.getCape(side, 'lose');
    }
  }
  assert.equal(log.length, fetchesAtReady, 'no fetch after preload completed');
});

test('bucket unreachable: honest degradation — vendored fallback SHAPES, still recoloured to the wizard\'s OWN palette, recorded on the report', async () => {
  const loadout = createRigLoadout({ p1Character: wizardA, p2Character: { id: 'stage-wizard-C', element: 'air', tier: 0 }, fetchImpl: bucketDownFetch(), cache: new Map() });
  await loadout.ready;
  for (const side of ['p1', 'p2']) {
    assert.equal(loadout.report[side].fallbackStates.length, DUEL_STATES.length, `${side}: every state honestly recorded as fallback`);
  }
  // the fallback is still the wizard's own colours: p1's fallback differs
  // from a p2-recoloured copy of the same element's fallback
  const idle1 = JSON.stringify(loadout.get('p1', 'idle'));
  const raw = JSON.parse(await fs.readFile(path.join(RIG_ASSETS, 'fallback', elementToken('fire'), 'idle.json'), 'utf8'));
  assert.notEqual(idle1, JSON.stringify(raw), 'fallback shapes must be recoloured to the wizard, not served source-coloured');
});

test('the stage composites on the arena art and never swaps src / fetches per state (static scan, rigStage.js)', async () => {
  const src = await read('ui/components/battle/rigStage.js');
  assert.ok(src.includes('client-static/img/fightScene/fightBG.svg'), 'arena composite: the incumbent arena art underlies the combatants');
  assert.ok(src.includes('cb-rig-arena'), 'arena img element present');
  // seamless transitions: stacked preloaded players, visibility/opacity toggles
  assert.ok(src.includes('animationData:'), 'players are created from in-memory data, never a path/src');
  assert.ok(!/\.src\s*=/.test(src), 'no src assignment anywhere in the stage (no GIF/src swapping)');
  assert.ok(!/fetch\(/.test(src), 'the stage itself never fetches — the loadout preloads everything');
  const setStepBody = src.slice(src.indexOf('function setClip'), src.indexOf('function resize'));
  assert.ok(!/fetch\(|loadAnimation\(/.test(setStepBody), 'a state change only toggles preloaded players');
  assert.ok(src.includes("classList.add('visible')") && src.includes("classList.remove('visible')"), 'cross-fade by class toggle over stacked canvases');
  // reference player configuration (the 2019 implementation\'s own)
  assert.ok(src.includes("renderer: 'canvas'") && src.includes('setSubframe(false)'), 'reference player configuration');
  // reference layer geometry: away side mirrors
  const css = await read('styles/battle.css');
  assert.ok(/cb-rig-wizard\.away[^}]*scaleX\(-1\)/s.test(css), 'away wizard mirrors, per the reference stage');
  assert.ok(/cb-rig-anim[^}]*transition:\s*opacity/s.test(css), 'opacity cross-fade on state layers');
});

test('the incumbent combatant is NEVER a GIF or shared clip: stage.js has no GIF path; duel.js routes the incumbent to the rig stage', async () => {
  const stageSrc = await read('ui/components/battle/stage.js');
  assert.ok(!/\.gif/i.test(stageSrc), 'no GIF reference in the combatant stage');
  const assetsSrc = await read('ui/components/battle/assets.js');
  assert.ok(!/incumbentGifUrl|STATE_TO_GIF/.test(assetsSrc), 'the GIF mapping is gone from the asset layer');
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(duelSrc.includes("treatment.id === 'incumbent'"), 'incumbent detection present');
  assert.ok(duelSrc.includes('createRigLoadout({ p1Character: character, p2Character: p2Char })'), 'both combatants get their OWN loadout identities');
  assert.ok(duelSrc.includes('rigStage.setStep'), 'the reveal drives the rig stage per timeline step');
  // preload starts at commit-screen mount, before the duel starts
  const mountRegion = duelSrc.slice(0, duelSrc.indexOf('function buildCommitScreen'));
  assert.ok(mountRegion.includes('createRigLoadout'), 'preload kicks off at mount, before the commit clock even runs');
  // the timeline start gates on readiness
  assert.ok(duelSrc.includes('rigStage.whenReady'), 'timeline start gates on every source being preloaded');
});

test('FX pass comes from the bundle FX sources, not a flat colour fill (incumbent)', async () => {
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(duelSrc.includes('affinityCapesForRound'), 'affinity rounds resolve per-side cape FX');
  const stageSrc = await read('ui/components/battle/rigStage.js');
  assert.ok(stageSrc.includes('playCape'), 'the stage plays the affinity-cape overlays');
  // the flat pulse (renderAffinityFx) stays alternates-only: the rig branch
  // never reaches it (it lives in the non-rig else branch).
  const updateFrame = duelSrc.slice(duelSrc.indexOf('function updateFrame'), duelSrc.indexOf('function skip'));
  const rigBranch = updateFrame.slice(updateFrame.indexOf('useRig && rigStage'), updateFrame.indexOf('} else {'));
  assert.ok(!rigBranch.includes('renderAffinityFx'), 'the incumbent FX pass is never the flat colour pulse');
});

test('NPC tag still reaches the incumbent stage (invariant #8 carries to the rig nameplates)', async () => {
  const src = await read('ui/components/battle/rigStage.js');
  assert.ok(src.includes('npcTagLabel'), 'rig nameplates render the permanent NPC tag');
});
