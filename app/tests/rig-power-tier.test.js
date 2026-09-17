// app/tests/rig-power-tier.test.js — A-power (fix round F2, R74/§18):
// the rig's power tier is a LIVE read of the character's current tier,
// ONE rule for player and NPC alike. Before this fix, the player's
// wizardIdentity() honoured the traits recorded at summon (tier 0 → power
// 1) forever, while an NPC seated at tier N carried power families derived
// from the live tier (game.js's NPC_SEATED path) — a systematic visual
// asymmetry: from T1 up the player's wizard was always drawn from the
// power-1 shape family while every opponent climbed. The ledger history is
// untouched (the summon event still records the traits the character had
// at summon — honest history); only the READ path (wizardIdentity) tracks
// the current tier, exactly as it always did for a character with no
// recorded traits.
//
// N-R74 (fix round F3b) refined WHAT tracks the tier: the power family is
// live, but the wizard's own recorded cosmetic combo is CARRIED into that
// family (wizardRig.carryTraits), never re-rolled — the dedicated coverage
// lives in rig-cosmetic-carry.test.js; the one-rule symmetry is re-stated
// here in its new form.
//
// CB-BUILD-022/R74/§18 update: the master rule still holds — the read path
// (wizardIdentity) never looks at `character.traits`/`character.palette` at
// all, recorded or not; the `traits`/`palette` fields on the argument object
// are always ignored. The A-power symmetry this file is named for (live
// tier, one rule for player and NPC) is UNCHANGED and still the point of
// every test below.
//
// Fix round F3 correction: the read path does NOT simply re-derive
// head/cape/hat/wand fresh at the live tier — that re-roll silently broke
// N-R74/F3b (a wizard's cosmetic combo must carry across tiers; see
// rig-cosmetic-carry.test.js and identity-read-time.test.js). The power
// family is still a live read (unchanged), but the combo within that family
// is the wizard's OWN tier-0 combo carried forward via `carryTraits` — a
// pure function of (characterId, elementKey, tier), never of the argument
// object's `traits`/`palette` fields. The one test below that had encoded
// the disproven "always re-derive fresh at the live tier, ignore the
// wizard's own combo" behaviour was corrected in place, with a comment
// marking the change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTraits, carryTraits, wizardIdentity, powerForTier, elementToken, parseComboKey } from '../engine/wizardRig.js';
import { RIG_COMBOS } from '../data/rigManifest.js';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function summonedCharacter(elementKey) {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(11) });
  game.ensureAccount(1000);
  const payload = game.summonCharacter({ element: elementKey }, 1001);
  return game.snapshot().characters[payload.characterId];
}

test('A-power: at tier N the player and an NPC derive from the SAME power family rule (live tier, not summon-frozen)', () => {
  for (const elementKey of ['fire', 'water', 'air']) {
    const c = summonedCharacter(elementKey);
    assert.ok(c.traits && c.traits.comboKey, 'summon recorded traits (history untouched)');
    for (let tier = 0; tier <= 6; tier++) {
      const livePower = powerForTier(elementToken(elementKey), tier);
      // the player: recorded traits + a climbed tier
      const player = wizardIdentity({ ...c, tier });
      assert.equal(player.traits.power, livePower,
        `${elementKey} player at tier ${tier}: identity power ${player.traits.power} must be the live power family ${livePower}`);
      // the NPC rule (game.js NPC_SEATED): deriveTraits at the live tier
      const npc = deriveTraits(`npc-any-${tier}`, elementKey, tier);
      assert.equal(npc.power, livePower, 'NPC rule is the same live power family');
      // and the identity still resolves to a real, complete library set
      assert.ok(RIG_COMBOS.includes(player.comboKey), 'live-tier identity resolves to a real shape set');
      assert.equal(parseComboKey(player.comboKey).power, livePower, 'the resolved combo sits in the live power family');
    }
  }
});

