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
import { renderCombatant, renderAffinityFx, renderProvisionalStageNotice } from '../components/battle/stage.js';
import { createRigLoadout } from '../components/battle/rigAssets.js';
import { createRigStage } from '../components/battle/rigStage.js';
import { renderRail, renderRoundCards, renderResultCard } from '../components/battle/rails.js';
import { renderFloorDrain, renderCoinFlip, renderPrizeAward } from '../components/battle/moments.js';
import { isSoundEnabled, setSoundEnabled, playIntro, playLoop, playRoundBeat, scheduleDuelReadyVoice, stopAllExceptBed, releaseAudioForRoute, carryBed, soundToggleButton } from '../components/battle/sound.js';
import { truthBadge, compactMoneyTruth, renderKillStopBanner } from '../components/chrome.js';
import { KillSwitchFrozenError } from '../../engine/game.js';

// CB-BUILD-009/R81: "shifting to the danger color as it nears zero" -- a
// presentation-only threshold (not an economy/duel constant, gate
// threshold, or invariant), chosen at the patch log's own "~10s" figure.
const COMMIT_CLOCK_DANGER_MS = 10_000;

// CB-BUILD-011/R11/R79: "the opponent tendency card readable" -- the raw
// F/W/A percentage triple (tendencyLabel, engine/npc.js) is exactly the
// kind of figure the DATA face is for and stays rendered as one below; this
// adds one plain-language PROSE sentence naming the opponent's single
// strongest lean, so a player can read the card at a glance instead of
// parsing three abbreviated percentages cold. Presentation-only (derives
// the same opponentSeat.tendency object already computed by the engine --
// no new data, no match-history depth, nothing engine-side touched).
function dominantTendencyPhrase(tendency) {
  if (!tendency) return null;
  const [topElement, topShare] = Object.entries(tendency).sort((a, b) => b[1] - a[1])[0];
  const label = topElement.charAt(0).toUpperCase() + topElement.slice(1).toLowerCase();
  return `Leans ${label} \u2014 about ${Math.round(topShare * 100)}% of rounds.`;
}

/**
 * C13/O3/R26 cards 1 & 2 ("Scouting reports" / "Pre-match Narrator brief"):
 * each renders ONLY when its own hypothesis is the ACTIVE one (O3) --
 * both derive from the SAME real ledger history (engine/hypotheses.js), so
 * the panel and the brief never disagree with each other.
 *
 * CB-BUILD-011/R11/R79: "the existing scouting panel (O3 card 1, when
 * active) given proper room rather than cramped mono." The panel wrapper
 * gets its own roomier class (cb-scouting-panel, styles/base.css --
 * generous padding, a real line-gap between rows instead of touching
 * zero-margin <div>s). The two SENTENCES a player actually reads here
 * (the W-L summary, the affinity-play-rate line) move off the data face
 * onto the prose face per R11 ("prose content, every sentence a player
 * reads, is set in the prose face ... the data face carries figures,
 * counters, tags, and code only, never body copy") -- these are full
 * sentences that happen to carry a figure, not bare figures/tags
 * themselves. The compact per-round tag rows (a result letter plus a
 * F/W/A move sequence -- exactly a "tag", not a sentence) and the section
 * label stay on the data face, unchanged; no new match-history depth is
 * added -- same opponentDuelHistory() rows, same 5-row cap.
 */
