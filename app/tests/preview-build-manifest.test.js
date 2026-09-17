// app/tests/preview-build-manifest.test.js — CB-BUILD-019: Tests reachable from the preview
// Asserts that the preview build script includes EVERY app/tests/*.test.js file
// and every helper/fixture they reference, so a reviewer can run the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'tools', 'preview', 'build-preview.mjs');
const TEST_OUTPUT_DIR = path.join(REPO_ROOT, 'dist-preview-test');

test('CB-BUILD-019: build-preview.mjs script exists and is executable', async () => {
  const stat = await fs.stat(BUILD_SCRIPT);
  assert.ok(stat.isFile(), 'build-preview.mjs should exist');
});

test('CB-BUILD-019: preview build script produces dist-preview with all test files', async () => {
  // Clean up test output
  try {
    await fs.rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
  } catch {}
  
  // Run the build script
  try {
    execSync(`node ${BUILD_SCRIPT} ${TEST_OUTPUT_DIR}`, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Build script failed: ${err.message}`);
  }
  
  // Verify the output directory exists
  const stat = await fs.stat(TEST_OUTPUT_DIR);
  assert.ok(stat.isDirectory(), 'dist-preview should be created');
  
  // Verify key directories exist
  const requiredDirs = ['app', 'docs', 'tests'];
  for (const dir of requiredDirs) {
    const dirPath = path.join(TEST_OUTPUT_DIR, dir);
    const stat = await fs.stat(dirPath);
    assert.ok(stat.isDirectory(), `${dir}/ should exist in preview`);
  }
  
  // Verify app/tests/ exists in output
  const appTestsPath = path.join(TEST_OUTPUT_DIR, 'app', 'tests');
  const stat2 = await fs.stat(appTestsPath);
  assert.ok(stat2.isDirectory(), 'app/tests/ should exist in preview');
});

test('CB-BUILD-019: preview includes EVERY app/tests/*.test.js file in the source', async () => {
  // Discover all test files in source
  const sourceTestDir = path.join(REPO_ROOT, 'app', 'tests');
  const sourceTestFiles = new Set();
  
  async function findTests(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await findTests(p);
      } else if (entry.name.endsWith('.test.js')) {
        const relPath = path.relative(sourceTestDir, p);
        sourceTestFiles.add(relPath);
      }
    }
  }
  
  await findTests(sourceTestDir);
  
  // Verify each test file exists in the preview
  const previewTestDir = path.join(TEST_OUTPUT_DIR, 'app', 'tests');
  for (const testFile of sourceTestFiles) {
    const previewPath = path.join(previewTestDir, testFile);
    const stat = await fs.stat(previewPath).catch(() => null);
    assert.ok(stat && stat.isFile(), `Test file app/tests/${testFile} should be in preview`);
  }
  
  assert.ok(sourceTestFiles.size > 0, 'Expected to find at least one test file');
  console.log(`    ✓ Found ${sourceTestFiles.size} test files in preview`);
});

test('CB-BUILD-019: preview includes all test helpers', async () => {
  const helpersDir = path.join(TEST_OUTPUT_DIR, 'app', 'tests', 'helpers');
  const stat = await fs.stat(helpersDir).catch(() => null);
  assert.ok(stat && stat.isDirectory(), 'app/tests/helpers/ should exist in preview');
  
  const entries = await fs.readdir(helpersDir);
  assert.ok(entries.length > 0, 'helpers directory should contain files');
  console.log(`    ✓ Found ${entries.length} helper files`);
});

test('CB-BUILD-019: preview includes fixture files referenced by tests', async () => {
  const fixturesDir = path.join(TEST_OUTPUT_DIR, 'app', 'tests', 'fixtures');
  const stat = await fs.stat(fixturesDir).catch(() => null);
  
  // Some tests may use fixtures, verify they're accessible if they exist
  if (stat && stat.isDirectory()) {
    const entries = await fs.readdir(fixturesDir);
    console.log(`    ✓ Found ${entries.length} fixture files`);
  } else {
    console.log('    ℹ No fixtures directory (some tests may not use fixtures)');
  }
});

test('CB-BUILD-019: tests/index.html manifest exists and documents the test recipe', async () => {
  const manifestPath = path.join(TEST_OUTPUT_DIR, 'tests', 'index.html');
  const content = await fs.readFile(manifestPath, 'utf8');
  
  assert.ok(content.includes('node --test'), 'Manifest should document the test command');
  assert.ok(content.includes('app/tests'), 'Manifest should reference test files');
  assert.ok(content.includes('Important'), 'Manifest should note tests do not run in browser');
});

test('CB-BUILD-019: preview root contains index.html', async () => {
  const indexPath = path.join(TEST_OUTPUT_DIR, 'index.html');
  const stat = await fs.stat(indexPath).catch(() => null);
  assert.ok(stat && stat.isFile(), 'index.html should be in preview root');
});

// Clean up after tests
test.after(async () => {
  try {
    await fs.rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
  } catch {}
});

// ---- fix round f2 (CB-BUILD-019 findings A + B) ---------------------------
// Finding A: the published preview could not run its own suite — the build
// never copied tools/, so preview-build-manifest.test.js (ENOENT on
// tools/preview/build-preview.mjs) and both parity test files (reading
// tools/parity/**) failed inside the published tree (630/618/12 vs the repo
// root's 654/654/0 at the same commit). Finding B: a naive quote-pairing
// regex in the asset discovery was blinded by the ODD number of apostrophes
// in ceremony.js's header comment, so assets/cw/lottie was never published
// and the R74a summon ceremony was dead in the preview.
//
// These tests fail at the SOURCE level — no one has to hand-run the preview
// tree to catch the next path that silently falls out of the copied set.
import {
  stripJsComments as previewStripJsComments,
  assetRefsFromSource,
  discoverRuntimeAssetPaths,
  discoverSuiteRepoPaths,
  buildPreview,
  verifyPreviewTree,
} from '../../tools/preview/build-preview.mjs';

const SKIP_NAMES = (name) =>
  name === 'node_modules' || name === '.git' || name.startsWith('dist-preview') || name.startsWith('.');

async function walkRel(root, base = root, out = []) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_NAMES(entry.name)) await walkRel(p, base, out);
    } else {
      out.push(path.relative(base, p));
    }
  }
  return out;
}

test('CB-BUILD-019/f2 (finding A): the preview mirrors EVERY file under tools/ (minus node_modules) — the suite reads tools/preview/** and tools/parity/**', async () => {
  const repoToolsFiles = await walkRel(path.join(REPO_ROOT, 'tools'));
  assert.ok(repoToolsFiles.length > 0, 'expected the repo to carry a tools/ tree');
  const missing = [];
  for (const rel of repoToolsFiles) {
    const stat = await fs.stat(path.join(TEST_OUTPUT_DIR, 'tools', rel)).catch(() => null);
    if (!stat || !stat.isFile()) missing.push(`tools/${rel}`);
  }
  assert.deepEqual(missing, [], `expected every tools/ file in the preview (a reviewer who clones nothing must be able to run the suite): missing ${JSON.stringify(missing)}`);
});

test('CB-BUILD-019/f2 (finding A, source-level): every repo path the test suite actually reads exists in the built preview — a new test reading an uncopied path fails HERE, without hand-running the preview', async () => {
  const suitePaths = await discoverSuiteRepoPaths(REPO_ROOT);
  assert.ok(suitePaths.has('tools/preview/build-preview.mjs'), 'derivation sanity: this very test reads the build script');
  assert.ok([...suitePaths].some((p) => p.startsWith('tools/parity')), 'derivation sanity: the parity tests read tools/parity/**');
  const missing = [];
  for (const rel of suitePaths) {
    const inRepo = await fs.stat(path.join(REPO_ROOT, rel)).catch(() => null);
    if (!inRepo) continue; // referenced but not present in the repo either (e.g. a tmp path a test creates and removes)
    const inPreview = await fs.stat(path.join(TEST_OUTPUT_DIR, rel)).catch(() => null);
    if (!inPreview) missing.push(rel);
  }
  assert.deepEqual(missing, [], `expected every suite-read repo path in the preview: missing ${JSON.stringify(missing)}`);
});

test('CB-BUILD-019/f2 (finding B, source-level): every asset path referenced by shipped app/ runtime code exists in the built preview', async () => {
  const runtimeRefs = await discoverRuntimeAssetPaths(REPO_ROOT);
  assert.ok(runtimeRefs.has('assets/cw/lottie'), 'derivation sanity: ceremony.js references ../assets/cw/lottie — if discovery goes blind to it again, THIS fails');
  const missing = [];
  for (const rel of runtimeRefs) {
    const inRepo = await fs.stat(path.join(REPO_ROOT, rel)).catch(() => null);
    if (!inRepo) continue;
    const inPreview = await fs.stat(path.join(TEST_OUTPUT_DIR, rel)).catch(() => null);
    if (!inPreview) missing.push(rel);
  }
  assert.deepEqual(missing, [], `expected every runtime-referenced asset path in the preview: missing ${JSON.stringify(missing)}`);
});

test('CB-BUILD-019/f2 (finding B): the R74a summon ceremony layer sources are published — assets/cw/lottie with every layer file ceremony.js can plan', async () => {
  const lottieDir = path.join(TEST_OUTPUT_DIR, 'assets', 'cw', 'lottie');
  const stat = await fs.stat(lottieDir).catch(() => null);
  assert.ok(stat && stat.isDirectory(), 'assets/cw/lottie/ must exist in the preview — without it every layer fetch 404s, sequenceDegraded flips true, and the ceremony skips the whole 2019 sequence (R74a [LAW])');
  // The full layer plan from ceremony.js's summonSequenceLayers(): the three
  // element flags, both prep takes (no WIND prep in the bundle), and the
  // neutral fallback flag.
  const layerFiles = [
    'summon-bg.json', 'summon.json', 'summon-in-progress.json', 'sparkles.json',
    'body.json', 'hands.json', 'hat.json',
    'fireFlag.json', 'waterFlag.json', 'windFlag.json', 'neutralFlag.json',
    'firePrep.json', 'waterPrep.json',
  ];
  const missing = [];
  for (const f of layerFiles) {
    const st = await fs.stat(path.join(lottieDir, f)).catch(() => null);
    if (!st || !st.isFile()) missing.push(f);
  }
  assert.deepEqual(missing, [], `expected every summon layer source in the preview: missing ${JSON.stringify(missing)}`);
});

test('CB-BUILD-019/f2 (finding B, unit): asset discovery is comment- and string-aware — a comment between two quotes cannot swallow the literal that follows', () => {
  // The exact hazard, mirroring ceremony.js's structure: a quoted import
  // specifier, then a comment mentioning "assets" (and carrying apostrophes
  // — ceremony.js's header holds 23, an odd count), then the real literal.
  // The old regex /['"`]([^'"`]*assets[^'"`]*)['"`]/g pairs the import's
  // closing quote with the literal's OPENING quote (the run between them
  // contains "assets" via the comment), swallowing '../assets/cw/lottie'.
  const synthetic = [
    "import { el } from '../dom.js';",
    '// Paths relative to the HTML document — same convention as',
    '// battle/assets.js and rigAssets.js',
    "const LOTTIE_BASE = '../assets/cw/lottie';",
    "const SOUND = `../assets/cw/sound/${name}`;",
  ].join('\n');
  const refs = assetRefsFromSource(synthetic);
  assert.ok(refs.has('assets/cw/lottie'), 'expected the discovery to find assets/cw/lottie past the comment');
  assert.ok(refs.has('assets/cw/sound'), 'expected the template-literal reference to normalize to its directory');

  // And the OLD regex demonstrably could not (the defect this fix removes):
  const oldPattern = /['"`]([^'"`]*assets[^'"`]*)['"`]/g;
  const oldHits = [...synthetic.matchAll(oldPattern)]
    .map((m) => m[1].replace(/^(\.\.\/)+/, ''))
    .filter((p) => p.startsWith('assets/'));
  assert.ok(!oldHits.some((p) => p.startsWith('assets/cw/lottie')), `the naive quote-pairing regex must miss the lottie literal here (the bug) — got ${JSON.stringify(oldHits)}`);
});

test('CB-BUILD-019/f2 (finding B, unit): the discovery finds assets/cw/lottie in the REAL shipped ceremony.js source', async () => {
  const src = await fs.readFile(path.join(REPO_ROOT, 'app', 'ui', 'components', 'summon', 'ceremony.js'), 'utf8');
  // The comment stripper must remove the header comment's apostrophes so no
  // quote-pairing can start inside a comment (data-face-scan.js's approach).
  const stripped = previewStripJsComments(src);
  assert.ok(!stripped.includes("bundle's"), 'expected the header comment (and its odd apostrophes) to be stripped before string scanning');
  const refs = assetRefsFromSource(src);
  assert.ok(refs.has('assets/cw/lottie'), `expected assets/cw/lottie among ceremony.js refs, got: ${JSON.stringify([...refs])}`);
  assert.ok(refs.has('assets/rig'), 'expected the rig fallback base too');
});

test('CB-BUILD-019/f2 (finding B): the build FAILS LOUDLY when a referenced asset directory is missing from the built tree', async (t) => {
  // A synthetic mini-repo: runtime code references two asset dirs; after a
  // successful build, one is removed from the OUTPUT — verification must
  // name it. (This exercises the exact check buildPreview() throws on.)
  const tmpRoot = path.join(REPO_ROOT, 'dist-preview-test-minirepo');
  const tmpOut = path.join(REPO_ROOT, 'dist-preview-test-miniout');
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(tmpOut, { recursive: true, force: true });
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(tmpOut, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(tmpRoot, 'app'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'docs'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'tools'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'assets', 'cw', 'lottie'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'index.html'), '<!doctype html>');
  await fs.writeFile(path.join(tmpRoot, 'docs', 'readme.md'), 'mini');
  await fs.writeFile(path.join(tmpRoot, 'assets', 'cw', 'lottie', 'summon.json'), '{}');
  await fs.writeFile(
    path.join(tmpRoot, 'app', 'main.js'),
    "// the bundle's odd-apostrophe hazard, reproduced\nconst BASE = '../assets/cw/lottie';\nexport default BASE;\n"
  );

  await buildPreview(tmpOut, tmpRoot);
  const ok = await verifyPreviewTree(tmpOut, tmpRoot);
  assert.deepEqual(ok.missing, [], 'a faithful build verifies clean');

  // Now silently drop the published asset dir — the verification must shout.
  await fs.rm(path.join(tmpOut, 'assets', 'cw', 'lottie'), { recursive: true, force: true });
  const broken = await verifyPreviewTree(tmpOut, tmpRoot);
  assert.deepEqual(broken.missing, ['assets/cw/lottie'], 'verification must name the missing referenced asset directory');
});
