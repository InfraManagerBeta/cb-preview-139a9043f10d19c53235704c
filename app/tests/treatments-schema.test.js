// app/tests/treatments-schema.test.js — t3 C: app/data/treatments/adjacent.json
// (Scrapyard Kings) + far.json (Undercard) complete per t1's schema, every
// field, all copy strings present, name pools >=12, seed rosters (7 named,
// canonical, R82 tendency structure), R13 mapping recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const incumbent = await loadTreatment('incumbent');
const adjacent = await loadTreatment('adjacent');
const far = await loadTreatment('far');

const SCHEMA_FIELDS = ['workingTitle', 'logoMark', 'nouns', 'elements', 'colors', 'fonts', 'namePool', 'seedRoster', 'copy', 'narrator'];
const NOUN_FIELDS = ['character', 'characterPlural', 'stakeUnit', 'stakeUnitAbbrev', 'headlinePrize', 'floor'];
const COLOR_ROLES = ['primary', 'ground', 'win', 'loss', 'surfaces', 'narratorAccent', 'water', 'fire', 'air'];

for (const [id, treatment] of [['adjacent', adjacent], ['far', far]]) {
  test(`${id}.json: carries every field of t1's schema (same as incumbent)`, () => {
    for (const field of SCHEMA_FIELDS) assert.ok(field in treatment, `${id} missing ${field}`);
  });

  test(`${id}.json: every R12 role noun present and non-empty`, () => {
    for (const noun of NOUN_FIELDS) assert.ok(treatment.nouns[noun], `${id} missing nouns.${noun}`);
  });

  test(`${id}.json: every fixed color role present (values differ from incumbent per R12/R13)`, () => {
    for (const role of COLOR_ROLES) {
      assert.ok(treatment.colors[role], `${id} missing colors.${role}`);
      assert.notEqual(treatment.colors[role], incumbent.colors[role], `${id}.colors.${role} matches the incumbent's value`);
    }
  });

  test(`${id}.json: fonts.display/data/prose are fixed (R11); only heroFace is theme-bound (R12) and differs`, () => {
    assert.equal(treatment.fonts.display, incumbent.fonts.display);
    assert.equal(treatment.fonts.data, incumbent.fonts.data);
    assert.equal(treatment.fonts.prose, incumbent.fonts.prose);
    assert.notEqual(treatment.fonts.heroFace, incumbent.fonts.heroFace);
  });

  test(`${id}.json: name pool has >=12 entries, all non-empty strings, no duplicates`, () => {
    assert.ok(treatment.namePool.length >= 12, `${id} namePool has only ${treatment.namePool.length}`);
    assert.equal(new Set(treatment.namePool).size, treatment.namePool.length, `${id} namePool has duplicates`);
    for (const n of treatment.namePool) assert.ok(typeof n === 'string' && n.length > 0);
  });

  test(`${id}.json: seed roster has exactly 7 canonical entries (R82), each with element + F/W/A tendency summing to 1`, () => {
    const canonical = treatment.seedRoster.filter((r) => r.canonical);
    assert.equal(canonical.length, 7, `${id} has ${canonical.length} canonical seed roster entries`);
    for (const r of canonical) {
      assert.ok(['fire', 'water', 'air'].includes(r.element));
      const sum = r.tendency.fire + r.tendency.water + r.tendency.air;
      assert.ok(Math.abs(sum - 1) < 1e-9, `${id} seed roster ${r.name} tendency sums to ${sum}`);
    }
  });

  test(`${id}.json: seed roster names are all present in the name pool's first seven entries (R82: "the first seven entries are also the R82 seed roster's canonical NPC names")`, () => {
    const canonicalNames = treatment.seedRoster.filter((r) => r.canonical).map((r) => r.name);
    assert.deepEqual(treatment.namePool.slice(0, 7), canonicalNames);
  });

  test(`${id}.json: element labels are Fire/Water/Air (mechanics fixed, R11); iconMotif present per element (R12, icon flavor only)`, () => {
    for (const el of ['fire', 'water', 'air']) {
      assert.ok(treatment.elements[el].label);
      assert.ok(treatment.elements[el].iconMotif, `${id}.elements.${el} missing iconMotif`);
    }
    assert.equal(treatment.elements.air.beats, 'water');
  });

  test(`${id}.json: narrator persona/register/examples present and differ from the incumbent's`, () => {
    assert.ok(treatment.narrator.personaLine);
    assert.ok(treatment.narrator.registerLine);
    assert.ok(Array.isArray(treatment.narrator.examples) && treatment.narrator.examples.length >= 2);
    assert.notEqual(treatment.narrator.personaLine, incumbent.narrator.personaLine);
    assert.notEqual(treatment.narrator.registerLine, incumbent.narrator.registerLine);
  });

  test(`${id}.json: copy carries the exact same key set as incumbent.json (every ~35+ string reproduced or intentionally shared)`, () => {
    const incKeys = Object.keys(incumbent.copy).filter((k) => !k.startsWith('_')).sort();
    const keys = Object.keys(treatment.copy).filter((k) => !k.startsWith('_')).sort();
    assert.deepEqual(keys, incKeys);
  });

  test(`${id}.json: the R73 static bypass lines are present, re-voiced (differ from incumbent), and carry the [ELEMENT]/[EEEEE] placeholders`, () => {
    assert.ok(treatment.copy.narratorBypassA.includes('[ELEMENT]'));
    assert.ok(treatment.copy.narratorBypassB.includes('[EEEEE]'));
    assert.notEqual(treatment.copy.narratorBypassA, incumbent.copy.narratorBypassA);
    assert.notEqual(treatment.copy.narratorBypassB, incumbent.copy.narratorBypassB);
  });

  test(`${id}.json: R8a truth line preserves meaning (mentions play money is free and the reservation notification list)`, () => {
    const t = treatment.copy.truthLine.toLowerCase();
    assert.ok(t.includes('free'));
    assert.ok(t.includes('notification list'));
  });
}

