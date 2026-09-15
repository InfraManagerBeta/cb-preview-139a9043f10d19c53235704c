// app/tests/manifest-hypotheses.test.js — f2/C13/O3/R26/R20/AC0: the six
// manifest-hypothesis cards at minimum fair-test scope, switchable via O3;
// each hypothesis's surface appears only when active; the scouting panel
// and the pre-match brief derive from REAL ledger events (not mocked data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import * as bracketEngine from '../engine/bracket.js';
import * as sync from '../engine/sync.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { effectiveTunables, effectiveTreatmentId, effectiveHypothesisId, defaultOverrides } from '../engine/overrides.js';
import { HYPOTHESIS_CARDS, hypothesisCard, opponentDuelHistory, summarizeOpponentHistory, nextMarqueeSlot } from '../engine/hypotheses.js';
import { generatePreMatchBrief, scanForbidden } from '../engine/narrator.js';
import * as pve from '../engine/pve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const tunablesRaw = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGame(overrides = {}, seed = 1) {
  const storage = createMemoryStorage();
  if (Object.keys(overrides).length) {
    storage.setItem('consoleOverrides', JSON.stringify({ ...defaultOverrides(), ...overrides }));
  }
  const tunables = effectiveTunables(tunablesRaw, { ...defaultOverrides(), ...overrides });
  const game = new Game({ ledger: new Ledger(storage), tunables, treatment, playerId: 'p1', random: mulberry32(seed), overridesStorage: storage });
  return game;
}

/** Play a guaranteed-human-win bracket (same fixture pattern as game.test.js). */
function playGuaranteedWinBracket(game, characterId, tier) {
  let t = Date.now();
  const lobby = game.joinLobby(characterId, tier, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  let guard = 0;
  while (!bracket.complete && guard++ < 60) {
    for (const m of bracketEngine.pendingMatches(bracket)) {
      const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
      t += 1000;
      game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? [1, 1, 1, 1, 1] : null, now: t });
    }
  }
  return { bracketId, bracket, humanSeatIndex, t };
}

// ---- registry ---------------------------------------------------------

test('HYPOTHESIS_CARDS carries exactly the six R26 cards in manifest order', () => {
  assert.equal(HYPOTHESIS_CARDS.length, 6);
  assert.deepEqual(HYPOTHESIS_CARDS.map((c) => c.order), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(HYPOTHESIS_CARDS.map((c) => c.id), ['scouting_reports', 'prematch_brief', 'spectate', 'marquee_brackets', 'pve_depth', 'theme_change']);
});

test('f4/N4 fix: effectiveHypothesisId defaults to NONE (not manifest-order card 1) and honors an O3 override', () => {
  assert.equal(effectiveHypothesisId(defaultOverrides()), null);
  assert.equal(effectiveHypothesisId({ ...defaultOverrides(), activeHypothesis: 'pve_depth' }), 'pve_depth');
  assert.equal(effectiveHypothesisId({ ...defaultOverrides(), activeHypothesis: 'scouting_reports' }), 'scouting_reports');
});

// ---- Card 1: Scouting reports -------------------------------------------

test('C13 card 1: opponent scouting history derives from REAL DUEL_RESOLVED ledger events (not mocked data)', () => {
  const game = freshGame({ activeHypothesis: 'scouting_reports' });
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'water' }, t0);
  const { bracketId, bracket, humanSeatIndex } = playGuaranteedWinBracket(game, summon.characterId, 0);

  // Pick any NPC opponent this bracket actually fought.
  const npcSeat = bracket.seats.find((s, i) => i !== humanSeatIndex && s.kind === 'npc');
  const ledgerEvents = game.ledger.all();
  const history = opponentDuelHistory(ledgerEvents, npcSeat.characterId, 10);
  assert.ok(history.length > 0, 'expected at least one real duel in the opponent\'s history');
  for (const row of history) {
    assert.ok(row.opponentCharacterId != null || row.won != null);
  }
  const summary = summarizeOpponentHistory(history);
  assert.equal(summary.wins + summary.losses + summary.ties, summary.count);
});

