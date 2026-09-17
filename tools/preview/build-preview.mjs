#!/usr/bin/env node
/**
 * tools/preview/build-preview.mjs — CB-BUILD-019: Tests reachable from the preview
 *
 * A dependency-free Node script (Node 22, no npm install) that assembles a
 * publishable static preview tree into dist-preview/ (path overridable by
 * argument) containing:
 * - the repo-root index.html
 * - the whole app/ tree (source AND app/tests/** including helpers/fixtures)
 * - the whole tools/ tree minus node_modules (fix round f2: the suite READS
 *   tools/preview/** and tools/parity/** — parity-harness.test.js,
 *   parity-preregistration.test.js, preview-build-manifest.test.js and
 *   spec-hygiene.test.js all fail without it, so "a reviewer who clones
 *   nothing can run the suite" was false before this copy existed)
 * - every asset path the shipped app/ code and the test suite actually read
 *   (discovered with a comment/string-aware scanner — see below), plus the
 *   spec's essential subsets
 * - docs/
 *
 * Output is a static, reviewer-browsable tree with a manifest that lists
 * every test file and shows the recipe to run the suite.
 *
 * ---- fix round f2 (CB-BUILD-019, findings A and B) --------------------
 * The original asset discovery paired quotes with a naive regex
 * (/['"`]([^'"`]*assets[^'"`]*)['"`]/g). ceremony.js's header comment
 * carries an ODD number of apostrophes ("bundle's", "R74a's", ...), so a
 * "string" opened mid-comment swallowed the '../assets/cw/lottie' literal
 * that followed and the whole summon-ceremony asset directory silently
 * fell out of the published tree (R74a [LAW] broken in the preview). This
 * is exactly the hazard app/tests/helpers/data-face-scan.js:120-124
 * documents; the discovery below follows that scanner's approach — a real
 * tokenizer that skips // and /* comments and understands ' " ` string
 * bodies (template `${...}` holes collapsed to a placeholder) — instead
 * of a bounded regex.
 *
 * The build also FAILS LOUDLY (exit 1) if any discovered repo path that
 * exists in the repository is missing from the built tree: a build that
 * silently publishes a broken app is the real defect.
 *
 * Exports (used by app/tests/preview-build-manifest.test.js so the same
 * derivation is asserted at the SOURCE level on every suite run — a new
 * test reading a repo path outside the copied set fails the suite without
 * anyone hand-running the preview tree):
 *   stripJsComments, extractStringLiterals, assetRefsFromSource,
 *   discoverRuntimeAssetPaths, discoverSuiteRepoPaths, collectSuiteModules
 * The build itself only runs when this file is the entry script (main
 * guard below), so importing these helpers never triggers a build.
 *
 * For testability the repo root can be overridden with the
 * CB_PREVIEW_REPO_ROOT environment variable (used by the manifest test to
 * prove the loud-failure path on a synthetic mini-repo).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Directories never copied and never demanded by verification.
const SKIP_DIR_NAMES = (name) =>
  name === 'node_modules' || name === '.git' || name.startsWith('dist-preview') || name.startsWith('.');

// ---- Comment/string-aware source scanning (data-face-scan.js's approach) --

/** Strips // and /* *\/ comments, preserving string/template bodies. */
export function stripJsComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let inString = null;
  while (i < n) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i += 2; continue; }
      if (c === inString) inString = null;
      i++; continue;
    }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { inString = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/**
 * Every string-literal body in `src`: '...' and "..." verbatim, template
 * literals with each `${...}` hole collapsed to a `\x00` placeholder.
 * Comments are skipped (an apostrophe inside a COMMENT — "doesn't",
 * "R74a's" — must never be mistaken for the start of a string literal:
 * that exact mistake is what dropped assets/cw/lottie from the preview).
 * Regex literals in obvious expression positions are skipped too, so a
 * pattern like /'([^']*)'/ in a test file cannot desynchronise the scan.
 */
export function extractStringLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let prevCode = ''; // last non-whitespace code char seen (for regex-position detection)
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '/' && '([{,=:;!&|?+-*%~^<>'.includes(prevCode)) {
      // Regex literal: scan to the unescaped closing '/', honouring [...] classes.
      i++;
      let inClass = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        else if (src[i] === '\n') break; // not a regex after all; bail
        i++;
      }
      i++; prevCode = '/';
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let val = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { val += src[j + 1] || ''; j += 2; continue; }
        if (src[j] === '\n') break; // unterminated; bail
        val += src[j]; j++;
      }
      out.push(val);
      i = j + 1; prevCode = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let val = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { val += src[j + 1] || ''; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          val += '\x00';
          j += 2;
          let depth = 1;
          while (j < n && depth > 0) {
            if (src[j] === '\\') { j += 2; continue; }
            if (src[j] === "'" || src[j] === '"') { const q = src[j]; j++; while (j < n && src[j] !== q) { if (src[j] === '\\') j++; j++; } j++; continue; }
            if (src[j] === '{') depth++;
            if (src[j] === '}') depth--;
            j++;
          }
          continue;
        }
        val += src[j]; j++;
      }
      out.push(val);
      i = j + 1; prevCode = '`';
      continue;
    }
    if (!/\s/.test(c)) prevCode = c;
    i++;
  }
  return out;
}

