// app/tests/rig-cosmetic-carry.test.js — N-R74 (fix round F3b; R74 [LAW]
// "each combatant is the actual summoned wizard — its parts composited from
// ITS OWN traits"; §17 AC1 "its own cosmetic set").
//
// The F2 A-power fix made the rig's power tier a live read, but from tier 1
// up it RE-DERIVED head/cape/hat/wand from a fresh hash pool — discarding
// the summoned wizard's own cosmetic identity in 99% of the cases where its
// exact combo existed at the new power (the re-probe's measurement). This
// file binds the repaired rule:
//
//   1. the wizard's own tier-0 power == live power -> its own traits verbatim;
//   2. exact tier-0 combo exists in the             -> that combo (the wizard
//      live power family (manifest listed)             keeps its whole set);
//   3. otherwise                                    -> DETERMINISTIC nearest
//      match: most tier-0 parts preserved (head/cape/hat/wand, equal
//      weight), ties broken by the existing summon hash fnv1a('traits:'+id)
//      indexing the tied candidates sorted lexicographically by combo key.
//
// Palette: always as recorded (tier-independent). Ledger: untouched — the
// carry is the READ path only. Symmetry: player and NPC identities resolve
// by this ONE rule at every tier (an NPC's traits are recorded at its seat
// tier, where the carry is a no-op).
//
// Fix round F3 (reviewer CRUCIAL, reproduced by the manager: 900/900
// tier0-vs-tier1 differing): CB-BUILD-022/R74/§18 correctly took `carryTraits`
// OFF the read path as a ledger read (wizardIdentity/deriveIdentity must
// never consult `character.traits`), but the round-1 fix over-corrected and
// dropped the CARRY behaviour entirely — the read path re-derived
// head/cape/hat/wand fresh from a hash pool at the live tier, discarding the
// wizard's own combo almost every time. F3 restores the guarantee WITHOUT
// reintroducing a ledger read: `deriveIdentity`/`wizardIdentity` now derive
// the wizard's OWN combo at tier 0 (a pure function of characterId/element —
// no ledger field involved) and carry it into the live tier's power family
// via `carryTraits` (also pure — characterId/element/tier only). The tests
// below assert this guarantee AT THE READ PATH (`wizardIdentity()` /
// `deriveIdentity()`), per the reviewer's second finding that coverage had
// moved off the read path and let the regression through green; a second
// block keeps `carryTraits` itself (the pure utility, unchanged) directly
// tested for its own fallback/tie-break contract. See
// app/tests/identity-read-time.test.js for the dedicated coverage proving
// no *recorded* ledger field (absent/stale/wrong) is ever consulted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTraits, derivePalette, carryTraits, deriveIdentity, wizardIdentity, powerForTier,
  elementToken, parseComboKey, fnv1a,
} from '../engine/wizardRig.js';
import { RIG_COMBOS } from '../data/rigManifest.js';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import * as sync from '../engine/sync.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

const COMBO_SET = new Set(RIG_COMBOS);
const PARTS = ['head', 'cape', 'hat', 'wand'];

function exactKeyAt(recorded, elementKey, tier) {
  const token = elementToken(elementKey);
  const power = powerForTier(token, tier);
  return `${token}-${power}-${recorded.head}-${recorded.cape}-${recorded.hat}-${recorded.wand}`;
}

function preservedParts(recorded, traits) {
  return PARTS.filter((p) => traits[p] === recorded[p]).length;
}

// ---- (a) THE READ PATH: the wizard's own combo carries whenever it exists
//     at the new power — asserted through wizardIdentity()/deriveIdentity(),
//     not carryTraits() called directly (F3: this is what regressed and
//     what must stay covered at the read path going forward).

test('N-R74 (read path, F3): T0→T1 keeps the wizard\'s own cosmetic combo whenever it exists at the new power — a review-repro case (char-alpha, air) carries exactly through wizardIdentity()/deriveIdentity()', () => {
  const ownTier0 = deriveTraits('char-alpha', 'air', 0); // WIND-1-head03-cape03-hat03-wand01
  const exact = exactKeyAt(ownTier0, 'air', 1);
  assert.ok(COMBO_SET.has(exact), `fixture: char-alpha's own combo must exist at the T1 power (${exact})`);
  const viaWizardIdentity = wizardIdentity({ id: 'char-alpha', element: 'air', tier: 1 });
  const viaDeriveIdentity = deriveIdentity('char-alpha', 'air', 1);
  for (const identity of [viaWizardIdentity, viaDeriveIdentity]) {
    assert.equal(identity.comboKey, exact, 'the summoned wizard keeps its OWN head/cape/hat/wand at the new power, read through the identity entry points');
    for (const p of PARTS) assert.equal(identity.traits[p], ownTier0[p], `part ${p} preserved verbatim`);
    assert.equal(identity.traits.power, powerForTier(elementToken('air'), 1), 'only the power family moved');
  }
  // and: a stale/wrong `traits` argument on the character object changes
  // nothing (CB-BUILD-022 holds) — the carried combo comes from the
  // wizard's own tier-0 DERIVATION, never from what's passed in.
  const withGarbageRecorded = wizardIdentity({ id: 'char-alpha', element: 'air', tier: 1, traits: { head: 'headXX', cape: 'capeXX', hat: 'hatXX', wand: 'wandXX', power: 999, comboKey: 'NOT-REAL' }, palette: null });
  assert.equal(withGarbageRecorded.comboKey, exact, 'a garbage `traits` argument does not affect the carried combo — it is never read');
});

