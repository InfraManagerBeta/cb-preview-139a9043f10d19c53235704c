// app/tests/battle-parity.test.js — CB-BUILD-005/006, §17 AC1's battle-
// fidelity row: "verified as new output against old output — a comparison,
// not a judgment." This file is the NODE-FEASIBLE half of that comparison.
//
// WHAT THE AUTOMATED CHECK COVERS (here, headless):
//   - document parity: for the canonical wizard, every one of the ten state
//     documents the runtime plays is structurally IDENTICAL to the 2019
//     library's own document (same version/fps/frame-size/duration, same
//     layer list, same shapes) — the rig's recolour pass changes colour
//     values at slot-mapped fills and NOTHING else (tree-diff assertion);
//   - role parity: the reference DuelPlayer's per-wizard animation roles
//     (idle/charge/chargeLoop/attack/reset/hit/win/lose/draw, home+away,
//     parsed from the reference source itself) are all present in the
//     port's up-front layer plan;
//   - state-machine, layout, and sound-schedule parity against the
//     reference implementation's own constants (battle-stage-port.test.js);
//   - determinism/distinctness of the parametric documents per wizard
//     (parametric-rig.test.js).
//
// WHAT NEEDS A BROWSER (documented, not silently skipped): rasterized
// frame-diffs against renders/gifs + renders/png-seq for the canonical
// wizard, cross-fade smoothness, canvas playback timing. Run
//   python3 -m http.server 8080   (repo root)
// then open http://localhost:8080/app/, summon, enter a duel: the reveal
// composites both wizards on the arena; renders/gifs/*.gif are the visual
// parity targets, side by side. The shape documents themselves are pulled
// from the live bucket (or the vendored cache offline), so the browser
// output IS the library's own art recoloured — the diff surface is layout
// and timing, both pinned to the reference's constants above.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARY_STATES, TIMELINE_TO_LIBRARY_STATE, wizardRigFor, compositeParametricDocument } from '../ui/components/battle/rig.js';
import { stageLayerPlan } from '../ui/components/battle/stage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VENDORED_DIR = path.join(REPO_ROOT, 'assets', 'vendored-shapes');
const REFERENCE_DIR = path.join(REPO_ROOT, 'assets', 'cw-asset-bundle', 'reference', 'DuelPlayer');
const GIFS_DIR = path.join(REPO_ROOT, 'assets', 'cw-asset-bundle', 'renders', 'gifs');

const CANONICAL_COMBO_SUFFIX = '-FIRE-1-head02-cape04-hat01-wand01.json';
const CANONICAL_WIZARD = { id: 'canonical', name: 'The Canonical Wizard', element: 'fire' };

async function canonicalDoc(state) {
  return JSON.parse(await fs.readFile(path.join(VENDORED_DIR, `${state}${CANONICAL_COMBO_SUFFIX}`), 'utf8'));
}

