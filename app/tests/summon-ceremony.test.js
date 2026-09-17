// app/tests/summon-ceremony.test.js — CB-BUILD-014 / R74a [LAW]: the summon
// is a CEREMONY. Pressing SUMMON plays the full 2019 summon sequence for the
// chosen element and ends in the REVEAL of the actual summoned wizard —
// parametric parts and colours derived from its characterId, drawn by the
// same rig/composite path the duel stage uses (recolorAnimation over the
// wizard's own shape set, canvas player, setSubframe(false)) — with its name
// (R59, drawn at commit) first shown alongside it. No wizard and no name are
// visible before the press (CB-BUILD-002 unregressed); the seal-to-reveal
// duration is instrumented on the ledger with a real measured number.
//
// The flow tests run the REAL screen end to end (fake-DOM harness + a lottie
// stub injected the same way the rig-stage's own player attaches + a fetch
// fake serving the repo's real bundle files) — the sequence gates are fired
// by the test, exactly like the shipped player's own 'complete' events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { wizardIdentity, elementToken } from '../engine/wizardRig.js';
import { recolorAnimation } from '../engine/rigRecolor.js';
import { installFakeDom, uninstallFakeDom, renderedText, appRoot } from './helpers/dom-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const CW_LOTTIE = path.resolve(APP_ROOT, '..', 'assets', 'cw', 'lottie');
const RIG_ASSETS = path.resolve(APP_ROOT, '..', 'assets', 'rig');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

// ---- shared fakes ----------------------------------------------------------

/** Serve every ceremony URL from the repo's own bundle files on disk: the
 * summon lottie set from assets/cw/lottie, and the rig's per-combo shape
 * URLs from the vendored per-element fallback sets (same mapping the
 * rig-stage tests use — the tests never touch the network). */
