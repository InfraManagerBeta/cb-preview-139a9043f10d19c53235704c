// app/tests/reserve-funnel-offer-bracket-board.test.js — N-C5 re-probe fix
// (R49a [LAW] "Reserve is offered in the played funnel's reserve step"; R51
// gates on reservation rate per FIRST-BRACKET COMPLETER).
//
// The prior fix round (C5/F1) put the offer on sitting.js alone. That
// covers the ELIMINATED path (CHARACTER_ELIMINATED -> SITTING) and the
// topped-out-champion path (CHARACTER_ADVANCED toppedOut -> SITTING) --
// but `duel.js`'s result screen routes an ORDINARY bracket WINNER (state
// stays ACTIVE) to `bracket-board`, which never rendered the offer at all.
// That is the gate's most engaged population, silently skipped.
//
// This suite drives the re-probe's own completion-path matrix directly
// against `mountBracketBoard`, using real ledger events (the same shape
// `Game#resolveMatch`/`projection.js` produce) rather than re-testing the
// bracket-completion engine logic itself (already covered by
// game.test.js/economy.test.js): ELIMINATED (staked) is unaffected here
// (it never reaches bracket-board -- covered by
// reserve-funnel-offer.test.js); WON T0->T1 (state ACTIVE) -> offer;
// topped-out champion (state SITTING) -> offer; already-reserved -> not
// re-asked; pre-anchor -> nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { createBracket } from '../engine/bracket.js';
import { computeAnchor } from '../engine/retention.js';
import { installFakeDom, uninstallFakeDom, renderedText } from './helpers/dom-harness.js';

let mountBracketBoard;

test.before(async () => {
  ({ mountBracketBoard } = await import('../ui/screens/bracket-board.js'));
});
test.beforeEach(() => { installFakeDom(); });
test.afterEach(() => { uninstallFakeDom(); });

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGameWithCharacter() {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed: 1 });
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  return { game, characterId: summoned.characterId };
}

/** A completed 8-seat bracket shape good enough for mountBracketBoard's own
 * render (seat labels + round names) -- this suite is about the RESERVE
 * OFFER's presence, not the bracket-tree rendering itself (bracket.test.js
 * already covers real recordMatchResult mechanics), so seats are minimal
 * stand-ins and every match is left undecided except what the render
 * touches (winnerSeat/seatA/seatB, seats[].name/kind). */
function makeCompletedBracket(humanSeatIndex) {
  const seats = Array.from({ length: 8 }, (_, i) => ({
    id: `seat-${i}`,
    kind: i === humanSeatIndex ? 'human' : 'npc',
    characterId: `char-${i}`,
    name: i === humanSeatIndex ? 'You' : `NPC ${i}`,
  }));
  const bracket = createBracket(seats, { tier: 0, createdAt: 1000 });
  bracket.complete = true; // stand-in: this suite doesn't drive real match resolution
  return bracket;
}

function appendAdvanced(game, characterId, { ts, toppedOut, allDuelsStaked = true }) {
  game.ledger.append({
    key: `test-advanced-${characterId}-${ts}`,
    type: EVENT_TYPES.CHARACTER_ADVANCED,
    playerId: game.playerId,
    ts,
    payload: {
      characterId, bracketId: 'test-bracket', tier: toppedOut ? 6 : 0, newTier: toppedOut ? 6 : 1,
      wonBracket: true, toppedOut, allDuelsStaked,
      prizeCheddar: toppedOut ? 0 : 500,
      ...(toppedOut ? { stakeCashedOutCheddar: 0, payoutCashUSD: 999999.92, stakeCashUSD: 0 } : {}),
    },
  });
}

function makeCtx(game, characterId, bracket, humanSeatIndex) {
  const navigated = [];
  const toasts = [];
  return {
    ctx: {
      treatment,
      tunables,
      game,
      router: { navigate: (name) => navigated.push(name) },
      refreshSession: () => ({ activeCharacterId: characterId, bracket, humanSeatIndex }),
      patchSession: () => {},
      toast: (msg) => toasts.push(msg),
    },
    navigated,
    toasts,
  };
}

function findReserveButton() {
  return document.getElementById('app').querySelectorAll('button')
    .find((b) => renderedText(b) === treatment.copy.reserveButton && !b.classList.contains('cb-nav-btn'));
}

test('N-C5/R49a: the ORDINARY bracket winner (state ACTIVE, T0->T1) reaches bracket-board carrying the reserve offer', () => {
  const { game, characterId } = freshGameWithCharacter();
  appendAdvanced(game, characterId, { ts: 2000, toppedOut: false });
  const character = game.snapshot().characters[characterId];
  assert.equal(character.state, 'ACTIVE', 'precondition: an ordinary bracket win leaves the character ACTIVE');
  assert.ok(computeAnchor(game.ledger.all(), game.playerId) != null, 'precondition: a wonBracket advance IS an anchor (R43)');

  const bracket = makeCompletedBracket(0);
  const { ctx } = makeCtx(game, characterId, bracket, 0);
  mountBracketBoard(ctx);

  const text = renderedText(document.getElementById('app'));
  assert.ok(text.includes(treatment.copy.reserveHeading), 'expected the reserve offer heading on bracket-board for the ordinary winner');
  assert.ok(findReserveButton(), 'expected a RESERVE button on bracket-board for the ordinary winner');
});

