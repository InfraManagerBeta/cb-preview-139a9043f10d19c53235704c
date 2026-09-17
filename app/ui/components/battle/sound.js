// app/ui/components/battle/sound.js — R78a [LAW] (CB-BUILD-016): sound is
// ON BY DEFAULT (the default-OFF guess this replaces cited a rule that said
// nothing about sound; R78a now does). Because phones withhold audio until
// a gesture, the audio layer ARMS on the player's first gesture (app.js
// installs installFirstTapArming on the first `pointerdown` — or `keydown`,
// for keyboard/AT users — anywhere) and is first
// heard during the summon ceremony (R74a — the SUMMON press is itself a tap,
// so the ceremony is always armed). The duel audio bed (the bundle's
// fight-intro/loop/round WAVs) plays through the bracket as the 2019 client
// played it; a mute control (soundToggleButton below, the same control the
// duel screen renders) is visible wherever sound plays. Every play call is
// best-effort and never throws (autoplay policies can still reject).
import { el } from '../dom.js';
import { soundUrl } from './assets.js';
import { loadOverrides, patchOverrides } from '../../../engine/overrides.js';

const cache = new Map();

// R78a arming: audio is withheld until the player's first gesture. Nothing
// constructs or plays an Audio element before this flips — which also keeps
// every play call a no-op under Node (no Audio global) until a test arms
// explicitly.
let armed = false;

export function isSoundArmed() {
  return armed;
}

export function armSound() {
  armed = true;
}

/** Test hook: drop back to the pre-gesture state so arming paths (tap vs
 * keyboard, f5 advisory) can each be exercised from cold in one process.
 * Production code never calls this — a real player, once armed, stays armed. */
export function disarmSoundForTests() {
  armed = false;
}

/** Install the one-shot first-tap arming hook (R78a: "arms on the player's
 * first tap") on `target` (default: the window). `pointerdown` is the
 * earliest gesture event — it precedes the click that starts the summon
 * ceremony, so the ceremony's own press both arms and starts the audio.
 * Fix round f5 (advisory): a keyboard / assistive-technology user never
 * fires `pointerdown` at all — a `keydown` satisfies browser autoplay
 * policy equally, so the hook listens for BOTH and whichever gesture lands
 * first arms (one-shot: both listeners come off together). */
export function installFirstTapArming(target) {
  const t = target || (typeof window !== 'undefined' ? window : null);
  if (!t || typeof t.addEventListener !== 'function') return;
  const onFirstTap = () => {
    armSound();
    if (typeof t.removeEventListener === 'function') {
      t.removeEventListener('pointerdown', onFirstTap);
      t.removeEventListener('keydown', onFirstTap);
    }
  };
  t.addEventListener('pointerdown', onFirstTap);
  t.addEventListener('keydown', onFirstTap);
}

function getAudio(name) {
  if (typeof Audio === 'undefined') return null; // no audio host (Node) — every play is a no-op
  if (!cache.has(name)) {
    const a = new Audio(soundUrl(name));
    a.preload = 'none';
    cache.set(name, a);
  }
  return cache.get(name);
}

function safePlay(a) {
  if (!a) return;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {}); // autoplay-policy rejection: ignore
  } catch { /* ignore */ }
}

// R78a: ON by default — overrides.js's defaultOverrides() now ships
// soundEnabled: true; an explicit mute (setSoundEnabled(false)) persists.
export function isSoundEnabled() {
  return !!loadOverrides().soundEnabled;
}

export function setSoundEnabled(enabled) {
  patchOverrides({ soundEnabled: !!enabled });
  if (!enabled) stopAll();
}

/** Enabled AND armed — the one gate every play path checks. */
function canPlay() {
  return armed && isSoundEnabled();
}

export function stopAll() {
  cancelScheduledVoices();
  cancelScheduledBedRestarts(); // g2 advisory: a pending duck-resume must never start audio after a full stop (A3)
  for (const a of cache.values()) { try { a.pause(); } catch { /* ignore */ } }
}

