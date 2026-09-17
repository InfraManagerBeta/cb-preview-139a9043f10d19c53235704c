// app/engine/overrides.js
// R14/O1-O10 + console actions: a persisted "override layer" the engine/UI
// read on top of tunables.json + the active treatment. Nothing here mutates
// the shipped data files — this module reads/writes a separate localStorage
// key (`consoleOverrides`) and exposes pure functions to compute "effective"
// values so the same code path runs identically in Node (tests, an
// in-memory adapter) and the browser (real localStorage).
//
// This is the concrete mechanism behind R14: "the console is where O-item
// alternatives are demonstrated switchable... make each switch visibly
// change the running app."

import { createMemoryStorage } from './ledger.js';

const OVERRIDES_KEY = 'consoleOverrides';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return createMemoryStorage();
}

export function defaultOverrides() {
  return {
    // ---- O-items (O1-O10) ----
    treatmentId: null,          // O1: null => tunables/treatment default ('incumbent')
    priceDoorArm: null,         // O2: null | 'under' | 'over' | 'freePlay' | 'default'
    legsHypothesis: null,       // O3: null => manifest order R26 default (card 1)
    runActivation: null,        // O4: null | 'console' | 'autoStartOnDeliveryAcceptance'
    commitWindowSec: null,      // O5: null => tunables default
    lobbyHumanWaitSec: null,    // O6: null => tunables default
    npcFillDensityId: null,     // O7: null | 'fillTo8' | 'fillTo8Min2Humans'
    loadFundsPresetsIndex: null,// O8: null => default; 0 => default, 1.. => alternatives[n-1]
    revealCadenceMs: null,      // O9: null => tunables default
    narratorTemperature: null, // O10: null => tunables default

    // C9/AC0 workbook row: a hand-edit-equivalent override layer over
    // tunables.gate.* (thresholds AND the sequential rule's own numbers --
    // minLookN/maxN/totalAlphaOneSided/futilityZ) -- the SAME object shape
    // as tunables.json's "gate" key, patched over it by effectiveTunables()
    // below. This is the one channel gate.js's classification, the console
    // display, AND runSimulator.js's pre-registration text all read through
    // effectiveTunables(), so a console-side threshold change propagates to
    // all three exactly like a hand edit to tunables.json itself would.
    gateOverrides: {}, // e.g. { reservationRateThreshold: 0.30 } or { sequentialRule: { maxN: 40 } }

    // O3/R26: which of the six manifest hypotheses is the ACTIVE one (C13).
    // null => manifest order default (card 1: scouting reports).
    activeHypothesis: null,

    // ---- console actions / state (A-list, kill switch, run) ----
    killSwitch: false,
    killSwitchReason: null,
    runStarted: false,
    runStartedAt: null,
    runCapsFrozen: false,
    perArmCapsUSD: {},          // armId -> costPerReservationCapUSD, editable pre-freeze
    brandDecisions: {},         // treatmentId -> 'accepted' | 'rejected'
    riskSignoffs: {},           // family id (docs/risk-dossier.md) -> 'signed' | 'rejected'
    custodyActions: {},         // action id -> { done: true, ts }

    // ---- presentation coverage-gap moment choices (R75) ----
    presentationMoments: { floorDrain: 1, coinFlip: 1, prizeAward: 1 }, // candidate # (1 or 2)
    // CB-BUILD-016/R78a [LAW]: sound is ON by default (the prior false was
    // a guess no rule backed). An explicit mute persists as false here.
    soundEnabled: true,

    // run seed, for reproducibility across a console session
    runSeed: 20260910,
  };
}

export function loadOverrides(storage) {
  const s = resolveStorage(storage);
  try {
    const raw = s.getItem(OVERRIDES_KEY);
    if (!raw) return defaultOverrides();
    return { ...defaultOverrides(), ...JSON.parse(raw) };
  } catch {
    return defaultOverrides();
  }
}

export function saveOverrides(overrides, storage) {
  const s = resolveStorage(storage);
  s.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  return overrides;
}

export function patchOverrides(patch, storage) {
  const current = loadOverrides(storage);
  const next = { ...current, ...patch };
  saveOverrides(next, storage);
  return next;
}

export function resetOverrides(storage) {
  const next = defaultOverrides();
  saveOverrides(next, storage);
  return next;
}

