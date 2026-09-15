// app/ui/components/battle/sound.js — R10 sound, ported to the reference
// implementation's own schedule (CB-BUILD-005): the bundle's fight-intro/
// fight-loop/fight-round-N/voice-round-N WAVs, triggered at exactly the
// offsets the shipped 2019 soundManager used
// (assets/cw-asset-bundle/reference/DuelPlayer/soundManager.js):
//   duel ready  → fight-intro; fight-loop at +1.8s; voice-round-1 at +2.2s
//   round start → stop loop; fight-round-N; and unless it is the final
//                 round: restart loop at +2.2s, NEXT round's voice at +3.6s
// All of it sits behind the default-OFF toggle (autoplay policies: a
// browser will reject/ignore audio.play() before a user gesture, so every
// call here is best-effort and never throws).
import { soundUrl } from './assets.js';
import { loadOverrides, patchOverrides } from '../../../engine/overrides.js';

// The reference implementation's timing constants, verbatim (soundManager.js
// scheduleOnceIn calls). Conformance-checked against the reference file by
// app/tests/battle-stage-port.test.js.
export const REFERENCE_SOUND_SCHEDULE = Object.freeze({
  loopAfterIntroSec: 1.8,
  firstVoiceSec: 2.2,
  loopRestartAfterRoundSec: 2.2,
  nextVoiceAfterRoundSec: 3.6,
  totalRounds: 5,
});

// The full sample set the reference loads (12 bites), mapped to the
// bundle's own files.
export const DUEL_SAMPLES = Object.freeze([
  'fight-intro.wav', 'fight-loop.wav',
  'fight-round-1.wav', 'fight-round-2.wav', 'fight-round-3.wav', 'fight-round-4.wav', 'fight-round-5.wav',
  'voice-round-1.wav', 'voice-round-2.wav', 'voice-round-3.wav', 'voice-round-4.wav', 'voice-round-5.wav',
]);

const cache = new Map();
function getAudio(name) {
  if (!cache.has(name)) {
    const a = new Audio(soundUrl(name));
    a.preload = 'none';
    cache.set(name, a);
  }
  return cache.get(name);
}

function safePlay(a) {
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => {}); // autoplay-policy rejection: ignore
  } catch { /* ignore */ }
}

export function isSoundEnabled() {
  return !!loadOverrides().soundEnabled;
}

export function setSoundEnabled(enabled) {
  patchOverrides({ soundEnabled: !!enabled });
  // CB-BUILD-fix-round-1 #3: the toggle stops AUDIO only. It used to call
  // stopAll(), which also fired (and nulled) the presentation freeze hook —
  // flipping SOUND OFF mid-reveal paused every wizard player (a looping
  // idle never recovers) AND disarmed the real unmount teardown's freeze.
  if (!enabled) stopAudio();
}

// ---- scheduling (the reference's Tone.Transport, ported to timeouts) --------

const scheduled = new Set();
function scheduleOnceIn(seconds, fn) {
  const handle = setTimeout(() => { scheduled.delete(handle); fn(); }, Math.round(seconds * 1000));
  scheduled.add(handle);
  return handle;
}
function clearScheduled() {
  for (const h of scheduled) clearTimeout(h);
  scheduled.clear();
}

// CB-BUILD-005: the battle stage registers a freeze hook so stopAll() (the
// duel screen's one teardown path — unmount, skip, result) also pauses the
// visual players, not just the audio bed. One hook at a time; the active
// stage owns it.
let presentationFreezeHook = null;
export function setPresentationFreezeHook(fn) {
  presentationFreezeHook = typeof fn === 'function' ? fn : null;
}

/** CB-BUILD-fix-round-2 (re-review A): a stage that is destroyed must
 * release its freeze-hook ownership — but ONLY if it still owns the hook.
 * Identity-compared, so a stale stage's late destroy (the orphan-preload
 * path) can never disarm the hook a NEWER live stage has since taken. */
export function releasePresentationFreezeHook(fn) {
  if (presentationFreezeHook === fn) presentationFreezeHook = null;
}

/** CB-BUILD-fix-round-1 #3: stop the AUDIO bed alone — cancel every
 * scheduled sample and pause everything playing. Never touches the
 * presentation freeze hook, so the SOUND toggle can call it mid-reveal
 * without freezing the combatants or disarming the unmount teardown. */
export function stopAudio() {
  clearScheduled();
  for (const a of cache.values()) { try { a.pause(); } catch { /* ignore */ } }
}

/** The full teardown path (unmount / skip / result): stop the audio bed AND
 * fire the one-shot presentation freeze hook so the visual players pause
 * with it. The sound toggle must NOT call this — see stopAudio above. */
export function stopAll() {
  stopAudio();
  if (presentationFreezeHook) {
    const hook = presentationFreezeHook;
    presentationFreezeHook = null;
    try { hook(); } catch { /* ignore */ }
  }
}

/** Warm the duel audio bed alongside the animation preload (the reference
 * loaded every sample before the duel; Audio preload is the browser-native
 * equivalent). Best-effort. */
export function preloadDuelAudio() {
  for (const name of DUEL_SAMPLES) {
    try { getAudio(name).preload = 'auto'; } catch { /* ignore */ }
  }
}

export function playIntro() { if (isSoundEnabled()) safePlay(getAudio('fight-intro.wav')); }
export function playLoop() {
  if (!isSoundEnabled()) return;
  const a = getAudio('fight-loop.wav');
  a.loop = true;
  safePlay(a);
}
export function stopLoop() {
  const a = cache.get('fight-loop.wav');
  if (a) a.pause();
}
export function playRoundBeat(roundNumber) {
  if (!isSoundEnabled()) return;
  const n = Math.min(5, Math.max(1, roundNumber));
  safePlay(getAudio(`fight-round-${n}.wav`));
}
function playVoice(roundNumber) {
  if (!isSoundEnabled()) return;
  const n = Math.min(5, Math.max(1, roundNumber));
  safePlay(getAudio(`voice-round-${n}.wav`));
}

/** The reference's onDuelPlayerReady, verbatim schedule: intro now, the
 * loop at +1.8s, the round-1 voice at +2.2s. */
export function scheduleDuelStart() {
  if (!isSoundEnabled()) return;
  playIntro();
  scheduleOnceIn(REFERENCE_SOUND_SCHEDULE.loopAfterIntroSec, () => playLoop());
  scheduleOnceIn(REFERENCE_SOUND_SCHEDULE.firstVoiceSec, () => playVoice(1));
}

/** The reference's onDuelPlayerRoundStart, verbatim schedule. `roundIndex`
 * is 0-based (0–4), exactly as the reference passes it. */
export function scheduleRoundStart(roundIndex) {
  if (!isSoundEnabled()) return;
  stopLoop();
  playRoundBeat(roundIndex + 1);
  if (roundIndex !== REFERENCE_SOUND_SCHEDULE.totalRounds - 1) {
    scheduleOnceIn(REFERENCE_SOUND_SCHEDULE.loopRestartAfterRoundSec, () => playLoop());
    scheduleOnceIn(REFERENCE_SOUND_SCHEDULE.nextVoiceAfterRoundSec, () => playVoice(roundIndex + 2));
  }
}