test('C13 card 1: an opponent with no shared history reports zero, not a fabricated record', () => {
  const history = opponentDuelHistory([], 'nobody', 10);
  assert.deepEqual(history, []);
  const summary = summarizeOpponentHistory(history);
  assert.equal(summary.count, 0);
  assert.equal(summary.wins, 0);
});

// ---- f7/N2: per-round scouting (f6 made per-round moves reconstructable) --

test('f7/N2: opponentDuelHistory returns playedByRound/facedByRound for a CURRENT event, oriented via combatants, matching the live per-round moves exactly for BOTH the seat-A and seat-B perspective', () => {
  const game = freshGame({ activeHypothesis: 'scouting_reports' });
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'water' }, t0);
  const lobby = game.joinLobby(summon.characterId, 0, t0 + 1000);
  let t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  t += 1000;
  game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [0, 1, 2, 0, 1], now: t });

  const ledgerEvents = game.ledger.all();
  const duelEvent = ledgerEvents.find((e) => e.type === EVENT_TYPES.DUEL_RESOLVED && e.payload.roundIndex === match.roundIndex && e.payload.matchIndex === match.matchIndex);
  const [combatantA, combatantB] = duelEvent.payload.combatants;
  const expectedMove1 = duelEvent.payload.outcome.rounds.map((r) => r.move1);
  const expectedMove2 = duelEvent.payload.outcome.rounds.map((r) => r.move2);
  assert.equal(expectedMove1.length, 5);

  const historyA = opponentDuelHistory(ledgerEvents, combatantA.characterId, 10);
  const rowA = historyA.find((h) => h.ts === duelEvent.ts);
  assert.equal(rowA.roundsAvailable, true);
  assert.deepEqual(rowA.playedByRound, expectedMove1, 'expected seat A\'s own history row to read move1 as ITS played elements');
  assert.deepEqual(rowA.facedByRound, expectedMove2, 'expected seat A\'s row to read move2 as what it FACED');

  const historyB = opponentDuelHistory(ledgerEvents, combatantB.characterId, 10);
  const rowB = historyB.find((h) => h.ts === duelEvent.ts);
  assert.equal(rowB.roundsAvailable, true);
  assert.deepEqual(rowB.playedByRound, expectedMove2, 'expected seat B\'s own history row to read move2 (mirrored) as ITS played elements');
  assert.deepEqual(rowB.facedByRound, expectedMove1, 'expected seat B\'s row to read move1 as what it FACED');
});

test('f7/N2: opponentDuelHistory falls back to summary-only (playedByRound/facedByRound null, roundsAvailable false) for a legacy rounds-free DUEL_RESOLVED event, never a fabricated per-round guess', () => {
  const ledgerEvents = [{
    type: EVENT_TYPES.DUEL_RESOLVED,
    ts: 1000,
    payload: {
      combatants: [{ characterId: 'a', won: true }, { characterId: 'b', won: false }],
      // f7/N1/N2: a pre-f6 event -- no `rounds` key on the outcome at all.
      outcome: { won: 3, lost: 2, draws: 0, bigCount: 1, criticalCount: 0, transfer: 10, floorDrain: false, trueTie: false },
    },
  }];
  const history = opponentDuelHistory(ledgerEvents, 'a', 10);
  assert.equal(history.length, 1);
  assert.equal(history[0].roundsAvailable, false);
  assert.equal(history[0].playedByRound, null);
  assert.equal(history[0].facedByRound, null);
  // Summary fields (A6's original retained set) are untouched by this fix.
  assert.equal(history[0].scoreFor, 3);
  assert.equal(history[0].won, true);
});

test('f7/N2: the scouting panel (duel.js) renders the per-round move history (R26(1)) per past duel, honestly marking a legacy (rounds-free) row', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/duel.js'), 'utf8');
  const panelBody = src.slice(src.indexOf('function renderScoutingAndBrief'), src.indexOf('function renderCoinFlipVerification'));
  assert.ok(panelBody.includes('h.playedByRound') && panelBody.includes('h.facedByRound'), 'expected the panel to render playedByRound/facedByRound');
  assert.ok(panelBody.includes('h.roundsAvailable'), 'expected the panel to branch on roundsAvailable');
  assert.ok(/round-by-round unavailable/.test(panelBody), 'expected the panel to honestly mark a legacy row');
});

// ---- Card 2: Pre-match Narrator brief ------------------------------------