/** Normalizes one raw in-literal asset reference to a repo-relative
 * `assets/...` path (or null if it is not one). */
function normalizeAssetRef(raw) {
  let p = raw.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
  if (!p.startsWith('assets/') && p !== 'assets') return null;
  p = p.split('\x00')[0]; // cut at a template hole
  p = p.replace(/\/+$/, ''); // trailing slash: a directory reference
  if (p === 'assets' || p === '') return null; // never demand the whole 244MB tree
  if (!/^assets\/[A-Za-z0-9_\-./ ]+$/.test(p)) return null;
  return p;
}

/**
 * Every `assets/...` repo path referenced by `src`:
 *  - string literals containing `assets/...` (with any `../` prefix), and
 *  - `path.join`/`path.resolve` argument runs anchored at a literal
 *    'assets' segment (e.g. `path.join(REPO, 'assets', 'rig', 'fallback')`).
 */
export function assetRefsFromSource(src) {
  const refs = new Set();
  for (const lit of extractStringLiterals(src)) {
    const re = /(?:(?:\.\.\/)+)?\bassets\/[A-Za-z0-9_\-./]*/g;
    let m;
    while ((m = re.exec(lit))) {
      const p = normalizeAssetRef(m[0]);
      if (p) refs.add(p);
    }
  }
  const stripped = stripJsComments(src);
  const callRe = /\b(?:path\s*\.\s*)?(?:join|resolve)\s*\(([^()]*)\)/g;
  let m;
  while ((m = callRe.exec(stripped))) {
    const segs = [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1] ?? x[2]);
    const at = segs.indexOf('assets');
    if (at !== -1) {
      const joined = path.posix.join(...segs.slice(at));
      const p = normalizeAssetRef(joined);
      if (p) refs.add(p);
    }
  }
  return refs;
}

// ---- File walking helpers -------------------------------------------------

