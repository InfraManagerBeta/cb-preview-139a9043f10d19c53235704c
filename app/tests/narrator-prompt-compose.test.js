// app/tests/narrator-prompt-compose.test.js — R71/R87 (CONFLICT-R71-R12):
// "the composition rule must be tested." Verifies the exact contract
// app/data/treatments/mapping.json records: the incumbent's composed prompt
// reproduces app/data/narrator-prompt.txt byte-for-byte; the Format and
// Content blocks are byte-identical across all three treatments; the Voice
// block differs from the incumbent's ONLY at the two recorded R87 lines,
// substituted exactly per the mapping file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTreatment, loadNarratorPrompt } from '../engine/dataLoader.js';
import { composeNarratorPrompt, disciplineBlock, FORMAT_BLOCK, CONTENT_BLOCK, VOICE_LINES } from '../engine/narratorPrompt.js';

const incumbent = await loadTreatment('incumbent');
const adjacent = await loadTreatment('adjacent');
const far = await loadTreatment('far');

test('composeNarratorPrompt(incumbent) reproduces app/data/narrator-prompt.txt byte-for-byte', async () => {
  const shipped = await loadNarratorPrompt();
  const composed = composeNarratorPrompt(incumbent);
  assert.equal(composed, shipped);
});

test('the Format rules block is byte-identical across incumbent/adjacent/far', () => {
  for (const t of [incumbent, adjacent, far]) {
    const composed = composeNarratorPrompt(t);
    assert.ok(composed.includes(FORMAT_BLOCK), `${t.id}: Format block not found verbatim`);
  }
});

test('the Content rules block is byte-identical across incumbent/adjacent/far', () => {
  for (const t of [incumbent, adjacent, far]) {
    const composed = composeNarratorPrompt(t);
    assert.ok(composed.includes(CONTENT_BLOCK), `${t.id}: Content block not found verbatim`);
  }
});

test('the Voice block is identical across all three treatments EXCEPT at the two recorded R87 noun-substitution lines', () => {
  const incVoice = disciplineLines(incumbent);
  const adjVoice = disciplineLines(adjacent);
  const farVoice = disciplineLines(far);
  assert.equal(incVoice.length, VOICE_LINES.length + 1); // +1 for the "Voice rules --" header line

  for (let i = 1; i < incVoice.length; i++) { // skip header at index 0
    const lineIdx = i - 1;
    if (lineIdx === 2 || lineIdx === 6) continue; // the two recorded substitution lines
    assert.equal(adjVoice[i], incVoice[i], `adjacent diverged at fixed Voice line ${lineIdx}: ${incVoice[i]}`);
    assert.equal(farVoice[i], incVoice[i], `far diverged at fixed Voice line ${lineIdx}: ${incVoice[i]}`);
  }
  // and the two substitution lines DO differ, exactly per docs/decision-graph.md / mapping.json
  assert.notEqual(adjVoice[3], incVoice[3]); // ornate-vocab line (header adds 1 to index)
  assert.notEqual(farVoice[3], incVoice[3]);
  assert.notEqual(adjVoice[7], incVoice[7]); // address line
  assert.notEqual(farVoice[7], incVoice[7]);
});

test('the two R87 substitution lines match app/data/treatments/mapping.json exactly', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mapping = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'data', 'treatments', 'mapping.json'), 'utf8'));
  const sub = mapping.conflicts['CONFLICT-R71-R12'].substitutions;

  const adjVoice = disciplineLines(adjacent);
  const farVoice = disciplineLines(far);
  assert.equal(adjVoice[3], sub.ornateVocabLine.adjacent);
  assert.equal(farVoice[3], sub.ornateVocabLine.far);
  assert.equal(adjVoice[7], sub.addressLine.adjacent);
  assert.equal(farVoice[7], sub.addressLine.far);
});

test('every treatment.narrator.examples renders in its own persona/register (theme-bound), never byte-identical to another treatment\'s examples', () => {
  const incExamples = exampleText(incumbent);
  const adjExamples = exampleText(adjacent);
  const farExamples = exampleText(far);
  assert.notEqual(incExamples, adjExamples);
  assert.notEqual(incExamples, farExamples);
  assert.notEqual(adjExamples, farExamples);
});

test('disciplineBlock() (Format+Voice+Content, no persona/examples) is identical for the incumbent\'s identity mapping and only the two lines change for the others', () => {
  const incBlock = disciplineBlock();
  const adjBlock = disciplineBlock(adjacent.narrator.disciplineNounLines);
  const farBlock = disciplineBlock(far.narrator.disciplineNounLines);
  assert.notEqual(incBlock, adjBlock);
  assert.notEqual(incBlock, farBlock);
  // but stripping just the two substituted lines should make them equal
  const strip = (s) => s.replace(incumbent.narrator.disciplineNounLines.ornateVocabLine, 'X').replace(incumbent.narrator.disciplineNounLines.addressLine, 'Y');
  const stripAdj = (s) => s.replace(adjacent.narrator.disciplineNounLines.ornateVocabLine, 'X').replace(adjacent.narrator.disciplineNounLines.addressLine, 'Y');
  const stripFar = (s) => s.replace(far.narrator.disciplineNounLines.ornateVocabLine, 'X').replace(far.narrator.disciplineNounLines.addressLine, 'Y');
  assert.equal(strip(incBlock), stripAdj(adjBlock));
  assert.equal(strip(incBlock), stripFar(farBlock));
});

// ---- helpers ---------------------------------------------------------------

function disciplineLines(treatment) {
  const composed = composeNarratorPrompt(treatment);
  const voiceStart = composed.indexOf('Voice rules');
  const voiceEnd = composed.indexOf('\n\n', voiceStart);
  return composed.slice(voiceStart, voiceEnd).split('\n');
}

function exampleText(treatment) {
  const composed = composeNarratorPrompt(treatment);
  const start = composed.indexOf('Examples of the voice');
  const end = composed.indexOf('\n\nContent rules');
  return composed.slice(start, end);
}
