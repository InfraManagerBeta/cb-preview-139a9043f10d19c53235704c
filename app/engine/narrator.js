// app/engine/narrator.js
// §9 — R71–R73. A deterministic local narration engine (no model call) that
// consumes the R72 pre-computed match-data shape and emits 2–5 plain prose
// sentences under the Format/Voice/Content rules shipped verbatim as product
// data at app/data/narrator-prompt.txt. This module implements the R73
// application layer for real: a forbidden-output scanner, a specificity
// check, strip-or-regenerate-once, a static fallback, and the exact R73
// static bypass for an identical-element-all-five-rounds duel.
//
// C5 fix (f2): the deterministic templates below are now REGISTER-aware —
// one template SET per treatment (incumbent/adjacent/far), each voiced to
// match that treatment's `narrator.registerLine`/`personaLine` (dry/precise
// British archivist; deadpan mechanical shop-manual scrutineer; terse/plain/
// broadcast-neutral scorekeeper). This is a deterministic APPROXIMATION of
// the register a live model call would produce from `composeNarratorPrompt`
// (app/engine/narratorPrompt.js) — that composed prompt remains the real
// artifact a live model call would use (see narratorPrompt.js; it is kept
// wired into app/ui/console/main.js's copy-label surface and covered by
// narrator-prompt-compose.test.js), and this comment records the
// approximation honestly per the brief. The far register is deliberately
// SHORTER and structurally different (fewer clauses per sentence, blunter
// lead fact) — not merely a noun swap — per C5/R71/R72.

// (no direct duel.js import needed — matchData carries element labels as strings)

// ---- R72: the pre-computed match-data shape ------------------------------

/**
 * Build the exact facts the application pre-computes for the Narrator — the
 * model (or, here, the deterministic engine) counts nothing; it only reads
 * facts already computed by the engine.
 */
export function buildMatchData(outcome, context = {}) {
  const {
    p1Name = 'Wizard A',
    p2Name = 'Wizard B',
    p1StakeBefore = null,
    p2StakeBefore = null,
    bracketCompletion = false,
    prize = null, // { amountCheddar, amountUSD, tier }
    isFinal = false,
  } = context;

  const p1StakeAfter = p1StakeBefore != null ? p1StakeBefore + (outcome.trueTie ? 0 : (outcome.winner === 1 ? outcome.transfer : -Math.abs(outcome.transfer))) : null;
  const p2StakeAfter = p2StakeBefore != null ? p2StakeBefore - (outcome.trueTie ? 0 : (outcome.winner === 1 ? outcome.transfer : -Math.abs(outcome.transfer))) : null;

  return {
    p1Name,
    p2Name,
    rounds: outcome.rounds.map((r) => ({
      number: r.round,
      result: r.result, // WIN | LOSS | DRAW (from character 1's perspective)
      move1: r.move1,
      move2: r.move2,
      p1Affinity: r.p1Affinity,
      p2Affinity: r.p2Affinity,
      tag: r.tag, // null | BIG | CRITICAL
    })),
    summary: {
      won: outcome.won,
      lost: outcome.lost,
      draws: outcome.draws,
      big: outcome.bigCount,
      critical: outcome.criticalCount,
    },
    flags: {
      tie: outcome.trueTie,
      upset: !!outcome.upset,
      bracketCompletion: !!bracketCompletion,
      coupDeGrace: !!outcome.coupDeGrace,
      floorDrain: !!outcome.floorDrain,
      identicalAllFive: !!outcome.identicalAllFive,
    },
    transfer: {
      amount: Math.abs(outcome.transfer || 0),
      direction: outcome.trueTie ? null : (outcome.winner === 1 ? 'p2top1' : 'p1top2'),
    },
    stakes: {
      p1Before: p1StakeBefore, p1After: p1StakeAfter,
      p2Before: p2StakeBefore, p2After: p2StakeAfter,
    },
    prize: bracketCompletion && prize ? prize : null,
    isFinal,
    identicalElementLabel: outcome.identicalAllFive ? capitalizeFirst(outcome.rounds[0].move1) : null,
  };
}

