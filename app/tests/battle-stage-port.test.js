// app/tests/battle-stage-port.test.js — CB-BUILD-005 / R74/R75 / AC1: the
// battle-presentation port. Arena composite (never bare/white), preload-
// everything/no-refetch/no-flash, the FX pass from the bundle's FX sources
// (never a flat fill), and conformance of the state machine + sound schedule
// to the shipped 2019 reference implementation
// (assets/cw-asset-bundle/reference/DuelPlayer/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDuel } from '../engine/duel.js';
import { buildDuelTimeline, CANONICAL_STATES } from '../engine/presentationTimeline.js';
import { LIBRARY_STATES, TIMELINE_TO_LIBRARY_STATE } from '../ui/components/battle/rig.js';
import { stageLayerPlan, fxPassSources, LOOPED_LIBRARY_STATES } from '../ui/components/battle/stage.js';
import { arenaSources, elementBackdropUrl, elementFlagUrl } from '../ui/components/battle/assets.js';
import { REFERENCE_SOUND_SCHEDULE, DUEL_SAMPLES } from '../ui/components/battle/sound.js';
import { createShapeLoader } from '../ui/components/battle/shapes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const REFERENCE_DIR = path.join(REPO_ROOT, 'assets', 'cw-asset-bundle', 'reference', 'DuelPlayer');
const VENDORED_DIR = path.join(REPO_ROOT, 'assets', 'vendored-shapes');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

