// app/tests/identity-read-time.test.js — CB-BUILD-022 / R74 / §18:
// "each combatant is the actual character, composited and recoloured by the
// rig. THE RIG'S DERIVATION IS THE AUTHORITY; the ledger records history."
//
// Round-1 derived character traits/palette AT SUMMON and recorded them as
// ledger fields (CHARACTER_SUMMONED.payload.traits/palette, NPC_SEATED
// likewise) which the read path (wizardRig.wizardIdentity) then PREFERRED
// over a fresh derivation. Build-forward: the read path now derives
// DETERMINISTICALLY from the character id (element, and the live tier for
// the power family) EVERY time, and never looks at recorded fields at all —
// they stay written as an audit record (game.js is unchanged: it still
// writes `traits`/`palette` on CHARACTER_SUMMONED and NPC_SEATED, and
// projection.js still carries them onto the snapshot character), but they
// are now read by NOTHING: `wizardRig.wizardIdentity`/`deriveIdentity`
// never consult `character.traits` or `character.palette`; neither does any
// caller downstream of it (the duel stage's rig loadout, rigAssets.js,
// takes traits/palette exclusively from wizardIdentity()'s return value).
//
// This file proves it three ways, per CB-BUILD-022's own instructions:
//   (1) recorded fields ABSENT (the spec's named example),
//   (2) recorded fields present but DELIBERATELY WRONG/stale (one step past
//       the example — exactly where a "prefer recorded, fall back to derive"
//       bug would survive undetected forever, since the common case doesn't
//       exercise it),
//   (3) determinism across a PROCESS boundary (a fresh Node process, no
//       shared module cache, no in-memory seed) — the derivation is a pure
//       function of its arguments, not of anything this process happened to
//       compute or cache earlier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  deriveIdentity, deriveTraits, derivePalette, wizardIdentity, elementToken,
} from '../engine/wizardRig.js';
import { RIG_COMBOS } from '../data/rigManifest.js';
import { createRigLoadout, DUEL_STATES } from '../ui/components/battle/rigAssets.js';
import { recolorAnimation, geometryDigest, colourInventory } from '../engine/rigRecolor.js';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { project } from '../engine/projection.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import * as sync from '../engine/sync.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RIG_ASSETS = path.resolve(__dirname, '..', '..', 'assets', 'rig');

