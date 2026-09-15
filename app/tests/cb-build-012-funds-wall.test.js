// app/tests/cb-build-012-funds-wall.test.js — CB-BUILD-012/R67: a funds
// wall is never a dead end. The CASH balance (`.cb-cash-pill`) is a
// control that opens Load Funds; an insufficient-CASH summon opens Load
// Funds inline and retries on deposit; the same pattern applies to
// re-entry (sitting.js). This is also the fix that makes bust-to-top-up
// (R49) observable end to end -- a funds wall with no deposit path
// corrupts that signal.
//
// Reproduces the symptom first: the delivered build showed an error and
// offered no way to add funds on an insufficient-CASH summon; the CASH
// pill in chrome.js was a non-interactive <span>; sitting.js's re-entry
// wall toasted "Not enough CASH — load funds first." with no actual route
// to Load Funds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import * as retention from '../engine/retention.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGame(playerId = 'p-cb012') {
  return new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId });
}

test('CB-BUILD-012 symptom, reproduced: the delivered summon.js toasted a raw error on insufficient CASH, with no Load Funds route', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  assert.equal(/ctx\.toast\(e\.message\);\s*\n\s*}\s*\n\s*},\s*\n\s*}, summonButtonLabel/.test(src), false);
});

test('CB-BUILD-012 symptom, reproduced: the delivered chrome.js CASH pill was a non-interactive <span>', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/components/chrome.js'), 'utf8');
  assert.equal(/el\('span', \{ class: 'cb-cash-pill cb-data' \}/.test(src), false, 'expected the cb-cash-pill span to be gone from chrome.js');
});

test('CB-BUILD-012/R67: chrome.js\'s topBar renders the CASH pill as a real button that opens Load Funds', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/components/chrome.js'), 'utf8');
  assert.ok(src.includes("import { openLoadFundsSheet } from './money-sheets.js'"), 'expected chrome.js to import openLoadFundsSheet');
  const topBarBody = src.slice(src.indexOf('export function topBar'));
  assert.ok(/el\('button', \{[\s\S]*class: 'cb-cash-pill cb-data'/.test(topBarBody), 'expected cb-cash-pill to be a <button>');
  assert.ok(/onClick: \(\) => openLoadFundsSheet\(ctx\)/.test(topBarBody), 'expected the CASH pill button to open Load Funds');
});

test('CB-BUILD-012/R67: summon.js routes an insufficient-CASH summon to openLoadFundsSheet(ctx, { onDeposited: retrySummon }) instead of toasting', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  assert.ok(src.includes("import { openLoadFundsSheet } from '../components/money-sheets.js'"), 'expected summon.js to import openLoadFundsSheet');
  assert.ok(src.includes('openLoadFundsSheet(ctx, { onDeposited: retrySummon })'), 'expected the exact retry-wired Load Funds call named in the patch');
  assert.ok(src.includes('function retrySummon()'), 'expected a retrySummon function that re-attempts the summon');
  // summon.js now uses the shared topBar(ctx) helper, so the CASH pill on
  // THIS screen is the same clickable control chrome.js now renders.
  assert.ok(src.includes('topBar(ctx)'), 'expected summon.js to render the shared topBar (cash pill is now a button everywhere it appears)');
});

test('CB-BUILD-012/R67: sitting.js applies the same inline-Load-Funds-and-return pattern to re-entry', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/sitting.js'), 'utf8');
  assert.equal(/Not enough CASH/.test(src), false, 'expected the dead-end re-entry toast to be gone');
  assert.ok(src.includes("import { openLoadFundsSheet } from '../components/money-sheets.js'"), 'expected sitting.js to import openLoadFundsSheet');
  assert.ok(/openLoadFundsSheet\(ctx, \{ onDeposited: attemptReenter \}\)/.test(src), 'expected re-entry\'s funds wall to open Load Funds and retry the SAME action on deposit');
});

test('CB-BUILD-012 end to end (engine): an insufficient-CASH summon, a deposit, then a successful retry -- the exact sequence attemptSummon/retrySummon perform', () => {
  const game = freshGame();
  game.ensureAccount(1000); // $25 signup grant (R41)
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);

  // Two $10 summons leave exactly $5 -- reproduces the patch log's own
  // symptom figures ("Summoning with CASH $5 and a $10 cost").
  game.summonCharacter({ element: 'fire' }, 1001);
  game.summonCharacter({ element: 'water' }, 1002);
  assert.equal(game.snapshot().account.cashUSD, 5);

  // The blocked action: attemptSummon's real call, which throws.
  assert.throws(() => game.summonCharacter({ element: 'air' }, 1003), /insufficient CASH/);

  // openLoadFundsSheet's deposit call (the sheet's own Continue button).
  game.loadFunds({ amountUSD: 20, presetOrCustom: 'preset', intentId: 'cb012-deposit', sessionNumber: 1 }, 1004);
  assert.equal(game.snapshot().account.cashUSD, 25);

  // retrySummon: the SAME call, now succeeds.
  const summoned = game.summonCharacter({ element: 'air' }, 1005);
  assert.ok(summoned.characterId);
  assert.equal(game.snapshot().account.cashUSD, 15);
});

