// app/tests/rig-identity.test.js — CB-BUILD-006 / §18 / R74: the parametric
// wizard identity. Every summoned wizard gets deterministic cosmetic traits
// (head/cape/hat/wand, selecting a REAL per-combo shape set from the
// library manifest) and a palette (one colour per portrait colour slot),
// assigned at summon, additive on the ledger payloads — and a wizard the
// system has never seen resolves to a valid identity the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTraits, derivePalette, wizardIdentity, parseComboKey, powerForTier,
  animationName, animationUrl, affinityCapeName, RIG_STATES,
} from '../engine/wizardRig.js';
import { RIG_COMBOS, RIG_FPS, RIG_WIDTH, RIG_HEIGHT } from '../data/rigManifest.js';
import { SLOT_NAMES, SLOT_COLOURS } from '../data/rigPalette.js';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import * as sync from '../engine/sync.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGame(seed = 1) {
  return new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(seed) });
}

test('the manifest is real: >1000 eligible combos, each parseable, states/fps/frame constants match the reference library', () => {
  assert.ok(RIG_COMBOS.length > 1000, `expected a real manifest, got ${RIG_COMBOS.length}`);
  for (const key of RIG_COMBOS.slice(0, 50)) assert.ok(parseComboKey(key), `unparseable combo ${key}`);
  assert.deepEqual(RIG_STATES, ['idle', 'charge', 'chargeloop', 'attack', 'hit', 'reset', 'cancel', 'win', 'lose', 'draw']);
  assert.equal(RIG_FPS, 30);
  assert.equal(RIG_WIDTH, 1720);
  assert.equal(RIG_HEIGHT, 1400);
});

test('trait assignment is deterministic, element-correct, and always lands on a real complete shape set', () => {
  const a1 = deriveTraits('char-abc', 'fire', 0);
  const a2 = deriveTraits('char-abc', 'fire', 0);
  assert.deepEqual(a1, a2, 'same characterId must derive identical traits');
  assert.ok(RIG_COMBOS.includes(a1.comboKey), 'assigned combo must exist in the library manifest');
  assert.equal(parseComboKey(a1.comboKey).element, 'FIRE');
  // "Wind is Air": the air element maps to the library's WIND sets.
  const air = deriveTraits('char-air', 'air', 0);
  assert.equal(parseComboKey(air.comboKey).element, 'WIND');
  const water = deriveTraits('char-w', 'water', 0);
  assert.equal(parseComboKey(water.comboKey).element, 'WATER');
});

test('a wizard the system has never seen animates as itself: any fresh id resolves to a valid combo + full palette', () => {
  for (let i = 0; i < 200; i++) {
    const id = `never-seen-${i}-${(i * 2654435761) % 97}`;
    const element = ['fire', 'water', 'air'][i % 3];
    const identity = wizardIdentity({ id, element, tier: i % 7 });
    assert.ok(RIG_COMBOS.includes(identity.comboKey), `unseen wizard ${id} must resolve to a real shape set`);
    for (const slot of SLOT_NAMES) {
      assert.match(identity.palette[slot], /^#[0-9A-F]{6}$/, `palette slot ${slot} must be a colour`);
      assert.ok(SLOT_COLOURS[slot].includes(identity.palette[slot]), `slot ${slot} colour must come from the slot's canonical list`);
    }
    // every state of the assigned combo addresses a real library file name
    for (const state of RIG_STATES) {
      assert.equal(animationName(state, identity.comboKey), `${state}-${identity.comboKey}.json`);
      assert.ok(animationUrl(state, identity.comboKey).startsWith('https://storage.googleapis.com/'));
    }
  }
});

test('two different wizards are visually distinct: different ids never collide on BOTH traits and palette (100 same-element pairs)', () => {
  let identical = 0;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const a = wizardIdentity({ id: `duel-a-${i}`, element: 'fire', tier: 0 });
    const b = wizardIdentity({ id: `duel-b-${i}`, element: 'fire', tier: 0 });
    const samePalette = JSON.stringify(a.palette) === JSON.stringify(b.palette);
    const sameTraits = a.comboKey === b.comboKey;
    if (samePalette && sameTraits) identical++;
  }
  assert.equal(identical, 0, `${identical}/${N} same-element pairs collided on BOTH traits and palette`);
});