function stripComments(src) {
  return src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

const INCUMBENT = { id: 'incumbent' };
const ALTERNATE = { id: 'adjacent' };

// ---- arena composite (R74: never a bare or white field) ----------------------

test('arena-composite: the incumbent stage composites on the bundle\'s arena art (fightScene/fightBG.svg + the grid texture)', async () => {
  const arena = arenaSources(INCUMBENT);
  assert.ok(arena.background.endsWith('client-static/img/fightScene/fightBG.svg'), 'the arena background must be the bundle\'s fight-scene art');
  assert.ok(arena.gridPattern.endsWith('client-static/img/general/gridPattern.svg'));
  // the referenced files really exist in the repo's bundle
  for (const rel of ['client-static/img/fightScene/fightBG.svg', 'client-static/img/general/gridPattern.svg', 'client-static/img/fightScene/loader.gif']) {
    await fs.access(path.join(REPO_ROOT, 'assets', 'cw-asset-bundle', rel));
  }
  // and stage.js actually applies it (inline, from arenaSources -- the
  // treatment-agnostic stylesheet never hardcodes treatment art)
  const stageSrc = await read('ui/components/battle/stage.js');
  assert.ok(stageSrc.includes('arenaSources(treatment)'), 'createBattleStage must derive the arena from arenaSources');
  assert.ok(stageSrc.includes("background-image:url('${arena.background}')"), 'the arena art must be composited as the stage background');
});

test('arena-composite: an alternate treatment (no bundled art, R12/CB-BUILD-007) gets the provisional dark field -- still never bare/white', () => {
  const arena = arenaSources(ALTERNATE);
  assert.equal(arena.background, null);
  assert.equal(arena.provisional, true);
});

test('arena-composite: the stage field colours are the dark chrome, never white (battle.css)', async () => {
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'battle.css'), 'utf8');
  const stageRule = css.slice(css.indexOf('.cb-arena-stage {'), css.indexOf('}', css.indexOf('.cb-arena-stage {')));
  assert.ok(/background-color:\s*var\(--cb-black/.test(stageRule), 'the arena field base must be the app\'s dark chrome');
  assert.ok(!/background(-color)?:\s*(#fff|white)/i.test(stageRule), 'the stage must never declare a white field');
  const loaderRule = css.slice(css.indexOf('.cb-stage-loader {'), css.indexOf('}', css.indexOf('.cb-stage-loader {')));
  assert.ok(/var\(--cb-black/.test(loaderRule), 'even the preload gate renders on the dark field, not white');
});

test('CB-BUILD-005: the canonical GIFs are parity reference only -- no runtime module loads renders/gifs or an <img> per state anymore', async () => {
  for (const rel of ['ui/components/battle/stage.js', 'ui/components/battle/assets.js', 'ui/components/battle/player.js', 'ui/components/battle/shapes.js', 'ui/screens/duel.js']) {
    const code = stripComments(await read(rel));
    assert.ok(!code.includes('renders/gifs'), `${rel} must not reference the GIF renders at runtime`);
    assert.ok(!code.includes('incumbentGifUrl'), `${rel} must not carry the old per-state GIF mapping`);
    assert.ok(!code.includes('png-seq'), `${rel} must not reference the PNG sequence at runtime`);
  }
});

// ---- no blank / no flash (R74: preload, cross-fade, never re-fetch) ----------

test('no-blank: the stage layer plan creates EVERY library state for BOTH sides up front (plus the FX layers) -- nothing constructs mid-duel', () => {
  const plan = stageLayerPlan();
  for (const side of ['p1', 'p2']) {
    for (const state of LIBRARY_STATES) {
      assert.ok(plan.some((l) => l.side === side && l.kind === 'wizard' && l.state === state), `missing ${side}:${state} layer in the up-front plan`);
    }
    for (const fx of ['capeWin', 'capeLose', 'flag']) {
      assert.ok(plan.some((l) => l.side === side && l.kind === 'fx' && l.state === fx), `missing ${side}:${fx} FX layer`);
    }
  }
  assert.equal(plan.filter((l) => l.kind === 'wizard').length, 2 * LIBRARY_STATES.length);
});

test('no-refetch: after preloading both combatants, walking an ENTIRE real duel timeline touches the network zero times', async () => {
  const fetchJson = async (url) => {
    if (url.startsWith('https://')) throw new Error('offline');
    const filename = url.slice(url.lastIndexOf('/') + 1);
    return JSON.parse(await fs.readFile(path.join(VENDORED_DIR, filename), 'utf8'));
  };
  const loader = createShapeLoader({ fetchJson });
  const w1 = { id: 'no-refetch-1', name: 'Alpha', element: 'fire' };
  const w2 = { id: 'no-refetch-2', name: 'Beta', element: 'water' };
  const a1 = await loader.preloadWizard(w1);
  await loader.preloadWizard(w2, { distinctFrom: a1.rig });
  const fetchesAfterPreload = loader.counters.networkFetches;

  // a real worst-case timeline: 5 CRITICAL rounds + floor drain + prize
  const outcome = resolveDuel({ mv1: [1, 1, 1, 1, 1], mv2: [0, 0, 0, 0, 0], aff1: 1, aff2: 0, p1: 100, p2: 9, floor: 10 });
  const timeline = buildDuelTimeline(outcome, 1170, { bracketComplete: true });
  for (const step of timeline) {
    for (const side of ['p1', 'p2']) {
      const stepState = (side === 'p1' ? step.p1State : step.p2State) || step.state;
      const lib = TIMELINE_TO_LIBRARY_STATE[stepState];
      if (!lib) continue; // affinityFx / moments render FX layers and overlays, preloaded separately
      loader.getDoc(side === 'p1' ? w1 : w2, lib);
    }
  }
  assert.equal(loader.counters.networkFetches, fetchesAfterPreload, 'the whole timeline must play without ONE additional fetch');
});

test('no-flash: every timeline state a duel can emit resolves to a preloaded library layer (no unmapped state can blank the stage)', () => {
  for (const state of CANONICAL_STATES) {
    const lib = TIMELINE_TO_LIBRARY_STATE[state];
    assert.ok(LIBRARY_STATES.includes(lib), `timeline state "${state}" has no preloaded library layer`);
  }
});

test('no-flash: state switching is visibility cross-fade over persistent players -- no img src swap, no player re-creation (static scan)', async () => {
  const stageSrc = await read('ui/components/battle/stage.js');
  const code = stripComments(stageSrc);
  // players are created in createBattleStage (build time) and only
  // played/stopped afterwards; setVisible toggles classes.
  const showStepBody = code.slice(code.indexOf('showStep(step'), code.indexOf('playAffinityFx({'));
  assert.ok(!showStepBody.includes('createStatePlayer'), 'showStep must not construct players');
  assert.ok(!showStepBody.includes('fetch('), 'showStep must not fetch');
  assert.ok(!/\.src\s*=/.test(code) && !/setAttribute\(\s*'src'/.test(code), 'nothing in the stage swaps an img src mid-duel');
  assert.ok(code.includes("classList.add('visible')") && code.includes("classList.remove('visible')"), 'state switching is class-toggled visibility');
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'battle.css'), 'utf8');
  assert.ok(/\.cb-anim-layer\s*{[^}]*transition:[^}]*opacity/s.test(css), 'the layers cross-fade (opacity transition), not hard-swap');
});

test('no-blank: the duel screen preloads EVERYTHING first and only then starts the timeline and the sound bed (static scan of duel.js)', async () => {
  const src = await read('ui/screens/duel.js');
  assert.ok(src.includes('prepareIncumbentStage()'), 'the incumbent path must run the preload gate');
  assert.ok(/prepareIncumbentStage\(\)[\s\S]{0,120}?\.then\(\(\) => startTimeline\(\)\)/.test(src), 'the timeline must start only after the preload settles');
  const startBody = src.slice(src.indexOf('function startTimeline()'), src.indexOf('buildShell();'));
  assert.ok(startBody.includes('scheduleDuelStart()'), 'the reference starts sound at duel-player-ready, after preload');
  assert.ok(src.includes('battleStage.whenReady()'), 'the stage readiness gate (the reference\'s animationsLoaded === animationsTotal) must be awaited');
  assert.ok(src.includes('battleStage.showStep(step'), 'frames drive the persistent stage');
  assert.ok(src.includes('battleStage.setMomentOverlay(momentNodeFor(step))'), 'moments overlay the composite instead of blanking it');
});

// ---- the FX pass from the bundle's sources (never a flat fill) ---------------

test('FX-from-sources: fxPassSources layers real bundle art -- per-element backdrop + element flag + affinity cape overlay', async () => {
  for (const [element, bundleKey] of [['fire', 'fire'], ['water', 'water'], ['air', 'wind']]) {
    const fx = fxPassSources(element, { won: true });
    assert.ok(fx.backdrop.endsWith(`client-static/img/duel/wizard-bg-${bundleKey}-win.svg`), `backdrop for ${element}`);
    assert.ok(fx.flag.endsWith(`lottie/${bundleKey}Flag.json`), `flag for ${element}`);
    assert.equal(fx.capeKey, 'win');
    assert.equal(fxPassSources(element, { won: false }).capeKey, 'lose');
    // the referenced bundle files exist
    await fs.access(path.join(REPO_ROOT, fx.backdrop.replace('../', '')));
    await fs.access(path.join(REPO_ROOT, fx.flag.replace('../', '')));
  }
});

test('FX-from-sources: the lose-variant backdrops exist too, and elementBackdropUrl/elementFlagUrl address them', async () => {
  for (const element of ['fire', 'water', 'air']) {
    for (const won of [true, false]) {
      const url = elementBackdropUrl(element, won);
      await fs.access(path.join(REPO_ROOT, url.replace('../', '')));
    }
    await fs.access(path.join(REPO_ROOT, elementFlagUrl(element).replace('../', '')));
  }
});

test('FX-from-sources: the incumbent FX pass is players + backdrop art, not a flat colour fill (static scan); the flat pulse survives ONLY as the alternates\' provisional marker', async () => {
  const stageSrc = await read('ui/components/battle/stage.js');
  const fxBody = stageSrc.slice(stageSrc.indexOf('playAffinityFx({'), stageSrc.indexOf('setMomentOverlay'));
  assert.ok(fxBody.includes('backdrop'), 'the FX pass shows the per-element backdrop art');
  assert.ok(fxBody.includes("playFx(side, won ? 'capeWin' : 'capeLose')"), 'the FX pass plays the affinity cape overlay from the shape library');
  assert.ok(fxBody.includes("playFx(side, 'flag')"), 'the FX pass plays the bundle\'s element flag animation');
  assert.ok(!/background/.test(fxBody), 'the incumbent FX pass paints no flat background');
  // the old flat radial pulse is documented as alternates-only
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'battle.css'), 'utf8');
  const marker = css.indexOf('.cb-affinity-fx');
  assert.ok(css.slice(0, marker).includes("ALTERNATES' provisional affinity FX pulse"), 'the flat pulse must be explicitly scoped to the alternates');
});