test('N-C5/R49a: a topped-out champion (state SITTING) also reaches bracket-board carrying the reserve offer', () => {
  const { game, characterId } = freshGameWithCharacter();
  appendAdvanced(game, characterId, { ts: 2000, toppedOut: true });
  const character = game.snapshot().characters[characterId];
  assert.equal(character.state, 'SITTING', 'precondition: a topped-out win lands SITTING (f4/N2)');
  assert.ok(computeAnchor(game.ledger.all(), game.playerId) != null, 'precondition: an anchor exists');

  const bracket = makeCompletedBracket(0);
  const { ctx } = makeCtx(game, characterId, bracket, 0);
  mountBracketBoard(ctx);

  const text = renderedText(document.getElementById('app'));
  assert.ok(text.includes(treatment.copy.reserveHeading), 'expected the reserve offer heading on bracket-board for the topped-out champion too');
  assert.ok(findReserveButton(), 'expected a RESERVE button on bracket-board for the topped-out champion');
});

test('N-C5/R49a: pressing bracket-board\'s RESERVE offer records the reservation and re-renders the SAME screen (offer then gone)', () => {
  const { game, characterId } = freshGameWithCharacter();
  appendAdvanced(game, characterId, { ts: 2000, toppedOut: false });
  const bracket = makeCompletedBracket(0);
  const { ctx } = makeCtx(game, characterId, bracket, 0);
  mountBracketBoard(ctx);

  const btn = findReserveButton();
  assert.ok(btn);
  btn.dispatch('click');

  assert.ok(game.snapshot().account.reservation, 'expected a reservation to be recorded');
  assert.ok(!findReserveButton(), 'expected the offer to be gone after the re-render (already reserved)');
});

test('N-C5/R49a: already-reserved -- bracket-board does not re-ask, for either winner shape', () => {
  const { game, characterId } = freshGameWithCharacter();
  appendAdvanced(game, characterId, { ts: 2000, toppedOut: false });
  game.pressReserve({ tier: 0, characterState: 'ACTIVE' }, 2500);

  const bracket = makeCompletedBracket(0);
  const { ctx } = makeCtx(game, characterId, bracket, 0);
  mountBracketBoard(ctx);

  assert.ok(!findReserveButton(), 'expected no RESERVE offer once already reserved');
});

test('N-C5/R49a: pre-anchor -- bracket-board carries no offer when no bracket has concluded yet (defensive: not reachable via real routing, but the shared guard must still hold)', () => {
  const { game, characterId } = freshGameWithCharacter();
  assert.equal(computeAnchor(game.ledger.all(), game.playerId), null, 'precondition: no anchor yet');

  const bracket = makeCompletedBracket(0);
  bracket.complete = false; // mid-run, no completion event at all
  const { ctx } = makeCtx(game, characterId, bracket, 0);
  mountBracketBoard(ctx);

  assert.ok(!findReserveButton(), 'expected no RESERVE offer pre-anchor');
});

test('N-C5/R49a: hesitated ELIMINATED (pre-anchor) does not carry the offer on bracket-board either, if it were ever reached here', () => {
  const { game, characterId } = freshGameWithCharacter();
  game.ledger.append({
    key: 'test-eliminate-hesitated',
    type: EVENT_TYPES.CHARACTER_ELIMINATED,
    playerId: game.playerId,
    ts: 2000,
    payload: { characterId, bracketId: 'test-bracket', tier: 0, allDuelsStaked: false },
  });
  assert.equal(computeAnchor(game.ledger.all(), game.playerId), null, 'precondition: a hesitated elimination is not an anchor');

  const bracket = makeCompletedBracket(0);
  const { ctx } = makeCtx(game, characterId, bracket, 0);
  mountBracketBoard(ctx);

  assert.ok(!findReserveButton(), 'expected no RESERVE offer for a pre-anchor hesitated elimination');
});

test('N-C5/R49a: bracket-board\'s bottom action button is unaffected by the new offer card (still routes on character.state)', () => {
  const { game, characterId } = freshGameWithCharacter();
  appendAdvanced(game, characterId, { ts: 2000, toppedOut: false });
  const bracket = makeCompletedBracket(0);
  const { ctx, navigated } = makeCtx(game, characterId, bracket, 0);
  mountBracketBoard(ctx);

  const actionBtn = document.getElementById('app').querySelectorAll('button')
    .find((b) => renderedText(b) === 'Continue');
  assert.ok(actionBtn, 'expected the ACTIVE-state "Continue" button to still render');
  actionBtn.dispatch('click');
  assert.deepEqual(navigated, ['duel']);
});