export function playIntro() { if (canPlay()) safePlay(getAudio('fight-intro.wav')); }
export function playLoop() {
  if (!canPlay()) return;
  const a = getAudio('fight-loop.wav');
  if (!a) return;
  a.loop = true;
  safePlay(a);
}
export function stopLoop() {
  const a = cache.get('fight-loop.wav');
  if (a) a.pause();
}
export function playRoundBeat(roundNumber) {
  if (!canPlay()) return;
  const n = Math.min(5, Math.max(1, roundNumber));
  // Round-3 fix g2 (advisory, R78a "as the 2019 client played it"): the
  // reference's onDuelPlayerRoundStart does THREE things (assets/cw/
  // reference/DuelPlayer/soundManager.js:117,131,136) and f5 ported only the
  // third. Now all three: stop('fightLoop') (:117) — the bed DUCKS under the
  // round beat…
  stopLoop();
  safePlay(getAudio(`fight-round-${n}.wav`));
  // …restart('fightLoop') at +2.2s (:131), except after the final round
  // (`if (round !== 4)` in the reference's 0-based indexing = our round 5;
  // after round 5 the result card's own carryBed() is what resumes it)…
  if (n !== 5) scheduleBedRestart(BED_RESTART_ON_ROUND_START_DELAY_MS);
  // Fix round f5 (R78a/R78): …and the reference's soundManager.js:136 — each
  // round start schedules the NEXT round's vocal sample ("we have to look
  // one round ahead here") at +3.6s, except after the final round.
  if (n !== 5) scheduleVoice(n + 1, VOICE_ON_ROUND_START_DELAY_MS);
}

// ---- Round-3 fix g2 (advisory): the bed's duck-and-resume under round beats --
// Reference soundManager.js:131 — `scheduleOnceIn(2.2, () => this.restart(
// 'fightLoop'))` on every non-final round start. Same offset, plain timers
// (the reference used Tone.Transport, same as the voices above). The pending
// restart is part of the BED's own lifecycle, so stopAllExceptBed() (skip /
// a carry to another bracket-context screen) leaves it pending — the bed
// resumes mid-duck exactly as it would have on the duel screen — while
// stopAll() (leaving the bracket, the kill switch's stop banner, a mute)
// cancels it outright: a timer that STARTS audio must never outlive the A3
// guarantee. The fire re-checks canPlay(), and is idempotent (a bed already
// resumed by carryBed() is left sounding, not reset — the reference's
// restart-from-the-top only ever ran against a stopped loop).
export const BED_RESTART_ON_ROUND_START_DELAY_MS = 2200; // reference soundManager.js:131

const bedTimers = new Set();

function scheduleBedRestart(delayMs) {
  if (!canPlay()) return; // muted/unarmed: schedule nothing (parity with scheduleVoice's gate)
  const handle = setTimeout(() => {
    bedTimers.delete(handle);
    if (!canPlay()) return;
    const a = getAudio('fight-loop.wav');
    if (!a) return;
    a.loop = true;
    if (a.paused === false || a.playing === true) return; // already sounding (carryBed beat us to it) — don't reset it
    safePlay(a);
  }, delayMs);
  if (handle && typeof handle.unref === 'function') handle.unref(); // never hold a Node process open
  bedTimers.add(handle);
}

export function cancelScheduledBedRestarts() {
  for (const handle of bedTimers) clearTimeout(handle);
  bedTimers.clear();
}

// ---- Fix round f5 (R78a/R78): the §18 round voices --------------------------
// `voice-round-1…5.wav` play on the 2019 reference's OWN triggers and
// timings (assets/cw/reference/DuelPlayer/soundManager.js, the in-repo
// authority): voiceRound0 (= voice-round-1.wav) at +2.2s on player-ready
// (:112), and voiceRound{round+1} at +3.6s on each non-final round start
// (:136). Scheduled with plain timers here (the reference used
// Tone.Transport.scheduleOnce — same offsets, different clock); every fire
// re-checks canPlay() so a mute landing inside the window silences the
// voice, and stopAll()/stopAllExceptBed() cancel whatever is still pending.
export const VOICE_ON_READY_DELAY_MS = 2200; // reference soundManager.js:112
export const VOICE_ON_ROUND_START_DELAY_MS = 3600; // reference soundManager.js:136

const voiceTimers = new Set();