test('CB-BUILD-012 end to end (R49): bust-to-top-up is observable through the real flow -- a character busts (stake hits zero via a PvE duel, the real shape Game#resolvePveDuel appends), the player deposits, and retention.bustToTopUp reads it straight off the ledger', () => {
  const game = freshGame('p-cb012-bust');
  game.ensureAccount(1000);
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);

  // Simulate the bust: this character's stake hits zero on a resolved PvE
  // duel -- PVE_DUEL_RESOLVED's real payload shape (game.js's own
  // resolvePveDuel append, above) carries a flat `stakeAfter`, which is
  // exactly what retention.bustToTopUp reads.
  const bustTs = 5000;
  game.ledger.append({
    key: 'test-bust-cb012', type: EVENT_TYPES.PVE_DUEL_RESOLVED, playerId: 'p-cb012-bust', ts: bustTs,
    payload: { characterId: summoned.characterId, sessionId: 's1', duelSeq: 0, staked: true, hesitated: false, stakeBefore: 40, stakeAfter: 0, rakeTaken: 0 },
  });

  // Before any deposit: bustToTopUp records the bust with no resolved
  // deposit yet.
  const before = retention.bustToTopUp(game.ledger.all(), 'p-cb012-bust');
  assert.equal(before.length, 1);
  assert.equal(before[0].depositTs, null);

  // The player deposits via the funds-wall retry path (Load Funds sheet).
  const depositTs = 65000;
  game.loadFunds({ amountUSD: 25, presetOrCustom: 'preset', intentId: 'cb012-bust-deposit', sessionNumber: 1 }, depositTs);

  const after = retention.bustToTopUp(game.ledger.all(), 'p-cb012-bust');
  assert.equal(after.length, 1);
  assert.equal(after[0].depositTs, depositTs);
  assert.equal(after[0].seconds, 60, 'expected the bust-to-top-up seconds to be observable end to end from the real ledger');
});

// ---- CB-BUILD-fix-round-1 #4: a SWEEP, not an enumeration -------------------
// The review found sitting.js still rendering `el('span', { class:
// 'cb-cash-pill cb-data' })` — a dead span — while only summon.js used
// chrome.js's button pill. R67: the CASH balance is itself a control. This
// sweep walks EVERY participant-facing UI source (screens + components,
// recursively) and fails on any `.cb-cash-pill` rendered as anything but a
// <button>, so the next screen to grow a dead pill fails here by
// construction instead of needing its own named assertion.
test('CB-BUILD-fix-round-1 #4: no participant screen or component renders a non-interactive .cb-cash-pill (sweep)', async () => {
  const roots = [path.join(APP_ROOT, 'ui/screens'), path.join(APP_ROOT, 'ui/components')];
  const files = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.name.endsWith('.js')) files.push(p);
    }
  }
  for (const root of roots) await walk(root);
  assert.ok(files.length >= 15, `sweep sanity: expected to walk the whole UI tree, found only ${files.length} files`);

  const offenders = [];
  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    // Any el('<tag>', ...) carrying cb-cash-pill where <tag> is not button.
    const re = /el\(\s*'([a-z0-9]+)'\s*,\s*\{[^}]*cb-cash-pill/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[1] !== 'button') offenders.push(`${path.relative(APP_ROOT, file)}: <${m[1]}> carries cb-cash-pill`);
    }
  }
  assert.deepEqual(offenders, [], `R67: the CASH pill is a control — found non-button cb-cash-pill renders:\n${offenders.join('\n')}`);
});

test('CB-BUILD-fix-round-1 #4: sitting.js routes through chrome.js\'s shared topBar (the button pill that opens Load Funds)', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/sitting.js'), 'utf8');
  assert.ok(/import \{[^}]*\btopBar\b[^}]*\} from '..\/components\/chrome.js'/.test(src), 'expected sitting.js to import topBar from chrome.js');
  assert.ok(/topBar\(ctx\)/.test(src), 'expected sitting.js to render the shared topBar(ctx)');
  assert.equal(/el\('span', \{ class: 'cb-cash-pill/.test(src), false, 'expected the dead cash-pill span to be gone from sitting.js');
});

test('CB-BUILD-fix-round-1 #4: the landing screen\'s door-price badge is not dressed as the CASH pill (it shows a price, not the balance)', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/landing.js'), 'utf8');
  assert.equal(src.includes('cb-cash-pill'), false, 'landing.js must not reuse the cash-pill class for the door-price badge');
  assert.ok(src.includes('cb-price-pill'), 'expected the door-price badge to carry its own cb-price-pill class');
  const css = await fs.readFile(path.join(APP_ROOT, 'styles/base.css'), 'utf8');
  assert.ok(/\.cb-price-pill/.test(css), 'expected .cb-price-pill to be styled in base.css');
});
