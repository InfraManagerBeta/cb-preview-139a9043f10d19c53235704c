// app/tests/duel-screen-structure.test.js — f2/C8/A2/A4/A16/A17: static
// structural checks over the duel screen and its battle sub-components (no
// DOM available in this harness -- same static-scan approach as the
// existing R1/invariant-#8 tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

test('C8/R77: renderResultCard (rails.js) renders BOTH combatants\' before/after (not just the human\'s)', async () => {
  const src = await read('ui/components/battle/rails.js');
  assert.ok(src.includes('opponentStakeBefore') && src.includes('opponentStakeAfter'), 'expected renderResultCard to accept and render the opponent\'s before/after too');
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(duelSrc.includes('opponentStakeBefore: opponentCombatant.stakeBefore'), 'expected duel.js to pass the opponent\'s stakeBefore through to renderResultCard');
  assert.ok(duelSrc.includes('opponentStakeAfter: opponentCombatant.stakeAfter'), 'expected duel.js to pass the opponent\'s stakeAfter through to renderResultCard');
});

test('A2: the reveal loop no longer calls mountScreen() per timeline step -- buildShell() mounts once, updateFrame() patches containers in place', async () => {
  const src = await read('ui/screens/duel.js');
  // buildShell (called once per duel) is the only mountScreen call inside runPresentation's closures.
  const runPresentationBody = src.slice(src.indexOf('function runPresentation'), src.indexOf('function renderResult'));
  const codeOnly = runPresentationBody.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  const mountScreenCalls = (codeOnly.match(/mountScreen\(/g) || []).length;
  assert.equal(mountScreenCalls, 1, `expected exactly one mountScreen( call inside the reveal loop (in buildShell), found ${mountScreenCalls}`);
  assert.ok(runPresentationBody.includes('function buildShell'), 'expected a buildShell() that mounts the screen shell once');
  assert.ok(runPresentationBody.includes('function updateFrame'), 'expected an updateFrame() that patches containers instead of remounting');
  assert.ok(runPresentationBody.includes('.replaceChildren('), 'expected updateFrame to use targeted replaceChildren() patching, not a full remount');
});

test('A17: the commit screen\'s 500ms tick calls a targeted clock update, not a full rebuild', async () => {
  const src = await read('ui/screens/duel.js');
  const tickBody = src.slice(src.indexOf('function tick()'), src.indexOf('buildCommitScreen();\n  timerHandle'));
  assert.ok(tickBody.includes('updateClockDisplay()'), 'expected tick() to call updateClockDisplay() on the not-yet-expired branch');
  assert.ok(!/buildCommitScreen\(\)/.test(tickBody), 'tick() must not call buildCommitScreen() (a full rebuild) on every 500ms tick');
});

test('A4/R81: the intermission (createIntermission/intermissionOver) is wired into the duel screen, not dead code', async () => {
  const syncSrc = await read('engine/sync.js');
  assert.ok(syncSrc.includes('export function createIntermission'));
  assert.ok(syncSrc.includes('export function intermissionOver'));
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(duelSrc.includes('sync.createIntermission('), 'expected duel.js to call sync.createIntermission(...)');
  assert.ok(duelSrc.includes('sync.intermissionOver('), 'expected duel.js to call sync.intermissionOver(...)');
  assert.ok(duelSrc.includes('function showIntermission'), 'expected a showIntermission() screen function');
});

test('A16/R76: the tug bar renders a portrait -- bundle art for the incumbent, a treatment-colored monogram for the alternates', async () => {
  const tugbarSrc = await read('ui/components/battle/tugbar.js');
  assert.ok(tugbarSrc.includes('incumbentPortraitUrl'), 'expected the incumbent tug-bar portrait to use the bundle art');
  assert.ok(tugbarSrc.includes('monogramPortraitMarkup'), 'expected the alternates\' tug-bar portrait to be a treatment-colored monogram, not a bare icon');
  const assetsSrc = await read('ui/components/battle/assets.js');
  assert.ok(assetsSrc.includes('client-static/img/wizards/'), 'expected the incumbent portrait to point at the bundle\'s wizards portrait art');
});

test('C6/§15.8: both the tug bar and the battle stage carry isNpc through to the permanent NPC tag', async () => {
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(/isNpc:\s*opponentSeat\.kind === 'npc'/.test(duelSrc), 'expected duel.js to compute p2.isNpc from the opponent seat\'s kind');
  assert.ok(duelSrc.includes('isNpc: p2.isNpc'), 'expected duel.js to pass isNpc through to renderCombatant for the opponent side');
});

test('f4/N1: the T6 win card and the prize-award moment both derive their figures from the CHARACTER_ADVANCED payload, not an independent tierLadder lookup', async () => {
  const duelSrc = await read('ui/screens/duel.js');
  // The old bug: both call sites re-derived a `tierData` from
  // `tunables.tierLadder.tiers.find(...)` and read `.prizeCheddar` off it
  // directly -- disagreeing with the ledger's real T6 cash payout. Neither
  // call site should do that anymore.
  assert.ok(!/tierLadder\.tiers\.find/.test(duelSrc), 'expected duel.js to no longer look up tierLadder.tiers directly for display figures');
  assert.ok(duelSrc.includes('lastOutcome.characterAdvancedPayload'), 'expected duel.js to read the CHARACTER_ADVANCED payload resolveMatch returns');
  assert.ok(duelSrc.includes('renderPrizeAward({ candidate: step.candidate, treatment, winOutcome })'), 'expected the prize-award moment to be given the same winOutcome payload');
  assert.ok(duelSrc.includes('winCardOutcome.toppedOut'), 'expected the win card to branch on toppedOut and show the cash + stake-conversion lines');
  assert.ok(duelSrc.includes('winCardOutcome.payoutCashUSD') && duelSrc.includes('winCardOutcome.stakeCashedOutCheddar') && duelSrc.includes('winCardOutcome.stakeCashUSD'));

  const momentsSrc = await read('ui/components/battle/moments.js');
  assert.ok(momentsSrc.includes('export function renderPrizeAward({ candidate = 1, treatment, winOutcome })'), 'expected renderPrizeAward to take the winOutcome payload, not a bare prizeCheddar');
  assert.ok(momentsSrc.includes('winOutcome.payoutCashUSD') && momentsSrc.includes('winOutcome.stakeCashedOutCheddar') && momentsSrc.includes('winOutcome.stakeCashUSD'), 'expected the topped-out branch to render the real cash + stake-conversion figures');
});

test('f4/N2: the sitting screen\'s emptied-character branch shows the champion-specific line for a topped-out champion, the generic line otherwise', async () => {
  const src = await read('ui/screens/sitting.js');
  assert.ok(src.includes('character.toppedOutChampion'), 'expected sitting.js to branch on the topped-out-champion flag');
  assert.ok(src.includes('treatment.copy.emptiedChampionLine'), 'expected sitting.js to read the champion-specific copy line');
  assert.ok(src.includes('treatment.copy.emptiedCardLine'), 'expected the generic line to remain the fallback for a non-champion emptied character');
});

test('f4/A-a/A-b: the spectate button (sitting.js) and the screener Continue button both carry a submitting guard against a double-tap', async () => {
  const sittingSrc = await read('ui/screens/sitting.js');
  const spectateBody = sittingSrc.slice(sittingSrc.indexOf('function renderSpectateCard'));
  assert.ok(/let submitting = false/.test(spectateBody), 'expected renderSpectateCard to declare a submitting guard');
  assert.ok(/if \(submitting\) return;/.test(spectateBody), 'expected renderSpectateCard\'s onClick to check the submitting guard');
  assert.ok(/'aria-disabled':\s*submitting/.test(spectateBody), 'expected the spectate button to reflect the submitting guard visually');

  const screenerSrc = await read('ui/screens/screener.js');
  assert.ok(/let submitting = false/.test(screenerSrc), 'expected the screener to declare a submitting guard');
  assert.ok(/if \(submitting\) return;.*A-b/.test(screenerSrc) || /f4\/A-b/.test(screenerSrc), 'expected the screener\'s Continue handler to check the submitting guard');
  // CB-BUILD-001/R70: the completion gate is no longer "both checkboxes
  // checked" (there is no jurisdiction checkbox any more) -- it's
  // "canContinue" (DOB entered + the detected location verdict allows
  // play). The submitting guard itself is unchanged; only the gate's name
  // moved with the field it now gates.
  assert.ok(/!canContinue \|\| submitting/.test(screenerSrc), 'expected Continue\'s aria-disabled to also reflect the submitting guard');
});

test('f4/A-g: renderResult\'s logNarration call catches KillSwitchFrozenError and renders the stop banner instead of freezing on the reveal\'s last frame', async () => {
  const src = await read('ui/screens/duel.js');
  assert.ok(src.includes("import { KillSwitchFrozenError } from '../../engine/game.js';"), 'expected duel.js to import KillSwitchFrozenError');
  const renderResultBody = src.slice(src.indexOf('function renderResult('), src.indexOf('function showIntermission('));
  assert.ok(/try\s*{[\s\S]*?ctx\.game\.logNarration\(/.test(renderResultBody), 'expected logNarration to be called inside a try block');
  assert.ok(/catch \(err\) {\s*\n\s*if \(err instanceof KillSwitchFrozenError\) { renderKillStopBanner\(ctx\); return; }/.test(renderResultBody), 'expected the catch to check KillSwitchFrozenError specifically and render the stop banner');
  assert.ok(/throw err;/.test(renderResultBody), 'expected any OTHER error to still propagate (a catch-site, not a swallow-everything guard)');
});

test('f4/A-h: the PvE Fight handler catches KillSwitchFrozenError from resolvePveDuel and shows the stop banner instead of leaving the button stuck disabled with no feedback', async () => {
  const src = await read('ui/screens/pve.js');
  assert.ok(src.includes("import { KillSwitchFrozenError } from '../../engine/game.js';"), 'expected pve.js to import KillSwitchFrozenError');
  const fightHandlerBody = src.slice(src.indexOf("onClick: () => {\n          if (moves.some"));
  assert.ok(/try\s*{\s*\n\s*result = ctx\.game\.resolvePveDuel\(/.test(fightHandlerBody), 'expected resolvePveDuel to be called inside a try block');
  assert.ok(/catch \(err\) {\s*\n\s*if \(err instanceof KillSwitchFrozenError\) { renderKillStopBanner\(ctx\); return; }/.test(fightHandlerBody), 'expected the catch to check KillSwitchFrozenError specifically and render the stop banner');
  assert.ok(/throw err;/.test(fightHandlerBody), 'expected any OTHER error to still propagate');
});

test('f4/A-g/A-h: both catch-sites reuse the SAME shared stop-banner helper (components/chrome.js:renderKillStopBanner), not two independently duplicated banners', async () => {
  const chromeSrc = await read('ui/components/chrome.js');
  assert.ok(chromeSrc.includes('export function renderKillStopBanner'), 'expected a shared, exported renderKillStopBanner');
  const duelSrc = await read('ui/screens/duel.js');
  const pveSrc = await read('ui/screens/pve.js');
  assert.ok(duelSrc.includes("renderKillStopBanner } from '../components/chrome.js'") || /renderKillStopBanner/.test(duelSrc));
  assert.ok(pveSrc.includes("renderKillStopBanner } from '../components/chrome.js'") || /renderKillStopBanner/.test(pveSrc));
  const appSrc = await read('ui/app.js');
  assert.ok(appSrc.includes('renderKillStopBanner'), 'expected app.js\'s own fresh-route-mount kill banner to reuse the same shared helper too');
});

// ---- f7/N1: a legacy (rounds-free) reconstructed duel skips the ----------
// round-by-round presentation and renders a summary-only result card ------

test('f7/N1: commit() checks result.replayUnavailable and skips runPresentation() for a legacy (rounds-free) reconstructed duel, going straight to renderResult()', async () => {
  const src = await read('ui/screens/duel.js');
  const commitBody = src.slice(src.indexOf('function commit('), src.indexOf('function runPresentation('));
  assert.ok(commitBody.includes('result.replayUnavailable'), 'expected commit() to branch on result.replayUnavailable');
  assert.ok(/if \(result\.replayUnavailable\) {\s*\n\s*phase = 'result';\s*\n\s*renderResult\(\);/.test(commitBody), 'expected the legacy branch to skip straight to renderResult()');
  assert.ok(/} else {\s*\n\s*phase = 'reveal';\s*\n\s*runPresentation\(\);/.test(commitBody), 'expected the normal branch to still run the full presentation');
});

test('f7/N1: renderResult() skips buildMatchData/generateNarration/logNarration for a legacy duel and renders a plain one-line notice instead, without touching the result card or coin-flip verification', async () => {
  const src = await read('ui/screens/duel.js');
  const renderResultBody = src.slice(src.indexOf('function renderResult('), src.indexOf('function showIntermission('));
  assert.ok(renderResultBody.includes('lastOutcome.replayUnavailable'), 'expected renderResult() to branch on lastOutcome.replayUnavailable');
  assert.ok(renderResultBody.includes('Round-by-round replay is unavailable for this pre-upgrade duel.'), 'expected the plain one-line notice');
  // The legacy branch must NOT call buildMatchData/generateNarration/logNarration.
  const legacyBranch = renderResultBody.slice(renderResultBody.indexOf('if (lastOutcome.replayUnavailable) {'), renderResultBody.indexOf('} else {'));
  assert.ok(!legacyBranch.includes('buildMatchData('), 'expected the legacy branch to skip buildMatchData (needs outcome.rounds)');
  assert.ok(!legacyBranch.includes('generateNarration('), 'expected the legacy branch to skip generateNarration');
  assert.ok(!legacyBranch.includes('logNarration('), 'expected the legacy branch to skip logNarration');
  // renderResultCard/coin-flip verification/win-card are unconditional --
  // rendered exactly the same regardless of replayUnavailable.
  assert.ok(renderResultBody.includes('renderResultCard({'), 'expected renderResultCard to still render for a legacy duel (summary fields only)');
  assert.ok(renderResultBody.includes('renderCoinFlipVerification(outcome)'));
});

test('f4/A-i: duel.js registers ctx.router.onUnmount at all three timer sites (commit tick / reveal timeouts sharing timerHandle, and the intermission interval)', async () => {
  const src = await read('ui/screens/duel.js');
  const onUnmountCalls = src.match(/ctx\.router\.onUnmount\(/g) || [];
  assert.equal(onUnmountCalls.length, 2, `expected exactly 2 onUnmount registrations (one covering timerHandle for commit+reveal, one for intermissionTimer), found ${onUnmountCalls.length}`);
  // f5/A3: the mount-time registration also stops every battle sound on
  // unmount now (stopAll()) -- updated from the bare two-clear-calls form.
  assert.ok(/ctx\.router\.onUnmount\(\(\) => { clearInterval\(timerHandle\); clearTimeout\(timerHandle\); stopAll\(\); }\);/.test(src), 'expected the mount-time registration to clear timerHandle via both clear functions AND stop all battle sound');
  assert.ok(/ctx\.router\.onUnmount\(\(\) => clearInterval\(intermissionTimer\)\);/.test(src), 'expected showIntermission to re-register its own teardown for intermissionTimer');
});

test('f5/A3: unmounting the duel screen stops every battle sound (sound.stopAll()) -- no lingering loop/intro/beat audible after navigating away', async () => {
  const src = await read('ui/screens/duel.js');
  assert.ok(src.includes("import { isSoundEnabled, setSoundEnabled, playIntro, playLoop, stopLoop, playRoundBeat, stopAll } from '../components/battle/sound.js';"), 'expected duel.js to import stopAll from the battle sound module');
  const teardownLine = src.split('\n').find((l) => l.includes('ctx.router.onUnmount') && l.includes('timerHandle'));
  assert.ok(teardownLine && teardownLine.includes('stopAll()'), 'expected the mount-time onUnmount teardown to call stopAll()');
});

test('f4/A-i: app/ui/router.js exports the onUnmount mechanism duel.js relies on', async () => {
  const src = await read('ui/router.js');
  assert.ok(src.includes('onUnmount(fn)'), 'expected createRouter to return an onUnmount(fn) registration function');
  assert.ok(/if \(unmountCurrent\)/.test(src), 'expected render() to check for and invoke a pending teardown before mounting the next screen');
});

test('f4/A-l: the coin-flip verification fold states the honest gap to "provably fair" -- verifiable after the fact, the seed is house-generated', async () => {
  const src = await read('ui/screens/duel.js');
  const foldBody = src.slice(src.indexOf('function renderCoinFlipVerification'), src.indexOf('function renderCoinFlipVerification') + 2500);
  assert.ok(/AFTER THE FACT/.test(foldBody), 'expected the fold to state the verification is only after-the-fact');
  assert.ok(/house-generated/i.test(foldBody), 'expected the fold to name the seed as house-generated, not player-supplied');
  assert.ok(/does not prove the seed was chosen fairly/i.test(foldBody), 'expected the fold to state the actual gap plainly, not just imply "provably fair"');
});

test('f5/A4: lobby.js registers ctx.router.onUnmount clearing its 300ms tick interval -- no ledger appends (SYNC_NPC_SEATED) or forced navigation to \'duel\'/\'landing\' after leaving the screen', async () => {
  const src = await read('ui/screens/lobby.js');
  assert.ok(src.includes('timer = setInterval(tick, 300);'), 'expected the 300ms tick interval to still be set up as before');
  assert.ok(/ctx\.router\.onUnmount\(\(\) => clearInterval\(timer\)\);/.test(src), 'expected an onUnmount registration clearing the SAME `timer` variable');
  // The registration must appear AFTER the interval is assigned (so
  // `timer` is defined when the teardown closes over it) and before the
  // trailing `tick()` kick-off call, matching duel.js's own established
  // teardown-registration placement.
  const setIdx = src.indexOf('timer = setInterval(tick, 300);');
  const unmountIdx = src.indexOf('ctx.router.onUnmount(() => clearInterval(timer));');
  assert.ok(setIdx > -1 && unmountIdx > setIdx, 'expected the onUnmount registration to appear after the interval is assigned');
});