function scheduleVoice(n, delayMs) {
  if (!canPlay()) return; // muted/unarmed: schedule nothing (parity with every other play path's gate)
  if (n < 1 || n > 5) return;
  const handle = setTimeout(() => {
    voiceTimers.delete(handle);
    if (canPlay()) safePlay(getAudio(`voice-round-${n}.wav`));
  }, delayMs);
  if (handle && typeof handle.unref === 'function') handle.unref(); // never hold a Node process open
  voiceTimers.add(handle);
}

/** The reveal's player-ready beat: voice-round-1 at +2.2s (soundManager.js:112). */
export function scheduleDuelReadyVoice() {
  scheduleVoice(1, VOICE_ON_READY_DELAY_MS);
}

export function cancelScheduledVoices() {
  for (const handle of voiceTimers) clearTimeout(handle);
  voiceTimers.clear();
}

// ---- Fix round f5 (R78a [LAW]): the bed carries through the bracket ---------
// "the duel audio bed (§18 sound/) plays through the bracket as the 2019
// client played it" — the 2019 sound layer lived at the duel-player level
// and stopped only when the player LEFT that context, never on every
// internal transition. This app renders the bracket context across routes
// (the duel screen's own commit/reveal/result/intermission phases, the
// bracket board, and sitting — the eliminated player's own screen and the
// door to post-elimination spectating), so screen teardowns call
// releaseAudioForRoute(nextRoute): the looping bed CARRIES to another
// bracket-context route (one-shots and pending voices still stop — those
// are duel-reveal beats) and everything stops on leaving the context
// (lobby, wallet, landing, …) exactly as the A3 fix required.
export const BED_ROUTES = ['duel', 'bracket-board', 'sitting'];

export function bedCarriesTo(route) {
  return BED_ROUTES.includes(route);
}

/** Stop every one-shot (intro sting, round beats, voices — fired and
 * pending) but leave the looping bed sounding. */
export function stopAllExceptBed() {
  cancelScheduledVoices();
  for (const [name, a] of cache.entries()) {
    if (name === 'fight-loop.wav') continue;
    try { a.pause(); } catch { /* ignore */ }
  }
}

/** Route-aware teardown: the one call every bracket-context screen makes on
 * unmount, with the route being mounted NEXT (ctx.router.current() inside an
 * onUnmount callback — the hash has already moved by then). */
export function releaseAudioForRoute(nextRoute) {
  if (bedCarriesTo(nextRoute)) stopAllExceptBed();
  else stopAll();
}

/** Idempotent: make sure the bed is sounding (armed + enabled) without
 * resetting its loop point when it already is. The result card calls this —
 * the bed reaches the result even on a path that never ran the reveal
 * (a legacy replay-unavailable duel commits straight to the result card). */
export function carryBed() {
  if (!canPlay()) return;
  const a = getAudio('fight-loop.wav');
  if (!a) return;
  a.loop = true;
  if (a.paused === false || a.playing === true) return; // already sounding — don't reset it
  safePlay(a);
}

// ---- R74a/R78a: the summon ceremony's audio ------------------------------
// The bundle ships no summon-specific WAV; the ceremony opens on the bed's
// own intro sting and carries the loop for its duration — the first thing
// the player hears (R78a), from the same §18 sound set the bracket plays.
export function playSummonCeremony() {
  playIntro();
  playLoop();
}
export function stopSummonCeremony() {
  stopLoop();
}

// ---- R78a: the mute control ----------------------------------------------
/** The visible mute control (R78a: "a mute control visible wherever sound
 * plays") — same class/copy as the duel screen's own toggle, packaged so
 * every surface that plays sound can render one. */
export function soundToggleButton() {
  const label = () => (isSoundEnabled() ? '\uD83D\uDD0A SOUND ON' : '\uD83D\uDD07 SOUND OFF');
  const btn = el('button', {
    class: `cb-sound-toggle${isSoundEnabled() ? ' on' : ''}`,
    onClick: () => {
      setSoundEnabled(!isSoundEnabled());
      btn.className = `cb-sound-toggle${isSoundEnabled() ? ' on' : ''}`;
      btn.innerHTML = '';
      btn.appendChild(document.createTextNode(label()));
    },
  }, label());
  return btn;
}
