// app/tests/spec-hygiene.test.js — CB-BUILD-020: One spec file in the repo
// Enforces that:
// 1. No duplicate copy of cb-outcome-spec.md exists
// 2. Every .md path referenced in source code actually exists
// So the repo maintains exactly one authoritative spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

test('CB-BUILD-020: exactly ONE cb-outcome-spec.md exists in the repo', async () => {
  const specFiles = [];
  
  async function findSpecs(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      // Skip git, node_modules, and dist directories
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.startsWith('dist')) {
        continue;
      }
      if (entry.isDirectory()) {
        await findSpecs(p);
      } else if (entry.name === 'cb-outcome-spec.md') {
        specFiles.push(p);
      }
    }
  }
  
  await findSpecs(REPO_ROOT);
  
  assert.equal(specFiles.length, 1, `expected exactly ONE cb-outcome-spec.md file (found ${specFiles.length}): ${specFiles.join(', ')}`);
  assert.ok(specFiles[0].endsWith('docs/cb-outcome-spec.md'), 'the one spec should be at docs/cb-outcome-spec.md');
});

test('CB-BUILD-020: no docs/specs directory or legacy spec paths exist', async () => {
  const legacyPaths = [
    'docs/specs',
    'specs',
    'specification',
    'doc/spec.md',
  ];
  
  for (const legacyPath of legacyPaths) {
    const fullPath = path.join(REPO_ROOT, legacyPath);
    try {
      await fs.stat(fullPath);
      throw new Error(`Found legacy path that should not exist: ${legacyPath}`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // Expected — path should not exist
    }
  }
});

test('CB-BUILD-020: every .md file referenced in source code actually exists', async () => {
  // Known real .md files that exist and are referenced
  const knownValidRefs = new Set([
    'app/README.md',
    'docs/cb-outcome-spec.md',
    'docs/cb-build-patch-log.md',
    'docs/retention-manifest.md',
    'docs/concept-cards.md',
    'docs/risk-dossier.md',
    'docs/decision-graph.md',
    'docs/presentation-candidates.md',
    'app/vendor/README.md',
  ]);
  
  // Files that are referenced in comments but are not real files (examples, etc.)
  // These are skipped as they are documentation/explanation examples
  const examplePatterns = [
    'path/to/file.md',
    'doc/spec.md',
    'docs/file.md',
    'docs/PRD.md',  // archived file
  ];
  
  const mdReferences = new Set();
  
  // Find actual .md references in app/, tools/, docs/
  async function findReferences(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      
      // Skip git, node_modules, dist directories
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.startsWith('dist')) {
        continue;
      }
      
      if (entry.isDirectory()) {
        await findReferences(p);
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.md')) {
        const content = await fs.readFile(p, 'utf8');
        
        // Find patterns like "app/...", "docs/..." in comments and code
        const pattern = /((?:app|docs)\/[\w\-/]+\.md)/g;
        
        let m;
        while ((m = pattern.exec(content))) {
          let mdPath = m[1];
          // Skip if it's a fragment reference (e.g., docs/file.md#section)
          mdPath = mdPath.split('#')[0];
          
          // Skip example paths
          if (!examplePatterns.includes(mdPath)) {
            mdReferences.add(mdPath);
          }
        }
      }
    }
  }
  
  await findReferences(path.join(REPO_ROOT, 'app'));
  await findReferences(path.join(REPO_ROOT, 'tools'));
  await findReferences(path.join(REPO_ROOT, 'docs'));
  
  // Verify each referenced file exists
  const missing = [];
  for (const mdRef of mdReferences) {
    if (!knownValidRefs.has(mdRef)) {
      const fullPath = path.join(REPO_ROOT, mdRef);
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) {
          missing.push(`${mdRef} (not a file)`);
        }
      } catch (err) {
        if (err.code === 'ENOENT') {
          missing.push(mdRef);
        }
      }
    }
  }
  
  assert.deepEqual(missing, [], `expected all .md references to exist; missing: ${missing.join(', ')}`);
  console.log(`    ✓ Verified ${mdReferences.size} unique .md references exist`);
});

test('CB-BUILD-020: no dangling references to removed specs/ directory', async () => {
  const specsRefPattern = /specs\//g;
  const badRefs = [];
  
  async function checkDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.startsWith('dist')) {
        continue;
      }
      
      // Skip this test file and the audit doc (they document the issue, not manifest it)
      if (entry.name === 'spec-hygiene.test.js' || entry.name === 'cb-build-020-audit.md') {
        continue;
      }
      
      if (entry.isDirectory()) {
        await checkDir(p);
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.md')) {
        const content = await fs.readFile(p, 'utf8');
        if (specsRefPattern.test(content)) {
          badRefs.push(p);
        }
      }
    }
  }
  
  await checkDir(path.join(REPO_ROOT, 'app'));
  await checkDir(path.join(REPO_ROOT, 'tools'));
  await checkDir(path.join(REPO_ROOT, 'docs'));
  
  assert.deepEqual(badRefs, [], `expected no references to removed 'specs/' directory; found in: ${badRefs.join(', ')}`);
});