test('mapping.json records the R13 mapping for every role noun and the R87 conflict resolution', async () => {
  const mapping = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', 'mapping.json'), 'utf8'));
  for (const noun of NOUN_FIELDS) {
    assert.ok(mapping.roleNouns[noun], `mapping.json missing roleNouns.${noun}`);
    assert.ok('incumbent' in mapping.roleNouns[noun] && 'adjacent' in mapping.roleNouns[noun] && 'far' in mapping.roleNouns[noun]);
  }
  assert.ok(mapping.conflicts['CONFLICT-R71-R12']);
  assert.equal(mapping.conflicts['CONFLICT-R71-R12'].status, 'resolved (implemented)');
});

test('the concept-card-selected treatments match docs/selection-rubric.md\'s top picks (Scrapyard Kings adjacent, Undercard far)', () => {
  assert.equal(adjacent.workingTitle, 'Scrapyard Kings');
  assert.equal(far.workingTitle, 'Undercard');
});

// R60-vs-R61/C21: cashOutBody must not overclaim "the only way to retire" --
// that's true only for a character that still holds a stake; an emptied
// (0C) character retires to the ledger (R61), a different, free action.
test('R60-vs-R61: cashOutBody scopes its "only way to retire" claim to a character that still holds a stake, in all three treatments', () => {
  for (const [name, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    const body = treatment.copy.cashOutBody.toLowerCase();
    assert.ok(body.includes('only way to retire'), `${name}: missing the "only way to retire" claim`);
    assert.ok(body.includes('still holds a stake') || body.includes('that still holds'), `${name}: claim isn't scoped to a stake-holding character`);
    assert.ok(body.includes('retires to the ledger') || body.includes('retire to the ledger'), `${name}: doesn't name the R61 emptied-character path`);
  }
});

test('f4/N2: all three treatments carry a theme-voiced emptiedChampionLine (shown when a topped-out T6 champion reaches the emptied card), distinct per treatment', () => {
  const seen = new Set();
  for (const [name, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    const line = treatment.copy.emptiedChampionLine;
    assert.ok(line && line.length > 0, `${name}: missing copy.emptiedChampionLine`);
    assert.notEqual(line, treatment.copy.emptiedCardLine, `${name}: emptiedChampionLine must differ from the generic emptiedCardLine`);
    seen.add(line);
  }
  assert.equal(seen.size, 3, 'expected a genuinely different (theme-voiced) line per treatment, not one line copy-pasted three times');
});

// ---- f4/N6: the incumbent's money unit ("C") must never leak into an --
// alternate treatment's own rendered copy. Narrow: matches a digit-glued
// "C" token in a money-shaped context ("(0C)", "20C", "(100C)") without
// tripping on unrelated letters/words or hex colors (which live in the
// `colors` section anyway, not `copy`, and never take the exact
// digit-immediately-followed-by-C-then-word-boundary shape this checks).
const INCUMBENT_UNIT_LEAK_RE = /\(\s*\d+\s*C\s*\)|\b\d+C\b/;

test('f4/N6: adjacent.json/far.json\'s copy strings carry zero leaked incumbent-unit ("C") token in a money context -- each uses its OWN unit abbreviation', () => {
  for (const [name, treatment, ownAbbrev] of [['adjacent', adjacent, 'S'], ['far', far, 'P']]) {
    for (const [key, value] of Object.entries(treatment.copy)) {
      if (typeof value !== 'string') continue;
      const match = value.match(INCUMBENT_UNIT_LEAK_RE);
      assert.equal(match, null, `${name}.copy.${key} leaked the incumbent's "C" unit token: "${match && match[0]}" in "${value}"`);
    }
    // And the emptied-card line specifically must carry the TREATMENT'S
    // OWN unit token in its money-context parenthetical (the exact bug
    // site: cashOutBody's "an emptied (0C) ... retires to the ledger").
    assert.match(treatment.copy.cashOutBody, new RegExp(`\\(\\s*0\\s*${ownAbbrev === 'S' ? 'SCRAP' : 'PURSE'}\\s*\\)`), `${name}: expected cashOutBody's emptied-character parenthetical to name its OWN unit`);
  }
});

test('f4/N6: the incumbent itself is UNAFFECTED (still names its own "(0C)" in cashOutBody) -- the fix is scoped to the two alternates, not a global regex strip', () => {
  assert.match(incumbent.copy.cashOutBody, /\(\s*0C\s*\)/);
});

test('f4/N6: the leak-scan regex itself does not false-positive on a hex color or an unrelated word (sanity: the scanner is narrow)', () => {
  const benign = ['#0C1B2A is not a money figure', 'Grade C material', 'ACCESS DENIED', 'a 2050 Cheddar wave'];
  for (const s of benign) {
    assert.equal(INCUMBENT_UNIT_LEAK_RE.test(s), false, `expected no false positive on: "${s}"`);
  }
  // and it DOES catch the real bug shape
  assert.equal(INCUMBENT_UNIT_LEAK_RE.test('an emptied (0C) Bot retires to the ledger'), true);
});