/** Tree-diff two JSON values; collect the paths that differ. */
function diffPaths(a, b, prefix = '', out = []) {
  if (a === b) return out;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    out.push(prefix || '(root)');
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

// ---- role parity vs the reference implementation ------------------------------

test('parity: every per-wizard animation role the reference DuelPlayer loads (parsed from ITS source) exists in the port\'s up-front layer plan, both sides', async () => {
  const ref = await fs.readFile(path.join(REFERENCE_DIR, 'DuelPlayer.js'), 'utf8');
  // the reference declares this.HOME_<ROLE> = animationInstance(...) for the
  // per-wizard roles; parse them out of the source.
  const roles = new Set([...ref.matchAll(/this\.(HOME|AWAY)_([A-Z_]+) = animationInstance\(/g)]
    .map((m) => m[2])
    .filter((r) => !r.startsWith('FX_') && !r.startsWith('SPELL_')));
  assert.deepEqual([...roles].sort(), ['ATTACK', 'CHARGE', 'CHARGE_LOOP', 'DRAW', 'HIT', 'IDLE', 'LOSE', 'RESET', 'WIN'].sort(), 'the reference\'s nine per-wizard roles');
  const roleToLibrary = { IDLE: 'idle', CHARGE: 'charge', CHARGE_LOOP: 'chargeloop', ATTACK: 'attack', RESET: 'reset', HIT: 'hit', WIN: 'win', LOSE: 'lose', DRAW: 'draw' };
  const plan = stageLayerPlan();
  for (const role of roles) {
    const lib = roleToLibrary[role];
    assert.ok(lib, `no library mapping for reference role ${role}`);
    for (const side of ['p1', 'p2']) {
      assert.ok(plan.some((l) => l.side === side && l.kind === 'wizard' && l.state === lib), `port is missing the reference role ${role} (${side}:${lib})`);
    }
  }
  // the library additionally ships 'cancel' (unused by the reference's duel
  // chain); the port preloads it too, so no reachable state can ever miss.
  assert.ok(plan.some((l) => l.state === 'cancel'));
});

// ---- document parity for the canonical wizard ---------------------------------

test('parity: for the canonical wizard, ALL TEN composited state documents are the 2019 library\'s own documents — identical structure, colour-only diffs at slot fills', async () => {
  const rig = wizardRigFor(CANONICAL_WIZARD);
  for (const state of LIBRARY_STATES) {
    const source = await canonicalDoc(state);
    const composite = compositeParametricDocument({ rig, state, shapeDoc: source });
    // identity envelope: version, fps, frame, duration, layer list
    assert.equal(composite.doc.v, source.v, `${state}: version`);
    assert.equal(composite.doc.fr, source.fr, `${state}: fps`);
    assert.equal(composite.doc.w, source.w, `${state}: width`);
    assert.equal(composite.doc.h, source.h, `${state}: height`);
    assert.equal(composite.doc.ip, source.ip, `${state}: in-point`);
    assert.equal(composite.doc.op, source.op, `${state}: out-point (duration)`);
    assert.deepEqual(composite.doc.layers.map((l) => l.nm), source.layers.map((l) => l.nm), `${state}: layer list`);
    assert.equal((composite.doc.assets || []).length, (source.assets || []).length, `${state}: asset (precomp) count`);
    // tree diff: EVERY difference is a colour value inside a fill/stroke
    // keypath ('.c.k...') or the rig's own meta stamp — nothing else moved.
    const diffs = diffPaths(source, composite.doc);
    assert.ok(diffs.length > 0, `${state}: the recolour must actually change something`);
    for (const p of diffs) {
      const isColour = /\.c\.k(\.|$)/.test(p) || /\.c\.k\.\d+/.test(p);
      const isMeta = p === 'meta' || p.startsWith('meta.');
      assert.ok(isColour || isMeta, `${state}: unexpected non-colour difference at ${p}`);
    }
  }
});

test('parity: the canonical wizard is deterministic — recompositing yields byte-identical documents (a stable diff target for the browser check)', async () => {
  const source = await canonicalDoc('win');
  const a = compositeParametricDocument({ rig: wizardRigFor(CANONICAL_WIZARD), state: 'win', shapeDoc: source });
  const b = compositeParametricDocument({ rig: wizardRigFor(CANONICAL_WIZARD), state: 'win', shapeDoc: source });
  assert.equal(JSON.stringify(a.doc), JSON.stringify(b.doc));
});

// ---- the parity references themselves ------------------------------------------

test('parity: the nine canonical GIF renders exist in the bundle as the browser-side visual diff targets (and stay out of the runtime)', async () => {
  const gifs = (await fs.readdir(GIFS_DIR)).filter((f) => f.endsWith('.gif'));
  assert.equal(gifs.length, 9, 'the bundle ships nine canonical duel GIFs');
  const expected = ['Idle', 'Battle Idle', 'Charge', 'Attack', 'Hit', 'Hit Success', 'Win', 'Lose', 'Power'];
  for (const name of expected) {
    assert.ok(gifs.some((g) => g.includes(name)), `missing the ${name} render`);
  }
});

test('parity: the affinity cape overlays share the wizard frame (1720×1400@30fps) so they composite exactly over the combatant', async () => {
  for (const f of ['affinitycapewin-FIRE-1.json', 'affinitycapelose-FIRE-1.json']) {
    const d = JSON.parse(await fs.readFile(path.join(VENDORED_DIR, f), 'utf8'));
    assert.equal(d.w, 1720, `${f}: width`);
    assert.equal(d.h, 1400, `${f}: height`);
    assert.equal(d.fr, 30, `${f}: fps`);
  }
});

test('parity: every library state the timeline can reach has a canonical vendored document, so the browser check can run fully offline', async () => {
  const reachable = new Set(Object.values(TIMELINE_TO_LIBRARY_STATE));
  for (const state of reachable) {
    await fs.access(path.join(VENDORED_DIR, `${state}${CANONICAL_COMBO_SUFFIX}`));
  }
});