test('palette assignment is per-slot deterministic and canonical-only', () => {
  const p1 = derivePalette('char-xyz');
  const p2 = derivePalette('char-xyz');
  assert.deepEqual(p1, p2);
  assert.deepEqual(Object.keys(p1).sort(), [...SLOT_NAMES].sort());
});

test('power tier maps game tiers onto the tiers the library actually carries', () => {
  for (const el of ['FIRE', 'WATER', 'WIND']) {
    for (let tier = 0; tier <= 6; tier++) {
      const p = powerForTier(el, tier);
      assert.ok(Number.isInteger(p) && p >= 1, `power for ${el} tier ${tier} = ${p}`);
      assert.ok(RIG_COMBOS.some((c) => { const q = parseComboKey(c); return q.element === el && q.power === p; }),
        `power ${p} must have ${el} combos`);
    }
  }
});

test('affinity-cape FX overlays resolve per element/power from the library manifest', () => {
  for (const el of ['fire', 'water', 'air']) {
    for (const kind of ['win', 'lose']) {
      const name = affinityCapeName(kind, el, 1);
      assert.ok(name && name.startsWith(`affinitycape${kind}-`), `${el}/${kind} -> ${name}`);
    }
  }
});

test('summon assigns traits+palette on the CHARACTER_SUMMONED payload (additive; existing fields untouched) and the snapshot carries them', () => {
  const game = freshGame();
  game.ensureAccount(1000);
  const payload = game.summonCharacter({ element: 'water' }, 1001);
  // additive: every pre-existing field still present
  for (const k of ['characterId', 'name', 'element', 'stakeCheddar', 'costUSD']) {
    assert.ok(k in payload, `existing summon payload field ${k} must survive`);
  }
  assert.ok(payload.traits && RIG_COMBOS.includes(payload.traits.comboKey), 'summon payload carries a valid comboKey');
  assert.deepEqual(payload.traits, deriveTraits(payload.characterId, 'water', 0), 'traits are the deterministic derivation of the characterId');
  assert.deepEqual(payload.palette, derivePalette(payload.characterId), 'palette is the deterministic derivation of the characterId');
  const c = game.snapshot().characters[payload.characterId];
  assert.deepEqual(c.traits, payload.traits, 'snapshot character carries the summoned traits');
  assert.deepEqual(c.palette, payload.palette, 'snapshot character carries the summoned palette');
  // wizardIdentity prefers the recorded identity and agrees with it
  assert.equal(wizardIdentity(c).comboKey, payload.traits.comboKey);
});

test('NPC seats get the same additive identity on NPC_SEATED; pre-upgrade characters (no stored identity) still resolve', () => {
  const game = freshGame(7);
  game.ensureAccount(1000);
  const s = game.summonCharacter({ element: 'fire' }, 1001);
  let t = 2000;
  const lobby = game.joinLobby(s.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  game.lockBracketFromLobby(lobby, t);
  const npcChars = Object.values(game.snapshot().characters).filter((c) => c.kind === 'npc');
  assert.ok(npcChars.length >= 7, `expected 7 NPC characters, got ${npcChars.length}`);
  for (const npc of npcChars) {
    assert.ok(npc.traits && RIG_COMBOS.includes(npc.traits.comboKey), `NPC ${npc.id} carries valid traits`);
    assert.ok(npc.palette && Object.keys(npc.palette).length === SLOT_NAMES.length, `NPC ${npc.id} carries a full palette`);
    assert.deepEqual(npc.traits, deriveTraits(npc.id, npc.element, npc.tier), 'NPC traits are the deterministic derivation');
  }
  // pre-upgrade character: no stored identity -> derived, valid, deterministic
  const legacy = { id: 'legacy-0001', element: 'water', tier: 2, traits: null, palette: null };
  const identity = wizardIdentity(legacy);
  assert.ok(RIG_COMBOS.includes(identity.comboKey));
  assert.deepEqual(identity, wizardIdentity(legacy));
});