// ---- conformance to the reference implementation -----------------------------

test('reference conformance: the round state machine matches DuelPlayer.js — winner plays RESET, loser plays HIT, draw resets both, idle→charge→chargeLoop chain', async () => {
  const ref = await fs.readFile(path.join(REFERENCE_DIR, 'DuelPlayer.js'), 'utf8');
  // the reference's own mapping, asserted from ITS source so this test
  // breaks if someone swaps the reference out from under the port:
  assert.ok(ref.includes('isHomeResetPlaying: isHomeRoundWinner || isDraw'), 'reference: round winner (or draw) plays RESET');
  assert.ok(ref.includes('isHomeHitPlaying: !isHomeRoundWinner'), 'reference: round loser plays HIT');
  assert.ok(ref.includes('this.HOME_IDLE.play();'), 'reference: the chain opens on idle');
  assert.ok(/HOME_IDLE\.addEventListener\('complete', \(\) => {\s*\n\s*this\.HOME_CHARGE\.play\(\);/.test(ref), 'reference: idle completes into charge');
  assert.ok(ref.includes('this.chargeLoop();'), 'reference: charge completes into the charge loop');
  // and OUR mapping agrees:
  assert.equal(TIMELINE_TO_LIBRARY_STATE.hitSuccess, 'reset', 'the R75 "winner Hit Success" beat is the reference\'s winner-RESET animation');
  assert.equal(TIMELINE_TO_LIBRARY_STATE.hit, 'hit');
  assert.equal(TIMELINE_TO_LIBRARY_STATE.battleIdle, 'idle');
  assert.equal(TIMELINE_TO_LIBRARY_STATE.charge, 'charge');
  assert.equal(TIMELINE_TO_LIBRARY_STATE.chargeLoop, 'chargeloop');
});

test('reference conformance: five rounds, 0-indexed, exactly as the reference counts them', async () => {
  const ref = await fs.readFile(path.join(REFERENCE_DIR, 'DuelPlayer.js'), 'utf8');
  assert.ok(ref.includes('const TOTAL_ROUNDS = 4; // Actually 5'), 'reference: TOTAL_ROUNDS is 4 (0-based, five rounds)');
  assert.equal(REFERENCE_SOUND_SCHEDULE.totalRounds, 5);
});

test('reference conformance: the loop states match the reference (chargeLoop loops; idle loops until the chain starts)', async () => {
  const ref = await fs.readFile(path.join(REFERENCE_DIR, 'DuelPlayer.js'), 'utf8');
  assert.ok(ref.includes('this.HOME_CHARGE_LOOP.loop = true;'), 'reference: the charge loop loops');
  assert.deepEqual([...LOOPED_LIBRARY_STATES].sort(), ['chargeloop', 'idle']);
});

test('reference conformance: the sound schedule constants are the reference soundManager\'s own (1.8s loop-in, 2.2s voice/loop-restart, 3.6s next voice)', async () => {
  const ref = await fs.readFile(path.join(REFERENCE_DIR, 'soundManager.js'), 'utf8');
  assert.ok(ref.includes('this.scheduleOnceIn(1.8, () => this.start(\'fightLoop\'))'), 'reference: loop at +1.8s after intro');
  assert.ok(ref.includes('this.scheduleOnceIn(2.2, () => this.start(\'voiceRound0\'))'), 'reference: first voice at +2.2s');
  assert.ok(ref.includes('this.scheduleOnceIn(2.2, () => this.restart(\'fightLoop\'))'), 'reference: loop restarts at +2.2s after a round start');
  assert.ok(ref.includes('this.scheduleOnceIn(3.6, () => this.start(`voiceRound${round + 1}`))'), 'reference: next round voice at +3.6s');
  assert.ok(ref.includes("if (round !== 4) {"), 'reference: no loop restart after the final round');
  assert.equal(REFERENCE_SOUND_SCHEDULE.loopAfterIntroSec, 1.8);
  assert.equal(REFERENCE_SOUND_SCHEDULE.firstVoiceSec, 2.2);
  assert.equal(REFERENCE_SOUND_SCHEDULE.loopRestartAfterRoundSec, 2.2);
  assert.equal(REFERENCE_SOUND_SCHEDULE.nextVoiceAfterRoundSec, 3.6);
});

test('reference conformance: our sound port implements the same schedule and skips the loop restart on the final round', async () => {
  const src = await read('ui/components/battle/sound.js');
  assert.ok(src.includes('scheduleOnceIn(REFERENCE_SOUND_SCHEDULE.loopAfterIntroSec, () => playLoop())'));
  assert.ok(src.includes('scheduleOnceIn(REFERENCE_SOUND_SCHEDULE.firstVoiceSec, () => playVoice(1))'));
  assert.ok(src.includes('roundIndex !== REFERENCE_SOUND_SCHEDULE.totalRounds - 1'), 'no loop restart / next voice after round five');
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(duelSrc.includes("if (step.state === 'attack')"), 'the round sound triggers at the attack (the reference\'s fight press)');
  assert.ok(duelSrc.includes('scheduleRoundStart((step.round || 1) - 1)'), '0-based round index, exactly as the reference passes it');
});

test('reference conformance: every sample the reference loads exists in the bundle and is addressed by the port', async () => {
  const ref = await fs.readFile(path.join(REFERENCE_DIR, 'soundManager.js'), 'utf8');
  const refSamples = [...ref.matchAll(/\/static\/sound\/([a-z0-9-]+\.wav)/g)].map((m) => m[1]);
  assert.equal(new Set(refSamples).size, 12, 'the reference loads 12 samples');
  for (const sample of new Set(refSamples)) {
    assert.ok(DUEL_SAMPLES.includes(sample), `port must know ${sample}`);
    await fs.access(path.join(REPO_ROOT, 'assets', 'cw-asset-bundle', 'sound', sample));
  }
});

test('reference conformance: the stage layout constants are DuelPlayer.css\'s own (wizard bottom 21% / width 41% / offset -1.4%; fx width 115% / offset -6.5%; away mirrored)', async () => {
  const refCss = await fs.readFile(path.join(REFERENCE_DIR, 'DuelPlayer.css'), 'utf8');
  assert.ok(refCss.includes('bottom: 21%;') && refCss.includes('width: 41%;') && refCss.includes('--offset: -1.4%;'), 'reference wizard layout');
  assert.ok(refCss.includes('--fxOffset: -6.5%;') && refCss.includes('width: 115%;'), 'reference fx layout');
  assert.ok(refCss.includes('transform: scaleX(-1);'), 'reference mirrors the away side');
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'battle.css'), 'utf8');
  assert.ok(css.includes('bottom: 21%;') && css.includes('width: 41%;'), 'port: wizard slots sit at the reference position');
  assert.ok(css.includes('left: -1.4%;') && css.includes('right: -1.4%;'), 'port: the reference horizontal offsets');
  assert.ok(css.includes('width: 115%;') && css.includes('left: -6.5%;'), 'port: the reference FX geometry');
  assert.ok(css.includes('.cb-wizard-slot.p2 { right: -1.4%; transform: scaleX(-1); }'), 'port: the away side mirrors, as shipped');
});