test('N-R74 (read path, F3): over 3000 synthetic characters at T0→T1 AND a higher jump (T0→T3), EVERY case whose exact combo exists at the new power carries it through wizardIdentity()/deriveIdentity() — 0 discarded', () => {
  for (const tier of [1, 3]) {
    let exists = 0;
    let carried = 0;
    for (let i = 0; i < 1000; i++) {
      for (const el of ['fire', 'water', 'air']) {
        const id = `char-${i}`;
        const ownTier0 = deriveTraits(id, el, 0);
        const exact = exactKeyAt(ownTier0, el, tier);
        if (!COMBO_SET.has(exact)) continue;
        exists += 1;
        const identity = wizardIdentity({ id, element: el, tier });
        const direct = deriveIdentity(id, el, tier);
        if (identity.comboKey === exact && direct.comboKey === exact) carried += 1;
        else assert.fail(`T0→T${tier} ${el} ${id}: own combo ${exact} exists at the new power but was discarded — wizardIdentity gave ${identity.comboKey}, deriveIdentity gave ${direct.comboKey}`);
      }
    }
    assert.equal(carried, exists, `T0→T${tier}: carried ${carried} of ${exists} existing combos through the read path — must be ALL of them`);
    assert.ok(exists > 300, `fixture sanity: the manifest must make this case common (got ${exists})`);
  }
});

// ---- (a2) THE WHOLE TIER LADDER — the past-the-examples case the spec never
//     enumerates (every enumerated scenario renders at tier 0). Walk a
//     character from tier 0 to the top of the ladder and check the carry
//     guarantee holds at EVERY step, not just a single T0→T1 advance.

test('F3: walking a character UP THE WHOLE TIER LADDER (tiers 0..6) — cosmetic parts persist at every single step through wizardIdentity(), not just on one T0→T1 advance', () => {
  let exactSteps = 0;
  let fallbackSteps = 0;
  for (let i = 0; i < 300; i++) {
    for (const el of ['fire', 'water', 'air']) {
      const id = `ladder-${i}`;
      const own = wizardIdentity({ id, element: el, tier: 0 });
      for (let tier = 1; tier <= 6; tier++) {
        const at = wizardIdentity({ id, element: el, tier });
        const exact = exactKeyAt(own.traits, el, tier);
        if (COMBO_SET.has(exact)) {
          exactSteps += 1;
          assert.equal(at.comboKey, exact, `${id} ${el} tier ${tier}: the wizard's own combo exists at this power and MUST carry verbatim`);
          for (const p of PARTS) assert.equal(at.traits[p], own.traits[p], `${id} ${el} tier ${tier}: part ${p} must be preserved`);
        } else {
          fallbackSteps += 1;
          // fallback engaged at this rung: still deterministic and still
          // the maximum achievable preservation of the wizard's OWN tier-0
          // parts within the live power family — never a fresh re-roll
          // that ignores them.
          const livePower = powerForTier(elementToken(el), tier);
          const family = RIG_COMBOS.map((key) => ({ key, ...parseComboKey(key) }))
            .filter((c) => c && c.element === elementToken(el) && c.power === livePower);
          const maxPreservable = Math.max(...family.map((c) => preservedParts(own.traits, c)));
          const got = preservedParts(own.traits, at.traits);
          assert.equal(got, maxPreservable, `${id} ${el} tier ${tier}: fallback preserves ${got} of ${maxPreservable} achievable parts`);
          assert.equal(parseComboKey(at.comboKey).power, livePower, `${id} ${el} tier ${tier}: fallback stays in the live power family`);
        }
        // determinism at every rung: re-reading the same tier gives the same identity
        assert.deepEqual(at, wizardIdentity({ id, element: el, tier }), `${id} ${el} tier ${tier}: read is deterministic`);
        // palette never moves as the wizard climbs
        assert.deepEqual(at.palette, own.palette, `${id} ${el} tier ${tier}: palette is tier-independent`);
      }
    }
  }
  assert.ok(exactSteps > 1000, `fixture sanity: enough exact-carry rungs exercised across the ladder (got ${exactSteps})`);
  assert.ok(fallbackSteps > 0, `fixture sanity: at least some rungs must exercise the fallback (got ${fallbackSteps})`);
});

