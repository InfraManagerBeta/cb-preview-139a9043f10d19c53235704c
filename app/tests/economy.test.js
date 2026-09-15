// app/tests/economy.test.js — R58-R63: accounts, tiers, state machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as economy from '../engine/economy.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import * as bracketEngine from '../engine/bracket.js';
import * as sync from '../engine/sync.js';
import { mulberry32 } from '../engine/rng.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

test('floors match the 2x re-entry-bonus formula for every tier (R55)', () => {
  for (const [tier, reentry] of Object.entries(tunables.reentry.byTier)) {
    assert.equal(tunables.floors.byTier[tier], 2 * reentry.bonusCheddar, `tier ${tier}`);
  }
});

test('summonCharacter mints a fresh ACTIVE tier-0 character with 100C', () => {
  const c = economy.summonCharacter(tunables, { id: 'c1', name: 'Test', element: 'fire', createdAt: 1000 });
  assert.equal(c.state, 'ACTIVE');
  assert.equal(c.tier, 0);
  assert.equal(c.stakeCheddar, 100);
});

test('canEnterTier: tier 0 is ungated; tier N>0 needs live W>L at tier N-1', () => {
  const c = { records: {} };
  assert.equal(economy.canEnterTier(c, 0), true);
  assert.equal(economy.canEnterTier({ records: { 0: { w: 1, l: 1 } } }, 1), false); // tied, not W>L
  assert.equal(economy.canEnterTier({ records: { 0: { w: 2, l: 1 } } }, 1), true);
  assert.equal(economy.canEnterTier({ records: {} }, 1), false); // no record at all
});

test('meetsMinimumStake: bracket entry requires stake >= tier floor', () => {
  const c = { stakeCheddar: 49 };
  assert.equal(economy.meetsMinimumStake(tunables, c, 0), false);
  c.stakeCheddar = 50;
  assert.equal(economy.meetsMinimumStake(tunables, c, 0), true);
});

test('reenter: pays the tier fee (tracked by caller) and credits the Cheddar bonus', () => {
  const c = { tier: 0, state: 'SITTING', stakeCheddar: 10 };
  const { character, feeUSD, bonusCheddar } = economy.reenter(tunables, c);
  assert.equal(feeUSD, 5.00);
  assert.equal(bonusCheddar, 25);
  assert.equal(character.stakeCheddar, 35);
  assert.equal(character.state, 'ACTIVE');
});

test('cashOut: converts stake to CASH at 20:1 and retires the character (sole retirement path)', () => {
  const c = { tier: 0, state: 'SITTING', stakeCheddar: 140 };
  const { character, cashUSD } = economy.cashOut(tunables, c);
  assert.equal(cashUSD, 7);
  assert.equal(character.stakeCheddar, 0);
  assert.equal(character.state, 'RETIRED');
  assert.throws(() => economy.cashOut(tunables, character)); // already retired
});

test('isEmptied: true only at stake <= 0', () => {
  assert.equal(economy.isEmptied({ stakeCheddar: 0 }), true);
  assert.equal(economy.isEmptied({ stakeCheddar: 1 }), false);
});

test('computeWinsToTop: 21 from a fresh tier-0 character (3 wins/bracket x 7 tiers)', () => {
  assert.equal(economy.computeWinsToTop(tunables, 0), 21);
  assert.equal(economy.computeWinsToTop(tunables, 6), 3);
});

test('tier ladder prize figures match R62 for tiers 0-2 (the tested slice)', () => {
  assert.deepEqual(economy.tierLadderEntry(tunables, 0), { tier: 0, prizeUSD: 20, prizeCheddar: 400 });
  assert.deepEqual(economy.tierLadderEntry(tunables, 1), { tier: 1, prizeUSD: 25, prizeCheddar: 500 });
  assert.deepEqual(economy.tierLadderEntry(tunables, 2), { tier: 2, prizeUSD: 100, prizeCheddar: 2000 });
});

// ---- C2/A8: bracketWinOutcome (the single, now-live, tier-clamp+payout rule) ---

test('bracketWinOutcome: below the top tier, advances (or not) exactly as before -- no clamp needed', () => {
  const out = economy.bracketWinOutcome(tunables, { championTier: 2, canAdvance: true, stakeCheddarAtWin: 5000 });
  assert.equal(out.toppedOut, false);
  assert.equal(out.newTier, 3);
  assert.equal(out.prizeCheddar, 2000); // T2's prize, minted onto the stake by the caller
});

test('bracketWinOutcome: canAdvance:false keeps the champion at the same tier (no free advance without the record)', () => {
  const out = economy.bracketWinOutcome(tunables, { championTier: 2, canAdvance: false, stakeCheddarAtWin: 5000 });
  assert.equal(out.newTier, 2);
});

test('C2: bracketWinOutcome at the TOP tier (T6) clamps -- never tier 7 -- and pays $999,999.92 CASH plus the stake at 20:1, not 20,000,000C', () => {
  const out = economy.bracketWinOutcome(tunables, { championTier: 6, canAdvance: true, stakeCheddarAtWin: 60000 });
  assert.equal(out.toppedOut, true);
  assert.equal(out.newTier, 6); // clamped
  assert.equal(out.prizeCheddar, 0); // NOT 20,000,000C minted onto the stake
  assert.equal(out.payoutCashUSD, 999999.92);
  assert.equal(out.stakeCashUSD, 60000 / 20);
  assert.equal(out.stakeCashedOutCheddar, 60000);
});

// ---- A7/A8: economy.test.js exercising the LIVE path (the Game facade) ----
// C2 happened exactly because the live path (game.js) re-implemented the
// tier-advance/payout logic inline, diverging from a dead, already-correct
// parallel copy over here. Cross-check: play a real, deterministic bracket
// through the Game facade and confirm the CHARACTER_ADVANCED event it wrote
// matches what economy.bracketWinOutcome (the pure function game.js now
// actually calls) would compute for the same inputs.

test('A7/A8: a live T0 bracket win advances via the SAME rule bracketWinOutcome exposes (not a re-implemented, divergent copy)', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  let t = Date.now();
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  let guard = 0;
  while (!bracket.complete && guard++ < 60) {
    for (const m of bracketEngine.pendingMatches(bracket)) {
      const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
      t += 1000;
      game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? [1, 1, 1, 1, 1] : null, now: t }); // water beats the always-'fire' opponents
    }
  }
  const advanced = game.ledger.byType(EVENT_TYPES.CHARACTER_ADVANCED).find((e) => e.payload.characterId === summon.characterId);
  assert.ok(advanced);
  // The pure rule the live path calls, given the SAME tier/canAdvance
  // inputs, reproduces exactly what the ledger recorded.
  const expected = economy.bracketWinOutcome(tunables, { championTier: 0, canAdvance: true, stakeCheddarAtWin: 999 });
  assert.equal(advanced.payload.newTier, expected.newTier);
  assert.equal(advanced.payload.prizeCheddar, expected.prizeCheddar);
  assert.equal(advanced.payload.prizeCheddar, economy.tierLadderEntry(tunables, 0).prizeCheddar);
});

test('A19: cashOutToastMessage always shows the pre-cash-out dollar figure (the old code was a dead `x ? y : y` ternary)', async () => {
  const { cashOutToastMessage } = await import('../ui/screens/sitting.js');
  assert.equal(cashOutToastMessage(7), 'Cashed out $7.00.');
  assert.equal(cashOutToastMessage(0), 'Cashed out $0.00.');
});
