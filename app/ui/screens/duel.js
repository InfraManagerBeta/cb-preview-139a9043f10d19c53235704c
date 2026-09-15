// app/ui/screens/duel.js — R52/R53/R81: five moves sealed and committed
// together per duel; commit window with visible clock; the R74-R77 battle
// presentation timeline; result card per R77.
import { mountScreen, el, cheddar, money } from '../components/dom.js';
import * as bracketEngine from '../../engine/bracket.js';
import * as sync from '../../engine/sync.js';
import * as economy from '../../engine/economy.js';
import { tendencyLabel } from '../../engine/npc.js';
import { buildMatchData, generateNarration, generatePreMatchBrief } from '../../engine/narrator.js';
import { elementIndex, reorientOutcome, deterministicFlipFromSeed } from '../../engine/duel.js';
import { buildDuelTimeline, preRoundHoldMs } from '../../engine/presentationTimeline.js';
import { projectedAfterRound } from '../../engine/duelProjection.js';
import { loadOverrides, effectiveHypothesisId } from '../../engine/overrides.js';
import { opponentDuelHistory, summarizeOpponentHistory, hypothesisCard } from '../../engine/hypotheses.js';
import { renderTugBar } from '../components/battle/tugbar.js';
import { renderCombatant, renderAffinityFx, createBattleStage, destroyActiveBattleStage } from '../components/battle/stage.js';
import { arenaSources } from '../components/battle/assets.js';
import { createShapeLoader } from '../components/battle/shapes.js';
import { renderRail, renderRoundCards, renderResultCard } from '../components/battle/rails.js';
import { renderFloorDrain, renderCoinFlip, renderPrizeAward } from '../components/battle/moments.js';
import { isSoundEnabled, setSoundEnabled, playIntro, playLoop, stopLoop, playRoundBeat, stopAll } from '../components/battle/sound.js';
// CB-BUILD-005: the reference implementation's own sound schedule (intro →
// loop at +1.8s → round voices; per-round beats at the attack, offsets per
// reference/DuelPlayer/soundManager.js) and the audio-bed preload.
import { preloadDuelAudio, scheduleDuelStart, scheduleRoundStart } from '../components/battle/sound.js';
import { truthBadge, compactMoneyTruth, renderKillStopBanner } from '../components/chrome.js';
import { KillSwitchFrozenError } from '../../engine/game.js';

// CB-BUILD-005/006: one shared shape-library loader for the whole session --
// its cache persists across duels, so a rematch preloads from memory and
// never re-fetches a wizard it already carries.
const shapeLoader = createShapeLoader();

/**
 * C13/O3/R26 cards 1 & 2 ("Scouting reports" / "Pre-match Narrator brief"):
 * each renders ONLY when its own hypothesis is the ACTIVE one (O3) --
 * both derive from the SAME real ledger history (engine/hypotheses.js), so
 * the panel and the brief never disagree with each other.
 */
function renderScoutingAndBrief(ctx, opponentSeat, treatment) {
  const activeId = effectiveHypothesisId(loadOverrides());
  if (activeId !== 'scouting_reports' && activeId !== 'prematch_brief') return null;
  const ledgerEvents = ctx.game.ledger.all();
  const history = opponentDuelHistory(ledgerEvents, opponentSeat.characterId, 10);
  const summary = summarizeOpponentHistory(history);
  const card = hypothesisCard(activeId);
  // CB-BUILD-fix-round-2 (re-review B): the fair-test line is a participant
  // sentence (R11) — the SAME string already wears the prose face on
  // sitting/lobby-entry/pve; this site now matches them exactly.
  const rows = [el('p', { class: 'cb-prose cb-prose-small' }, card.fairTestLine)];

  if (activeId === 'scouting_reports') {
    rows.push(el('div', { class: 'cb-micro' }, `${opponentSeat.name}: ${summary.wins}-${summary.losses}${summary.ties ? ` (${summary.ties} tie${summary.ties === 1 ? '' : 's'})` : ''} over the last ${summary.count} staked duel${summary.count === 1 ? '' : 's'}.`));
    rows.push(el('div', { class: 'cb-micro' }, `Affinity-play rate: ${Math.round(summary.avgAffinityPlayRate * 100)}%.`));
    // f7/N2: LAW R26(1) ("elements played by round") -- per past duel,
    // compact. `playedByRound`/`facedByRound` come from hypotheses.js's
    // opponentDuelHistory, which itself falls back to `null` (summary-only,
    // honestly marked via `roundsAvailable`) for a legacy (pre-f6)
    // rounds-free event -- rendered as a one-line notice per row instead of
    // a fabricated per-round guess.
    // f8/advisory-6: an opponent with NO prior duel history (every
    // quarterfinal NPC on this single-device build -- see
    // docs/retention-manifest.md card 1 -- reaches 0 rows every time) must
    // not render a "PER-ROUND" header over an empty list.
    if (history.length) {
      rows.push(el('div', { class: 'cb-micro' }, 'PER-ROUND (most recent first):'));
    }
    for (const h of history.slice(0, 5)) {
      const outcomeLetter = h.won ? 'W' : h.tie ? 'T' : 'L';
      const line = h.roundsAvailable
        ? `${outcomeLetter} \u00b7 ${h.playedByRound.join('/')} vs ${h.facedByRound.join('/')}`
        : `${outcomeLetter} \u00b7 round-by-round unavailable (pre-upgrade duel)`;
      rows.push(el('div', { class: 'cb-micro' }, line));
    }
  } else if (activeId === 'prematch_brief') {
    const brief = generatePreMatchBrief(opponentSeat.name, summary, { register: treatment.id });
    rows.push(el('p', { class: 'cb-narration', style: 'color:var(--cb-narrator-accent, var(--cb-teal));' }, brief.text));
  }

  return el('div', { class: 'cb-card' }, rows);
}

/**
 * C22/R54: the "provably fair" coin-flip verification surface. Only shown
 * for a true-tie duel (the only case a flip happened at all). Shows the
 * commitment (recorded BEFORE the flip) and the revealed seed, plain-
 * language recompute instructions, and a one-tap re-verify that
 * independently recomputes SHA-256(seed) via the browser's real Web Crypto
 * (`crypto.subtle.digest`) -- deliberately a SEPARATE implementation from
 * the engine's own synchronous sha256Hex (app/engine/duel.js), so a match
 * here is real, independent confirmation, not a tautology.
 */
