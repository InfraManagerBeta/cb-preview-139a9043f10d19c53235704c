// app/tests/cb-build-011-redesign.test.js
// CB-BUILD-011 (targets R11/R79, R83): bring the move-choice screen to the
// design bar as one coherent redesign -- prominent clock (009), no scroll
// jump (010), clear disabled state (t2/CB-BUILD-008), prose copy in
// .cb-prose (not mono), an uncramped layout with room for a future
// scouting panel WITHOUT adding scouting content. Existing behaviour
// (tendency card, five rounds, seal flow, aria attributes, idempotency)
// must be unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const duelSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/duel.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(process.cwd(), 'app/styles/base.css'), 'utf8');
const buildBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('function selectMove'));

test('CB-BUILD-011: the redesigned screen still carries the prominent clock (009) and in-place selection (010)', () => {
  assert.ok(buildBody.includes("class: 'cb-topbar cb-commit-topbar'"), 'expected the sticky-pinned commit topbar (CB-BUILD-009) to still be present');
  assert.ok(buildBody.includes('cb-commit-clock'), 'expected the prominent clock class to still be present');
  assert.ok(buildBody.includes('onClick: () => selectMove(i, elName)'), 'expected move buttons to still wire selectMove (CB-BUILD-010), not a rebuild');
});

test('CB-BUILD-011: the disabled seal button still gets its clear state for free from the t2/CB-BUILD-008 CSS rule (no new disabled styling reinvented)', () => {
  assert.ok(buildBody.includes("'aria-disabled': isSealDisabled(moves)"), 'expected the seal button to still gate on aria-disabled');
  const rule = cssSrc.match(/\.cb-btn:disabled,\s*\.cb-btn\[aria-disabled="true"\]\s*\{[^}]+\}/s);
  assert.ok(rule && rule[0].includes('#5a5a50'), 'expected the existing t2 disabled-button rule (muted fill) to still exist and be reused, not duplicated');
});

test('CB-BUILD-011: player-facing sentences on this screen are set in .cb-prose (the prose face), never .cb-micro/.cb-data/mono', () => {
  // Every `el('p', ...)` on this screen must use .cb-prose -- a <p> is
  // exactly the "sentence a player reads" R11 targets, distinct from the
  // micro/data labels and tags used for the tendency stat row and round
  // headers (which stay data-face, per the existing convention elsewhere
  // in this file and the rest of the app).
  const pTagMatches = buildBody.match(/el\('p',\s*\{[^}]*\}/g) || [];
  assert.ok(pTagMatches.length >= 2, `expected at least 2 <p> elements on the commit screen (explainer + lead-in), found ${pTagMatches.length}`);
  for (const tag of pTagMatches) {
    assert.ok(/class:\s*'cb-prose/.test(tag), `expected every <p> on the commit screen to carry .cb-prose, found: ${tag}`);
  }
});

test('CB-BUILD-011: the layout is uncramped -- opponent panel and round-cards each sit in their own breathing-room section with real CSS gap', () => {
  assert.ok(buildBody.includes("class: 'cb-commit-opponent-panel'"), 'expected an opponent-panel wrapper section');
  assert.ok(buildBody.includes("class: 'cb-commit-rounds'"), 'expected a rounds wrapper section');
  const opponentRule = cssSrc.match(/\.cb-commit-opponent-panel\s*\{[^}]+\}/s);
  const roundsRule = cssSrc.match(/\.cb-commit-rounds\s*\{[^}]+\}/s);
  assert.ok(opponentRule && /gap:\s*\d+px/.test(opponentRule[0]), 'expected the opponent panel to declare a real gap (breathing room), not rely on ad-hoc margins');
  assert.ok(roundsRule && /gap:\s*\d+px/.test(roundsRule[0]), 'expected the rounds section to declare a real gap (breathing room)');
});