test('C13 card 2: the pre-match brief is register-aware, 2 sentences, and discipline-scanned', () => {
  const summary = { wins: 3, losses: 1, ties: 0, count: 4, avgAffinityPlayRate: 0.4 };
  const brief = generatePreMatchBrief('Manchego the Merciless', summary, { register: 'far' });
  assert.equal(scanForbidden(brief.text).length, 0);
  const sentenceCount = brief.text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  assert.equal(sentenceCount, 2);

  const incBrief = generatePreMatchBrief('Manchego the Merciless', summary, { register: 'incumbent' });
  assert.notEqual(incBrief.text, brief.text, 'expected the register to change the brief\'s wording');
});

test('C13 card 2: a fresh opponent (no history) still produces a discipline-clean 2-sentence brief', () => {
  const brief = generatePreMatchBrief('Fresh Opponent', { wins: 0, losses: 0, ties: 0, count: 0, avgAffinityPlayRate: 0 }, { register: 'incumbent' });
  assert.equal(scanForbidden(brief.text).length, 0);
});

// ---- Card 3: Spectate after elimination ----------------------------------

test('C13 card 3: Game#recordSpectateView appends a SPECTATE_VIEW event', () => {
  const game = freshGame({ activeHypothesis: 'spectate' });
  game.ensureAccount(1000);
  game.recordSpectateView('bracket-1', 2000);
  const events = game.ledger.byType(EVENT_TYPES.SPECTATE_VIEW);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.bracketId, 'bracket-1');
});

test('f4/A-a: recordSpectateView is idempotent -- keyed on bracketId+playerId (once per bracket per player, the honest §13 spectate-rate semantics), not a fresh randomId() per call', () => {
  const game = freshGame({ activeHypothesis: 'spectate' });
  game.ensureAccount(1000);
  game.recordSpectateView('bracket-1', 2000);
  game.recordSpectateView('bracket-1', 2001); // repeat view of the SAME still-open board -- must be a no-op
  game.recordSpectateView('bracket-1', 2002);
  const events = game.ledger.byType(EVENT_TYPES.SPECTATE_VIEW).filter((e) => e.payload.bracketId === 'bracket-1');
  assert.equal(events.length, 1, 'expected repeated views of the same bracket to record exactly one event');

  // A genuinely different bracket still records its OWN event.
  game.recordSpectateView('bracket-2', 2003);
  const allEvents = game.ledger.byType(EVENT_TYPES.SPECTATE_VIEW);
  assert.equal(allEvents.length, 2);
});

// ---- Card 4: Marquee scheduled brackets ----------------------------------

test('C13 card 4: nextMarqueeSlot is deterministic given `now`, always in the future, and the reminder opt-in is a real, idempotent ledger event', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const slot = nextMarqueeSlot(now, 20);
  assert.ok(slot.startsAt > now);
  assert.equal(slot.msRemaining, slot.startsAt - now);

  const game = freshGame({ activeHypothesis: 'marquee_brackets' });
  game.ensureAccount(1000);
  game.optInMarqueeReminder(slot.startsAt, 1500);
  game.optInMarqueeReminder(slot.startsAt, 1600); // replay -- idempotent
  const events = game.ledger.byType(EVENT_TYPES.MARQUEE_REMINDER_OPT_IN);
  assert.equal(events.length, 1);
});

// ---- Card 5: PvE depth ----------------------------------------------------

test('C13 card 5: generatePvERosterOpponent round-robins through the canonical roster deterministically by session epoch', () => {
  const opp0 = pve.generatePvERosterOpponent(tunablesRaw, treatment, { tier: 0, playerStakeCheddar: 100, sessionEpoch: 0, random: mulberry32(1) });
  const opp1 = pve.generatePvERosterOpponent(tunablesRaw, treatment, { tier: 0, playerStakeCheddar: 100, sessionEpoch: 1, random: mulberry32(1) });
  const canonicalCount = treatment.seedRoster.filter((r) => r.canonical).length;
  const oppSame = pve.generatePvERosterOpponent(tunablesRaw, treatment, { tier: 0, playerStakeCheddar: 100, sessionEpoch: canonicalCount, random: mulberry32(1) });
  assert.ok(opp0.name);
  assert.notEqual(opp0.name, opp1.name);
  assert.equal(oppSame.name, opp0.name, 'expected the roster to cycle back after `canonicalCount` sessions');
  assert.equal(opp0.npcTag, true);
});