function capitalizeFirst(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** XML-record rendering of the match data, per R72 ("<round number="1" result="WIN"/>"). */
export function toXML(matchData) {
  const lines = ['<duel>'];
  for (const r of matchData.rounds) {
    lines.push(
      `  <round number="${r.number}" result="${r.result}" p1Affinity="${r.p1Affinity}" p2Affinity="${r.p2Affinity}"${r.tag ? ` tag="${r.tag}"` : ''}/>`
    );
  }
  const s = matchData.summary;
  lines.push(`  <summary won="${s.won}" lost="${s.lost}" draws="${s.draws}" big="${s.big}" critical="${s.critical}"/>`);
  const f = matchData.flags;
  lines.push(`  <flags tie="${f.tie}" upset="${f.upset}" bracketCompletion="${f.bracketCompletion}" coupDeGrace="${f.coupDeGrace}" floorDrain="${f.floorDrain}"/>`);
  lines.push(`  <transfer amount="${matchData.transfer.amount}"${matchData.transfer.direction ? ` direction="${matchData.transfer.direction}"` : ''}/>`);
  if (matchData.prize) {
    lines.push(`  <prize amountCheddar="${matchData.prize.amountCheddar}" amountUSD="${matchData.prize.amountUSD}" tier="${matchData.prize.tier}"/>`);
  }
  lines.push('</duel>');
  return lines.join('\n');
}

// ---- R73: the application layer -------------------------------------------

// A9 fix (f2): the "house or product mention" pattern used to only ban the
// incumbent's own strings (Cheeze/Cheese Wizards, "CW", "Cheddar Battles"),
// so a run of the alternate treatments could still legally slip a
// competing/inactive product's name past the scanner. Every shipped
// product name is banned in every register/treatment — the scanner runs on
// all of them (R73), never scoped to "whichever one happens to be active"
// in a way that would leave the OTHER two live in its blind spot.
const FORBIDDEN_PATTERNS = [
  { name: 'luck words', re: /\b(luck|lucky|fortunate|unfortunately)\b/i },
  { name: 'exclamation points', re: /!/ },
  { name: 'direct address', re: /\byou(r|'re|’re)?\b/i },
  { name: 'gaming language', re: /\b(gg|noob|pwn(ed)?|op|nerf|buff|meta)\b/i },
  {
    name: 'house or product mention',
    // Bans the incumbent's own strings AND every treatment's product name
    // (A9: "not just the incumbent's strings") -- Scrapyard Kings/Undercard
    // are banned right alongside Cheddar Battles, regardless of which
    // treatment is currently active, since the scanner must catch a
    // cross-treatment name leak too (e.g. incumbent copy that accidentally
    // quotes "Undercard").
    re: /\b(cheeze wizards|cheese wizards|\bcw\b|the house|our platform|cheddar battles|scrapyard kings|undercard)\b/i,
  },
  { name: 'hedging connectives', re: /\b(however|nevertheless)\b/i },
];

export function scanForbidden(text) {
  return FORBIDDEN_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

/** "Could this describe a different match?" — require at least one number
 * pulled straight from this match's data to appear in the text. */
export function specificityCheck(text, matchData) {
  const s = matchData.summary;
  const lower = text.toLowerCase();
  const requiredNumbers = [s.won, s.lost, s.draws, matchData.transfer.amount];
  return requiredNumbers.some((n) => n !== 0 && (text.includes(String(n)) || lower.includes(numberWord(n))));
}

const STATIC_FALLBACK = 'The ledger records the result: the score stands, the transfer is entered, and the record travels.';

function numberWord(n) {
  const words = ['no', 'one', 'two', 'three', 'four', 'five'];
  return words[n] ?? String(n);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// R12/R13: the deterministic local narration engine stands in for the model
// call, so its prose is a participant-facing surface too — the world noun
// ("wizard") and the stake-unit noun ("cheddar") it uses in body text must
// swap per treatment exactly like every other theme-bound copy string. The
// defaults below match the incumbent's shipped nouns exactly, so every
// existing call site (and every existing test) that does not pass `nouns`
// keeps producing byte-identical output.
const DEFAULT_NOUNS = { character: 'wizard', stakeUnitProse: 'cheddar' };

// C5: the three per-treatment registers. `REGISTERS` keys match
// `treatment.id` (incumbent/adjacent/far); `generateNarration`/`renderTemplate`
// default to 'incumbent' when no register is passed, so every pre-existing
// call site (and every existing test) keeps producing byte-identical output.
const REGISTERS = Object.freeze({
  incumbent: 'incumbent', // dry, precise, British archivist (Terry Pratchett calibration)
  adjacent: 'adjacent',   // deadpan, exact, mechanical shop-manual scrutineer
  far: 'far',             // terse, plain, broadcast-neutral scorekeeper
});

function scoreFragment(s, style) {
  const roundWord = style === 'far' ? 'Round' : 'round';
  if (style === 'far') {
    // Terse/broadcast: the bare numbers first, no subordinate draw clause.
    return `${capitalize(numberWord(s.won))} to ${numberWord(s.lost)}.`;
  }
  const drawClause = s.draws ? `, with ${numberWord(s.draws)} draw${s.draws === 1 ? '' : 's'}` : '';
  return `${capitalize(numberWord(s.won))} ${roundWord}${s.won === 1 ? '' : 's'} to ${numberWord(s.lost)}${drawClause}.`;
}

// ---- Incumbent register: dry/precise/British archivist -------------------
function renderIncumbent(matchData, variant, nouns) {
  const s = matchData.summary;
  const f = matchData.flags;
  const t = matchData.transfer;
  const character = nouns.character || DEFAULT_NOUNS.character;
  const unit = nouns.stakeUnitProse || DEFAULT_NOUNS.stakeUnitProse;

  if (f.tie) {
    // f4/C17 fix: the old hardcoded "All five rounds settled nothing
    // between them" is FALSE whenever a true tie (duelScore === 0) is
    // reached via offsetting decisive rounds rather than five straight
    // draws (duelScore sums SIGNED weighted deltas -- a net zero does not
    // require every round to be a draw). It also doesn't reliably survive
    // specificityCheck: when draws != 5, the literal word "five" matches
    // none of this match's real numbers (won/lost/draws/transfer), and a
    // true tie always carries transfer.amount === 0 (excluded from the
    // check), leaving the fallback as the only guaranteed-real-number
    // route -- silently degrading every true tie to the generic
    // STATIC_FALLBACK instead of this register's own tie line. Leading
    // with the real score breakdown (scoreFragment, exactly what the
    // non-tie templates use) guarantees at least one of won/lost/draws
    // is nonzero (they sum to 5) and appears verbatim.
    return [
      `${scoreFragment(s, 'incumbent')} The ledger's own arithmetic ties it exactly.`,
      'The ledger turns to the coin for this one.',
      t.amount === 0 ? `No ${unit} moves on a true tie.` : `${capitalize(numberWord(t.amount))} ${unit} sat untouched.`,
    ];
  }

  if (f.coupDeGrace) {
    const sentences = [
      `${capitalize(numberWord(s.draws))} rounds produced nothing.`,
      'One round produced everything.',
      'The ledger does not find this proportionate.',
      'The ledger records it anyway.',
    ];
    if (f.floorDrain) sentences.push(`${capitalize(numberWord(t.amount))} ${unit} changed hands — all of it.`);
    return sentences;
  }

  // variant 0: lead with the score. variant 1: lead with the transfer fact
  // (a genuinely different structure, not a reworded variant 0 — C17).
  // variant 2: lead with the round-count/affinity fact.
  if (variant === 1 && (f.floorDrain || t.amount > 0)) {
    const sentences = [
      f.floorDrain
        ? `The transfer took the loser to nothing — ${t.amount} ${unit}, the full stake.`
        : `${t.amount} ${unit} changed hands.`,
      scoreFragment(s, 'incumbent'),
    ];
    if (s.critical > 0) sentences.push(`${capitalize(numberWord(s.critical))} round${s.critical === 1 ? '' : 's'} saw both ${character}s commit their own element at once.`);
    if (f.upset) sentences.push('The smaller stack took it.');
    if (matchData.prize) sentences.push(`The bracket is closed. The prize is entered separately from the duel: ${matchData.prize.amountCheddar} ${unit}.`);
    return sentences.filter(Boolean).slice(0, 5);
  }

  if (variant === 2 && (s.critical > 0 || s.big > 0)) {
    const affinityCount = s.critical > 0 ? s.critical : s.big;
    const affinityWord = s.critical > 0 ? `both ${character}s commit their own element at once` : 'carry an affinity weight';
    const sentences = [
      `${capitalize(numberWord(affinityCount))} round${affinityCount === 1 ? '' : 's'} ${s.critical > 0 ? `saw ${affinityWord}` : affinityWord}.`,
      scoreFragment(s, 'incumbent'),
    ];
    if (f.floorDrain) sentences.push(`The transfer took the loser to nothing — ${t.amount} ${unit}, the full stake.`);
    else if (t.amount > 0) sentences.push(`${t.amount} ${unit} changed hands.`);
    if (f.upset) sentences.push('The smaller stack took it.');
    return sentences.filter(Boolean).slice(0, 5);
  }

  const sentences = [scoreFragment(s, 'incumbent')];

  if (s.critical > 0) {
    sentences.push(`${capitalize(numberWord(s.critical))} round${s.critical === 1 ? '' : 's'} saw both ${character}s commit their own element at once.`);
  } else if (s.big > 0) {
    sentences.push(`${capitalize(numberWord(s.big))} round${s.big === 1 ? '' : 's'} carried an affinity weight.`);
  }

  if (f.floorDrain) {
    sentences.push(`The transfer took the loser to nothing — ${t.amount} ${unit}, the full stake.`);
  } else if (t.amount > 0) {
    sentences.push(`${t.amount} ${unit} changed hands.`);
  }

  if (f.upset) {
    sentences.push('The smaller stack took it.');
  }

  if (matchData.prize) {
    sentences.push(`The bracket is closed. The prize is entered separately from the duel: ${matchData.prize.amountCheddar} ${unit}.`);
  }

  return sentences.filter(Boolean).slice(0, 5);
}

// ---- Adjacent register: deadpan, mechanical, shop-manual scrutineer ------
function adjacentScoreLine(s) {
  return `${capitalize(numberWord(s.won))} logged to ${numberWord(s.lost)}${s.draws ? `, ${numberWord(s.draws)} null${s.draws === 1 ? '' : 's'}` : ''}.`;
}

function renderAdjacent(matchData, variant, nouns) {
  const s = matchData.summary;
  const f = matchData.flags;
  const t = matchData.transfer;
  const character = nouns.character || 'bot';
  const unit = nouns.stakeUnitProse || 'scrap';

  if (f.tie) {
    // f4/C17 fix: same reasoning as the incumbent's tie fix above -- "Five
    // readings, five nulls" is only true when draws === 5, and doesn't
    // reliably survive specificityCheck otherwise. Lead with the real
    // logged breakdown instead.
    return [
      `${adjacentScoreLine(s)} Balanced to zero on the scrutineer's own math.`,
      'The scrutineer defers to the coin for this reading.',
      t.amount === 0 ? `Zero ${unit} logged on a null reading.` : `${capitalize(numberWord(t.amount))} ${unit} held at rest.`,
    ];
  }

  if (f.coupDeGrace) {
    const sentences = [
      `${capitalize(numberWord(s.draws))} readings logged nothing.`,
      'One reading logged everything.',
      'The scrutineer flags the ratio.',
      'The scrutineer logs it regardless.',
    ];
    if (f.floorDrain) sentences.push(`${capitalize(numberWord(t.amount))} ${unit} crossed the line — the full reading.`);
    return sentences;
  }

  // variant 0: lead with the logged score. variant 1: lead with the
  // transfer fact. variant 2 (f4/C17 fix -- this register previously had
  // NO variant-2 branch, so a v2 request silently fell through to the
  // same rendering as v0): lead with the reading-count/calibration fact,
  // mirroring the incumbent's own variant-2 structure in this register's
  // voice.
  if (variant === 1 && (f.floorDrain || t.amount > 0)) {
    const sentences = [
      f.floorDrain
        ? `The reading drained the loser to zero — ${t.amount} ${unit}, the full stock.`
        : `${t.amount} ${unit} crossed the line.`,
      adjacentScoreLine(s),
    ];
    if (s.critical > 0) sentences.push(`${capitalize(numberWord(s.critical))} reading${s.critical === 1 ? '' : 's'} logged both ${character}s on their own calibration at once.`);
    if (f.upset) sentences.push('The lighter unit measured heavier.');
    if (matchData.prize) sentences.push(`The circuit closes. The payout is a separate line item: ${matchData.prize.amountCheddar} ${unit}.`);
    return sentences.filter(Boolean).slice(0, 5);
  }

  if (variant === 2 && (s.critical > 0 || s.big > 0)) {
    const affinityCount = s.critical > 0 ? s.critical : s.big;
    const affinityWord = s.critical > 0 ? `both ${character}s logged their own calibration at once` : 'carried a calibration weight';
    const sentences = [
      `${capitalize(numberWord(affinityCount))} reading${affinityCount === 1 ? '' : 's'} ${s.critical > 0 ? `logged ${affinityWord}` : affinityWord}.`,
      adjacentScoreLine(s),
    ];
    if (f.floorDrain) sentences.push(`The reading drained the loser to zero — ${t.amount} ${unit}, the full stock.`);
    else if (t.amount > 0) sentences.push(`${t.amount} ${unit} crossed the line.`);
    if (f.upset) sentences.push('The lighter unit measured heavier.');
    return sentences.filter(Boolean).slice(0, 5);
  }

  const sentences = [adjacentScoreLine(s)];

  if (s.critical > 0) {
    sentences.push(`${capitalize(numberWord(s.critical))} reading${s.critical === 1 ? '' : 's'} logged both ${character}s on their own calibration at once.`);
  } else if (s.big > 0) {
    sentences.push(`${capitalize(numberWord(s.big))} reading${s.big === 1 ? '' : 's'} carried a calibration weight.`);
  }

  if (f.floorDrain) {
    sentences.push(`The reading drained the loser to zero — ${t.amount} ${unit}, the full stock.`);
  } else if (t.amount > 0) {
    sentences.push(`${t.amount} ${unit} crossed the line.`);
  }

  if (f.upset) sentences.push('The lighter unit measured heavier.');

  if (matchData.prize) {
    sentences.push(`The circuit closes. The payout is a separate line item: ${matchData.prize.amountCheddar} ${unit}.`);
  }

  return sentences.filter(Boolean).slice(0, 5);
}

// ---- Far register: terse, plain, broadcast-neutral scorekeeper ----------
// C5: SHORTER sentences, zero flourish, no subordinate clauses -- a
// structurally different (not just re-nouned) rendering: short declaratives,
// the score stated as bare numbers, no compound "with N draws" clause.
function renderFar(matchData, variant, nouns) {
  const s = matchData.summary;
  const f = matchData.flags;
  const t = matchData.transfer;
  const unit = nouns.stakeUnitProse || 'purse';

  if (f.tie) {
    // f4/C17 fix: same reasoning as the other two registers -- "Even
    // card." carries no number at all, so it can never satisfy
    // specificityCheck on its own; lead with the bare score (still
    // terse/plain, this register's own voice) so a real number always
    // appears.
    //
    // f5/crucial-4 follow-up fix: `scoreFragment(s, 'far')` only ever
    // states won/lost ("Zero to zero." -- numberWord(0) is "no", so
    // literally "No to no.") -- when a true tie is reached via ALL FIVE
    // ROUNDS DRAWING (won===0, lost===0, draws===5 -- e.g. a mixed matched
    // sequence that now correctly routes here instead of R73's bypass, per
    // duel.js's identicalAllFive fix), won and lost are BOTH zero and
    // excluded by specificityCheck's own rule (`n !== 0`), leaving NO real
    // number in the line at all -- silently degrading to the generic
    // STATIC_FALLBACK, the exact failure mode this register's tie line was
    // supposed to have been fixed against. State the draws count explicitly
    // whenever won and lost are both zero.
    //
    // f6/advisory-9 fix: the f5 fix above appended the draws count as a
    // trailing clause, producing a redundant "No to no. Five even. Tied."
    // lead -- "No to no." states nothing "Five even." doesn't already cover
    // more informatively, and it reads oddly for this register's own terse/
    // plain voice. When won and lost are both zero, LEAD with the draws
    // count instead of the "No to no." fragment (dropping it entirely,
    // not just relegating it); specificityCheck still passes because the
    // draws count itself is the real, match-specific number the check
    // requires. When the tie is NOT all-draws (won/lost carry real, nonzero
    // numbers), `scoreFragment` remains the right lead -- unchanged.
    const allDrawsTie = s.won === 0 && s.lost === 0;
    const leadLine = allDrawsTie
      ? `${capitalize(numberWord(s.draws))} even. Tied.`
      : `${scoreFragment(s, 'far')} Tied.`;
    return [
      leadLine,
      'The coin decides.',
      t.amount === 0 ? `No ${unit} moved.` : `${capitalize(numberWord(t.amount))} ${unit} held.`,
    ];
  }

  if (f.coupDeGrace) {
    const sentences = [
      `${capitalize(numberWord(s.draws))} even rounds.`,
      'One round moved it.',
      'Scored and filed.',
    ];
    if (f.floorDrain) sentences.push(`${t.amount} ${unit}. All of it.`);
    return sentences;
  }

  // variant 0: lead with the bare score. variant 1: lead with the
  // transfer fact. variant 2 (f4/C17 fix -- this register previously had
  // NO variant-2 branch either, same gap as adjacent's): lead with the
  // affinity-round count, terse/plain, no character noun needed to stay
  // in this register's minimal voice.
  if (variant === 1 && (f.floorDrain || t.amount > 0)) {
    const sentences = [
      f.floorDrain ? `${t.amount} ${unit}. All of it.` : `${t.amount} ${unit} moved.`,
      scoreFragment(s, 'far'),
    ];
    if (s.draws > 0) sentences.push(`${capitalize(numberWord(s.draws))} even.`);
    if (matchData.prize) sentences.push(`Card closed. Purse filed separately: ${matchData.prize.amountCheddar} ${unit}.`);
    return sentences.filter(Boolean).slice(0, 5);
  }

  if (variant === 2 && (s.critical > 0 || s.big > 0)) {
    const affinityCount = s.critical > 0 ? s.critical : s.big;
    const sentences = [
      `${capitalize(numberWord(affinityCount))} affinity round${affinityCount === 1 ? '' : 's'}.`,
      scoreFragment(s, 'far'),
    ];
    if (f.floorDrain) sentences.push(`${t.amount} ${unit}. All of it.`);
    else if (t.amount > 0) sentences.push(`${t.amount} ${unit} moved.`);
    if (f.upset) sentences.push('Underdog card.');
    return sentences.filter(Boolean).slice(0, 5);
  }

  const sentences = [scoreFragment(s, 'far')];

  if (s.draws > 0) sentences.push(`${capitalize(numberWord(s.draws))} even.`);

  if (f.floorDrain) {
    sentences.push(`${t.amount} ${unit}. All of it.`);
  } else if (t.amount > 0) {
    sentences.push(`${t.amount} ${unit} moved.`);
  }

  if (f.upset) sentences.push('Underdog card.');

  if (matchData.prize) {
    sentences.push(`Card closed. Purse filed separately: ${matchData.prize.amountCheddar} ${unit}.`);
  }

  return sentences.filter(Boolean).slice(0, 5);
}

/** Deterministic templates, chosen by match shape AND (C5) by the active
 * treatment's register. Each returns 2-5 sentences as an array of strings
 * (joined with a space by the caller). `variant` (C17) genuinely changes
 * the rendering's lead fact/structure, not just a no-op re-invocation.
 * f6/A10 fix: the prior wording ("variant 2 specifically only diverges from
 * variant 0 when an affinity round exists") was incomplete -- v1d's
 * counterexample: a true tie or a coup-de-grâce shape returns EARLY (see
 * `if (f.tie) return [...]` / `if (f.coupDeGrace) return [...]` at the top
 * of each register's render function below) BEFORE the `variant === 2`
 * branch is ever reached, regardless of whether an affinity round exists --
 * so a tie/coup-de-grâce duel with affinity rounds still renders identically
 * across every variant. Corrected: variant 2 diverges only when an affinity
 * round exists AND the shape isn't tie/coup-de-grâce. */
function renderTemplate(matchData, variant = 0, nouns = DEFAULT_NOUNS, register = REGISTERS.incumbent) {
  if (register === REGISTERS.adjacent) return renderAdjacent(matchData, variant, nouns);
  if (register === REGISTERS.far) return renderFar(matchData, variant, nouns);
  return renderIncumbent(matchData, variant, nouns);
}

/**
 * Generate narration for a duel. Deterministic (no external call); the
 * function still runs the real R73 pipeline: static bypass check first,
 * then scan -> regenerate once on failure -> static fallback, then a
 * specificity check with the same regenerate-once-then-fallback discipline.
 *
 * @param {object} [opts.register] 'incumbent' | 'adjacent' | 'far' -- C5:
 *   selects the treatment-voiced template set. Defaults to 'incumbent' so
 *   every pre-existing call site keeps producing its exact prior output.
 */
export function generateNarration(matchData, { treatmentCopy = null, random = Math.random, nouns = DEFAULT_NOUNS, register = REGISTERS.incumbent } = {}) {
  // R73 static bypass: identical element committed all five rounds.
  if (matchData.flags.identicalAllFive && treatmentCopy) {
    const el = matchData.identicalElementLabel || 'Fire';
    const useA = random() < 0.5;
    const text = useA
      ? treatmentCopy.narratorBypassA.replace('[ELEMENT]', el)
      : treatmentCopy.narratorBypassB.replace(/\[EEEEE\]/g, el.toUpperCase());
    return { text, usedBypass: true, usedFallback: false, regenerations: 0 };
  }

  let regenerations = 0;
  let text = renderTemplate(matchData, 0, nouns, register).join(' ');
  let violations = scanForbidden(text);
  if (violations.length > 0) {
    regenerations = 1;
    text = renderTemplate(matchData, 1, nouns, register).join(' ');
    violations = scanForbidden(text);
  }
  if (violations.length > 0) {
    return { text: STATIC_FALLBACK, usedBypass: false, usedFallback: true, regenerations, violations };
  }

  if (!specificityCheck(text, matchData)) {
    regenerations += 1;
    const retry = renderTemplate(matchData, 2, nouns, register).join(' ');
    if (specificityCheck(retry, matchData) && scanForbidden(retry).length === 0) {
      text = retry;
    } else {
      return { text: STATIC_FALLBACK, usedBypass: false, usedFallback: true, regenerations };
    }
  }

  return { text, usedBypass: false, usedFallback: false, regenerations };
}

export { STATIC_FALLBACK, DEFAULT_NOUNS, REGISTERS, renderTemplate };

// ---- C13/R26 card 2: Pre-match Narrator brief ------------------------------
// "A two-sentence brief per opponent from the ledger, discipline-scanned"
// (docs/retention-manifest.md, card 2) -- same call shape and discipline as
// the post-duel narration above (data-only in, scanForbidden discipline
// check, static fallback), fed by `engine/hypotheses.js:summarizeOpponentHistory`
// instead of a resolved duel's matchData. Register-aware (C5) exactly like
// generateNarration.

const BRIEF_STATIC_FALLBACK = 'The ledger holds no comment on this pairing.';

function renderBriefSentences(opponentName, summary, register, unit) {
  const { wins, losses, count, avgAffinityPlayRate } = summary;
  const affinityPct = Math.round(avgAffinityPlayRate * 100);
  if (count === 0) {
    if (register === REGISTERS.far) return [`${opponentName}: no record yet.`, 'First meeting.'];
    if (register === REGISTERS.adjacent) return [`${opponentName} carries no logged reading yet.`, 'This is the first calibration.'];
    return [`${opponentName} carries no record with this ledger yet.`, 'This will be their first entry.'];
  }
  if (register === REGISTERS.far) {
    return [`${opponentName}: ${wins}-${losses} over the last ${count}.`, `Plays an affinity element ${affinityPct}% of rounds.`];
  }
  if (register === REGISTERS.adjacent) {
    return [`${opponentName} logs ${wins} to ${losses} across the last ${count} readings.`, `Calibrates to an affinity element in ${affinityPct}% of rounds.`];
  }
  return [`${opponentName} stands at ${wins} wins to ${losses} across the last ${count} duels.`, `Commits an affinity element in ${affinityPct}% of rounds.`];
}

/**
 * @param {string} opponentName
 * @param {object} summary from engine/hypotheses.js:summarizeOpponentHistory
 * @param {object} [opts] { register, nouns } -- same meaning as generateNarration
 */
export function generatePreMatchBrief(opponentName, summary, { register = REGISTERS.incumbent } = {}) {
  const sentences = renderBriefSentences(opponentName, summary, register);
  const text = sentences.join(' ');
  const violations = scanForbidden(text);
  if (violations.length > 0) {
    return { text: BRIEF_STATIC_FALLBACK, usedFallback: true, violations };
  }
  return { text, usedFallback: false };
}

export { BRIEF_STATIC_FALLBACK };