function renderScoutingAndBrief(ctx, opponentSeat, treatment) {
  const activeId = effectiveHypothesisId(loadOverrides());
  if (activeId !== 'scouting_reports' && activeId !== 'prematch_brief') return null;
  const ledgerEvents = ctx.game.ledger.all();
  const history = opponentDuelHistory(ledgerEvents, opponentSeat.characterId, 10);
  const summary = summarizeOpponentHistory(history);
  const card = hypothesisCard(activeId);
  const rows = [el('p', { class: 'cb-micro', style: 'color:var(--cb-teal);' }, card.fairTestLine)];

  if (activeId === 'scouting_reports') {
    rows.push(el('p', { class: 'cb-prose' }, `${opponentSeat.name}: ${summary.wins}-${summary.losses}${summary.ties ? ` (${summary.ties} tie${summary.ties === 1 ? '' : 's'})` : ''} over the last ${summary.count} staked duel${summary.count === 1 ? '' : 's'}.`));
    rows.push(el('p', { class: 'cb-prose' }, `Affinity-play rate: ${Math.round(summary.avgAffinityPlayRate * 100)}%.`));
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

  return el('div', { class: 'cb-card cb-scouting-panel' }, rows);
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
  const resultLine = el('div', { class: 'cb-micro', style: 'margin-top:6px;' }, '');
  return el('details', { class: 'cb-card' }, [
    el('summary', {}, 'Verify this coin flip'),
    el('p', { class: 'cb-legal' }, `Commitment (recorded BEFORE the flip): ${commitment}`),
    el('p', { class: 'cb-legal' }, `Revealed seed (AFTER the flip): ${seed}`),
    el('p', { class: 'cb-legal' }, 'Recompute: SHA-256(seed) must equal the commitment above; the flip itself is a fixed function of the seed alone (the first hex digit of SHA-256(seed): even => this side, odd => the other side).'),
    // f4/A-l: one honest sentence naming the actual gap to "provably
    // fair" -- this recomputation proves the flip wasn't changed AFTER
    // the commitment was recorded; it does NOT prove the seed itself was
    // chosen fairly, since the seed is house-generated (this.random,
    // server/app-side), not supplied or influenced by the player. Stated
    // plainly rather than left implied by the "provably fair" framing
    // elsewhere (this module's own header comment, in quotes, for
    // exactly this reason).
    el('p', { class: 'cb-legal' }, 'Honest limit: this is verifiable AFTER THE FACT — it proves the flip was not changed once committed. It does not prove the seed was chosen fairly: the seed itself is house-generated, not supplied by you.'),
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

  // CB-BUILD-005/006 (incumbent only): kick off the battle-animation preload
  // NOW, at commit-screen mount — the duel's every animation source (both
  // combatants' own shape sets, recoloured to their own palettes, plus the
  // affinity-cape FX) is fetching while the player picks moves, and the
  // reveal never fetches mid-duel. The alternates keep their placeholder
  // stage (CB-BUILD-007/011 are a different patch).
  const useRig = treatment.id === 'incumbent';
  let rigLoadout = null;
  let rigStage = null;
  if (useRig) {
    const chars = ctx.game.snapshot().characters;
    const p2Char = chars[opponentSeat.characterId]
      || { id: opponentSeat.characterId || `seat-${opponentSeatIndex}-${opponentSeat.name}`, element: opponentSeat.element, tier: bracket.tier || 0 };
    rigLoadout = createRigLoadout({ p1Character: character, p2Character: p2Char });
  }

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
  // A3 (as amended by fix round f5/R78a [LAW]): unmounting the duel screen
  // stops the one-shot battle sounds (intro sting, round beats, pending
  // round voices) -- but the looping BED now CARRIES to another
  // bracket-context screen (bracket board, sitting, or this screen's own
  // next mount) instead of stopping on every unmount: R78a says the bed
  // "plays through the bracket as the 2019 client played it", whose sound
  // layer stopped only on leaving the duel-player context entirely.
  // releaseAudioForRoute(ctx.router.current()) reads the route being
  // mounted NEXT (inside an onUnmount callback the hash has already moved)
  // and stops EVERYTHING -- the A3 guarantee -- when that route is outside
  // the bracket context (lobby, wallet, landing, ...).
  // (CB-BUILD-005: the rig stage tears ITSELF down when its root leaves the
  // document -- see rigStage.js's disconnect watchdog -- so navigation away
  // mid-reveal stops its players without a third teardown site here.)
  ctx.router.onUnmount(() => { clearInterval(timerHandle); clearTimeout(timerHandle); releaseAudioForRoute(ctx.router.current()); });

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

  // Disconnect-safe: a sealed commit stands. If this device already sealed a
  // commit for this exact match (e.g. before a reload), resolve with it
  // rather than asking again.
  const existingCommit = window_.commits[humanSeatIndex];
  if (existingCommit) {
    queueMicrotask(() => commit(existingCommit.moves, existingCommit.hesitated));
  }

  function buildCommitScreen() {
    const remainingMs = Math.max(0, window_.deadline - Date.now());
    // CB-BUILD-009/R81: a PROMINENT, PERSISTENT countdown -- pinned in view
    // for the whole selection, large enough to read at a glance, shifting
    // to the danger color as it nears zero -- replaces the small
    // `cb-timer` data span that used to sit quietly in the top bar next to
    // the logo (easy to miss entirely).
    commitTimerNode = el('div', {
      class: `cb-commit-clock cb-data${remainingMs <= COMMIT_CLOCK_DANGER_MS ? ' danger' : ''}`,
    }, `${Math.ceil(remainingMs / 1000)}s`);

    // CB-BUILD-010/§12/R83: a move tap must mutate ONLY that round's three
    // buttons + the seal button's disabled state, in place -- no
    // buildCommitScreen() remount (a full mountScreen() teardown+rebuild,
    // which resets scroll to whatever the browser lands on) on selection.
    // `roundButtonGroups[i]` holds the three live button nodes for round i
    // so `selectMove` can toggle `.selected` on exactly those three,
    // without touching any other round's DOM or re-mounting the screen.
    const roundButtonGroups = [];
    // CB-BUILD-008 optional enhancement (folded, manager-announced on PR #8):
    // `roundCardNodes[i]` holds round i's own card element (parallel to
    // roundButtonGroups[i]'s three buttons), captured at build time purely
    // so a press on a still-gated Seal Commitment can highlight exactly the
    // rounds still missing a move, in place -- no rebuild, no gate-logic
    // change (the gate itself -- aria-disabled + the no-op guard below --
    // is untouched).
    const roundCardNodes = [];
    let sealButtonNode;
    let missingHighlightTimer = null;

    function selectMove(i, elName) {
      moves[i] = elName;
      for (const [name, btn] of Object.entries(roundButtonGroups[i])) {
        btn.classList.toggle('selected', name === elName);
      }
      const stillGated = moves.some((m) => m == null);
      if (stillGated) sealButtonNode.setAttribute('aria-disabled', 'true');
      else sealButtonNode.removeAttribute('aria-disabled');
    }

    // CB-BUILD-008 optional enhancement: "briefly highlight the rounds
    // still missing a move, so the player is told what is left rather than
    // met with a dead control." Fires on a press of the STILL-GATED seal
    // button only (the no-op branch); a real seal press (every round
    // picked) never calls this. Purely additive visual feedback -- toggles
    // one CSS class per missing round's own card, in place, and clears it
    // after a fixed window (re-triggerable: a second press while the
    // pulse is still showing restarts the same window rather than stacking
    // timers).
    const MISSING_ROUND_HIGHLIGHT_MS = 900;
    function flashMissingRounds() {
      clearTimeout(missingHighlightTimer);
      const missingIdxs = [];
      moves.forEach((m, i) => { if (m == null) missingIdxs.push(i); });
      for (const i of missingIdxs) roundCardNodes[i].classList.add('cb-round-missing');
      missingHighlightTimer = setTimeout(() => {
        for (const i of missingIdxs) roundCardNodes[i].classList.remove('cb-round-missing');
      }, MISSING_ROUND_HIGHLIGHT_MS);
    }

    const roundCards = moves.map((mv, i) => {
      const group = {};
      // CB-BUILD-011/R11/R79/R83: "five round pickers roomy and card-like
      // (whole card a target, >=44px, >=8px spacing)" -- cb-round-picker
      // (styles/base.css) gives the round its own roomier padding/spacing;
      // the three moves inside render as bigger, rounder, more evidently
      // tappable "cards" (each already its own whole-button target, >=44px
      // -- see the CB-BUILD-011 .cb-element-btn sizing below -- with a
      // >=8pt gap between them, per .cb-element-row).
      const card = el('div', { class: 'cb-card cb-round-picker' }, [
        el('div', { class: 'cb-micro' }, `ROUND ${i + 1}`),
        el('div', { class: 'cb-element-row' }, ELEMENTS.map((elName) => {
          const btn = el('button', {
            class: `cb-element-btn${moves[i] === elName ? ' selected' : ''}${elName === character.element ? ' affinity' : ''}`,
            'data-el': elName,
            onClick: () => selectMove(i, elName),
          }, treatment.elements[elName].label);
          group[elName] = btn;
          return btn;
        })),
      ]);
      roundButtonGroups.push(group);
      roundCardNodes.push(card);
      return card;
    });

    sealButtonNode = el('button', {
      class: 'cb-btn block',
      'aria-disabled': moves.some((m) => m == null),
      onClick: () => {
        if (!moves.some((m) => m == null)) commit(moves.map(elementIndex), false);
        else flashMissingRounds();
      },
    }, 'Seal Commitment');

    mountScreen([
      // Fix round f5/R78a: the bed now carries INTO this screen from the
      // previous duel's result/intermission, so the commit screen needs the
      // visible mute too. It sits in the topbar beside the logo (audio
      // chrome only) -- the move-choice layout below (clock, pickers, seal)
      // is untouched, per CB-BUILD-010/011's protected structure.
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark), soundToggleButton()]),
      commitTimerNode,
      // CB-BUILD-009r/R81: states, BEFORE the clock ever runs low, exactly
      // what happens at zero -- shown for the whole selection window, not
      // sprung on the player only once time is nearly out. Reverted copy:
      // the owner ruled (2026-09-15) that ALL FIVE moves are chosen at
      // random at zero, including any already picked -- not just the blanks.
      el('p', { class: 'cb-legal', style: 'text-align:center;' }, 'If this hits 0:00, all five moves are chosen at random \u2014 even any you\u2019ve already picked \u2014 and this duel is flagged hesitated.'),
      // CB-BUILD-011/R79: the screen's one hero moment (display face,
      // Bebas Neue via the fixed h2 rule) -- used exactly once on this
      // screen, per R79's "one hero-moment face used at most once".
      el('h2', {}, `${character.name} vs ${opponentSeat.name}`),
      // CB-BUILD-011/R11/R79: "the opponent tendency card readable" --
      // cb-tendency-card (styles/base.css) gives the card more breathing
      // room; a plain-language lean sentence (prose face) now sits above
      // the raw F/W/A figures (data face, unchanged) instead of being the
      // card's only content.
      el('div', { class: 'cb-card cb-tendency-card' }, [
        el('div', { class: 'cb-micro' }, 'OPPONENT TENDENCY'),
        el('div', { class: 'cb-data', style: 'margin-top:4px;' }, [
          `${opponentSeat.name} `,
          opponentSeat.kind === 'npc' ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
        ]),
        opponentSeat.tendency
          ? el('p', { class: 'cb-prose', style: 'margin:8px 0 4px;' }, dominantTendencyPhrase(opponentSeat.tendency))
          : null,
        el('div', { class: 'cb-micro' }, opponentSeat.tendency ? `F/W/A ${tendencyLabel(opponentSeat.tendency)}` : ''),
      ]),
      renderScoutingAndBrief(ctx, opponentSeat, treatment),
      // CB-BUILD-011/R79: a clear section break (data-face label, not a
      // second hero moment) between the opponent info above and the five
      // move pickers below -- visual hierarchy the old flat stack lacked.
      el('div', { class: 'cb-micro cb-section-label' }, 'CHOOSE YOUR FIVE MOVES'),
      ...roundCards,
      sealButtonNode,
    ]);
  }

  // A17: the targeted per-tick update -- touches only the timer text node.

  function updateClockDisplay() {
    if (!commitTimerNode) return;
    const remainingMs = Math.max(0, window_.deadline - Date.now());
    commitTimerNode.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    // CB-BUILD-009/R81: shift to the danger color as the clock nears zero.
    commitTimerNode.classList.toggle('danger', remainingMs <= COMMIT_CLOCK_DANGER_MS);
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

    // CB-BUILD-005 (incumbent): the rig stage — both combatants as their
    // OWN wizards on the arena composite, every state preloaded and
    // cross-faded. Built ONCE per reveal; updateFrame drives it via
    // setStep. The node persists across frames (its player canvases are
    // never torn down mid-duel).
    if (useRig && rigLoadout && !rigStage) {
      rigStage = createRigStage({ loadout: rigLoadout, p1, p2, treatment });
    }

    // R75: the affinity FX pass — per side, the library's affinity-cape
    // overlay (win or lose flavour by that round's own result), only for a
    // side that actually played its affinity. FX from the bundle's own
    // sources, not a flat fill (CB-BUILD-005).
    function affinityCapesForRound(roundNo) {
      const r = outcome.rounds && outcome.rounds[roundNo - 1];
      if (!r) return { p1Cape: null, p2Cape: null };
      return {
        p1Cape: r.p1Affinity ? (r.result === 'WIN' ? 'win' : r.result === 'LOSS' ? 'lose' : null) : null,
        p2Cape: r.p2Affinity ? (r.result === 'LOSS' ? 'win' : r.result === 'WIN' ? 'lose' : null) : null,
      };
    }

    const canSkip = !!ctx.session.hasSeenDuelPlaythrough;
    let stepIdx = -1; // -1 = the pre-round-one hold (R76: "readable for one second before round one")
    let throughRound = 0;
    let cancelled = false;

    playIntro();
    playLoop();
    // Fix round f5 (R78a/R78): the reference's player-ready beat also
    // schedules voice-round-1 at +2.2s (soundManager.js:112); each round
    // beat below schedules the next round's voice at +3.6s inside
    // playRoundBeat itself (soundManager.js:136).
    scheduleDuelReadyVoice();

    function stepAt(i) { return i >= 0 ? timeline[i] : null; }

    // A2 fix (f2): the reveal loop used to call `mountScreen()` -- a full
    // `#app.innerHTML = ''` teardown + rebuild of every node -- on EVERY
    // timeline step (up to 39 times in the worst case). The shell (tug-bar
    // container, stage container, controls row, round-cards container) is
    // now built ONCE by `buildShell()`; every subsequent frame calls
    // `updateFrame()`, which only replaces the CONTENTS of those specific
    // containers (`replaceChildren`), never tearing down the shell itself
    // (topbar, skip/sound buttons row structure) it doesn't need to.
    let tugBarContainer, stageRowContainer, roundCardsContainer, skipBtnContainer, soundBtnContainer;

    function buildShell() {
      tugBarContainer = el('div', { class: 'cb-tugbar-container' });
      stageRowContainer = el('div', { class: 'cb-stage-row' });
      roundCardsContainer = el('div', { class: 'cb-round-cards-container' });
      skipBtnContainer = el('div', {});
      soundBtnContainer = el('div', {});

      mountScreen([
        tugBarContainer,
        // C7/R8a: a compact truth line near the tug bar -- covers every
        // moment shown in the reveal (stage/floorDrain/coinFlip/prizeAward
        // all render within this same screen mount).
        compactMoneyTruth(ctx),
        el('div', { class: 'cb-battle-stage' }, [
          stageRowContainer,
          el('div', { class: 'cb-tag-row', style: 'justify-content:space-between;' }, [skipBtnContainer, soundBtnContainer]),
          roundCardsContainer,
        ]),
      ]);
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

      let stageMain;
      if (step && step.state === 'floorDrain') {
        stageMain = renderFloorDrain({ candidate: step.candidate, loserName: lastOutcome.humanWon ? opponentSeat.name : character.name, treatment });
      } else if (step && step.state === 'coinFlip') {
        stageMain = renderCoinFlip({ candidate: step.candidate, p1Name: p1.name, p2Name: p2.name, winnerName: lastOutcome.humanWon ? character.name : opponentSeat.name });
      } else if (step && step.state === 'prizeAward') {
        stageMain = renderPrizeAward({ candidate: step.candidate, treatment, winOutcome });
      } else if (useRig && rigStage) {
        // CB-BUILD-005: the persistent rig stage IS the frame's stage —
        // setStep toggles preloaded, recoloured players (cross-fade, no
        // src swap, no fetch); an affinityFx step plays the cape FX pass.
        const displayStep = step || { state: 'battleIdle' };
        rigStage.setStep(displayStep, displayStep.state === 'affinityFx' ? affinityCapesForRound(displayStep.round) : {});
        stageMain = rigStage.root;
      } else {
        const displayStep = step || { state: 'battleIdle' };
        stageMain = el('div', { class: 'cb-stage-main' }, [
          // CB-BUILD-007 track 1/R12: the alternates' placeholder stage
          // carries a clearly-marked, honest provisional-art notice (this
          // branch only ever runs for a non-incumbent treatment -- the
          // incumbent's real rig stage is handled by the `useRig &&
          // rigStage` branch above); renderProvisionalStageNotice returns
          // null for any treatment without the line (defensive).
          renderProvisionalStageNotice(treatment),
          renderCombatant({ treatment, name: p1.name, element: p1.element, step: displayStep, side: 'p1', isNpc: p1.isNpc }),
          el('div', { class: 'cb-vs-marker cb-micro' }, 'VS'),
          renderCombatant({ treatment, name: p2.name, element: p2.element, step: displayStep, side: 'p2', isNpc: p2.isNpc }),
          step && step.state === 'affinityFx' ? renderAffinityFx({ element: outcome.rounds[throughRound - 1] ? outcome.rounds[throughRound - 1].move1 : 'fire' }) : null,
        ]);
      }

      const skipVisible = canSkip && !cancelled && stepIdx < timeline.length - 1;

      stageRowContainer.replaceChildren(
        renderRail({ treatment, rounds: outcome.rounds, throughRound, perspective: 'p1' }),
        stageMain,
        renderRail({ treatment, rounds: outcome.rounds, throughRound, perspective: 'p2' }),
      );

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
      // Fix round f5/R78a: an abrupt jump cuts the one-shots (a mid-ring
      // beat, every pending round voice) but the BED carries to the result
      // card -- it no longer stops at the reveal's edge.
      stopAllExceptBed();
      throughRound = 5;
      stepIdx = timeline.length - 1;
      finish();
    }

    function advance() {
      if (cancelled) return;
      stepIdx += 1;
      if (stepIdx >= timeline.length) { finish(); return; }
      const step = timeline[stepIdx];
      if (step.roundComplete) {
        throughRound = step.round;
        playRoundBeat(step.round);
      }
      updateFrame();
      timerHandle = setTimeout(advance, step.ms);
    }

    function finish() {
      // Fix round f5/R78a: no stopLoop() here -- the bed plays on through
      // the result card and the rest of the bracket (renderResult carries it).
      if (!cancelled) ctx.patchSession({ hasSeenDuelPlaythrough: true });
      phase = 'result';
      renderResult();
    }

    buildShell();
    // R76: "the bar holds readable for one second before round one." (A2:
    // one source for this expression -- presentationTimeline.js's
    // preRoundHoldMs, also what totalDurationMs(steps, cadenceMs) counts.)
    updateFrame();
    if (useRig && rigStage) {
      // CB-BUILD-005/R74: the timeline starts only once EVERY animation
      // source is preloaded and painted (the reference gated its chain on
      // isAnimationReady the same way; its loader shows real progress until
      // then). A load failure never strands the duel: the stage degrades
      // (loadout fallback / nameplates-over-arena) and the reveal proceeds.
      rigStage.whenReady.catch(() => {}).then(() => {
        if (cancelled || phase !== 'reveal') return;
        updateFrame();
        timerHandle = setTimeout(advance, preRoundHoldMs(cadenceMs));
      });
    } else {
      timerHandle = setTimeout(advance, preRoundHoldMs(cadenceMs));
    }
  }

  function renderResult() {
    // Fix round f5/R78a [LAW]: the bed CARRIES onto the result card (it used
    // to stopAll() here -- the reviewer's finding: audio existed only during
    // the reveal). One-shot round samples ring out naturally, as the 2019
    // client let them; carryBed() keeps the loop sounding -- and STARTS it
    // for a path that never ran the reveal (a legacy replay-unavailable duel
    // commits straight to this card).
    carryBed();
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
      // Fix round f5/R78a: the bed is sounding on this card now -- the
      // visible mute control comes with it.
      el('div', { class: 'cb-tag-row', style: 'justify-content:flex-end;' }, [soundToggleButton()]),
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
    // player already left. Fix round f5/R78a: the bed sounds through the
    // intermission too, so this teardown is route-aware the same way the
    // mount-time one is -- carry to a bracket-context route, stop otherwise.
    ctx.router.onUnmount(() => { clearInterval(intermissionTimer); releaseAudioForRoute(ctx.router.current()); });

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
        // Fix round f5/R78a: the bed sounds through the intermission (20-30s)
        // -- the visible mute rides in the topbar.
        el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark), el('span', { class: 'cb-timer cb-data' }, `${Math.ceil(remainingMs / 1000)}s`), soundToggleButton()]),
        el('h2', {}, 'Intermission'),
        el('p', { class: 'cb-micro' }, 'The updated board:'),
        el('div', { class: 'cb-bracket-tree' }, boardSnapshot()),
        el('div', { class: 'cb-card' }, [
          el('div', { class: 'cb-micro' }, 'NEXT OPPONENT'),
          nextOpponent
            ? el('div', { class: 'cb-data', style: 'margin-top:4px;' }, [
                nextOpponent.name,
                nextOpponent.kind === 'npc' ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
              ])
            // C6/R11 [LAW]: a full sentence belongs on the PROSE face
            // (--font-prose), never the data face (--font-data, .cb-micro
            // -- figures/tags/timestamps only). This is a sentence.
            : el('div', { class: 'cb-prose', style: 'margin-top:4px;' }, 'Still being decided elsewhere in the bracket…'),
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
      // CB-BUILD-009r/R81: the owner reversed the preserve-partial rule
      // (2026-09-15) -- a missed clock now commits a uniform-random FIVE-move
      // hand, the WHOLE hand, including any rounds already picked. No
      // picked-moves are passed in; nothing survives.
      const autoMoves = sync.autoCommitHesitated(window_, humanSeatIndex, Date.now(), Math.random);
      commit(autoMoves.moves, true);
    } else {
      // A17: targeted update, not a full rebuild, on every 500ms tick.
      updateClockDisplay();
    }
  }

  buildCommitScreen();
  timerHandle = setInterval(tick, 500);
}