// ---- the runtime bar (R78) ---------------------------------------------------

test('R78: playback is the canvas build of the interchange player, vendored and loaded classically; the rig composites BEFORE playback', async () => {
  const playerSrc = await read('ui/components/battle/player.js');
  assert.ok(playerSrc.includes("renderer: 'canvas'"), 'GPU-composited canvas playback, not DOM/SVG node soup');
  assert.ok(playerSrc.includes('animationData: doc'), 'players consume the rig\'s composited documents, never a URL (no hidden fetch)');
  const html = await fs.readFile(path.join(APP_ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('assets/vendor/lottie_canvas.min.js'), 'the vendored runtime must load with the app');
  await fs.access(path.join(REPO_ROOT, 'assets', 'vendor', 'lottie_canvas.min.js'));
});

test('R75: the coverage-gap moments (floor drain / coin flip / prize award) stay two-candidates-each in moments.js, untouched by the port', async () => {
  const momentsSrc = await read('ui/components/battle/moments.js');
  for (const fn of ['renderFloorDrain', 'renderCoinFlip', 'renderPrizeAward']) {
    assert.ok(momentsSrc.includes(`export function ${fn}`), `${fn} must survive`);
    const body = momentsSrc.slice(momentsSrc.indexOf(`export function ${fn}`));
    assert.ok(body.includes('candidate === 2'), `${fn} keeps its second candidate`);
  }
});