test('A-power: at the summon tier, the read-time derivation coincides with what summon recorded (no gratuitous divergence at tier 0)', () => {
  const c = summonedCharacter('fire');
  const identity = wizardIdentity(c); // snapshot tier is the summon tier (0)
  // CB-BUILD-022/R74/§18: wizardIdentity() no longer READS c.traits at all —
  // it derives fresh from (c.id, c.element, c.tier). This equality holds
  // because the summon write ALSO used deriveTraits(id, element, 0); it is
  // not a "recorded traits honoured" behaviour, it's the same pure function
  // computed twice on the same inputs. See identity-read-time.test.js for
  // the case that tells the two apart (recorded fields absent/stale).
  assert.deepEqual(identity.traits, c.traits, 'at tier 0, summon-time derivation and read-time derivation agree (same inputs)');
});

test('A-power: the ledger summon payload still records the traits of the tier AT summon (history semantics unchanged)', () => {
  const c = summonedCharacter('water');
  assert.deepEqual(c.traits, deriveTraits(c.id, 'water', 0),
    'CHARACTER_SUMMONED still carries the deterministic tier-0 derivation — the fix is read-path only');
});

test('A-power: the palette is tier-independent and derives to the same value at every tier (identity keeps its colours as it climbs)', () => {
  const c = summonedCharacter('air');
  for (let tier = 0; tier <= 6; tier++) {
    // CB-BUILD-022/R74/§18: derivePalette(id) doesn't take a tier argument,
    // so this was always going to be constant across tiers; wizardIdentity
    // now derives it fresh every call rather than reading c.palette, and it
    // still agrees with c.palette because both are derivePalette(c.id).
    assert.deepEqual(wizardIdentity({ ...c, tier }).palette, c.palette,
      `tier ${tier}: the wizard's palette derivation is tier-independent`);
  }
});

test('CB-BUILD-022/R74/§18 + F3: read-time identity ignores the ARGUMENT OBJECT\'S traits/palette entirely — recorded, absent, or recorded-at-a-different-tier all resolve to the SAME derivation, which carries the wizard\'s OWN tier-0 combo into the live power family (never a fresh re-roll, never a read of the argument\'s traits/palette)', () => {
  for (let tier = 0; tier <= 6; tier++) {
    const recordedAtSummon = deriveTraits('consistency-x', 'fire', 0);
    const withRecorded = wizardIdentity({ id: 'consistency-x', element: 'fire', tier, traits: recordedAtSummon, palette: null });
    const derivedFresh = wizardIdentity({ id: 'consistency-x', element: 'fire', tier, traits: null, palette: null });
    const recordedAtLiveTier = deriveTraits('consistency-x', 'fire', tier);
    const withRecordedAtLiveTier = wizardIdentity({ id: 'consistency-x', element: 'fire', tier, traits: recordedAtLiveTier, palette: null });
    // F3: the expected combo is the wizard's OWN tier-0 combo carried into
    // the live tier's power family (N-R74/F3b), NOT a fresh re-roll at the
    // live tier — those two are usually different combos (that divergence
    // was the F3 regression: 900/900 T0-vs-T1 differing).
    const expected = carryTraits(deriveTraits('consistency-x', 'fire', 0), 'consistency-x', 'fire', tier).comboKey;
    // ONE rule, no exceptions: whatever the ARGUMENT OBJECT's `traits` holds
    // — a tier-0 record, null, or a record already at the live tier — the
    // rendered comboKey is always this same carried derivation; the
    // argument's `traits`/`palette` fields are never consulted.
    assert.equal(withRecorded.comboKey, expected, `tier ${tier}: the argument's recorded combo is never read — the carried derivation wins`);
    assert.equal(derivedFresh.comboKey, expected, `tier ${tier}: absent traits still carry the wizard's own tier-0 combo forward`);
    assert.equal(withRecordedAtLiveTier.comboKey, expected, `tier ${tier}: a same-tier "recorded" argument still just re-derives+carries (harmless coincidence, not a read)`);
    // both paths land in the SAME live power family (the A-power symmetry)
    const livePower = powerForTier(elementToken('fire'), tier);
    assert.equal(parseComboKey(withRecorded.comboKey).power, livePower, `tier ${tier}: sits in the live power family`);
    assert.equal(parseComboKey(derivedFresh.comboKey).power, livePower, `tier ${tier}: sits in the live power family`);
  }
});
