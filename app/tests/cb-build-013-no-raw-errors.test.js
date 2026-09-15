// app/tests/cb-build-013-no-raw-errors.test.js — CB-BUILD-013/§12/R83: no
// raw or developer error text reaches a participant surface. Sweeps EVERY
// catch under app/ui for a surfaced e.message/err.message, and unit-tests
// the one mapping function this patch adds (summon.js's
// playerFacingSummonError).
//
// Reproduces the symptom first: the delivered summon.js's catch block did
// `ctx.toast(e.message)` -- so a real thrown Error like "summonCharacter:
// insufficient CASH" (function name and all) was displayed verbatim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playerFacingSummonError } from '../ui/screens/summon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function collectJsFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectJsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('CB-BUILD-013 symptom, reproduced: the delivered summon.js toasted the raw thrown error string verbatim', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  assert.equal(/ctx\.toast\(e\.message\)/.test(src), false, 'expected the raw e.message toast to be gone');
});

test('CB-BUILD-013 app-wide sweep: zero file under app/ui DISPLAYS e.message/err.message on a participant surface (toast/text), anywhere', async () => {
  const files = await collectJsFiles(path.join(APP_ROOT, 'ui'));
  const offenders = [];
  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    // Strip line comments before scanning, so a comment that MENTIONS
    // "e.message" (documenting the rule, as several patch commits do)
    // doesn't itself trip the sweep -- only live code counts. A regex
    // CLASSIFICATION check (`/pattern/.test(e.message)`, used to detect
    // which error was thrown -- e.g. the insufficient-CASH branch) is not
    // a display and is explicitly allowed; only e.message reaching a
    // toast/text/template-literal participant surface is swept for.
    const noLineComments = src.split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .filter((line) => !/\.test\(\s*(e|err)\.message\s*\)/.test(line))
      .join('\n');
    // Also strip /* ... */ block comments (JSDoc included) -- a comment
    // that documents the rule by naming "e.message" must not itself trip
    // the sweep.
    const codeOnly = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\be\.message\b|\berr\.message\b/.test(codeOnly)) offenders.push(path.relative(APP_ROOT, file));
  }
  assert.deepEqual(offenders, [], `expected zero app/ui files to display e.message/err.message on a participant surface, found: ${offenders.join(', ')}`);
});

test('CB-BUILD-013/§12/R83: summon.js maps every non-insufficient-CASH failure to player-language copy via playerFacingSummonError', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  assert.ok(src.includes('ctx.toast(playerFacingSummonError(e))'), 'expected the fallback catch branch to route through the mapping function');
});

test('playerFacingSummonError: never echoes the raw error message, for a generic error', () => {
  const raw = new Error('resolvePveDuel: unknown character');
  const mapped = playerFacingSummonError(raw);
  assert.notEqual(mapped, raw.message);
  assert.equal(/resolvePveDuel|unknown character/.test(mapped), false, 'expected zero leakage of the raw developer string');
  assert.ok(mapped.length > 0);
});

test('playerFacingSummonError: a KillSwitchFrozenError gets a specific, still player-language line (not its raw AC0/frozen-ledger message)', () => {
  class KillSwitchFrozenError extends Error {
    constructor(action) { super(`Game#${action}: kill switch is active -- frozen, no ledger append (AC0).`); this.name = 'KillSwitchFrozenError'; }
  }
  const e = new KillSwitchFrozenError('summonCharacter');
  const mapped = playerFacingSummonError(e);
  assert.notEqual(mapped, e.message);
  assert.equal(/AC0|frozen|ledger append/i.test(mapped), false, 'expected zero leakage of the raw kill-switch developer string');
});

test('CB-BUILD-013: the insufficient-CASH case still routes to Load Funds with NO error text at all (patch 012\'s branch returns before ever reaching the mapping function)', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  const catchBody = src.slice(src.indexOf('} catch (e) {'), src.indexOf('function retrySummon'));
  const insufficientCashBranch = catchBody.slice(0, catchBody.indexOf('return;') + 'return;'.length);
  assert.equal(/toast/.test(insufficientCashBranch), false, 'expected zero toast/error text in the insufficient-CASH branch');
  assert.ok(insufficientCashBranch.includes('openLoadFundsSheet'));
});