/**
 * Compute the effective timers/tunables object given the shipped tunables
 * and the current override layer. Returns a NEW object (tunables.json's
 * loaded object is never mutated) with override leaves applied over the
 * 'default' slot of each O-item, so every other engine/UI read-path
 * (`tunables.timers.commitWindowSec.default`, etc.) keeps working -- callers
 * that want the live value should read `effectiveTunables(...).timers...`.
 */
export function effectiveTunables(tunables, overrides) {
  const eff = JSON.parse(JSON.stringify(tunables));
  if (overrides.commitWindowSec != null) eff.timers.commitWindowSec.default = overrides.commitWindowSec;
  if (overrides.lobbyHumanWaitSec != null) eff.timers.lobbyHumanWaitSec.default = overrides.lobbyHumanWaitSec;
  if (overrides.revealCadenceMs != null) eff.timers.revealCadenceMs.default = overrides.revealCadenceMs;
  if (overrides.narratorTemperature != null) eff.narrator.temperature.default = overrides.narratorTemperature;
  if (overrides.npcFillDensityId != null) {
    const alt = [eff.npcFillDensity.default, ...eff.npcFillDensity.alternatives].find((a) => a.id === overrides.npcFillDensityId);
    if (alt) eff.npcFillDensity.default = alt;
  }
  if (overrides.loadFundsPresetsIndex != null) {
    const options = [eff.loadFundsPresets.default, ...eff.loadFundsPresets.alternatives];
    const picked = options[overrides.loadFundsPresetsIndex];
    if (picked) eff.loadFundsPresets.default = picked;
  }
  if (overrides.runActivation != null) eff.runActivation.default = overrides.runActivation;
  if (overrides.priceDoorArm != null && overrides.priceDoorArm !== 'default') {
    const usd = eff.priceDoorArms.alternatives[overrides.priceDoorArm];
    if (usd != null) eff.priceDoorArms.displayedEntryPriceDefaultUSD = usd;
  }
  // C9: a gate-override patch -- deep-merged one level so
  // `{ sequentialRule: { maxN: 40 } }` doesn't clobber the rest of
  // `sequentialRule` (minLookN, totalAlphaOneSided, etc).
  if (overrides.gateOverrides && Object.keys(overrides.gateOverrides).length > 0) {
    const patch = overrides.gateOverrides;
    const mergedSequentialRule = patch.sequentialRule
      ? { ...eff.gate.sequentialRule, ...patch.sequentialRule }
      : eff.gate.sequentialRule;
    eff.gate = { ...eff.gate, ...patch, sequentialRule: mergedSequentialRule };
  }
  return eff;
}

/** Resolve which treatment id the running app should load, honoring O1.
 *
 * C13/O3 fix (f2): when the "theme change" manifest hypothesis (card 6) is
 * the ACTIVE hypothesis, the theme follows the door-yield THEME WINNER
 * recorded by the last console run (`overrides.lastDoorYieldThemeWinnerId`,
 * written by app/ui/console/runPanel.js after `buildDoorYieldReport`) --
 * "the named theme (R22) applied to the retention configuration," reusing
 * O1's own mechanism (this same function) rather than inventing a second
 * theme-switch path. Falls back to the normal O1 resolution if no run has
 * been made yet, or when a different (or no) hypothesis is active. */
export function effectiveTreatmentId(overrides, fallback = 'incumbent') {
  if (effectiveHypothesisId(overrides) === 'theme_change' && overrides.lastDoorYieldThemeWinnerId) {
    return overrides.lastDoorYieldThemeWinnerId;
  }
  return overrides.treatmentId || fallback;
}

/** C13/O3: which of the six R26 manifest-hypothesis cards is ACTIVE.
 * f4/N4 fix: defaults to NONE (`null`) -- a default install/build must not
 * render ANY of the six hypothesis surfaces; R6 runs each hypothesis in a
 * LATER envelope (this build only needs to demonstrate each is switchable
 * at delivery, AC0 row 1), so "manifest order card 1 selected by default"
 * was wrong -- it silently activated card 1's surface (the scouting-
 * reports panel) inside the gate cell on every default install with no
 * operator action at all. The console's O3 radio group carries an explicit
 * "none (manifest order — each hypothesis runs in a later envelope, R6)"
 * option, selected by default, so the "none" state is a first-class,
 * visible choice rather than an implicit fallback. */
export function effectiveHypothesisId(overrides) {
  return overrides.activeHypothesis || null;
}

export { OVERRIDES_KEY };