function localFetch() {
  return async (url) => {
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
}

function layerTreeDigest(animation) {
  return geometryDigest(animation) + '|' + colourInventory(animation).map((c) => c.hex).join(',');
}

// ---------------------------------------------------------------------------
// (1) recorded fields ABSENT — the spec's named example
// ---------------------------------------------------------------------------

test('CB-BUILD-022 (absent case): a character whose recorded traits/palette are ABSENT renders byte-identically to the derivation', () => {
  for (const [id, element, tier] of [
    ['read-absent-1', 'fire', 0],
    ['read-absent-2', 'water', 3],
    ['read-absent-3', 'air', 6],
  ]) {
    const derived = deriveIdentity(id, element, tier);
    const noFieldsAtAll = wizardIdentity({ id, element, tier }); // traits/palette keys not present at all
    const explicitNull = wizardIdentity({ id, element, tier, traits: null, palette: null });
    const explicitUndefined = wizardIdentity({ id, element, tier, traits: undefined, palette: undefined });
    const emptyPalette = wizardIdentity({ id, element, tier, traits: null, palette: {} });
    for (const rendered of [noFieldsAtAll, explicitNull, explicitUndefined, emptyPalette]) {
      assert.deepEqual(rendered.traits, derived.traits, `${id}: traits must match the derivation exactly when recorded fields are absent`);
      assert.deepEqual(rendered.palette, derived.palette, `${id}: palette must match the derivation exactly when recorded fields are absent`);
      assert.equal(rendered.comboKey, derived.comboKey);
    }
  }
});

test('CB-BUILD-022 (absent case, end-to-end): a pre-upgrade / legacy character with no stored identity at all resolves to a real, complete, deterministic derivation', () => {
  const legacy = { id: 'legacy-9001', element: 'water', tier: 2 }; // no .traits, no .palette keys
  const identity = wizardIdentity(legacy);
  assert.ok(RIG_COMBOS.includes(identity.comboKey), 'must resolve to a real shape set in the manifest');
  assert.deepEqual(identity, wizardIdentity(legacy), 'repeated reads of the same absent-record character agree');
  assert.deepEqual(identity, deriveIdentity('legacy-9001', 'water', 2), 'identical to the direct derivation entry point');
});

// ---------------------------------------------------------------------------
// (2) recorded fields present but DELIBERATELY WRONG / stale — one step past
//     the spec's example, exactly where a "prefer recorded" bug would hide
// ---------------------------------------------------------------------------

test('CB-BUILD-022 (stale/wrong case): recorded traits/palette that are WRONG (belong to a different character entirely) are still ignored — rendered identity equals the derivation, not the garbage', () => {
  const id = 'read-stale-1';
  const element = 'fire';
  const tier = 4;
  const derived = deriveIdentity(id, element, tier);
  // deliberately wrong: another real character's traits/palette, at a
  // DIFFERENT element and tier than this character's own — a plausible
  // "stale ledger record from before a re-summon / data migration" shape.
  const wrongTraits = deriveTraits('someone-else-entirely', 'water', 0);
  const wrongPalette = derivePalette('someone-else-entirely');
  assert.notEqual(wrongTraits.comboKey, derived.comboKey, 'fixture sanity: the wrong traits really are different from the derivation');
  assert.notDeepEqual(wrongPalette, derived.palette, 'fixture sanity: the wrong palette really is different from the derivation');
  const rendered = wizardIdentity({ id, element, tier, traits: wrongTraits, palette: wrongPalette });
  assert.deepEqual(rendered.traits, derived.traits, 'wrong recorded traits must NOT leak into the rendered identity');
  assert.deepEqual(rendered.palette, derived.palette, 'wrong recorded palette must NOT leak into the rendered identity');
  assert.equal(rendered.comboKey, derived.comboKey);
});

test('CB-BUILD-022 (stale/wrong case): recorded traits that are STRUCTURALLY invalid (comboKey not in the manifest, garbage fields) do not crash the read path and are still ignored', () => {
  const id = 'read-stale-2';
  const element = 'air';
  const tier = 1;
  const derived = deriveIdentity(id, element, tier);
  const garbageTraits = { head: 'head99', cape: 'cape99', hat: 'hat99', wand: 'wand99', power: 999, comboKey: 'NOT-A-REAL-COMBO-KEY' };
  const garbagePalette = { 'boot-accent': '#000000' }; // wrong shape: missing every other slot, bogus value
  const rendered = wizardIdentity({ id, element, tier, traits: garbageTraits, palette: garbagePalette });
  assert.deepEqual(rendered.traits, derived.traits, 'structurally-invalid recorded traits must not surface, let alone crash the read');
  assert.deepEqual(rendered.palette, derived.palette, 'structurally-invalid recorded palette must not surface');
  assert.ok(RIG_COMBOS.includes(rendered.comboKey), 'still resolves to a real, complete shape set');
});

test('CB-BUILD-022 (stale/wrong case, tier-matched): even when the wrong recorded traits happen to sit in the SAME live power family (the old carry rule\'s easiest case), the derivation still wins, not the record', () => {
  // The old N-R74 carry rule's "recorded power already matches the live
  // power family -> recorded traits verbatim" branch was the one MOST
  // likely to hide this defect (same power family looks "plausible"). Prove
  // it's gone: hand in wrong-but-same-power traits and check they're inert.
  const id = 'read-stale-3';
  const element = 'fire';
  const tier = 0;
  const derived = deriveTraits(id, element, tier);
  const wrongSamePower = deriveTraits('read-stale-3-decoy', element, tier); // same element+tier => same power family
  assert.equal(wrongSamePower.power, derived.power, 'fixture sanity: same power family');
  assert.notEqual(wrongSamePower.comboKey, derived.comboKey, 'fixture sanity: still a different combo');
  const rendered = wizardIdentity({ id, element, tier, traits: wrongSamePower, palette: null });
  assert.equal(rendered.comboKey, derived.comboKey, 'same-power-family wrong traits are still ignored — no special-cased "verbatim" branch survives');
});

test('CB-BUILD-022 (stale/wrong case, end-to-end via the ledger): a snapshot character whose projected traits/palette were corrupted after summon still renders the derivation', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(5) });
  game.ensureAccount(1000);
  const payload = game.summonCharacter({ element: 'water' }, 1001);
  const pristine = game.snapshot().characters[payload.characterId];
  const derived = deriveIdentity(pristine.id, pristine.element, pristine.tier);
  // Simulate a stale/corrupted ledger-derived record (e.g. hand-edited
  // storage, a migration bug, bit rot) by taking the projected snapshot
  // object and swapping in wrong values for the recorded identity fields —
  // this is exactly the shape wizardIdentity() receives in production; it
  // must not matter one bit.
  const corrupted = { ...pristine, traits: { head: 'headXX', cape: 'capeXX', hat: 'hatXX', wand: 'wandXX', power: 1, comboKey: 'FIRE-1-headXX-capeXX-hatXX-wandXX' }, palette: { 'boot-accent': '#123456' } };
  const renderedPristine = wizardIdentity(pristine);
  const renderedCorrupted = wizardIdentity(corrupted);
  assert.deepEqual(renderedPristine, derived, 'the untouched snapshot character renders the derivation');
  assert.deepEqual(renderedCorrupted, derived, 'the corrupted snapshot character renders the SAME derivation — byte-identical to the pristine read');
  assert.deepEqual(renderedPristine, renderedCorrupted, 'pristine and corrupted characters render byte-identically');
});

