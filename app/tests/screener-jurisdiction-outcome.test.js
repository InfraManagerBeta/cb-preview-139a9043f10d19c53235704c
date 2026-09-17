// app/tests/screener-jurisdiction-outcome.test.js — CB-BUILD-001/R70 fix
// round (C2): "a player outside the permitted set meets the shipped 'not
// available in your region' outcome." The not-permitted verdict used to
// render the SAME `screenerRejectedMessage` as an under-18 DOB, worded
// "...isn't open to you yet under these answers" -- attributing a detected
// jurisdiction verdict to the player's own "answers," and giving it no
// distinct rendering from an age failure at all. Fixed: the jurisdiction
// outcome now renders its own copy (`screenerNotAvailableMessage`, carrying
// the shipped "not available in your region" phrase), and the under-18
// outcome's own copy no longer carries "under these answers" either. This
// asserts the RENDERED copy of both outcomes, distinctly, through the real
// `el()`/`mountScreen()` via the shared fake-DOM harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTreatment } from '../engine/dataLoader.js';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { loadTunables } from '../engine/dataLoader.js';
import { installFakeDom, uninstallFakeDom, renderedText } from './helpers/dom-harness.js';

let mountScreener;

test.before(async () => {
  installFakeDom();
  ({ mountScreener } = await import('../ui/screens/screener.js'));
});
test.after(() => { uninstallFakeDom(); });

const tunables = await loadTunables();

function freshCtx(treatment, { detectLocation } = {}) {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed: 1 });
  let navigatedTo = null;
  return {
    ctx: {
      treatment,
      game,
      detectLocation,
      router: { navigate: (name) => { navigatedTo = name; } },
    },
    get navigatedTo() { return navigatedTo; },
  };
}

const TREATMENTS = ['incumbent', 'adjacent', 'far'];

for (const id of TREATMENTS) {
  test(`C2/R70: ${id}.json -- a not-permitted jurisdiction verdict renders its OWN outcome, carrying "not available in your region", not the under-18 copy`, async () => {
    const treatment = await loadTreatment(id);
    const { ctx } = freshCtx(treatment, { detectLocation: () => ({ permitted: false, region: 'XX' }) });
    mountScreener(ctx);
    const text = renderedText(document.getElementById('app'));
    assert.match(text.toLowerCase(), /not available in your region/, `${id}: expected the shipped "not available in your region" phrase in the rendered jurisdiction outcome`);
    assert.ok(!text.includes(treatment.copy.screenerRejectedMessage), `${id}: expected the jurisdiction outcome to NOT reuse the under-18 message`);
  });

  test(`C2/R70: ${id}.json -- the jurisdiction outcome never attributes the verdict to the player's "answers"`, async () => {
    const treatment = await loadTreatment(id);
    const { ctx } = freshCtx(treatment, { detectLocation: () => ({ permitted: false, region: 'XX' }) });
    mountScreener(ctx);
    const text = renderedText(document.getElementById('app'));
    assert.ok(!/under these answers|under your answers|based on your answers/i.test(text), `${id}: expected no answers-framing in the jurisdiction outcome, got: "${text}"`);
  });

  test(`C2/R70: ${id}.json -- the under-18 outcome renders its OWN copy, distinct from the jurisdiction outcome, and also carries no answers-framing`, async () => {
    const treatment = await loadTreatment(id);
    const { ctx } = freshCtx(treatment); // permitted jurisdiction (default)
    mountScreener(ctx);
    // Enter an under-18 DOB and press Continue.
    const dobInput = document.getElementById('app').querySelector('input');
    assert.ok(dobInput, 'expected a DOB <input> on the permitted-jurisdiction render');
    dobInput.dispatch('change', { target: { value: '2020-01-01' } });
    const continueBtn = document.getElementById('app').querySelectorAll('button').find((b) => renderedText(b) === 'Continue');
    assert.ok(continueBtn, 'expected a Continue button');
    continueBtn.dispatch('click');
    const text = renderedText(document.getElementById('app'));
    assert.ok(text.includes(treatment.copy.screenerRejectedMessage), `${id}: expected the under-18 outcome to render screenerRejectedMessage`);
    assert.ok(!text.toLowerCase().includes('not available in your region'), `${id}: expected the under-18 outcome to NOT carry the jurisdiction phrase`);
    assert.ok(!/under these answers|under your answers|based on your answers/i.test(text), `${id}: expected no answers-framing in the under-18 outcome either, got: "${text}"`);
  });

  test(`C2/R70: ${id}.json -- screenerNotAvailableMessage itself carries the shipped phrase (data-level, independent of rendering)`, async () => {
    const treatment = await loadTreatment(id);
    assert.match(treatment.copy.screenerNotAvailableMessage.toLowerCase(), /not available in your region/);
  });
}

test('C2/R70: sanity -- querySelectorAll returns a real array-like with .find (harness check)', async () => {
  const treatment = await loadTreatment('incumbent');
  const { ctx } = freshCtx(treatment);
  mountScreener(ctx);
  const buttons = document.getElementById('app').querySelectorAll('button');
  assert.ok(Array.isArray(buttons));
  assert.ok(buttons.length >= 1);
});