test('C13 card 5: Game#startPveOpponent draws a NAMED roster opponent when pve_depth is active, and pveRosterRecords aggregates real W/L from the ledger', () => {
  const game = freshGame({ activeHypothesis: 'pve_depth' }, 7);
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'water' }, t0);
  const opponent = game.startPveOpponent(summon.characterId, t0 + 1000);
  assert.ok(opponent.name, 'expected a named roster opponent under pve_depth');

  // Fight a few duels against it, tracking outcomes.
  let t = t0 + 2000;
  for (let i = 0; i < 3; i++) {
    const duelSeq = game.peekPveDuelSeq(opponent.sessionId);
    game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [1, 1, 1, 1, 1], opponent, duelSeq, now: t });
    t += 1000;
    // stop early if the opponent zeroed out and got replaced upstream is
    // out of scope for this pure-engine test; three fixed-move duels vs a
    // fixed opponent tendency is enough to exercise the record path.
    if (game.snapshot().characters[summon.characterId].stakeCheddar <= 0) break;
  }

  const records = pve.pveRosterRecords(game.ledger.all());
  assert.ok(records[opponent.name], 'expected a roster record keyed by the opponent\'s name');
  assert.ok(records[opponent.name].w + records[opponent.name].l > 0);
});

test('C13 card 5: without pve_depth active, PvE opponents stay anonymous (no name), preserving pre-f2 behavior', () => {
  const game = freshGame({}, 7);
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'water' }, t0);
  const opponent = game.startPveOpponent(summon.characterId, t0 + 1000);
  assert.equal(opponent.name, undefined);
});

// ---- Card 6: Theme change --------------------------------------------------

test('C13 card 6: effectiveTreatmentId follows the recorded door-yield theme winner ONLY when theme_change is active', () => {
  const withWinner = { ...defaultOverrides(), lastDoorYieldThemeWinnerId: 'far' };
  assert.equal(effectiveTreatmentId(withWinner, 'incumbent'), 'incumbent', 'without theme_change active, O1 (or its default) still governs');
  const active = { ...withWinner, activeHypothesis: 'theme_change' };
  assert.equal(effectiveTreatmentId(active, 'incumbent'), 'far');
});

test('C13 card 6: with theme_change active but no run yet, falls back to the normal O1 resolution', () => {
  const overrides = { ...defaultOverrides(), activeHypothesis: 'theme_change' };
  assert.equal(effectiveTreatmentId(overrides, 'incumbent'), 'incumbent');
});

// ---- O3 switch: each hypothesis's surface appears only when active ------

async function read(rel) { return fs.readFile(path.join(APP_ROOT, rel), 'utf8'); }

test('O3: each hypothesis\'s UI surface is gated on effectiveHypothesisId(...) === its own id', () => {
  const checks = [
    ['ui/screens/duel.js', "activeId !== 'scouting_reports' && activeId !== 'prematch_brief'"],
    ['ui/screens/sitting.js', "effectiveHypothesisId(loadOverrides()) !== 'spectate'"],
    ['ui/screens/lobby-entry.js', "effectiveHypothesisId(loadOverrides()) !== 'marquee_brackets'"],
    ['ui/screens/pve.js', "effectiveHypothesisId(loadOverrides()) !== 'pve_depth'"],
  ];
  return Promise.all(checks.map(async ([file, needle]) => {
    const src = await read(file);
    assert.ok(src.includes(needle), `${file}: expected the gate "${needle}"`);
  }));
});

