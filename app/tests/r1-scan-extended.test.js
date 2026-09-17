// app/tests/r1-scan-extended.test.js — R1 scan extended over the two new
// treatment files and the operator console: the strings "Cheeze Wizards" /
// "Cheese Wizards" / standalone "CW" in zero participant-facing surfaces.
// The console is operator-facing, not participant-facing, but the brief
// asks to "keep it clean anyway," so it is scanned too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const FORBIDDEN = [/cheeze wizards/i, /cheese wizards/i, /\bcw\b/i];
// Legitimate, non-renderable, non-theme-bound path/filename tokens that
// happen to contain "cw" as a standalone word (§18's own naming): the
// bundle's directory name (renamed assets/cw-asset-bundle -> assets/cw per
// CB-BUILD-000, content byte-identical) and its nine canonical GIF
// filenames. Src/href attribute values are explicitly permitted by the
// brief ("GIF file paths as src attributes are fine; alt text must be
// theme-neutral"). Both the pre-rename and post-rename bundle path
// spellings are stripped so this stays correct regardless of which the
// checked-out tree carries.
const CW_ASSET_FILENAME_RE = /CW_[A-Za-z ]+\.gif/g;
const CW_ASSET_BUNDLE_PATH_RE = /cw-asset-bundle|assets\/cw\//gi;

function scan(text) {
  const cleaned = text.replace(CW_ASSET_FILENAME_RE, '').replace(CW_ASSET_BUNDLE_PATH_RE, '');
  return FORBIDDEN.filter((re) => re.test(cleaned));
}

async function collectFiles(dir, exts = ['.js', '.html', '.css', '.json', '.txt', '.md']) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectFiles(p, exts));
    else if (exts.includes(path.extname(entry.name))) out.push(p);
  }
  return out;
}

test('R1 scan: adjacent.json / far.json / mapping.json carry zero renderable field with a forbidden string (developer-only "_"-prefixed keys excluded, same convention as invariant #9 -- those keys document R1 itself and the R87 conflict resolution, and are never read by the UI)', async () => {
  for (const filename of ['adjacent.json', 'far.json', 'mapping.json']) {
    const raw = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', filename), 'utf8'));
    (function walk(obj, keyPath = '') {
      if (obj == null) return;
      if (typeof obj === 'string') {
        for (const re of FORBIDDEN) assert.equal(re.test(obj), false, `${filename} ${keyPath} matched ${re}`);
        return;
      }
      if (Array.isArray(obj)) { obj.forEach((v, i) => walk(v, `${keyPath}[${i}]`)); return; }
      if (typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (k.startsWith('_')) continue;
          walk(v, `${keyPath}.${k}`);
        }
      }
    })(raw);
  }
});

test('R1 scan: the operator console (app/console.html + app/ui/console/*, app/styles/console.css) is clean', async () => {
  const files = [path.join(APP_ROOT, 'console.html'), ...await collectFiles(path.join(APP_ROOT, 'ui', 'console')), path.join(APP_ROOT, 'styles', 'console.css')];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const hits = scan(text);
    assert.deepEqual(hits, [], `${file} matched: ${hits}`);
  }
});

test('R1 scan: the battle-presentation UI modules (app/ui/components/battle/*, app/styles/battle.css) are clean', async () => {
  const files = [...await collectFiles(path.join(APP_ROOT, 'ui', 'components', 'battle')), path.join(APP_ROOT, 'styles', 'battle.css')];
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const hits = scan(text);
    assert.deepEqual(hits, [], `${file} matched: ${hits}`);
  }
});

test('R1 scan: the root redirect page (index.html) is clean', async () => {
  const text = await fs.readFile(path.join(APP_ROOT, '..', 'index.html'), 'utf8');
  const hits = scan(text);
  assert.deepEqual(hits, [], `root index.html matched: ${hits}`);
});
