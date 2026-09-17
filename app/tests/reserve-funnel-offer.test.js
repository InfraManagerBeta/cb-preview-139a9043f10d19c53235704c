// app/tests/reserve-funnel-offer.test.js — fix round (C5): R49a [LAW]
// "Reserve is offered in the played funnel's reserve step." The only route
// to RESERVE was the bottom-nav tab -- a hunt, never an offer inside the
// played funnel itself. Reservation rate is the gate's primary metric, so
// this isn't cosmetic. Fixed: sitting.js (the surface a character's own
// bracket run concludes onto -- CHARACTER_ELIMINATED / a topped-out
// champion's CHARACTER_ADVANCED both route here) now offers RESERVE
// post-anchor (R43: the SAME first-bracket-concluded timestamp), reusing
// R49a's own copy; the bottom-nav tab is untouched. Tests render through
// the real el()/mountScreen() via the shared fake-DOM harness: a concluded
// bracket's sitting surface carries the offer; pre-anchor (a hesitated/
// auto-committed loss, which lands SITTING without counting as an anchor,
// same gate reserve.js's own recall prompt already uses) it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { computeAnchor } from '../engine/retention.js';
import { installFakeDom, uninstallFakeDom, renderedText } from './helpers/dom-harness.js';

let mountSitting;

test.before(async () => {
  ({ mountSitting } = await import('../ui/screens/sitting.js'));
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

function eliminate(game, characterId, { ts, allDuelsStaked = true } = {}) {
  game.ledger.append({
    key: `test-eliminate-${characterId}-${ts}`,
    type: EVENT_TYPES.CHARACTER_ELIMINATED,
    playerId: game.playerId,
    ts,
    payload: { characterId, bracketId: 'test-bracket', tier: 0, allDuelsStaked },
  });
}

function makeCtx(game, characterId) {
  const navigated = [];
  const toasts = [];
  return {
    ctx: {
      treatment,
      tunables,
      game,
      router: { navigate: (name) => navigated.push(name) },
      refreshSession: () => ({ activeCharacterId: characterId, bracket: null }),
      patchSession: () => {},
      toast: (msg) => toasts.push(msg),
    },
    navigated,
    toasts,
  };
}

function findReserveButton() {
  // treatment.copy.reserveButton ("RESERVE") is the SAME label the bottom-
  // nav tab already carries (chrome.js:bottomNav) -- that tab is untouched
  // by this fix and must keep rendering regardless. Distinguish the new
  // funnel-offer button by class (the nav tab carries 'cb-nav-btn'; the
  // offer card's button does not).
  return document.getElementById('app').querySelectorAll('button')
    .find((b) => renderedText(b) === treatment.copy.reserveButton && !b.classList.contains('cb-nav-btn'));
}

test('C5/R49a: a concluded bracket\'s sitting surface (post-anchor) carries the RESERVE offer', () => {
  const { game, characterId } = freshGameWithCharacter();
  eliminate(game, characterId, { ts: 2000 }); // a real, staked elimination -- an anchor
  assert.ok(computeAnchor(game.ledger.all(), game.playerId) != null, 'precondition: an anchor exists');

  const { ctx } = makeCtx(game, characterId);
  mountSitting(ctx);
  const text = renderedText(document.getElementById('app'));
  assert.ok(text.includes(treatment.copy.reserveHeading), 'expected the reserve offer heading to render');
  assert.ok(findReserveButton(), 'expected a RESERVE button to render on the sitting surface');
});

test('C5/R49a: PRE-anchor (a hesitated/auto-committed loss -- lands SITTING but does not count as R43\'s anchor), the sitting surface does NOT carry the offer', () => {
  const { game, characterId } = freshGameWithCharacter();
  eliminate(game, characterId, { ts: 2000, allDuelsStaked: false }); // hesitated -- not an anchor
  assert.equal(computeAnchor(game.ledger.all(), game.playerId), null, 'precondition: no anchor yet');

  const { ctx } = makeCtx(game, characterId);
  mountSitting(ctx);
  const text = renderedText(document.getElementById('app'));
  assert.ok(!text.includes(treatment.copy.reserveHeading), 'expected NO reserve offer before an anchor exists');
  assert.ok(!findReserveButton(), 'expected no RESERVE button pre-anchor');
});

test('C5/R49a: pressing the sitting-surface RESERVE offer actually records the reservation (Game#pressReserve), same event as the nav-tab route', () => {
  const { game, characterId } = freshGameWithCharacter();
  eliminate(game, characterId, { ts: 2000 });
  const { ctx } = makeCtx(game, characterId);
  mountSitting(ctx);
  const btn = findReserveButton();
  assert.ok(btn);
  btn.dispatch('click');
  assert.ok(game.snapshot().account.reservation, 'expected a reservation to be recorded');
});

test('C5/R49a: once already reserved, the sitting surface stops offering it again (no repeat ask)', () => {
  const { game, characterId } = freshGameWithCharacter();
  eliminate(game, characterId, { ts: 2000 });
  game.pressReserve({ tier: 0, characterState: 'SITTING' }, 2500);

  const { ctx } = makeCtx(game, characterId);
  mountSitting(ctx);
  assert.ok(!findReserveButton(), 'expected no repeat RESERVE offer once already reserved');
});

test('C5/R49a: the bottom-nav RESERVE tab is unchanged (still present, unaffected by the new funnel offer)', () => {
  const { game, characterId } = freshGameWithCharacter();
  eliminate(game, characterId, { ts: 2000 });
  const { ctx } = makeCtx(game, characterId);
  mountSitting(ctx);
  const navButtons = document.getElementById('app').querySelectorAll('button').filter((b) => b.classList.contains('cb-nav-btn'));
  assert.ok(navButtons.some((b) => renderedText(b) === 'RESERVE'), 'expected the bottom-nav RESERVE tab to still render');
});

test('C5/R49a: a topped-out champion (the OTHER SITTING-landing path, via CHARACTER_ADVANCED toppedOut) also gets the offer -- the emptied-card branch renders it too', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed: 1 });
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  game.ledger.append({
    key: 'test-topped-out',
    type: EVENT_TYPES.CHARACTER_ADVANCED,
    playerId: game.playerId,
    ts: 2000,
    payload: { characterId: summoned.characterId, bracketId: 'test-bracket', tier: 6, newTier: 6, wonBracket: true, toppedOut: true, allDuelsStaked: true, stakeCashedOutCheddar: 0, payoutCashUSD: 0, stakeCashUSD: 0 },
  });
  const character = game.snapshot().characters[summoned.characterId];
  assert.equal(character.state, 'SITTING');
  assert.ok(economyIsEmptiedLike(character), 'precondition: the champion is emptied (0C stake)');

  const { ctx } = makeCtx(game, summoned.characterId);
  mountSitting(ctx);
  assert.ok(findReserveButton(), 'expected the RESERVE offer on the emptied-champion branch too');
});

function economyIsEmptiedLike(character) {
  return character.stakeCheddar <= 0;
}
