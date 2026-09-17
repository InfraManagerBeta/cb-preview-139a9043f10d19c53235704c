// app/tests/rig-stage-degraded.test.js — A-loader (fix round F2, R74/
// §12/R83): the TOTAL load-failure path of the incumbent battle stage.
// Before this fix, when `loadout.ready` rejected (bucket AND vendored
// fallback both unreachable) rigStage.js added `.done`/`.ready` only on
// the success path, so `.cb-rig-scene{visibility:hidden}` held and the
// progress card stayed pinned over the arena for the whole duel: a frozen
// loader, no combatants, no explanation. Now the stage fails honestly: the
// loader hides, the stage stands in its best available degraded form (the
// arena art and nameplates render independently of the loadout — never a
// blank field), and a one-line player-language notice on the PROSE face
// says so. whenReady resolves (never rejects), so duel.js's reveal
// proceeds on schedule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeDom, uninstallFakeDom, renderedText } from './helpers/dom-harness.js';
import { loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const treatment = await loadTreatment('incumbent');

/** A loadout whose every fetch failed: ready rejects (the total-failure
 * shape rigAssets produces when bucket AND vendored fallback are down). */
function rejectingLoadout() {
  const ready = Promise.reject(new Error('rig fetch failed: 503'));
  ready.catch(() => {}); // observed by the stage; silence the bare handle
  return {
    identities: {},
    report: { p1: { fallbackStates: [], fallbackCapes: [], unslottedStates: [] }, p2: { fallbackStates: [], fallbackCapes: [], unslottedStates: [] } },
    ready,
    progress: () => ({ loaded: 0, total: 22 }),
    get: () => null,
    getCape: () => null,
  };
}

const p1 = { name: 'Alpha', element: 'fire', isNpc: false };
const p2 = { name: 'Beta', element: 'fire', isNpc: true };

/** A stub player installed as globalThis.lottie — rigStage's ensureLottie()
 * prefers the global attach (the browser UMD shape), so the stage's own
 * wiring (instance creation, classes, loader, watchdog) runs for real while
 * the rendering itself is stubbed (no real canvas under node:test). */
function installFakePlayer() {
  globalThis.lottie = {
    loadAnimation: () => ({
      setSubframe() {}, goToAndStop() {}, play() {}, pause() {},
      destroy() {}, resize() {}, addEventListener() {}, totalFrames: 1,
    }),
  };
  return () => { delete globalThis.lottie; };
}

test('A-loader: loadout.ready rejection degrades honestly — loader hidden, stage revealed, prose-face player-language notice; whenReady resolves', async (t) => {
  installFakeDom();
  const removePlayer = installFakePlayer();
  t.after(() => { uninstallFakeDom(); removePlayer(); });
  const { createRigStage } = await import('../ui/components/battle/rigStage.js');
  const stage = createRigStage({ loadout: rejectingLoadout(), p1, p2, treatment });
  // whenReady RESOLVES on total failure (duel.js's reveal proceeds); a
  // rejection here would strand the timeline start.
  await stage.whenReady;

  // never a frozen loader: the progress card is hidden
  const loader = stage.root.querySelector('.cb-rig-loader');
  assert.ok(loader, 'loader element exists');
  assert.ok(loader.classList.contains('done'), 'the loader is hidden (.done), not pinned over the arena');

  // best available degraded form: the arena art still underlies the stage
  // (an <img> independent of the loadout — never a blank/white field) and
  // the nameplates still name both combatants.
  assert.ok(stage.root.classList.contains('degraded'), 'the stage declares its degraded state');
  const arena = stage.root.querySelector('.cb-rig-arena');
  assert.ok(arena && /fightScene\/fightBG\.svg$/.test(arena.getAttribute('src')), 'the arena art element still stands under the stage');
  const text = renderedText(stage.root);
  assert.ok(text.includes('Alpha') && text.includes('Beta'), 'both nameplates still render');

  // the one-line notice: player language, PROSE face
  const notice = stage.root.querySelector('.cb-rig-degraded-notice');
  assert.ok(notice, 'a degradation notice is rendered');
  assert.ok(notice.classList.contains('cb-prose'), 'the notice is on the prose face (R11), never the data face');
  assert.equal(notice.textContent, treatment.copy.stageDegradedNotice, 'the notice is the treatment\u2019s player-language line');
  assert.ok(notice.textContent.length > 20 && !/error|fetch|http|503|undefined/i.test(notice.textContent),
    'player language: no developer vocabulary leaks (§12/R83)');
  stage.destroy();
});

test('A-loader: every treatment carries the player-language degradation line (copy key present, non-empty, no raw-error shape)', async () => {
  for (const id of ['incumbent', 'adjacent', 'far']) {
    const t = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', `${id}.json`), 'utf8'));
    assert.ok(t.copy.stageDegradedNotice && t.copy.stageDegradedNotice.length > 20, `${id}: stageDegradedNotice present`);
    assert.ok(!/error|fetch|http|\d\d\d\b/i.test(t.copy.stageDegradedNotice), `${id}: notice is player language`);
  }
});

test('A-loader: the SUCCESS path is untouched — no degraded class, no notice, loader done, scene revealed', async (t) => {
  installFakeDom();
  const removePlayer = installFakePlayer();
  t.after(() => { uninstallFakeDom(); removePlayer(); });
  const { createRigStage } = await import('../ui/components/battle/rigStage.js');
  const { createRigLoadout, DUEL_STATES } = await import('../ui/components/battle/rigAssets.js');
  const RIG_ASSETS = path.resolve(APP_ROOT, '..', 'assets', 'rig');
  const { elementToken } = await import('../engine/wizardRig.js');
  // serve every url from the vendored library files (same fake as
  // rig-stage.test.js) so the loadout genuinely succeeds
  const localFetch = async (url) => {
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
    } catch { return { ok: false, status: 404 }; }
  };
  const loadout = createRigLoadout({ p1Character: { id: 'ok-A', element: 'fire', tier: 0 }, p2Character: { id: 'ok-B', element: 'fire', tier: 0 }, fetchImpl: localFetch, cache: new Map() });
  const stage = createRigStage({ loadout, p1, p2, treatment });
  await stage.whenReady;
  assert.equal(DUEL_STATES.length, 9);
  assert.ok(!stage.root.classList.contains('degraded'), 'success path never carries the degraded class');
  assert.equal(stage.root.querySelector('.cb-rig-degraded-notice'), null, 'no notice on success');
  assert.ok(stage.root.classList.contains('ready'), 'scene revealed');
  assert.ok(stage.root.querySelector('.cb-rig-loader').classList.contains('done'), 'loader done');
  stage.destroy();
});