// ---- (b) the fallback is deterministic and part-preserving — carryTraits
//     the pure function, directly (its own contract, independent of the
//     read path wiring proved above)

test('N-R74 (carryTraits, direct) fallback: when the exact combo does not exist at the new power, the nearest match is deterministic, stays in the live power family, and preserves the MAXIMUM number of recorded parts', () => {
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    for (const el of ['fire', 'water', 'air']) {
      const id = `fallback-${i}`;
      const recorded = deriveTraits(id, el, 0);
      if (COMBO_SET.has(exactKeyAt(recorded, el, 1))) continue; // fallback cases only
      checked += 1;
      const token = elementToken(el);
      const livePower = powerForTier(token, 1);
      const traits = carryTraits(recorded, id, el, 1);
      // deterministic: same inputs, same output, every time
      assert.equal(traits.comboKey, carryTraits(recorded, id, el, 1).comboKey,
        `${el} ${id}: fallback must be deterministic`);
      assert.ok(COMBO_SET.has(traits.comboKey), `${el} ${id}: fallback resolves to a real eligible combo`);
      assert.equal(parseComboKey(traits.comboKey).power, livePower, `${el} ${id}: fallback stays in the live power family`);
      // part-preserving: no combo in the live family preserves MORE parts
      const got = preservedParts(recorded, traits);
      const max = Math.max(...RIG_COMBOS
        .map(parseComboKey)
        .filter((c) => c && c.element === token && c.power === livePower)
        .map((c) => preservedParts(recorded, c)));
      assert.equal(got, max, `${el} ${id}: fallback preserves ${got} parts but ${max} was achievable`);
    }
  }
  assert.ok(checked > 100, `fixture sanity: enough fallback cases exercised (got ${checked})`);
});

test('N-R74 fallback ties: broken by the existing summon hash over the lexicographically sorted tied candidates — a pure function of (recorded, id, tier)', () => {
  // char-alpha fire: FIRE-1-head04-cape04-hat16-wand05 has no exact T1 match;
  // recompute the metric independently and check carryTraits lands on it.
  const recorded = deriveTraits('char-alpha', 'fire', 0);
  assert.ok(!COMBO_SET.has(exactKeyAt(recorded, 'fire', 1)), 'fixture: char-alpha fire must be a fallback case at T1');
  const livePower = powerForTier('FIRE', 1);
  const family = RIG_COMBOS.map((key) => ({ key, ...parseComboKey(key) }))
    .filter((c) => c.element === 'FIRE' && c.power === livePower);
  const best = Math.max(...family.map((c) => preservedParts(recorded, c)));
  const tied = family.filter((c) => preservedParts(recorded, c) === best)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const expected = tied[fnv1a('traits:char-alpha') % tied.length];
  const carried = carryTraits(recorded, 'char-alpha', 'fire', 1);
  assert.equal(carried.comboKey, expected.key, 'the stated metric IS the implemented metric');
  assert.equal(preservedParts(recorded, carried), best, `the char-alpha fallback preserves ${best} of 4 parts`);
  // and: this is exactly what the read path renders too (F3 wiring).
  assert.equal(wizardIdentity({ id: 'char-alpha', element: 'fire', tier: 1 }).comboKey, expected.key,
    'wizardIdentity renders the same deterministic fallback carryTraits computes directly');
});

// ---- palette: derives to the same value at every tier (id-keyed, tier-independent)

test('N-R74: the palette derivation is tier-independent — exact carry and fallback alike, at every tier (CB-BUILD-022/R74: wizardIdentity re-derives it fresh from characterId every call; it agrees with the `palette` passed in here only because that value IS derivePalette(id))', () => {
  for (const [id, el] of [['char-alpha', 'air'], ['char-alpha', 'fire']]) {
    const traits = deriveTraits(id, el, 0);
    const palette = derivePalette(id);
    for (let tier = 0; tier <= 6; tier++) {
      assert.deepEqual(wizardIdentity({ id, element: el, tier, traits, palette }).palette, palette,
        `${el} tier ${tier}: palette derivation is stable across tiers`);
    }
  }
});