function renderCoinFlipVerification(outcome) {
  if (!outcome.trueTie || !outcome.coinFlip) return null;
  const { seed, commitment } = outcome.coinFlip;
  // CB-BUILD-fix-round-4 (R11): the verdict line receives full sentences at
  // runtime ("✓ Verified — …" / "✗ Mismatch — …"), so it wears the prose
  // face like its four sibling lines in this card.
  const resultLine = el('div', { class: 'cb-prose cb-prose-small', style: 'margin-top:6px;' }, '');
  return el('details', { class: 'cb-card' }, [
    el('summary', {}, 'Verify this coin flip'),
    el('p', { class: 'cb-prose cb-prose-small' }, `Commitment (recorded BEFORE the flip): ${commitment}`),
    el('p', { class: 'cb-prose cb-prose-small' }, `Revealed seed (AFTER the flip): ${seed}`),
    el('p', { class: 'cb-prose cb-prose-small' }, 'Recompute: SHA-256(seed) must equal the commitment above; the flip itself is a fixed function of the seed alone (the first hex digit of SHA-256(seed): even => this side, odd => the other side).'),
    // f4/A-l: one honest sentence naming the actual gap to "provably
    // fair" -- this recomputation proves the flip wasn't changed AFTER
    // the commitment was recorded; it does NOT prove the seed itself was
    // chosen fairly, since the seed is house-generated (this.random,
    // server/app-side), not supplied or influenced by the player. Stated
    // plainly rather than left implied by the "provably fair" framing
    // elsewhere (this module's own header comment, in quotes, for
    // exactly this reason).
    el('p', { class: 'cb-prose cb-prose-small' }, 'Honest limit: this is verifiable AFTER THE FACT — it proves the flip was not changed once committed. It does not prove the seed was chosen fairly: the seed itself is house-generated, not supplied by you.'),
    el('button', {
      class: 'cb-btn secondary block',
      onClick: async () => {
        resultLine.textContent = 'Verifying…';
        try {
          const digestBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
          const recomputed = Array.from(new Uint8Array(digestBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
          const commitmentOk = recomputed === commitment;
          const flipOk = deterministicFlipFromSeed(seed) === outcome.coinFlipWinner;
          resultLine.textContent = commitmentOk && flipOk
            ? '\u2713 Verified — the commitment and the flip both recompute exactly from the revealed seed.'
            : '\u2717 Mismatch — this does not recompute; something was tampered with.';
        } catch {
          resultLine.textContent = 'Could not verify in this browser (Web Crypto unavailable).';
        }
      },
    }, 'Re-verify (Web Crypto)'),
    resultLine,
  ]);
}

// CB-BUILD-009 (R81): the commit clock shifts to the danger color once
// under this many milliseconds remain (~10s, per the master rule's "as it
// nears zero (~under 10s)"). A pure, exported predicate so the exact
// threshold is unit-testable without a DOM.
export const COMMIT_CLOCK_DANGER_MS = 10000;

export function isClockDanger(remainingMs, thresholdMs = COMMIT_CLOCK_DANGER_MS) {
  return remainingMs <= thresholdMs;
}

// CB-BUILD-009 (R81): "the player's own selections are kept; only unpicked
// rounds are filled, uniform-random" -- a pure, exported merge so the
// auto-commit fill rule is unit-testable without a DOM. `moves` is the
// five-slot array of element NAMES (or null) the commit screen tracks;
// `toIndex` converts a chosen name to its element index (engine/duel.js's
// elementIndex); `random` is injectable for a deterministic test.
export function computeAutoCommitMoves(moves, toIndex, random = Math.random) {
  return moves.map((mv) => (mv != null ? toIndex(mv) : Math.floor(random() * 3)));
}

// CB-BUILD-010/§12-R83: the seal button is disabled exactly when some round
// is still unpicked -- a pure predicate shared by the initial build AND the
// in-place update (updateSealButtonState), so both agree by construction.
export function isSealDisabled(moves) {
  return moves.some((m) => m == null);
}

// CB-BUILD-010/§12-R83: a move tap must mutate ONLY the tapped round's own
// three buttons (toggling `selected`) -- never the other four rounds, and
// never a full screen rebuild. `roundButtons` is a { fire, water, air } map
// of that round's three button-like objects (anything with a
// `classList.toggle(name, cond)`, so this is unit-testable against plain
// fakes, no real DOM required).
export function applyRoundSelectionClasses(roundButtons, elements, chosenElement) {
  for (const name of elements) {
    const btn = roundButtons[name];
    if (btn) btn.classList.toggle('selected', name === chosenElement);
  }
}

// CB-BUILD-fix-round-1 #8: the incumbent's preload gate is BOUNDED. The gate
// itself (preload EVERYTHING, then play — R74) stands; what was missing was
// any timeout/cancel: one stalled bucket (a fetch that never settles)
// stranded the player on "SUMMONING COMBATANTS…" forever, AFTER the ledger
// had already resolved the duel, with no navigation out. A gate that outlives
// this budget degrades to the EXISTING stageFailed path (the dark
// provisional field — the duel stays watchable and completable, the result
// card stays reachable). This is a presentation-layer tunable-style
// constant, NOT a spec/economy/gate-threshold constant.
export const STAGE_PRELOAD_TIMEOUT_MS = 10000;

/** Race a preload promise against the timeout. Resolves (never rejects) with
 * `{ ok, timedOut }`: ok=true only when the preload itself fulfilled in
 * time; a rejection or a timeout is ok=false (the caller degrades). Timer
 * functions are injectable so the bound is unit-testable without real time
 * or a DOM. */
export function boundStagePreload(preloadPromise, { timeoutMs = STAGE_PRELOAD_TIMEOUT_MS, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    const handle = setTimeoutFn(() => finish({ ok: false, timedOut: true }), timeoutMs);
    Promise.resolve(preloadPromise).then(
      () => { clearTimeoutFn(handle); finish({ ok: true, timedOut: false }); },
      () => { clearTimeoutFn(handle); finish({ ok: false, timedOut: false }); }
    );
  });
}

export function mountDuel(ctx) {
  const { treatment, tunables } = ctx;
  let session = ctx.refreshSession();
  let { bracketId, bracket, humanSeatIndex, activeCharacterId } = session;
  if (!bracket || humanSeatIndex == null) { ctx.router.navigate('lobby-entry'); return; }

  const character = ctx.game.snapshot().characters[activeCharacterId];
  if (!character || character.state !== 'ACTIVE') {
    ctx.router.navigate(character && character.state === 'SITTING' ? 'sitting' : 'bracket-board');
    return;
  }

  // Auto-resolve every other pending match in the current round first (the
  // rest of the bracket plays out live on the board — R81).
  autoResolveOthers();

  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  if (!match) {
    // Human's seat has no pending match: either eliminated earlier or the
    // bracket is fully complete either way, the board is the right screen.
    ctx.router.navigate('bracket-board');
    return;
  }

  const opponentSeatIndex = match.seatA === humanSeatIndex ? match.seatB : match.seatA;
  const opponentSeat = bracket.seats[opponentSeatIndex];

  function autoResolveOthers() {
    let guard = 0;
    while (guard++ < 20) {
      const pending = bracketEngine.pendingMatches(bracket).filter((m) => m.seatA !== humanSeatIndex && m.seatB !== humanSeatIndex);
      if (pending.length === 0) break;
      for (const m of pending) {
        ctx.game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: null });
      }
      ctx.patchSession({ bracket });
      // if the human's match still doesn't exist and bracket isn't complete, the round moved on; loop again
      if (bracket.complete || bracketEngine.pendingMatches(bracket).some((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex)) break;
    }
  }

  const ELEMENTS = ['fire', 'water', 'air'];
  const moves = [null, null, null, null, null];
  let window_ = ctx.session.commitWindow;
  if (!window_ || window_.matchKey !== `${match.roundIndex}-${match.matchIndex}`) {
    window_ = sync.createCommitWindow(tunables, Date.now());
    window_.matchKey = `${match.roundIndex}-${match.matchIndex}`;
    ctx.patchSession({ commitWindow: window_ });
  }

  let timerHandle = null;
  let phase = 'commit';
  let lastOutcome = null;
  let lastNarration = null;

  // f4/A-i fix: `timerHandle` drives BOTH the commit-window's 500ms tick
  // (below) and the reveal's setTimeout chain (runPresentation) -- the
  // SAME outer variable, reused across phases. Registering ONE teardown
  // callback here, closing over `timerHandle` by reference (not by
  // value), covers whichever of the two is actually live at the moment a
  // navigation away from this screen happens: the router (router.js)
  // calls and clears whatever was last registered here BEFORE mounting
  // the next screen, on every navigation -- an explicit `ctx.router.
  // navigate(...)` call, the browser back/forward buttons, or a reload.
  // Previously nothing cleared this timer on navigation at all: a stale
  // tick interval kept firing in the background after leaving the
  // screen, and once the commit deadline passed it would still call
  // `sync.autoCommitHesitated` + `commit(...)` -- a real ledger mutation
  // for a screen the player is no longer looking at (see
  // duel-teardown.test.js for the reproduction).
  // A3: unmounting the duel screen also stops every battle sound --
  // otherwise a lingering loop/intro/beat sample kept playing after
  // navigating away (an explicit navigate, back/forward, or a reload),
  // audible over whatever screen the player is actually looking at now.
  ctx.router.onUnmount(() => { clearInterval(timerHandle); clearTimeout(timerHandle); stopAll(); });

  // A17 fix (f2): `renderCommit()` used to be called on every 500ms tick,
  // tearing down and rebuilding the ENTIRE screen just to update the clock
  // (`mountScreen` clears `#app` and re-creates every node). Now the commit
  // screen is built ONCE (`buildCommitScreen`, called on mount and again
  // only on a real move-selection change, a user-initiated, infrequent
  // event); the 500ms tick (`tick()` below) calls `updateClockDisplay()`
  // instead, which mutates only the timer text node it kept a reference to.
  // A pressed move-selection button is therefore the SAME DOM node across
  // ticks -- nothing rebuilds it out from under the user.
  let commitTimerNode = null;

  // CB-BUILD-010: persistent references to the per-round move buttons and
  // the seal button, so a move tap can mutate them in place instead of
  // rebuilding the screen (see selectMove()/updateSealButtonState() below).
  let roundButtonRefs = [];
  let sealButtonNode = null;

  // Disconnect-safe: a sealed commit stands. If this device already sealed a
  // commit for this exact match (e.g. before a reload), resolve with it
  // rather than asking again.
  const existingCommit = window_.commits[humanSeatIndex];
  if (existingCommit) {
    queueMicrotask(() => commit(existingCommit.moves, existingCommit.hesitated));
  }

  function buildCommitScreen() {
    const remainingMs = Math.max(0, window_.deadline - Date.now());
    // CB-BUILD-009/R81: promoted from a small `cb-timer cb-data` span to a
    // large, persistent `cb-commit-clock` -- never a small data span (see
    // base.css: display-face, large size, a `.danger` modifier that shifts
    // the color as it nears zero).
    commitTimerNode = el('span', { class: 'cb-commit-clock', 'data-danger': isClockDanger(remainingMs) ? 'true' : 'false' }, `${Math.ceil(remainingMs / 1000)}s`);
    applyClockDangerState(remainingMs);
    mountScreen([
      // CB-BUILD-009/R81: `cb-commit-topbar` pins this row (logo + the
      // clock) in view for the whole selection (base.css: position:
      // sticky) -- the clock is never scrolled out of sight while picking
      // moves across five round cards.
      el('div', { class: 'cb-topbar cb-commit-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark), commitTimerNode]),
      // CB-BUILD-009/R81: stated BEFORE the clock runs low (rendered from
      // the first frame, not conditionally near zero) what happens at
      // zero -- the player's own selections are kept, only the unpicked
      // rounds fill uniform-random, and the duel is flagged "hesitated".
      // Prose content (R11): a sentence a player reads is set in the
      // prose face, not the data/mono face.
      el('p', { class: 'cb-prose cb-commit-explainer' }, 'If the clock runs out, your own picks stay locked in — only the rounds you haven\u2019t chosen yet are filled at random, and this duel is flagged \u201chesitated\u201d.'),
      el('h2', {}, `${character.name} vs ${opponentSeat.name}`),
      // CB-BUILD-011/R11-R79: the opponent panel groups the tendency card
      // with whatever scouting/pre-match-brief card is active (below), an
      // uncramped section with visual room for a future scouting panel to
      // slot into -- renderScoutingAndBrief already renders nothing when
      // its hypothesis card is inactive (this is the "room in the layout",
      // not new scouting CONTENT; deep opponent match-history stays an
      // unresolved product tension, out of this build's scope).
      el('div', { class: 'cb-commit-opponent-panel' }, [
        el('div', { class: 'cb-card' }, [
          el('div', { class: 'cb-micro' }, 'OPPONENT TENDENCY'),
          el('div', { class: 'cb-data', style: 'margin-top:4px;' }, [
            `${opponentSeat.name} `,
            opponentSeat.kind === 'npc' ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
          ]),
          el('div', { class: 'cb-micro', style: 'margin-top:6px;' }, opponentSeat.tendency ? `F/W/A ${tendencyLabel(opponentSeat.tendency)}` : ''),
        ]),
        renderScoutingAndBrief(ctx, opponentSeat, treatment),
      ]),
      // CB-BUILD-011/R11-R79: a plain-language prose lead-in (the prose
      // face, not mono/data -- R11: every sentence a player reads) above
      // the five round cards, which now sit in their own uncramped,
      // breathing-room section (`cb-commit-rounds`) instead of running
      // straight on from the opponent panel.
      el('p', { class: 'cb-prose' }, 'Pick a move for each of the five rounds below, then seal your commitment.'),
      el('div', { class: 'cb-commit-rounds' }, moves.map((mv, i) => {
        // CB-BUILD-010/§12-R83: each round's three buttons are built ONCE
        // here and kept in `roundButtonRefs[i]` -- a move tap
        // (`selectMove` below) mutates only THOSE three buttons and the
        // seal button in place; it no longer calls buildCommitScreen() (a
        // full mountScreen() remount, which resets scroll to the top --
        // see mountScreen's `window.scrollTo(0, 0)`). Scroll position is
        // therefore preserved across a selection, exactly as the A17 fix
        // already does for the timer.
        roundButtonRefs[i] = {};
        // CB-BUILD-fix-round-1 #2: this card's class was `cb-round-card`,
        // which COLLIDES with battle.css's reveal-side `.cb-round-card`
        // (mono flex row, 6px padding — battle.css loads after base.css per
        // index.html), re-cramping the commit screen and killing
        // CB-BUILD-011's breathing room. The commit screen now uses its own
        // `cb-commit-round-card` class; the reveal side's `.cb-round-card`
        // (rails.js + battle.css) stays untouched.
        return el('div', { class: 'cb-card cb-commit-round-card' }, [
          el('div', { class: 'cb-micro' }, `ROUND ${i + 1}`),
          el('div', { class: 'cb-element-row' }, ELEMENTS.map((elName) => {
            const btn = el('button', {
              class: `cb-element-btn${moves[i] === elName ? ' selected' : ''}${elName === character.element ? ' affinity' : ''}`,
              'data-el': elName,
              onClick: () => selectMove(i, elName),
            }, treatment.elements[elName].label);
            roundButtonRefs[i][elName] = btn;
            return btn;
          })),
        ]);
      })),
      (sealButtonNode = el('button', {
        class: 'cb-btn block',
        'aria-disabled': isSealDisabled(moves),
        onClick: () => { if (!isSealDisabled(moves)) commit(moves.map(elementIndex), false); },
      }, 'Seal Commitment')),
    ]);
  }

  // CB-BUILD-010/§12-R83: a move tap mutates only the tapped round's three
  // buttons (toggling `selected`) and the seal button's disabled state, IN
  // PLACE -- never rebuilding the screen (no buildCommitScreen()/mountScreen()
  // call here, so scroll position holds exactly where the player left it).
  function selectMove(i, elName) {
    moves[i] = elName;
    if (roundButtonRefs[i]) applyRoundSelectionClasses(roundButtonRefs[i], ELEMENTS, elName);
    updateSealButtonState();
  }

  // CB-BUILD-010: the seal button's disabled state updates in place (the
  // same node the screen mounted once), not via a rebuild. The muted-fill
  // disabled look (t2/CB-BUILD-008) comes free from `.cb-btn[aria-disabled="true"]`
  // in base.css -- toggling the attribute is all that's needed here.
  function updateSealButtonState() {
    if (!sealButtonNode) return;
    if (isSealDisabled(moves)) sealButtonNode.setAttribute('aria-disabled', 'true');
    else sealButtonNode.removeAttribute('aria-disabled');
  }

  // A17: the targeted per-tick update -- touches only the timer text node.
  // CB-BUILD-009: also re-applies the danger-color state as time runs down
  // (still a targeted mutation, no rebuild).
  function updateClockDisplay() {
    if (!commitTimerNode) return;
    const remainingMs = Math.max(0, window_.deadline - Date.now());
    commitTimerNode.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    applyClockDangerState(remainingMs);
  }

  // CB-BUILD-009/R81: the clock shifts to the danger color (and, optionally,
  // pulses) as it nears zero (~under 10s) -- `isClockDanger` is the single
  // shared, unit-tested threshold check.
  function applyClockDangerState(remainingMs) {
    if (!commitTimerNode) return;
    const danger = isClockDanger(remainingMs);
    commitTimerNode.classList.toggle('danger', danger);
    commitTimerNode.classList.toggle('pulse', danger);
    commitTimerNode.setAttribute('data-danger', danger ? 'true' : 'false');
  }

  // C16/AC0: the kill switch must stop an in-flight duel -- not just gate
  // navigation between screens. Checked here (before any commit/resolve)
  // AND inside Game#resolveMatch itself (guarded at the Game layer so any
  // OTHER caller, e.g. f2's console/simulator, inherits the freeze too).
  // On kill: no auto-commit, no resolution, no stake transfer -- the
  // bracket is VOIDED (every character keeps the stake it held at this
  // instant) and the router's own kill-switch check shows the stop banner
  // on the next navigation.
  function handleKillMidDuel() {
    clearInterval(timerHandle);
    ctx.game.voidBracketOnKill({ bracketId, bracket, now: Date.now() });
    ctx.patchSession({ bracketId: null, bracket: null, humanSeatIndex: null, commitWindow: null });
    ctx.router.navigate('landing');
  }

  function commit(moveIndices, hesitated) {
    if (ctx.game.isKilled()) { handleKillMidDuel(); return; }
    clearInterval(timerHandle);
    sync.recordCommit(window_, humanSeatIndex, moveIndices, Date.now());
    const result = ctx.game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: moveIndices, hesitated, now: Date.now() });
    lastOutcome = result;
    ctx.patchSession({ bracket, commitWindow: null, lastResult: result });
    // f7/N1: a legacy (pre-f6) reconstructed duel (game.js's
    // `replayUnavailable` flag -- e.g. a sealed commit from before this
    // build existed, replayed on a plain same-tab reload) has no
    // round-by-round detail to animate at all -- buildDuelTimeline and
    // every rail/round-card consumer assume a real `outcome.rounds` array.
    // Skip the presentation entirely and go straight to the summary-only
    // result card (renderResult below already degrades gracefully for this
    // case) rather than let the timeline builder throw on `.rounds` of null.
    if (result.replayUnavailable) {
      phase = 'result';
      renderResult();
    } else {
      phase = 'reveal';
      runPresentation();
    }
  }

  // ---- R74/R75/R76/R77: the battle presentation timeline -------------------

  function runPresentation() {
    const outcome = reorientOutcome(lastOutcome.outcome, lastOutcome.humanIsSeatA);
    const combatant = lastOutcome.combatants.find((c) => c.characterId === character.id);
    const opponentCombatant = lastOutcome.combatants.find((c) => c.characterId !== character.id);
    const floor = economy.floorForTier(tunables, character.tier);
    const cadenceMs = tunables.timers.revealCadenceMs.default;
    const overrides = loadOverrides();
    const bracketComplete = lastOutcome.bracketComplete && lastOutcome.humanWon;
    // f4/N1: read the SAME payload the CHARACTER_ADVANCED ledger event
    // carries (app/engine/game.js#resolveMatch), not a fresh lookup into
    // tierLadder.tiers[...].prizeCheddar -- the two used to disagree for a
    // T6 (topped-out) win (20,000,000C shown here vs $999,999.92 CASH +
    // stake at 20:1 actually paid, prizeCheddar 0).
    const winOutcome = bracketComplete ? lastOutcome.characterAdvancedPayload : null;

    const timeline = buildDuelTimeline(outcome, cadenceMs, {
      momentChoice: overrides.presentationMoments,
      bracketComplete,
    });

    // C6/A16: p1 is always the human's own character (never NPC); p2 is
    // whichever seat sits across from it, which CAN be an NPC.
    const p1 = { name: character.name, element: character.element, isNpc: false };
    const p2 = { name: opponentSeat.name, element: opponentSeat.element, isNpc: opponentSeat.kind === 'npc' };
    const startShare = combatant.stakeBefore / Math.max(1, combatant.stakeBefore + opponentCombatant.stakeBefore) * 100;
    // p1 is the human, so the duel winner's side follows the reoriented outcome.
    const winnerSide = (outcome.winner === 1 || outcome.coinFlipWinner === 1) ? 'p1' : 'p2';

    const canSkip = !!ctx.session.hasSeenDuelPlaythrough;
    let stepIdx = -1; // -1 = the pre-round-one hold (R76: "readable for one second before round one")
    let throughRound = 0;
    let cancelled = false;

    // ---- CB-BUILD-005: the incumbent's ported battle stage ------------------
    // Each combatant renders from its OWN cosmetic shape set, recoloured to
    // its own palette by the parametric rig (CB-BUILD-006), composited on the
    // bundle's arena art; every state player is created and preloaded BEFORE
    // the timeline starts (the reference DuelPlayer's loadAnimations gate),
    // then cross-faded -- no img src swap, no re-fetch, no blank, no flash.
    const isIncumbent = treatment.id === 'incumbent';
    let battleStage = null;
    let stageFailed = false; // no reachable shape source at all: degrade to the provisional stage, never to a blank/white field

    async function prepareIncumbentStage() {
      const humanIdentity = { id: character.id, name: character.name, element: character.element };
      const opponentIdentity = { id: opponentCombatant.characterId, name: opponentSeat.name, element: opponentSeat.element };
      preloadDuelAudio();
      const totalUnits = 24; // 2x10 wizard states + 2 cape pairs + 2 flags
      let doneUnits = 0;
      const bump = () => {
        doneUnits += 1;
        const bar = document.querySelector('.cb-stage-progress-bar');
        if (bar) bar.style.width = `${Math.min(100, Math.round((doneUnits / totalUnits) * 100))}%`;
      };
      const fetchLocalJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`); return r.json(); };
      const actorP1 = await shapeLoader.preloadWizard(humanIdentity, { onProgress: bump });
      // R74: visually distinct, guaranteed -- the opponent's rig derives with
      // a distinctness guard against the human's.
      const actorP2 = await shapeLoader.preloadWizard(opponentIdentity, { distinctFrom: actorP1.rig, onProgress: bump });
      const [capesP1, capesP2, flagP1, flagP2] = await Promise.all([
        shapeLoader.preloadAffinityCapes(humanIdentity).then((v) => { bump(); return v; }),
        shapeLoader.preloadAffinityCapes(opponentIdentity).then((v) => { bump(); return v; }),
        fetchLocalJson(fxFlagUrl(p1.element)).then((v) => { bump(); return v; }).catch(() => { bump(); return null; }),
        fetchLocalJson(fxFlagUrl(p2.element)).then((v) => { bump(); return v; }).catch(() => { bump(); return null; }),
      ]);
      // CB-BUILD-fix-round-2 (re-review A): the late-settle guard is HOISTED
      // ABOVE the constructor. createBattleStage's FIRST statement is the
      // module-global destroyActiveBattleStage(), so fix round 1's
      // post-constructor guard still let an ORPHAN preload (this duel already
      // degraded at the bound, was skipped, or unmounted) destroy a LATER
      // duel's live stage — its 20 players gone, its layer map cleared (every
      // subsequent showStep a silent no-op via setVisible's !nextPlayer
      // early-return) — and silently steal freeze-hook ownership, before
      // self-destructing. Guarding BEFORE the constructor means an orphan
      // fires NO global side effect at all — it never constructs (so never
      // constructs-then-destroys the 20 players either) and never touches
      // the active stage or the freeze hook.
      if (stageFailed || cancelled || !tugBarContainer.isConnected) return;
      battleStage = createBattleStage({
        treatment,
        p1: { name: p1.name, element: p1.element, isNpc: p1.isNpc },
        p2: { name: p2.name, element: p2.element, isNpc: p2.isNpc },
        actors: { p1: actorP1, p2: actorP2 },
        capes: { p1: capesP1, p2: capesP2 },
        flags: { p1: flagP1, p2: flagP2 },
      });
      stageCenterContainer.replaceChildren(battleStage.root);
      await battleStage.whenReady();
    }

    function fxFlagUrl(elementKey) {
      // the bundle's element flag animation (fire/water/wind naming; Air is
      // the game copy, wind the asset key -- R74)
      return `../assets/cw-asset-bundle/lottie/${{ fire: 'fireFlag', water: 'waterFlag', air: 'windFlag' }[elementKey] || 'neutralFlag'}.json`;
    }

    function stepAt(i) { return i >= 0 ? timeline[i] : null; }

    // A2 fix (f2): the reveal loop used to call `mountScreen()` -- a full
    // `#app.innerHTML = ''` teardown + rebuild of every node -- on EVERY
    // timeline step (up to 39 times in the worst case). The shell (tug-bar
    // container, stage containers, controls row, round-cards container) is
    // now built ONCE by `buildShell()`; every subsequent frame calls
    // `updateFrame()`, which only replaces the CONTENTS of those specific
    // containers (`replaceChildren`), never tearing down the shell itself.
    // CB-BUILD-005 tightens this further for the incumbent: the stage node
    // itself (battleStage.root) is PERSISTENT -- created once with every
    // state layer preloaded, patched only by visibility cross-fades.
    let tugBarContainer, railLeftContainer, stageCenterContainer, railRightContainer, roundCardsContainer, skipBtnContainer, soundBtnContainer;

    function buildShell() {
      tugBarContainer = el('div', { class: 'cb-tugbar-container' });
      railLeftContainer = el('div', { class: 'cb-rail-container' });
      stageCenterContainer = el('div', { class: 'cb-stage-center' });
      railRightContainer = el('div', { class: 'cb-rail-container' });
      roundCardsContainer = el('div', { class: 'cb-round-cards-container' });
      skipBtnContainer = el('div', {});
      soundBtnContainer = el('div', {});

      if (isIncumbent) {
        // the reference's loading gate: arena-dark loader with a progress
        // bar until every animation source is preloaded -- never a bare or
        // white field, and the timeline does not start under it.
        const arena = arenaSources(treatment);
        stageCenterContainer.replaceChildren(el('div', { class: 'cb-arena-stage' }, [
          el('div', { class: 'cb-stage-loader' }, [
            arena.loader ? el('img', { class: 'cb-stage-loader-img', src: arena.loader, alt: '' }) : null,
            el('div', { class: 'cb-stage-progress' }, [el('div', { class: 'cb-stage-progress-bar' })]),
            el('div', { class: 'cb-micro' }, 'SUMMONING COMBATANTS…'),
          ]),
        ]));
      }

      mountScreen([
        tugBarContainer,
        // C7/R8a: a compact truth line near the tug bar -- covers every
        // moment shown in the reveal (stage/floorDrain/coinFlip/prizeAward
        // all render within this same screen mount).
        compactMoneyTruth(ctx),
        el('div', { class: 'cb-battle-stage' }, [
          el('div', { class: 'cb-stage-row' }, [railLeftContainer, stageCenterContainer, railRightContainer]),
          el('div', { class: 'cb-tag-row', style: 'justify-content:space-between;' }, [skipBtnContainer, soundBtnContainer]),
          roundCardsContainer,
        ]),
      ]);
    }

    function momentNodeFor(step) {
      if (!step) return null;
      if (step.state === 'floorDrain') {
        return renderFloorDrain({ candidate: step.candidate, loserName: lastOutcome.humanWon ? opponentSeat.name : character.name, treatment });
      }
      if (step.state === 'coinFlip') {
        return renderCoinFlip({ candidate: step.candidate, p1Name: p1.name, p2Name: p2.name, winnerName: lastOutcome.humanWon ? character.name : opponentSeat.name });
      }
      if (step.state === 'prizeAward') {
        return renderPrizeAward({ candidate: step.candidate, treatment, winOutcome });
      }
      return null;
    }

    function updateFrame() {
      const step = stepAt(stepIdx);
      const proj = projectedAfterRound(outcome.rounds, throughRound, elementIndex(character.element), elementIndex(opponentSeat.element), combatant.stakeBefore, opponentCombatant.stakeBefore, floor);

      const tugBar = renderTugBar({
        treatment, p1, p2,
        p1SharePct: proj.p1SharePct, p2SharePct: proj.p2SharePct,
        startPct: startShare, floor,
        p1Stake: proj.p1Projected, p2Stake: proj.p2Projected,
      });
      tugBarContainer.replaceChildren(tugBar);

      if (isIncumbent && battleStage && !stageFailed) {
        // CB-BUILD-005: persistent stage -- visibility cross-fades only.
        const fxRound = outcome.rounds[(step && step.round ? step.round : 1) - 1];
        battleStage.showStep(step, {
          affinityElement: fxRound ? fxRound.move1 : p1.element,
          p1WonRound: fxRound ? fxRound.result === 'WIN' : true,
          winnerSide,
        });
        // R75 coverage-gap moments overlay the composite (arena and
        // combatants stay live behind them -- no blank swap).
        battleStage.setMomentOverlay(momentNodeFor(step));
      } else if (!isIncumbent || stageFailed) {
        // the alternates' provisional stage (R12/CB-BUILD-007), and the
        // incumbent's last-resort degrade when NO shape source is reachable
        // -- still the dark treatment field, never bare/white.
        let stageMain = momentNodeFor(step);
        if (!stageMain) {
          const displayStep = step || { state: 'battleIdle' };
          stageMain = el('div', { class: 'cb-stage-main' }, [
            renderCombatant({ treatment, name: p1.name, element: p1.element, step: displayStep, side: 'p1', isNpc: p1.isNpc }),
            el('div', { class: 'cb-vs-marker cb-micro' }, 'VS'),
            renderCombatant({ treatment, name: p2.name, element: p2.element, step: displayStep, side: 'p2', isNpc: p2.isNpc }),
            step && step.state === 'affinityFx' ? renderAffinityFx({ element: outcome.rounds[throughRound - 1] ? outcome.rounds[throughRound - 1].move1 : 'fire' }) : null,
          ]);
        }
        stageCenterContainer.replaceChildren(stageMain);
      }

      const skipVisible = canSkip && !cancelled && stepIdx < timeline.length - 1;

      railLeftContainer.replaceChildren(renderRail({ treatment, rounds: outcome.rounds, throughRound, perspective: 'p1' }));
      railRightContainer.replaceChildren(renderRail({ treatment, rounds: outcome.rounds, throughRound, perspective: 'p2' }));

      skipBtnContainer.replaceChildren(skipVisible ? el('button', { class: 'cb-skip-btn', onClick: skip }, 'Skip \u203a') : el('span'));
      soundBtnContainer.replaceChildren(el('button', {
        class: `cb-sound-toggle${isSoundEnabled() ? ' on' : ''}`,
        onClick: () => { setSoundEnabled(!isSoundEnabled()); updateFrame(); },
      }, isSoundEnabled() ? '\uD83D\uDD0A SOUND ON' : '\uD83D\uDD07 SOUND OFF'));

      roundCardsContainer.replaceChildren(renderRoundCards({ rounds: outcome.rounds, throughRound, treatment }));
    }

    function skip() {
      cancelled = true;
      clearTimeout(timerHandle);
      stopLoop();
      throughRound = 5;
      stepIdx = timeline.length - 1;
      finish();
    }

    function advance() {
      if (cancelled || !tugBarContainer.isConnected) return;
      stepIdx += 1;
      if (stepIdx >= timeline.length) { finish(); return; }
      const step = timeline[stepIdx];
      if (step.state === 'attack') {
        // CB-BUILD-005: the reference triggers the round's fight sample and
        // schedules the loop restart / next voice AT the attack (its
        // onDuelPlayerRoundStart), 0-based round index.
        scheduleRoundStart((step.round || 1) - 1);
      }
      if (step.roundComplete) {
        throughRound = step.round;
      }
      updateFrame();
      timerHandle = setTimeout(advance, step.ms);
    }

    function finish() {
      stopLoop();
      if (!cancelled) ctx.patchSession({ hasSeenDuelPlaythrough: true });
      phase = 'result';
      renderResult();
    }

    function startTimeline() {
      // Liveness guard: the preload is async, so the player may have
      // navigated away (or skipped) before it settled -- a mount that is no
      // longer in the document must not restart timers or the sound bed
      // (the unmount teardown already cleared/stopped everything).
      if (cancelled || !tugBarContainer.isConnected) return;
      // CB-BUILD-005: the reference starts sound at onDuelPlayerReady --
      // only once every animation source is preloaded (intro now, loop at
      // +1.8s, round-1 voice at +2.2s).
      scheduleDuelStart();
      updateFrame();
      // R76: "the bar holds readable for one second before round one." (A2:
      // one source for this expression -- presentationTimeline.js's
      // preRoundHoldMs, also what totalDurationMs(steps, cadenceMs) counts.)
      timerHandle = setTimeout(advance, preRoundHoldMs(cadenceMs));
    }

    buildShell();
    updateFrame();
    if (isIncumbent) {
      // R74: preload EVERYTHING, then play -- the timeline never starts over
      // a half-loaded stage, and nothing fetches once it starts.
      // CB-BUILD-fix-round-1 #8: the gate is BOUNDED — a preload that
      // rejects OR outlives STAGE_PRELOAD_TIMEOUT_MS degrades to the
      // existing stageFailed path (dark provisional field; duel watchable,
      // result card reachable) instead of stranding the player on the
      // loader. The happy path is unchanged: a preload that settles in time
      // starts the timeline exactly as before.
      boundStagePreload(prepareIncumbentStage())
        .then((gate) => { if (!gate.ok) stageFailed = true; })
        .then(() => startTimeline());
    } else {
      startTimeline();
    }
  }

  function renderResult() {
    stopAll();
    // CB-BUILD-005: the reveal is over -- release the persistent stage's
    // players (mountScreen below removes its DOM; this stops the tickers).
    destroyActiveBattleStage();
    const outcome = reorientOutcome(lastOutcome.outcome, lastOutcome.humanIsSeatA);
    const combatant = lastOutcome.combatants.find((c) => c.characterId === character.id);
    const opponentCombatant = lastOutcome.combatants.find((c) => c.characterId !== character.id);
    const humanWon = lastOutcome.humanWon;

    // f7/N1: a legacy (pre-f6) reconstructed duel has no per-round detail
    // (outcome.rounds === null) -- buildMatchData/generateNarration both
    // dereference outcome.rounds unconditionally, so skip them outright
    // rather than let buildMatchData's own `.rounds.map` throw. Every
    // summary field renderResultCard reads (won/lost/draws/trueTie/
    // floorDrain) and the combatants' stakeBefore/stakeAfter are UNAFFECTED
    // -- legacy events carry those exactly as always -- so the result card
    // itself renders normally; a one-line notice replaces the narration
    // paragraph, and no narration is logged for this duel (there is no
    // matchData to log an R72 "user message" for).
    let narrationRow;
    if (lastOutcome.replayUnavailable) {
      narrationRow = el('div', { class: 'cb-card' }, [
        el('p', { class: 'cb-narration' }, 'Round-by-round replay is unavailable for this pre-upgrade duel.'),
      ]);
    } else {
      const matchData = buildMatchData(outcome, {
        p1Name: character.name, p2Name: opponentSeat.name,
        p1StakeBefore: combatant.stakeBefore, p2StakeBefore: opponentCombatant.stakeBefore,
        bracketCompletion: lastOutcome.bracketComplete && humanWon,
        prize: null,
        isFinal: match.roundIndex === 2,
      });
      lastNarration = generateNarration(matchData, {
        treatmentCopy: treatment.copy,
        nouns: { character: treatment.nouns.character.toLowerCase(), stakeUnitProse: treatment.nouns.stakeUnit.toLowerCase() },
        // C5: treatment.id (incumbent/adjacent/far) IS the register key.
        register: treatment.id,
      });
      // C18/R73: every narration logged with its toXML "user message".
      // f4/A-g fix: a kill that lands DURING the reveal (after commit, before
      // this render) freezes Game#logNarration (every ledger-touching Game
      // method is guarded, per f1's AC0 kill-switch rule) -- uncaught, that
      // left the screen frozen on the reveal's last frame with an unhandled
      // exception, never reaching either the result card or a stop banner.
      // Catch specifically KillSwitchFrozenError and render the same stop
      // banner a fresh route mount would show; any other error still
      // propagates (this is a catch-site, not a guard change -- the kill
      // guard itself, and every other Game method's behavior, is untouched).
      try {
        ctx.game.logNarration({ bracketId, roundIndex: match.roundIndex, matchIndex: match.matchIndex, matchData, narration: lastNarration });
      } catch (err) {
        if (err instanceof KillSwitchFrozenError) { renderKillStopBanner(ctx); return; }
        throw err;
      }
      narrationRow = el('div', { class: 'cb-card' }, [el('p', { class: 'cb-narration' }, lastNarration.text)]);
    }

    const rows = [
      truthBadge(ctx), // C7/R8a: the result card shows real money movement (stakes are play-money units, but the transfer numbers are exactly the kind of "money figure" R8a's line must sit beside)
      renderResultCard({
        treatment, humanWon, outcome,
        p1Name: character.name, p2Name: opponentSeat.name,
        // C8/R77: BOTH combatants' before/after/delta, not just the human's.
        stakeBefore: combatant.stakeBefore, stakeAfter: combatant.stakeAfter,
        opponentStakeBefore: opponentCombatant.stakeBefore, opponentStakeAfter: opponentCombatant.stakeAfter,
        floorDrain: outcome.floorDrain,
      }),
      narrationRow,
      renderCoinFlipVerification(outcome),
    ];

    if (lastOutcome.bracketComplete && humanWon) {
      // f4/N1: read the SAME CHARACTER_ADVANCED payload the reveal's
      // prize-award moment reads (above), not an independent
      // tierLadder.tiers[...] lookup -- the two used to disagree for a
      // topped-out (T6) win.
      const winCardOutcome = lastOutcome.characterAdvancedPayload;
      const winCardRows = [
        el('div', { class: 'cb-display', style: 'font-size:24px;' }, treatment.copy.duelWonLine),
      ];
      if (winCardOutcome && winCardOutcome.toppedOut) {
        // R56: "the win screen shows DUEL WON and the prize as separate
        // lines" -- R62's topped-out payout is itself two figures (cash +
        // the stake's 20:1 conversion), so both get their own line.
        winCardRows.push(el('div', { class: 'cb-data' }, `${treatment.copy.prizeLine}: ${money(winCardOutcome.payoutCashUSD)}`));
        winCardRows.push(el('div', { class: 'cb-data cb-micro' }, `Stake cashed out: ${cheddar(winCardOutcome.stakeCashedOutCheddar)} @ 20:1 = ${money(winCardOutcome.stakeCashUSD)}`));
      } else {
        winCardRows.push(el('div', { class: 'cb-data' }, `${treatment.copy.prizeLine}: ${winCardOutcome ? cheddar(winCardOutcome.prizeCheddar) : ''}`));
      }
      rows.push(el('div', { class: 'cb-card', style: 'text-align:center;' }, winCardRows));
    }


    rows.push(el('button', {
      class: 'cb-btn block',
      onClick: () => {
        if (!humanWon) { ctx.router.navigate('sitting'); return; }
        if (lastOutcome.bracketComplete) { ctx.router.navigate('bracket-board'); return; }
        // advance within the round / to the next round
        autoResolveOthers();
        ctx.patchSession({ bracket });
        // A4/R81: the intermission (20-30s, updated board, next opponent's
        // card) between this result and the next duel's commit screen.
        showIntermission();
      },
    }, humanWon ? (lastOutcome.bracketComplete ? 'View Bracket' : 'Next Duel') : 'Continue'));

    mountScreen(rows);
  }

  // ---- A4/R81: the intermission ---------------------------------------------
  // "Intermission: 20-30s, updated board, next opponent's card." Sits
  // between a won (non-bracket-completing) duel's result and the next
  // duel's commit screen. `createIntermission`/`intermissionOver`
  // (app/engine/sync.js) previously had zero callers -- wired in here.
  const INTERMISSION_DEMO_MULTIPLIER = 12; // same demo-speed convention as lobby.js; the tunable 20-30s range itself is untouched

  function showIntermission() {
    const nextMatch = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
    const nextOpponentSeatIndex = nextMatch ? (nextMatch.seatA === humanSeatIndex ? nextMatch.seatB : nextMatch.seatA) : null;
    const nextOpponent = nextOpponentSeatIndex != null ? bracket.seats[nextOpponentSeatIndex] : null;

    const intermission = sync.createIntermission(tunables, Date.now());
    const realStart = Date.now();
    const virtualNow = () => intermission.startedAt + (Date.now() - realStart) * INTERMISSION_DEMO_MULTIPLIER;
    let intermissionTimer = null;
    // f4/A-i fix: replaces the mount-time registration above (the commit
    // tick / reveal timeout chain is long finished by the time the
    // intermission starts) with one covering THIS timer instead --
    // navigating away during the intermission must stop it from
    // eventually calling `ctx.router.navigate('duel')` into a screen the
    // player already left.
    ctx.router.onUnmount(() => clearInterval(intermissionTimer));

    function boardSnapshot() {
      return bracket.rounds.map((round, ri) => el('div', {}, [
        el('div', { class: 'cb-bracket-round-label' }, bracketEngine.bracketRoundName(ri).toUpperCase()),
        ...round.map((m) => {
          const seatName = (idx) => (idx != null && bracket.seats[idx] ? bracket.seats[idx].name : '\u2014');
          const decided = m.winnerSeat !== null;
          return el('div', { class: 'cb-bracket-match' }, [
            el('span', { class: `seat ${decided ? (m.winnerSeat === m.seatA ? 'winner' : 'loser') : ''}` }, seatName(m.seatA)),
            el('span', { class: 'cb-micro' }, 'vs'),
            el('span', { class: `seat ${decided ? (m.winnerSeat === m.seatB ? 'winner' : 'loser') : ''}` }, seatName(m.seatB)),
          ]);
        }),
      ]));
    }

    function render() {
      const remainingMs = Math.max(0, intermission.endsAt - virtualNow());
      mountScreen([
        el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark), el('span', { class: 'cb-timer cb-data' }, `${Math.ceil(remainingMs / 1000)}s`)]),
        el('h2', {}, 'Intermission'),
        el('p', { class: 'cb-prose cb-prose-small' }, 'The updated board:'),
        el('div', { class: 'cb-bracket-tree' }, boardSnapshot()),
        el('div', { class: 'cb-card' }, [
          el('div', { class: 'cb-micro' }, 'NEXT OPPONENT'),
          nextOpponent
            ? el('div', { class: 'cb-data', style: 'margin-top:4px;' }, [
                nextOpponent.name,
                nextOpponent.kind === 'npc' ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
              ])
            : el('div', { class: 'cb-prose cb-prose-small', style: 'margin-top:4px;' }, 'Still being decided elsewhere in the bracket…'),
        ]),
      ]);
    }

    render();
    intermissionTimer = setInterval(() => {
      if (ctx.game.isKilled()) {
        clearInterval(intermissionTimer);
        handleKillMidDuel();
        return;
      }
      render();
      if (sync.intermissionOver(intermission, virtualNow())) {
        clearInterval(intermissionTimer);
        ctx.router.navigate('duel');
      }
    }, 500);
  }

  function tick() {
    if (phase !== 'commit') return;
    if (ctx.game.isKilled()) { handleKillMidDuel(); return; }
    const remaining = window_.deadline - Date.now();
    if (remaining <= 0) {
      // CB-BUILD-009/R81: master rule now keeps the player's own picks on
      // auto-commit -- only the still-unpicked rounds fill uniform-random
      // (previously `sync.autoCommitHesitated` overwrote EVERY round with
      // a fresh random pick, discarding any in-progress selection, which
      // read as "the game changing the player's moves"). `computeAutoCommitMoves`
      // (this file, pure + unit-tested) does the merge; the window's
      // commits bag is written directly, in the SAME shape
      // `sync.autoCommitHesitated` used, so `recordCommit`'s idempotency
      // check inside `commit()` and the disconnect-safe resume path above
      // both still see exactly what they expect.
      if (!window_.commits[humanSeatIndex]) {
        window_.commits[humanSeatIndex] = { moves: computeAutoCommitMoves(moves, elementIndex), hesitated: true, ts: Date.now() };
      }
      const autoMoves = window_.commits[humanSeatIndex];
      commit(autoMoves.moves, true);
    } else {
      // A17: targeted update, not a full rebuild, on every 500ms tick.
      updateClockDisplay();
    }
  }

  buildCommitScreen();
  timerHandle = setInterval(tick, 500);
}