function localFetch(log = []) {
  return async (url) => {
    log.push(url);
    let file = null;
    let m = /assets\/cw\/lottie\/(.+\.json)$/.exec(url);
    if (m) file = path.join(CW_LOTTIE, m[1]);
    m = /wizard-animations\/([a-z]+)-(FIRE|WATER|WIND|NEUTRAL)-.+\.json$/.exec(url);
    if (m) file = path.join(RIG_ASSETS, 'fallback', m[2], `${m[1]}.json`);
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

const failingFetch = async () => ({ ok: false, status: 503 });

// One lottie stub attached ONCE (ceremony.js resolves its player once, the
// same way the rig stage does); each test resets the shared instance list.
let createdAnims = [];
const lottieStub = {
  loadAnimation(cfg) {
    const inst = {
      cfg,
      played: false,
      paused: false,
      destroyed: false,
      listeners: {},
      setSubframe() {},
      goToAndStop() {},
      play() { this.played = true; this.paused = false; },
      pause() { this.paused = true; },
      resize() {},
      destroy() { this.destroyed = true; },
      addEventListener(type, cb) { (this.listeners[type] = this.listeners[type] || []).push(cb); },
      fire(type) { for (const cb of this.listeners[type] || []) cb(); },
    };
    createdAnims.push(inst);
    return inst;
  },
};

function animByMount(name) {
  return createdAnims.find((a) => a.cfg.container && a.cfg.container.getAttribute && a.cfg.container.getAttribute('data-anim') === name) || null;
}

async function waitFor(cond, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor: condition never became true');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let previousLottie;
let previousFetch;
test.before(() => {
  previousLottie = globalThis.lottie;
  previousFetch = globalThis.fetch;
  globalThis.lottie = lottieStub; // must be attached before the first ceremony import resolves its player
  globalThis.fetch = localFetch(); // the SCREEN path uses the global fetch; serve it locally
});
test.after(() => {
  globalThis.lottie = previousLottie;
  globalThis.fetch = previousFetch;
});
test.beforeEach(() => { createdAnims = []; installFakeDom(); });
test.afterEach(() => { uninstallFakeDom(); });

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');
const { mountSummon } = await import('../ui/screens/summon.js');
const { createSummonCeremony, summonSequenceLayers, REVEAL_STATE } = await import('../ui/components/summon/ceremony.js');

function freshCtx(seed = 7) {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed });
  game.submitScreener({ age18: true, jurisdictionOk: true }, 500);
  return {
    treatment, tunables, game,
    router: { navigate: () => {}, onUnmount: () => {} },
    patchSession: () => {},
    toast: () => {},
  };
}

function pressSummon(withElement = 'fire') {
  const app = appRoot();
  const elBtn = app.querySelectorAll('button').find((b) => b.getAttribute('data-el') === withElement);
  assert.ok(elBtn, 'element picker button present');
  elBtn.dispatch('click');
  const summonBtn = appRoot().querySelectorAll('button').find((b) => renderedText(b).startsWith('Summon ('));
  assert.ok(summonBtn, 'Summon button present after an element is picked');
  summonBtn.dispatch('click');
}

// ---- (b) nothing before the press ----------------------------------------

test('CB-BUILD-014/R74a + CB-BUILD-002/R59: before the press, no ceremony, no rig draw, and no name from the pool is visible', () => {
  const ctx = freshCtx();
  mountSummon(ctx);
  const app = appRoot();
  assert.equal(app.querySelector('.cb-summon-ceremony'), null, 'no ceremony node before the press');
  assert.equal(app.querySelector('.cb-summon-wizard'), null, 'no rig reveal mount before the press');
  assert.equal(createdAnims.length, 0, 'no player instance exists before the press');
  const text = renderedText(app);
  for (const poolName of treatment.namePool) {
    assert.ok(!text.includes(poolName), `pool name "${poolName}" must not render before the press`);
  }
  // picking an element alone still reveals nothing
  app.querySelectorAll('button').find((b) => b.getAttribute('data-el') === 'water').dispatch('click');
  assert.equal(appRoot().querySelector('.cb-summon-ceremony'), null, 'picking an element does not start a ceremony');
  assert.equal(createdAnims.length, 0);
});

// ---- (a) the ceremony runs BEFORE any reveal; the reveal is the rig-drawn
// actual wizard, its name with it; (d) seal-to-reveal instrumented ----------

test('CB-BUILD-014/R74a: pressing SUMMON plays the full sequence first (no wizard, no name), then reveals the rig-composited summoned wizard with its name — and instruments seal-to-reveal with a real number', async () => {
  const ctx = freshCtx();
  mountSummon(ctx);
  pressSummon('fire');

  // the engine sealed the summon at the press — but the SCREEN must not
  // have revealed anything yet: the ceremony plays first.
  const summonedEvt = ctx.game.ledger.byType(EVENT_TYPES.CHARACTER_SUMMONED)[0];
  assert.ok(summonedEvt, 'the summon transaction sealed at the press');
  const { characterId, name, element } = summonedEvt.payload;

  const root = await waitFor(() => appRoot().querySelector('.cb-summon-ceremony'));
  await waitFor(() => animByMount('summon') && animByMount('summon').played);
  assert.ok(root.classList.contains('phase-sequence'), 'the ceremony opens on the summon sequence phase');
  assert.ok(!renderedText(appRoot()).includes(name), 'the name is NOT visible during the sequence');
  assert.ok(!animByMount('reveal-wizard').played, 'the wizard is NOT drawn during the sequence — first sight is the reveal');

  await sleep(3); // make the measured seal-to-reveal duration strictly positive

  // the sequence completes -> the forming beat (body/hands/hat over the
  // in-progress loop), still no reveal
  animByMount('summon').fire('complete');
  await waitFor(() => root.classList.contains('phase-manifest'));
  assert.ok(animByMount('body').played, 'the forming beat plays');
  assert.ok(!renderedText(appRoot()).includes(name), 'still no name during the forming beat');
  assert.ok(!animByMount('reveal-wizard').played, 'still no wizard before the reveal');

  // the forming beat completes -> FIRST SIGHT: the actual wizard + its name
  animByMount('body').fire('complete');
  await waitFor(() => root.classList.contains('phase-reveal') && renderedText(appRoot()).includes(name));

  const reveal = animByMount('reveal-wizard');
  assert.ok(reveal.played, 'the reveal plays the rig draw');
  assert.equal(reveal.cfg.renderer, 'canvas', 'the reveal uses the shipped player configuration (R78)');
  assert.ok(reveal.cfg.animationData && reveal.cfg.animationData.layers, 'the reveal is drawn from in-memory animation data, never a path/src');

  // the reveal is the ACTUAL summoned wizard: the same derive->recolour
  // path the duel stage uses, in ITS own palette — not a generic clip.
  const identity = wizardIdentity({ id: characterId, element, tier: 0 });
  const raw = JSON.parse(await fs.readFile(path.join(RIG_ASSETS, 'fallback', elementToken(element), `${REVEAL_STATE}.json`), 'utf8'));
  const expected = recolorAnimation(raw, identity.palette).animation;
  assert.deepEqual(reveal.cfg.animationData, expected, 'the reveal draws the summoned wizard: its own shape set recoloured to its OWN derived palette');
  assert.notDeepEqual(reveal.cfg.animationData, raw, 'the reveal is recoloured live — never the source-coloured (pre-baked) clip');

  // the name appears exactly at the reveal, with a Continue action
  assert.ok(renderedText(appRoot()).includes(name), 'the name is revealed with the wizard');
  assert.ok(appRoot().querySelectorAll('button').some((b) => renderedText(b) === 'Continue'), 'one Continue action on the reveal');

  // (d) seal-to-reveal instrumented on the ledger, through the existing
  // append API, with a real measured number
  const metric = ctx.game.ledger.all().find((e) => e.type === 'SUMMON_CEREMONY_REVEALED');
  assert.ok(metric, 'the seal-to-reveal event is on the ledger');
  assert.equal(metric.payload.characterId, characterId);
  assert.ok(Number.isFinite(metric.payload.sealToRevealMs), 'sealToRevealMs is a real number');
  assert.ok(metric.payload.sealToRevealMs > 0, `sealToRevealMs is a real measured duration (got ${metric.payload.sealToRevealMs})`);
  assert.equal(metric.payload.ceremonyDegraded, false, 'the full ceremony played — honestly recorded as not degraded');
});

// ---- the full 2019 set, per element ---------------------------------------

test('CB-BUILD-014/R74a: the sequence is the bundle\'s full summon set — summon, summon-in-progress, body, hat, hands, sparkles, the element\'s flag and prep (fire/water; the bundle ships no Air prep)', () => {
  const fire = summonSequenceLayers('fire');
  const names = fire.map((l) => l.name);
  for (const required of ['summon-bg', 'summon', 'summon-in-progress', 'body', 'hat', 'hands', 'sparkles', 'flag', 'prep']) {
    assert.ok(names.includes(required), `fire summon carries the ${required} layer`);
  }
  assert.equal(fire.find((l) => l.name === 'flag').file, 'fireFlag.json');
  assert.equal(fire.find((l) => l.name === 'prep').file, 'firePrep.json');
  const water = summonSequenceLayers('water');
  assert.equal(water.find((l) => l.name === 'flag').file, 'waterFlag.json');
  assert.equal(water.find((l) => l.name === 'prep').file, 'waterPrep.json');
  const air = summonSequenceLayers('air');
  assert.equal(air.find((l) => l.name === 'flag').file, 'windFlag.json', 'Air plays the bundle\'s WIND flag (Wind is Air in copy, files keep 2019 names)');
  assert.equal(air.find((l) => l.name === 'prep'), undefined, 'no prep layer for Air — the bundle ships none');
});

test('CB-BUILD-014/R74a: two different summoned wizards reveal DIFFERENT composited output (own parts/palette, never a shared clip)', async () => {
  const log = [];
  const a = createSummonCeremony({ character: { id: 'ceremony-wizard-A', element: 'fire', tier: 0 }, treatment, fetchImpl: localFetch(log), cache: new Map() });
  const b = createSummonCeremony({ character: { id: 'ceremony-wizard-B', element: 'fire', tier: 0 }, treatment, fetchImpl: localFetch(log), cache: new Map() });
  // drive both ceremonies to their reveals
  await waitFor(() => createdAnims.filter((i) => i.cfg.container.getAttribute('data-anim') === 'summon').length === 2);
  for (const inst of createdAnims.filter((i) => i.cfg.container.getAttribute('data-anim') === 'summon')) inst.fire('complete');
  await waitFor(() => createdAnims.filter((i) => i.cfg.container.getAttribute('data-anim') === 'body' && i.played).length === 2);
  for (const inst of createdAnims.filter((i) => i.cfg.container.getAttribute('data-anim') === 'body')) inst.fire('complete');
  const [reportA, reportB] = await Promise.all([a.whenRevealed, b.whenRevealed]);
  assert.equal(reportA.revealDegraded, false);
  assert.equal(reportB.revealDegraded, false);
  const reveals = createdAnims.filter((i) => i.cfg.container.getAttribute('data-anim') === 'reveal-wizard');
  assert.equal(reveals.length, 2);
  assert.notDeepEqual(reveals[0].cfg.animationData, reveals[1].cfg.animationData,
    'two wizards of the same element still differ — each reveal is ITS wizard\'s own recoloured set');
  a.destroy(); b.destroy();
});

// ---- honest degradation ----------------------------------------------------

test('CB-BUILD-014: a total load failure never strands the reveal — whenRevealed still resolves, the degradation is recorded and stated in player language', async () => {
  const c = createSummonCeremony({ character: { id: 'ceremony-wizard-C', element: 'water', tier: 0 }, treatment, fetchImpl: failingFetch, cache: new Map() });
  const report = await c.whenRevealed;
  assert.equal(report.sequenceDegraded, true, 'the skipped sequence is recorded, never hidden');
  assert.equal(report.revealDegraded, true, 'the failed rig draw is recorded, never hidden');
  assert.ok(renderedText(c.root).includes(treatment.copy.stageDegradedNotice), 'the treatment\'s stated notice renders in player language');
  c.destroy();
});

// ---- structural: the flow and the call path -------------------------------

test('CB-BUILD-014 (defect repro, static): the press no longer jumps straight to a static card — the ceremony runs between summonCharacter and the reveal, and the reveal goes through the rig path', async () => {
  const screenSrc = await read('ui/screens/summon.js');
  assert.ok(/renderCeremony\(summoned, sealTs\)/.test(screenSrc), 'the press routes through the ceremony');
  const attemptBody = screenSrc.slice(screenSrc.indexOf('function attemptSummon'), screenSrc.indexOf('function renderCeremony'));
  assert.ok(!/renderReveal\(/.test(attemptBody), 'the press never calls the reveal directly any more');
  assert.ok(/sealToRevealMs/.test(screenSrc) && /ledger\.append\(/.test(screenSrc), 'seal-to-reveal is instrumented through the existing ledger append API');

  const ceremonySrc = await read('ui/components/summon/ceremony.js');
  assert.ok(/wizardIdentity/.test(ceremonySrc) && /recolorAnimation/.test(ceremonySrc), 'the reveal derives + recolours through the existing rig entry points (t4: called, never edited)');
  assert.ok(/renderer: 'canvas'/.test(ceremonySrc) && /setSubframe\(false\)/.test(ceremonySrc), 'the shipped player configuration (R78: the engine stays)');
  assert.ok(/animationData:/.test(ceremonySrc), 'players are created from in-memory data');
  assert.ok(!/\.src\s*=/.test(ceremonySrc) && !/\.gif/i.test(ceremonySrc), 'no src swap, no pre-baked clip anywhere in the ceremony');
});