// ---- (c) player/NPC symmetry: ONE rule at every tier, and that rule carries

test('N-R74/CB-BUILD-022/F3 symmetry: player and NPC identities resolve by ONE rule at every tier — the wizard\'s own tier-0 combo carried into the live power family, never a fresh re-roll and never the argument object\'s recorded traits', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(11) });
  game.ensureAccount(1000);
  const payload = game.summonCharacter({ element: 'fire' }, 1001);
  const player = game.snapshot().characters[payload.characterId];
  let t = 2000;
  const lobby = game.joinLobby(payload.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  game.lockBracketFromLobby(lobby, t);
  const npcs = Object.values(game.snapshot().characters).filter((c) => c.kind === 'npc');
  assert.ok(npcs.length >= 7, 'a locked bracket seats NPCs');
  for (let tier = 0; tier <= 6; tier++) {
    // the player: read-time derivation carrying its OWN tier-0 combo,
    // regardless of what was recorded on the character object
    const pi = wizardIdentity({ ...player, tier });
    const expectedPlayer = deriveIdentity(player.id, player.element, tier).comboKey;
    assert.equal(pi.comboKey, expectedPlayer,
      `tier ${tier}: player identity carries its own tier-0 combo into the live tier, exactly what deriveIdentity computes`);
    assert.equal(pi.traits.power, powerForTier(elementToken(player.element), tier),
      `tier ${tier}: player sits in the live power family (A-power symmetry preserved)`);
    // every NPC: THE SAME rule
    for (const npc of npcs) {
      const ni = wizardIdentity({ ...npc, tier });
      const expectedNpc = deriveIdentity(npc.id, npc.element, tier).comboKey;
      assert.equal(ni.comboKey, expectedNpc,
        `tier ${tier}: NPC identity is the SAME carry-forward rule, not its recorded traits`);
    }
  }
  // at the seat tier, an NPC's recorded traits happen to equal the live
  // derivation (both are deriveTraits(id, element, seatTier)) — but that's
  // coincidence, not a read; a stale/wrong `traits` at the SAME tier would
  // still render the derivation (see identity-read-time.test.js).
  for (const npc of npcs) {
    assert.equal(wizardIdentity(npc).comboKey, npc.traits.comboKey,
      'an NPC at its seat tier renders exactly its recorded combo (coincidence of matching derivation, not a read)');
  }
});

// ---- ledger: read-path only

test('N-R74/CB-BUILD-022: the read path never rewrites (or reads back) history — the CHARACTER_SUMMONED record still carries the tier-0 derivation after climbed reads', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(3) });
  game.ensureAccount(1000);
  const payload = game.summonCharacter({ element: 'water' }, 1001);
  const c = game.snapshot().characters[payload.characterId];
  wizardIdentity({ ...c, tier: 3 }); // a climbed read
  assert.deepEqual(game.snapshot().characters[payload.characterId].traits, deriveTraits(c.id, 'water', 0),
    'the recorded traits are untouched by the read path');
});

// ---- (d) distinctness unaffected

test('N-R74 distinctness: two same-element wizards with recorded traits still differ at climbed tiers (100 pairs, tiers 1 and 3 — no pair collides on BOTH combo and palette)', () => {
  for (const tier of [1, 3]) {
    let identical = 0;
    for (let i = 0; i < 100; i++) {
      const a = wizardIdentity({ id: `carry-a-${i}`, element: 'fire', tier, traits: deriveTraits(`carry-a-${i}`, 'fire', 0), palette: derivePalette(`carry-a-${i}`) });
      const b = wizardIdentity({ id: `carry-b-${i}`, element: 'fire', tier, traits: deriveTraits(`carry-b-${i}`, 'fire', 0), palette: derivePalette(`carry-b-${i}`) });
      if (a.comboKey === b.comboKey && JSON.stringify(a.palette) === JSON.stringify(b.palette)) identical += 1;
    }
    assert.equal(identical, 0, `tier ${tier}: ${identical}/100 same-element pairs collided on BOTH traits and palette`);
  }
});

// ---- tier 0 untouched (parity checks B/D derive at tier 0)

test('N-R74: tier-0 behaviour is byte-identical to the recorded derivation — the carry only engages when the power family moves', () => {
  for (const el of ['fire', 'water', 'air']) {
    const recorded = deriveTraits('t0-check', el, 0);
    assert.deepEqual(carryTraits(recorded, 't0-check', el, 0), recorded, `${el}: carry at the recorded tier is the record, verbatim`);
    assert.deepEqual(wizardIdentity({ id: 't0-check', element: el, tier: 0, traits: recorded, palette: null }).traits, recorded);
  }
});