async function walkFiles(dir, filter, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES(entry.name)) await walkFiles(p, filter, out);
    } else if (filter(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const isJsFile = (name) => name.endsWith('.js') || name.endsWith('.mjs');

// ---- Suite module graph (what the tests transitively import) --------------

function importSpecifiers(strippedSrc) {
  const specs = [];
  const re = /(?:\bimport\s*\(\s*|\bimport\s+(?:[\w${},*\s]+\s+from\s+)?|\bexport\s+(?:[\w${},*\s]+\s+)?from\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(strippedSrc))) specs.push(m[1]);
  return specs;
}

/**
 * Every module file the test suite can reach: seeds = all .js under
 * app/tests/, expanded through relative import/require/dynamic-import
 * specifiers (this is how tools/parity/*.mjs — preregistration, compare,
 * player-config, reference-recolor and their own imports — enter the set).
 */
export async function collectSuiteModules(repoRoot = REPO_ROOT) {
  const seeds = await walkFiles(path.join(repoRoot, 'app', 'tests'), isJsFile);
  const seen = new Set(seeds.map((p) => path.resolve(p)));
  const queue = [...seen];
  while (queue.length) {
    const file = queue.shift();
    let src;
    try {
      src = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const spec of importSpecifiers(stripJsComments(src))) {
      if (!spec.startsWith('.')) continue; // bare/node: specifiers: not repo files
      const resolved = path.resolve(path.dirname(file), spec);
      if (!resolved.startsWith(repoRoot + path.sep)) continue;
      if (seen.has(resolved)) continue;
      try {
        const st = await fs.stat(resolved);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      seen.add(resolved);
      queue.push(resolved);
    }
  }
  return seen;
}

// ---- Discovery: asset paths and repo paths the tree actually reads --------

/** Asset paths referenced by shipped RUNTIME app/ code (app/ minus app/tests). */
export async function discoverRuntimeAssetPaths(repoRoot = REPO_ROOT) {
  const refs = new Set();
  const files = await walkFiles(path.join(repoRoot, 'app'), isJsFile);
  for (const file of files) {
    if (file.includes(`${path.sep}app${path.sep}tests${path.sep}`)) continue;
    const src = await fs.readFile(file, 'utf8');
    for (const r of assetRefsFromSource(src)) refs.add(r);
  }
  return refs;
}

/**
 * Repo-relative paths the TEST SUITE reads (fix A's derivation — "derive
 * the set from what tests actually read, so the next new test cannot
 * silently fall out"): over every suite module (app/tests/** plus
 * transitive imports, e.g. tools/parity/*.mjs):
 *  - relative import targets (repo-relative),
 *  - `path.join(REPO_ROOT, 'tools', ...)` / `path.resolve(__dirname, '..',
 *    ...)` argument runs made of string literals, anchored at a repo-root
 *    identifier (REPO/REPO_ROOT/ROOT) or at __dirname,
 *  - `assets/...` references (same scanner the asset copy uses).
 * Paths under directories the build never publishes (node_modules,
 * dist-preview*, .git) are excluded.
 */
export async function discoverSuiteRepoPaths(repoRoot = REPO_ROOT) {
  const paths = new Set();
  const add = (repoRel) => {
    const norm = path.posix.normalize(repoRel).replace(/\/+$/, '');
    if (!norm || norm === '.' || norm.startsWith('..')) return;
    const parts = norm.split('/');
    if (parts.some((seg) => SKIP_DIR_NAMES(seg))) return;
    paths.add(norm);
  };
  for (const file of await collectSuiteModules(repoRoot)) {
    const src = await fs.readFile(file, 'utf8');
    const stripped = stripJsComments(src);
    const fileDirRel = path.relative(repoRoot, path.dirname(file)).split(path.sep).join('/');
    for (const spec of importSpecifiers(stripped)) {
      if (!spec.startsWith('.')) continue;
      add(path.posix.join(fileDirRel, spec));
    }
    const callRe = /\b(?:path\s*\.\s*)?(?:join|resolve)\s*\(\s*([A-Za-z_$][\w$]*)\s*,([^()]*)\)/g;
    let m;
    while ((m = callRe.exec(stripped))) {
      const base = m[1];
      const argText = m[2];
      // Every remaining argument must be a plain string literal — a variable
      // segment makes the path underivable and the run is skipped.
      const litRe = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
      const leftover = argText.replace(litRe, '').replace(/[\s,]/g, '');
      if (leftover.length > 0) continue;
      const segs = [...argText.matchAll(litRe)].map((x) => x[1] ?? x[2]);
      if (segs.length === 0) continue;
      if (/^(REPO|REPO_ROOT|ROOT)$/.test(base)) add(path.posix.join(...segs));
      else if (base === '__dirname') add(path.posix.join(fileDirRel, ...segs));
    }
    for (const r of assetRefsFromSource(src)) add(r);
  }
  return paths;
}

// ---- Helper: recursive copy (skips node_modules/dist-preview*/.git) -------
async function copyRecursive(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIR_NAMES(entry.name)) continue;
      await copyRecursive(path.join(src, entry.name), path.join(dest, entry.name));
    }
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---- Discover asset paths referenced in app/ (runtime AND tests) ----------
export async function discoverAssetPaths(repoRoot = REPO_ROOT) {
  const paths = new Set(await discoverRuntimeAssetPaths(repoRoot));

  // The suite's own asset reads (tests + the tools modules they import).
  for (const p of await discoverSuiteRepoPaths(repoRoot)) {
    if (p === 'assets' || p.startsWith('assets/')) paths.add(p);
  }

  // Known essential asset subsets per the spec (kept: the app builds some
  // fetch URLs from segments a static scan cannot join).
  const essential = [
    'assets/cw/client-static/img',
    'assets/cw/sound',
    'assets/cw/ui-icons',
    'assets/rig',
  ];
  for (const p of essential) paths.add(p);

  paths.delete('assets'); // never the whole tree (renders/sources are 170MB of non-runtime source material)
  return Array.from(paths).sort();
}

// ---- Verification (fix B): exported so the manifest test can exercise the
// loud-failure path directly. Every repo path that shipped runtime code or
// the test suite references, and that exists under `repoRoot`, must exist
// under `outDir`. Returns { required, missing } — `missing` non-empty means
// the built tree silently dropped something the app or suite reads.
export async function verifyPreviewTree(outDir, repoRoot = REPO_ROOT) {
  const requiredSet = new Set([
    ...(await discoverRuntimeAssetPaths(repoRoot)),
    ...(await discoverSuiteRepoPaths(repoRoot)),
  ]);
  const missing = [];
  for (const rel of requiredSet) {
    if (!(await exists(path.join(repoRoot, rel)))) continue; // never existed; nothing to publish
    if (!(await exists(path.join(outDir, rel)))) missing.push(rel);
  }
  missing.sort();
  return { required: requiredSet.size, missing };
}

// ---- Main build ----
export async function buildPreview(outDir, repoRoot = REPO_ROOT) {
  // Clean output directory
  try {
    await fs.rm(outDir, { recursive: true, force: true });
  } catch {}

  // Create output directory
  await fs.mkdir(outDir, { recursive: true });

  // Copy root index.html
  await fs.copyFile(path.join(repoRoot, 'index.html'), path.join(outDir, 'index.html'));
  console.log('✓ Copied index.html');

  // Copy app/ tree
  await copyRecursive(path.join(repoRoot, 'app'), path.join(outDir, 'app'));
  console.log('✓ Copied app/');

  // Copy tools/ tree (fix A: the suite reads tools/preview/** and
  // tools/parity/** — without this the published preview cannot run its
  // own suite; node_modules and dist-preview* are never copied)
  await copyRecursive(path.join(repoRoot, 'tools'), path.join(outDir, 'tools'));
  console.log('✓ Copied tools/ (minus node_modules)');

  // Discover and copy assets
  const assetPaths = await discoverAssetPaths(repoRoot);
  const copiedAssets = [];
  for (const assetPath of assetPaths) {
    const src = path.join(repoRoot, assetPath);
    const dest = path.join(outDir, assetPath);
    try {
      const stat = await fs.stat(src);
      if (stat.isDirectory()) {
        await copyRecursive(src, dest);
      } else {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
      }
      copiedAssets.push(assetPath);
    } catch {
      // Asset path does not exist in the repo (e.g. a normalized template
      // prefix); verification below only demands paths that DO exist.
    }
  }
  console.log(`✓ Copied assets (${copiedAssets.length} paths)`);

  // Copy docs/
  await copyRecursive(path.join(repoRoot, 'docs'), path.join(outDir, 'docs'));
  console.log('✓ Copied docs/');

  // Copy any other repo files the suite reads that the trees above missed
  // (derived, not hand-listed — fix A).
  const suitePaths = await discoverSuiteRepoPaths(repoRoot);
  for (const rel of suitePaths) {
    const src = path.join(repoRoot, rel);
    const dest = path.join(outDir, rel);
    if ((await exists(src)) && !(await exists(dest))) {
      await copyRecursive(src, dest);
      console.log(`✓ Copied suite-read path: ${rel}`);
    }
  }

  // ---- VERIFY (fix B): every repo path that shipped code or the suite
  // references and that exists in the repository MUST exist in the built
  // tree. A build that silently publishes a broken app is the real defect —
  // fail loudly instead.
  const { required, missing } = await verifyPreviewTree(outDir, repoRoot);
  if (missing.length > 0) {
    console.error('\n✗ PREVIEW BUILD FAILED — referenced repo paths missing from the built tree:');
    for (const rel of missing) console.error(`   - ${rel}`);
    console.error('Every asset/tool/doc path that shipped app/ code or the test suite reads must be published.');
    throw new Error(`preview verification failed: ${missing.length} referenced path(s) missing from ${outDir}`);
  }
  console.log(`✓ Verified: all ${required} referenced repo paths present in the built tree`);

  // Discover test files present in the output
  const appTestsInOutput = path.join(outDir, 'app', 'tests');
  const testFilesInOutput = (await walkFiles(appTestsInOutput, (n) => n.endsWith('.js')))
    .map((p) => path.relative(appTestsInOutput, p))
    .sort();

  // Compute totals over the whole built tree
  let totalBytes = 0;
  const allFiles = await walkFiles(outDir, () => true);
  for (const p of allFiles) {
    const stat = await fs.stat(p);
    totalBytes += stat.size;
  }

  // Create tests/index.html — landing page for running the suite
  const testsIndexContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Cheddar Battles Test Suite</title>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            line-height: 1.6;
        }
        code {
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
        }
        pre {
            background: #f0f0f0;
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
        }
        .file-list {
            background: #fafafa;
            border-left: 3px solid #333;
            padding: 12px;
            margin: 16px 0;
        }
        .important {
            color: #d32f2f;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>Cheddar Battles Test Suite</h1>
    
    <p><strong>Important:</strong> <span class="important">The test suite does NOT run in a browser.</span></p>
    
    <h2>How to Run the Tests</h2>
    <p>Use Node.js directly from the command line:</p>
    <pre><code>node --test app/tests/*.test.js</code></pre>
    
    <p>From the root directory of this preview (where <code>index.html</code> and <code>app/</code> are located).</p>
    
    <h2>Test Files Manifest</h2>
    <p>The following test files are included and will be run with the command above:</p>
    
    <div class="file-list">
`;

  // Add test files to the manifest
  const testListHtml = testFilesInOutput
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => `<code>app/tests/${f}</code>`)
    .join('<br>');

  const manifest = `${testsIndexContent}${testListHtml}
    </div>
    
    <h2>Test Fixtures and Helpers</h2>
    <p>All test fixtures and helper modules are included:</p>
    <ul>
        <li><code>app/tests/helpers/</code> — shared test utilities</li>
        <li><code>app/tests/fixtures/</code> — test data files</li>
    </ul>
    
    <h2>Preview Contents</h2>
    <p>This preview includes:</p>
    <ul>
        <li>The complete <code>app/</code> tree (source code)</li>
        <li>The complete <code>app/tests/</code> tree (test suite with helpers and fixtures)</li>
        <li>The complete <code>tools/</code> tree minus <code>node_modules</code> (the preview builder and the parity harness the suite reads)</li>
        <li><code>index.html</code> (preview entry point)</li>
        <li><code>assets/</code> (runtime assets used by the app)</li>
        <li><code>docs/</code> (specification and documentation)</li>
    </ul>
    
    <h2>Verification</h2>
    <p>To verify the test suite passes in this preview:</p>
    <pre><code>cd /path/to/this/preview
node --test app/tests/*.test.js</code></pre>
    
    <p>All tests should pass with zero failures.</p>
    
</body>
</html>`;

  await fs.mkdir(path.join(outDir, 'tests'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'tests', 'index.html'), manifest);
  console.log('✓ Created tests/index.html manifest');

  // Summary output (counts are REAL walks over the built tree, not a formula)
  console.log('\n=== Preview Build Complete ===');
  console.log(`Files included: ${allFiles.length + 1}`); // +1: tests/index.html written after the walk
  console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB (${totalBytes} bytes)`);
  console.log(`Test files: ${testFilesInOutput.filter((f) => f.endsWith('.test.js')).length}`);
  console.log(`Output: ${outDir}`);
}

// ---- Entry point (main guard: importing this module never builds) ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = process.env.CB_PREVIEW_REPO_ROOT
    ? path.resolve(process.env.CB_PREVIEW_REPO_ROOT)
    : REPO_ROOT;
  const outDir = process.argv[2] || path.join(repoRoot, 'dist-preview');
  console.log(`Building preview to: ${outDir}`);
  buildPreview(outDir, repoRoot).catch((err) => {
    console.error('Error building preview:', err.message);
    process.exit(1);
  });
}