test('O3: the console\'s overridesPanel renders a real switch (not just a note) over all six cards plus an explicit "none" default, and runPanel persists the theme-change winner', async () => {
  const overridesPanelSrc = await read('ui/console/overridesPanel.js');
  assert.ok(overridesPanelSrc.includes('HYPOTHESIS_CARDS.map'), 'expected O3 to render a real radio group over the six cards');
  assert.ok(/none \(manifest order/.test(overridesPanelSrc), 'expected an explicit "none (manifest order...)" O3 option');
  assert.ok(overridesPanelSrc.includes("activeHypothesis: v === NONE_VALUE ? null : v"));
  const runPanelSrc = await read('ui/console/runPanel.js');
  assert.ok(runPanelSrc.includes('lastDoorYieldThemeWinnerId'), 'expected runPanel.js to persist the door-yield theme winner for card 6');
});

test('f5/A9: the console pre-registration panel displays intentClickPctOfClicksBaseline (the 5.2% baseline) alongside the derived cost-per-intent-click range', async () => {
  const runPanelSrc = await read('ui/console/runPanel.js');
  assert.ok(runPanelSrc.includes('preReg.doorYield.intentClickPctOfClicksBaseline'), 'expected the pre-registration panel to read intentClickPctOfClicksBaseline');
  // Displayed on the SAME row as the cost-per-intent-click range, per the brief.
  const doorYieldLine = runPanelSrc.split('\n').find((l) => l.includes("tr('Door yield"));
  assert.ok(doorYieldLine && doorYieldLine.includes('intentClickPctOfClicksBaseline') && doorYieldLine.includes('costPerIntentClickUSDRange'), 'expected the door-yield row to show intentClickPctOfClicksBaseline alongside costPerIntentClickUSDRange, not on a separate row');
});

test('f5/A11: the console run-report (gate verdict) states that daily batching can close the gate cell above the planned N ceiling, with the reached-N interval governing', async () => {
  const runPanelSrc = await read('ui/console/runPanel.js');
  const verdictFnBody = runPanelSrc.slice(runPanelSrc.indexOf('function renderGateVerdict'), runPanelSrc.indexOf('function renderGateVerdict') + 2000);
  assert.ok(/daily batching/i.test(verdictFnBody), 'expected the gate verdict to name "daily batching" as the mechanism');
  assert.ok(/above N=/.test(verdictFnBody), 'expected the note to state the close can land ABOVE the planned N');
  assert.ok(/reached-N/i.test(verdictFnBody), 'expected the note to name the reached-N interval as what governs');
  // The note must use the LIVE maxN (from gateConfig), not a hardcoded 50.
  assert.ok(runPanelSrc.includes('renderGateVerdict(gateResult, gateConfig.secondaryRequiredCount, gateConfig.sequentialRule.maxN)'), 'expected renderGateVerdict to be called with the live gateConfig.sequentialRule.maxN, not a hardcoded literal');
});

// ---- f4/N4: default install renders NO hypothesis surface anywhere ------

test('f4/N4: a default (no console interaction) install renders no hypothesis surface on ANY of the six gated call sites', () => {
  const noneOverrides = defaultOverrides();
  assert.equal(noneOverrides.activeHypothesis, null);
  assert.equal(effectiveHypothesisId(noneOverrides), null, 'a default install must resolve to NO active hypothesis');

  // Every gated call site compares effectiveHypothesisId(...) against one
  // of the six real card ids -- null matches none of them, so every
  // surface stays absent by construction. Exercise the two call sites that
  // are pure functions reachable without a full DOM (duel.js's helper is
  // private, but game.js's PvE roster gate is public and ledger-observable).
  const game = freshGame({}); // no activeHypothesis override at all -- true default
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'water' }, t0);
  const opponent = game.startPveOpponent(summon.characterId, t0 + 1000);
  assert.equal(opponent.name, undefined, 'card 5 (pve_depth) must not activate on a default install');

  // card 3/4: default install's effectiveHypothesisId is null, so both
  // sitting.js's spectate gate and lobby-entry.js's marquee gate see a
  // mismatch against their own id and render nothing -- verified directly
  // via the exported resolver (the DOM-rendering path is covered by the
  // O3 gate-source-scan test above; this asserts the actual VALUE those
  // gates compare against on a true default install).
  assert.notEqual(effectiveHypothesisId(defaultOverrides()), 'spectate');
  assert.notEqual(effectiveHypothesisId(defaultOverrides()), 'marquee_brackets');
  assert.notEqual(effectiveHypothesisId(defaultOverrides()), 'scouting_reports');
  assert.notEqual(effectiveHypothesisId(defaultOverrides()), 'prematch_brief');
  assert.notEqual(effectiveHypothesisId(defaultOverrides()), 'theme_change');
});
