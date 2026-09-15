// app/engine/narratorPrompt.js
// §9/R71 + R87 conflict CONFLICT-R71-R12 (recorded in
// app/data/treatments/mapping.json and docs/decision-graph.md): composes the
// full Narrator system prompt for any treatment from the incumbent's shipped
// prompt (app/data/narrator-prompt.txt, byte-verbatim product data) as the
// canonical template.
//
// R71 splits the prompt into:
//   - theme-bound lines: the opening persona+register sentences, the product
//     name, world nouns, and the example sentences -> swapped per treatment.
//   - discipline lines (Format rules, Voice rules, Content rules): verbatim
//     in every treatment, EXCEPT the R87 conflict resolution: two Voice-rule
//     lines contain incumbent nouns baked into the illustrative text itself
//     ("'Cheddar transferred' not 'coffers depleted'" and "Never address the
//     wizard directly.") -- those two lines are held "semantically verbatim"
//     with ONLY the role noun swapped through the R13 mapping, everything
//     else byte-identical.
//
// This module is the single source of truth for that composition, so the
// rule is testable (app/tests/narrator-prompt-compose.test.js) rather than
// hand-copied into three separate prompt files that could drift apart.

const FORMAT_BLOCK = `Format rules — these are absolute:
- Plain prose only. No headers. No subheaders. No titles. No sign-offs. No italic flourishes. No "Record sealed." No document structure of any kind.
- 2–5 sentences. Match length to the interest of the data. A routine 3-2 win with nothing unusual is worth 2 sentences. A coup de grâce after four draws is worth 5. A boring match should get a bored Narrator — brevity is not failure, it is accuracy.
- Output nothing except the narration sentences themselves.`;

// The Voice rules block, held as an ordered list of lines so the two
// noun-bearing lines (index 2 and index 6) can be substituted per treatment
// while every other line stays byte-identical to the shipped incumbent text.
const VOICE_LINES = [
  '- "Round" is acceptable. Do not substitute synonyms like "exchange", "bout", or "engagement".',
  '- Never invent organizational structures (no "divisions", "brackets" as named entities, "affinity classifications").',
  null, // index 2: the "ornate vocabulary" example line -- R87 noun substitution
  '- Never say "unfortunately", "however", "nevertheless".',
  '- Never use emoji.',
  '- Never explain rules or mechanics.',
  null, // index 6: "Never address the {character} directly." -- R87 noun substitution
  '- Never moralize or editorialize about choices.',
  '- Never attribute outcomes to luck.',
  '- Specific over general — these numbers, this result, this opponent. Not a generic outcome.',
  '- The ledger is permanent. The record travels.',
];

const CONTENT_BLOCK = `Content rules — these are absolute:
- Never describe how a round was won. No spell descriptions, no elemental metaphors, no "aqueous assault", no "methodical application of flame." You were not there. You have the outcome, not the footage.
- Never invent context not present in the data. No "initial advantages," no backstory, no nicknames, no implied momentum. Only what was explicitly sent.
- Find the interesting fact and build toward it. Do not summarize the duel chronologically. Ask: what is the one thing worth noting about this specific result? Lead with setup, land on that.
- The most interesting fact is often the most unusual number or the sharpest contrast. A 1-0 result with four draws that ends in a total drain is not a routine win. Treat it accordingly.
- Never explain why an outcome happened. The Narrator saw the ledger entry, not the duel. It knows who won which rounds. It does not know why, and it does not speculate. No causal language: no "because", no "despite", no "proved", no "ensured", no "against X's Y".`;

/** The incumbent's exact R87 noun-substitution values -- the identity
 * mapping (the incumbent maps to itself). Every other treatment supplies its
 * own pair in its treatment JSON's `narrator.disciplineNounLines`. */
export const INCUMBENT_NOUN_LINES = {
  ornateVocabLine: '- Never use ornate vocabulary where plain vocabulary works. "Cheddar transferred" not "coffers depleted". "Now holds" not "ascending to".',
  addressLine: '- Never address the wizard directly.',
};

/** Build the Voice rules block text for a treatment, given its two
 * noun-substituted lines (byte-identical to the incumbent's in every other
 * respect -- see VOICE_LINES above). */
export function buildVoiceBlock(nounLines = INCUMBENT_NOUN_LINES) {
  const lines = VOICE_LINES.map((l, i) => {
    if (i === 2) return nounLines.ornateVocabLine;
    if (i === 6) return nounLines.addressLine;
    return l;
  });
  return ['Voice rules — these are absolute:', ...lines].join('\n');
}

/** The discipline block (Format + Voice + Content), the part of the prompt
 * that must be verbatim across every treatment modulo the recorded R87 noun
 * substitution. */
export function disciplineBlock(nounLines = INCUMBENT_NOUN_LINES) {
  return [FORMAT_BLOCK, '', buildVoiceBlock(nounLines), '', CONTENT_BLOCK].join('\n');
}

/**
 * Compose the full system prompt for a treatment.
 * @param {object} treatment a loaded treatment JSON (incumbent/adjacent/far)
 * @param {object} [opts]
 * @param {object} [opts.nounLines] override for the R87 noun-substitution
 *   pair; defaults to `treatment.narrator.disciplineNounLines` (or the
 *   incumbent's identity mapping if absent).
 */
export function composeNarratorPrompt(treatment, opts = {}) {
  const nounLines = opts.nounLines || treatment?.narrator?.disciplineNounLines || INCUMBENT_NOUN_LINES;
  const persona = treatment.narrator.personaLine;
  const register = treatment.narrator.registerLine;
  const permanenceLine = 'You record outcomes with appropriate permanence.';
  const examples = treatment.narrator.examples && treatment.narrator.examples.length > 0
    ? treatment.narrator.examples
    : [];

  const parts = [
    `${persona} ${register} ${permanenceLine}`,
    '',
    FORMAT_BLOCK,
    '',
    buildVoiceBlock(nounLines),
  ];

  if (examples.length > 0) {
    parts.push('', 'Examples of the voice at its best (internalize these, do not copy them):', '');
    parts.push(examples.map((e) => {
      if (typeof e === 'string') return `"${e}"`;
      return `"${e.text}"${e.note ? ` [${e.note}]` : ''}`;
    }).join('\n\n'));
  }

  parts.push('', CONTENT_BLOCK);

  return parts.join('\n') + '\n';
}

export { FORMAT_BLOCK, CONTENT_BLOCK, VOICE_LINES };
