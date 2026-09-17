// app/tests/no-raw-error-text.test.js — CB-BUILD-013/§12/R83: no raw or
// developer error text reaches a participant surface; every blocked or
// failed action is explained in player language; the insufficient-CASH
// case routes to Load Funds with NO error text at all. Sweep of every
// catch that surfaces `e.message` (or a raw stack) to a participant
// surface. Static source scan (no DOM available in this harness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

async function collectJsFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectJsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// ---- defect reproduction ---------------------------------------------------

test('CB-BUILD-013/R83 (defect repro): summon.js no longer toasts the raw e.message for a non-insufficient-CASH error', async () => {
  const src = await read('ui/screens/summon.js');
  assert.ok(!/ctx\.toast\(e\.message\)/.test(src), 'expected no toast(e.message) left in summon.js');
});

test('CB-BUILD-013/R83 (defect repro): app.js\'s boot-failure handler no longer dumps err.stack into the participant #app div', async () => {
  const src = await read('ui/app.js');
  const codeOnly = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/err\.stack/.test(codeOnly), 'expected no err.stack interpolation left in app.js\'s live code');
});

// ---- the fix: a full sweep, over every participant-facing UI file --------

test('CB-BUILD-013/R83: NO participant-facing UI file (ui/ minus ui/console/, the operator-only surface) ever passes a caught error\'s .message/.stack into toast()/innerHTML/textContent -- referencing .message to CLASSIFY an error (e.g. `/insufficient CASH/.test(e.message)`) is fine; DISPLAYING it is not', async () => {
  const uiRoot = path.join(APP_ROOT, 'ui');
  const allFiles = await collectJsFiles(uiRoot);
  const participantFiles = allFiles.filter((f) => !f.includes(`${path.sep}console${path.sep}`));
  const offenders = [];
  const displayPatterns = [
    /\.toast\([^)]*\b(?:e|err|error)\.(?:message|stack)\b/,
    /innerHTML\s*=[^;]*\b(?:e|err|error)\.(?:message|stack)\b/,
    /textContent\s*=[^;]*\b(?:e|err|error)\.(?:message|stack)\b/,
  ];
  for (const file of participantFiles) {
    const src = await fs.readFile(file, 'utf8');
    const codeOnly = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    if (displayPatterns.some((re) => re.test(codeOnly))) offenders.push(path.relative(APP_ROOT, file));
  }
  assert.deepEqual(offenders, [], `expected zero participant-facing files to DISPLAY a caught error's .message/.stack: ${JSON.stringify(offenders)}`);
});

test('CB-BUILD-013/R83: the operator console\'s own boot-failure raw dump is UNTOUCHED (it is explicitly operator-facing, not a participant surface, per app/README.md)', async () => {
  const src = await read('ui/console/main.js');
  assert.ok(/err\.stack/.test(src), 'expected the console\'s own diagnostic dump to be left as-is -- it is not a participant surface');
});

test('CB-BUILD-013/R67: the insufficient-CASH case in summon.js shows NO error text at all -- it routes straight to Load Funds', async () => {
  const src = await read('ui/screens/summon.js');
  const attemptBody = src.slice(src.indexOf('function attemptSummon'), src.indexOf('function renderReveal'));
  // A3 (fix round): classification moved from a `/insufficient CASH/.test
  // (e.message)` regex to the engine's stable `e.code === 'INSUFFICIENT_CASH'`.
  const insufficientBranch = attemptBody.slice(attemptBody.indexOf("if (e.code === 'INSUFFICIENT_CASH')"), attemptBody.indexOf('} else {'));
  assert.ok(insufficientBranch.length > 0, 'expected to find the insufficient-CASH branch by its new code-based condition');
  assert.ok(!/ctx\.toast/.test(insufficientBranch), 'expected the insufficient-CASH branch to show no toast/error text at all');
  assert.ok(/openLoadFundsSheet/.test(insufficientBranch));
});

test('CB-BUILD-013/R83: summon.js\'s fallback for any OTHER error is mapped player copy, not a raw string', async () => {
  const src = await read('ui/screens/summon.js');
  const attemptBody = src.slice(src.indexOf('function attemptSummon'), src.indexOf('function renderReveal'));
  const elseBranch = attemptBody.slice(attemptBody.indexOf('} else {'));
  assert.ok(/ctx\.toast\('[^']+'\)/.test(elseBranch), 'expected a literal player-copy string, not an interpolated error');
});

test('CB-BUILD-013/R83: app.js\'s boot failure renders player-safe copy (no exception text) while still logging to console.error for developers', async () => {
  const src = await read('ui/app.js');
  const catchBody = src.slice(src.indexOf('main().catch'));
  assert.ok(/console\.error\(err\)/.test(catchBody), 'expected the real error to still be logged for developers');
  assert.ok(/Something went wrong/.test(catchBody), 'expected player-safe copy');
  assert.ok(!/\$\{.*err/.test(catchBody), 'expected no template-literal interpolation of the error object into participant-facing markup');
});