test('CB-BUILD-011: room for a future scouting panel exists in the opponent panel WITHOUT adding scouting/match-history content (the absolute boundary)', () => {
  assert.ok(buildBody.includes('renderScoutingAndBrief(ctx, opponentSeat, treatment)'), 'expected the pre-existing, hypothesis-gated scouting/brief slot to still render inside the opponent panel');
  // Boundary: no NEW deep opponent match-history/scouting copy anywhere in
  // this screen (case-insensitive scan for the forbidden concepts, outside
  // of the pre-existing, unmodified renderScoutingAndBrief function itself
  // and comments that merely document the boundary).
  const commitScreenSection = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('function tick()'));
  const codeOnly = commitScreenSection.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!/match[- ]history/i.test(codeOnly), 'expected no new "match history" scouting content added to the commit screen build');
  assert.ok(!/scouting report/i.test(codeOnly), 'expected no new "scouting report" content added to the commit screen build (that lives only in the pre-existing, gated renderScoutingAndBrief)');
});

test('CB-BUILD-011: existing behaviour is unchanged -- tendency card, five rounds, seal flow, aria attributes, idempotency', () => {
  assert.ok(buildBody.includes('OPPONENT TENDENCY'), 'expected the tendency card label to still render');
  assert.ok(buildBody.includes('tendencyLabel(opponentSeat.tendency)'), 'expected the tendency label helper to still be called');
  assert.ok(buildBody.includes('moves.map((mv, i) =>'), 'expected the five rounds to still be built from the moves array');
  assert.ok(buildBody.includes("'Seal Commitment'"), 'expected the seal button copy to be unchanged');
  assert.ok(buildBody.includes("'aria-disabled': isSealDisabled(moves)"), 'expected the seal button\'s aria-disabled gating to be unchanged');
  // Idempotency: the disconnect-safe resume-from-existing-commit path is
  // untouched (outside buildCommitScreen, but part of the same screen).
  assert.ok(duelSrc.includes('const existingCommit = window_.commits[humanSeatIndex];'));
  assert.ok(duelSrc.includes('queueMicrotask(() => commit(existingCommit.moves, existingCommit.hesitated));'));
});

test('CB-BUILD-011: no battle-stage, engine, or other-screen files were touched across CB-BUILD-009/010/011 (this lane\'s whole change set)', () => {
  // Diff the ticket's own commit range: its fork point (57a9f78 -- ticket t2
  // merged in, before this task's own work began) to its own last commit
  // (abb7331c -- CB-BUILD-011, this ticket's tip). Scoped to exactly the
  // range of CB-BUILD-009/010/011's own commits, rather than to the current
  // HEAD -- once this ticket lands in the shared lane, other tickets (t1,
  // t4, ...) may also sit between the same fork point and HEAD, and a
  // diff against a moving HEAD would wrongly attribute their files to this
  // ticket. Both endpoints are fixed commits reachable from history (the
  // second stays reachable via this merge commit's parent even after the
  // ticket branch ref is deleted), so this remains a stable check of only
  // what CB-BUILD-009/010/011 themselves touched.
  let changedFiles = [];
  try {
    changedFiles = execSync('git diff --name-only 57a9f78 abb7331c4150e19e46f01386913ccf09abbfba54', { cwd: process.cwd(), encoding: 'utf8' })
      .split('\n').map((f) => f.trim()).filter(Boolean);
  } catch {
    // Not a git checkout (e.g. a tarball export) -- skip rather than fail
    // spuriously; the other tests in this file already cover the same
    // ground via direct source inspection.
    return;
  }
  for (const f of changedFiles) {
    assert.ok(
      f === 'app/ui/screens/duel.js' || f === 'app/styles/base.css' || f.startsWith('app/tests/'),
      `expected CB-BUILD-009/010/011 to touch only duel.js, base.css, and new tests -- found: ${f}`
    );
    assert.ok(!f.startsWith('app/ui/components/battle/'), `must not touch battle-stage components (another live ticket): ${f}`);
  }
});