// ---------------------------------------------------------------------------
// duel-stage data feed: rigAssets.createRigLoadout (what the UI actually
// consumes) is equally indifferent to absent/stale recorded fields, because
// it takes identity exclusively from wizardIdentity() — no separate read of
// character.traits/.palette anywhere in its own code.
// ---------------------------------------------------------------------------

test('CB-BUILD-022: the duel stage\'s rig loadout renders byte-identical recoloured layer trees for a character with absent vs. stale/wrong recorded fields', async () => {
  const base = { id: 'loadout-check-1', element: 'fire', tier: 2 };
  const withWrongRecord = {
    ...base,
    traits: { head: 'head01', cape: 'cape01', hat: 'hat01', wand: 'wand01', power: 1, comboKey: 'WATER-1-head01-cape01-hat01-wand01' },
    palette: { 'boot-accent': '#FFFFFF' },
  };
  const loadoutAbsent = createRigLoadout({ p1Character: base, p2Character: { id: 'loadout-check-2', element: 'water', tier: 0 }, fetchImpl: localFetch(), cache: new Map() });
  const loadoutStale = createRigLoadout({ p1Character: withWrongRecord, p2Character: { id: 'loadout-check-2', element: 'water', tier: 0 }, fetchImpl: localFetch(), cache: new Map() });
  await Promise.all([loadoutAbsent.ready, loadoutStale.ready]);
  assert.equal(loadoutAbsent.identities.p1.comboKey, loadoutStale.identities.p1.comboKey, 'the loadout\'s resolved identity ignores the stale recorded traits');
  for (const state of DUEL_STATES) {
    const a = loadoutAbsent.get('p1', state);
    const b = loadoutStale.get('p1', state);
    assert.equal(layerTreeDigest(a), layerTreeDigest(b), `state ${state}: absent-record and stale-record loadouts must render byte-identically`);
  }
});

// ---------------------------------------------------------------------------
// (3) determinism across a PROCESS boundary — no in-memory cache seeds it
// ---------------------------------------------------------------------------

const wizardRigUrl = pathToFileURL(path.resolve(__dirname, '..', 'engine', 'wizardRig.js')).href;

/** Compute deriveIdentity(id, element, tier) in a brand-new Node process —
 * a fresh module graph, no shared globals, no warm cache from this test
 * file or any earlier test in the suite. */
function deriveInFreshProcess(id, element, tier) {
  const code = `
    import(${JSON.stringify(wizardRigUrl)}).then((m) => {
      const identity = m.deriveIdentity(${JSON.stringify(id)}, ${JSON.stringify(element)}, ${JSON.stringify(tier)});
      process.stdout.write(JSON.stringify(identity));
    });
  `;
  const out = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('CB-BUILD-022 (cross-process determinism): the SAME id derives IDENTICALLY in two independent fresh Node processes, and matches this process\'s own derivation', () => {
  const id = 'cross-process-char-42';
  const element = 'water';
  const tier = 3;
  const here = deriveIdentity(id, element, tier);
  const proc1 = deriveInFreshProcess(id, element, tier);
  const proc2 = deriveInFreshProcess(id, element, tier); // a SECOND fresh process, not a rerun in the first
  assert.deepEqual(proc1, here, 'a fresh process must derive exactly what this process derives');
  assert.deepEqual(proc2, here, 'a second, independent fresh process must derive exactly what this process derives');
  assert.deepEqual(proc1, proc2, 'two fresh processes must agree with each other');
}); // no timeout override needed: two `node -e` spawns are cheap

test('CB-BUILD-022 (cross-process determinism, several ids/elements/tiers): fresh-process derivation matches in-process derivation across the board', () => {
  const cases = [
    ['proc-a', 'fire', 0],
    ['proc-b', 'water', 5],
    ['proc-c', 'air', 6],
  ];
  for (const [id, element, tier] of cases) {
    const here = deriveIdentity(id, element, tier);
    const fresh = deriveInFreshProcess(id, element, tier);
    assert.deepEqual(fresh, here, `${id}/${element}/tier ${tier}: fresh-process derivation must match`);
  }
});

// ---------------------------------------------------------------------------
// sanity: the derivation entry point's own contract (id-keyed, no ledger read)
// ---------------------------------------------------------------------------

test('CB-BUILD-022: deriveIdentity is a pure function of (characterId, elementKey, tier) — same inputs, same outputs, no hidden state', () => {
  const a1 = deriveIdentity('pure-check', 'fire', 2);
  const a2 = deriveIdentity('pure-check', 'fire', 2);
  assert.deepEqual(a1, a2);
  assert.ok(RIG_COMBOS.includes(a1.comboKey));
  assert.equal(elementToken('fire'), 'FIRE');
  assert.equal(a1.characterId, 'pure-check');
  assert.equal(a1.element, 'fire');
});
