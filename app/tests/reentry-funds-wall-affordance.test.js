// app/tests/reentry-funds-wall-affordance.test.js — CB-BUILD-012 fix round
// (C3): R67 ("a funds-blocked action opens Load Funds inline") and §12/R83
// ("a control never presents as actionable when it cannot act") run BOTH
// ways -- a control also must never present as INACTIONABLE when it
// actually CAN act. sitting.js's Re-enter button set
// `'aria-disabled': account.cashUSD < reentry.usd` while its own onClick
// (attemptReenter) opens Load Funds inline on exactly that condition --
// since the el() aria-disabled coercion fix, this renders greyed +
// cursor:not-allowed on the very first paint: a dead-dressed control that
// is actually the funds wall's live door. Fixed: aria-disabled now ties
// ONLY to a genuinely inert state (reenterSubmitting, a request already in
// flight); the funds-short case renders as the actionable route it is,
// labeled "Load Funds to re-enter". DOM-level regression test through the
// REAL `el()` (not a stub) -- the review's repro named the stub pattern as
// the reason the defect went uncaught the first time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { installFakeDom, uninstallFakeDom, renderedText } from './helpers/dom-harness.js';

let mountSitting;

test.before(async () => {
  installFakeDom();
  ({ mountSitting } = await import('../ui/screens/sitting.js'));
});
test.after(() => { uninstallFakeDom(); });

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGameWithCharacter() {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed: 1 });
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  return { game, characterId: summoned.characterId };
}

let tsCounter = 2000;
function eliminate(game, characterId) {
  tsCounter += 1;
  game.ledger.append({
    key: `test-eliminate-${characterId}-${tsCounter}`,
    type: EVENT_TYPES.CHARACTER_ELIMINATED,
    playerId: game.playerId,
    ts: tsCounter,
    payload: { characterId, bracketId: 'test-bracket', tier: 0, allDuelsStaked: true },
  });
}

function reenter(game, characterId) {
  tsCounter += 1;
  const sittingEpoch = game.peekSittingEpoch(characterId);
  game.reenterCharacter(characterId, tsCounter, { sittingEpoch });
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

function reenterButton() {
  const buttons = document.getElementById('app').querySelectorAll('button');
  return buttons.find((b) => renderedText(b).startsWith('Re-enter') || renderedText(b) === 'Load Funds to re-enter');
}

test('C3/R67+§12/R83: with enough CASH for the fee, the Re-enter button carries NO aria-disabled at all and reads "Re-enter ($X)"', () => {
  const { game, characterId } = freshGameWithCharacter(); // cash: 25 - 10 = 15
  eliminate(game, characterId); // SITTING; reentry.usd = 5; 15 >= 5
  const { ctx } = makeCtx(game, characterId);
  mountSitting(ctx);
  const btn = reenterButton();
  assert.ok(btn, 'expected a Re-enter/Load-Funds button to render');
  assert.equal(btn.getAttribute('aria-disabled'), null, 'expected NO aria-disabled while affordable');
  assert.match(renderedText(btn), /^Re-enter \(\$/, 'expected the plain re-entry label while affordable');
});

test('C3/R67+§12/R83 (defect repro, fixed): short on CASH, the Re-enter button is NOT dressed disabled -- it reads as the live Load-Funds door it is', () => {
  const { game, characterId } = freshGameWithCharacter(); // cash: 15
  eliminate(game, characterId); reenter(game, characterId); // cash: 15-5=10
  eliminate(game, characterId); reenter(game, characterId); // cash: 10-5=5
  eliminate(game, characterId); reenter(game, characterId); // cash: 5-5=0
  eliminate(game, characterId); // SITTING; cash=0 < reentry.usd=5 -- short
  assert.ok(game.snapshot().account.cashUSD < 5, 'precondition: short on CASH');

  const { ctx } = makeCtx(game, characterId);
  mountSitting(ctx);
  const btn = reenterButton();
  assert.ok(btn, 'expected a button to render even while short on CASH');
  assert.equal(btn.getAttribute('aria-disabled'), null, 'expected the funds-short control to read as ACTIVE, not dead-dressed (aria-disabled must be absent)');
  assert.equal(renderedText(btn), 'Load Funds to re-enter', 'expected an explicit, honest affordance label for the funds-short case');
});

test('C3/R67: pressing the funds-short Re-enter button actually opens Load Funds inline (the live door the un-dead-dressed control now honestly advertises)', () => {
  const { game, characterId } = freshGameWithCharacter();
  eliminate(game, characterId); reenter(game, characterId);
  eliminate(game, characterId); reenter(game, characterId);
  eliminate(game, characterId); reenter(game, characterId);
  eliminate(game, characterId);
  assert.ok(game.snapshot().account.cashUSD < 5);

  const { ctx } = makeCtx(game, characterId);
  mountSitting(ctx);
  const btn = reenterButton();
  const overlaysBefore = document.body.children.filter((n) => n.className && n.className.includes('cb-sheet-overlay'));
  assert.equal(overlaysBefore.length, 0, 'precondition: no Load Funds sheet open yet');
  btn.dispatch('click');
  // Load Funds sheet is appended to document.body, a sibling of #app.
  const overlays = document.body.children.filter((n) => n.className && n.className.includes('cb-sheet-overlay'));
  assert.equal(overlays.length, 1, 'expected pressing the funds-short control to open exactly one Load Funds sheet');
});

test('C3/§12/R83: a GENUINELY inert state (reenterSubmitting, mid-request) still dresses disabled -- the fix is scoped to the funds-short case, not "never disabled"', async () => {
  // Simulate the in-flight moment directly against sitting.js's own source
  // shape (the submitting flag is module-local UI state, not observable
  // from the engine) -- this is the structural half of the regression: the
  // audited call site in el-aria-disabled-coercion.test.js still ties
  // aria-disabled to `reenterSubmitting`, and that state, when true, must
  // still dress disabled and never re-open Load Funds (attemptReenter's
  // reenterSubmitting guard returns before opening anything once CASH is
  // sufficient).
  const src = await (await import('node:fs/promises')).readFile(new URL('../ui/screens/sitting.js', import.meta.url), 'utf8');
  assert.ok(/'aria-disabled':\s*reenterSubmitting,/.test(src), 'expected aria-disabled to be tied to reenterSubmitting alone');
  assert.ok(!/'aria-disabled':\s*account\.cashUSD < reentry\.usd/.test(src), 'expected the funds-short condition to no longer drive aria-disabled at all');
});
