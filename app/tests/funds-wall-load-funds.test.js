// app/tests/funds-wall-load-funds.test.js — CB-BUILD-012/R67: Load Funds is
// reachable from every point a player can meet a funds wall; the CASH
// balance is itself a control that opens it; a blocked action (summon,
// re-entry) opens Load Funds inline, returning to the blocked action on
// deposit. Static source scan (no DOM available in this harness) plus a
// real end-to-end engine check that the retry pattern actually works and
// that R49's bust-to-top-up metric becomes observable once it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { bustToTopUp } from '../engine/retention.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');
function freshGame(seed = 1) {
  const ledger = new Ledger(createMemoryStorage());
  return new Game({ ledger, tunables, treatment, playerId: 'p1', seed });
}

// ---- defect reproduction: the old dead-end shape --------------------------

test('CB-BUILD-012/R67 (defect repro): summon.js no longer just toasts e.message on insufficient CASH', async () => {
  const src = await read('ui/screens/summon.js');
  assert.ok(!/catch \(e\) \{\s*ctx\.toast\(e\.message\);\s*\}/.test(src.replace(/\s+/g, ' ')), 'expected the old bare toast(e.message) catch to be gone');
});

test('CB-BUILD-012/R67 (defect repro): the CASH pill (chrome.js) is no longer a non-interactive <span>', async () => {
  const src = await read('ui/components/chrome.js');
  assert.ok(!/el\('span', \{ class: 'cb-cash-pill/.test(src), 'expected the CASH pill to no longer be built as a bare span');
});

// ---- the fix: Load Funds reachable from the funds wall, with retry -------

test('CB-BUILD-012/R67: chrome.js exports a cashPill(ctx) that is a real button opening Load Funds', async () => {
  const src = await read('ui/components/chrome.js');
  assert.ok(/export function cashPill\(ctx\)/.test(src));
  const body = src.slice(src.indexOf('export function cashPill'), src.indexOf('export function topBar'));
  assert.ok(/el\('button'/.test(body), 'expected cashPill to render a <button>');
  assert.ok(/openLoadFundsSheet\(ctx\)/.test(body), 'expected cashPill\'s onClick to open Load Funds');
  assert.ok(/import \{ openLoadFundsSheet \} from '\.\/money-sheets\.js'/.test(src));
});

test('CB-BUILD-012/R67: summon.js routes insufficient CASH to openLoadFundsSheet with an onDeposited retry of the SAME summon', async () => {
  const src = await read('ui/screens/summon.js');
  assert.ok(/import \{ openLoadFundsSheet \} from '\.\.\/components\/money-sheets\.js'/.test(src));
  assert.ok(/insufficient CASH/.test(src), 'expected summon.js to detect the insufficient-CASH error specifically');
  // C4/R67: the sheet now also receives a `shortfall` option (the funds-
  // wall shortfall copy) alongside the retry -- the onDeposited retry
  // itself is unchanged, just no longer the sole option in the object.
  assert.ok(/openLoadFundsSheet\(ctx, \{ onDeposited: \(\) => attemptSummon\(chosenElement\), shortfall: /.test(src), 'expected the retry to re-attempt the exact same summon');
});

test('CB-BUILD-012/R67: summon.js\'s topbar renders cashPill(ctx), not an inert span', async () => {
  const src = await read('ui/screens/summon.js');
  assert.ok(/import \{ truthBadge, cashPill \} from '\.\.\/components\/chrome\.js'/.test(src));
  assert.ok(/cashPill\(ctx\)/.test(src));
});

test('CB-BUILD-012/R67: sitting.js routes insufficient CASH at re-entry to openLoadFundsSheet with a retry, same as summon', async () => {
  const src = await read('ui/screens/sitting.js');
  const codeOnly = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(/import \{ openLoadFundsSheet \} from '\.\.\/components\/money-sheets\.js'/.test(src));
  assert.ok(!/Not enough CASH — load funds first/.test(codeOnly), 'expected the old toast copy to be gone from live code');
  const attemptStart = src.indexOf('function attemptReenter');
  const attemptBody = src.slice(attemptStart, src.indexOf('mountScreen([', attemptStart));
  // C4/R67: same shape change as summon.js above -- a `shortfall` option
  // rides alongside the onDeposited retry.
  assert.ok(/openLoadFundsSheet\(ctx, \{ onDeposited: attemptReenter, shortfall: /.test(attemptBody), 'expected re-entry to retry itself on deposit');
});

// ---- end to end: the retry pattern actually works at the engine level ----

test('CB-BUILD-012/R67: summonCharacter throws insufficient CASH, then succeeds after loadFunds -- the exact retry sequence the UI now performs', () => {
  const game = freshGame();
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  // Spend the signup grant down to (near) zero so the next summon is blocked.
  const snap0 = game.snapshot();
  assert.ok(snap0.account.cashUSD > 0, 'precondition: a signup grant exists');
  // Drain CASH below the entry price via a direct ledger debit isn't part of
  // the public API -- instead, summon repeatedly until CASH can't cover the
  // door price (the real path a player takes).
  let blocked = null;
  for (let i = 0; i < 20; i++) {
    try {
      game.summonCharacter({ element: 'fire' }, 1000 + i);
    } catch (e) {
      blocked = e;
      break;
    }
  }
  assert.ok(blocked, 'expected summonCharacter to eventually throw insufficient CASH');
  assert.match(blocked.message, /insufficient CASH/);

  // The exact retry the UI now performs: loadFunds, then re-attempt the
  // SAME summon call.
  game.loadFunds({ amountUSD: 1000, presetOrCustom: 'custom', intentId: 'topup-1', sessionNumber: 1 }, 5000);
  const summoned = game.summonCharacter({ element: 'fire' }, 5001);
  assert.ok(summoned.characterId, 'expected the retried summon to succeed once funded');
});

test('CB-BUILD-012/R49: bust-to-top-up becomes an observable metric once a busted player can reach Load Funds and deposit', () => {
  const game = freshGame();
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  // Simulate the character busting to zero stake (a real DUEL_RESOLVED
  // event shape, stakeAfter: 0 -- R49's own bust condition).
  game.ledger.append({
    key: 'test-bust',
    type: EVENT_TYPES.DUEL_RESOLVED,
    playerId: 'p1',
    ts: 10_000,
    payload: { characterId: summon.characterId, stakeAfter: 0 },
  });
  // Before any deposit, bust-to-top-up can't report a completed interval.
  const before = bustToTopUp(game.ledger.all(), 'p1');
  assert.equal(before.length, 1);
  assert.equal(before[0].seconds, null, 'no deposit yet -- the interval is not yet observable');

  // The player hits the funds wall (summon or re-entry), reaches Load
  // Funds (CB-BUILD-012's fix), and deposits.
  game.loadFunds({ amountUSD: 50, presetOrCustom: 'custom', intentId: 'bust-topup-1', sessionNumber: 1 }, 15_000);

  const after = bustToTopUp(game.ledger.all(), 'p1');
  assert.equal(after[0].depositTs, 15_000);
  assert.equal(after[0].seconds, 5, 'expected bust-to-top-up to measure the 5s from bust to deposit');
});
