// app/ui/components/summon/ceremony.js — CB-BUILD-014 / R74a [LAW]: the
// summon is a CEREMONY. Pressing SUMMON plays the full 2019 summon sequence
// for the chosen element — the bundle's own summon set (summon.json,
// summon-in-progress.json, summon-bg.json, body/hat/hands, sparkles, the
// element's flag and prep — exactly R74a's asset list, played by the shipped
// lottie player, R78: the playback engine stays) — and ends in the REVEAL of
// the actual summoned wizard: its parametric parts and colours drawn LIVE by
// the same rig path the duel stage uses (wizardIdentity -> per-combo shape
// set -> recolorAnimation to the wizard's OWN palette -> canvas player,
// setSubframe(false) — the reference player configuration, mirroring
// rigStage.js/rigAssets.js). Never a generic or pre-baked clip: the reveal
// animationData is this wizard's own recoloured shape set.
//
// t4 coordination (CB-BUILD-022): the identity is DERIVED from the character
// id at read time via the existing derive-style entry points
// (engine/wizardRig.js wizardIdentity/deriveTraits/derivePalette,
// engine/rigRecolor.js recolorAnimation — called, never edited): this module
// passes only { id, element, tier } and never reads summon-time recorded
// identity fields off the ledger.
//
// Phasing, ported from how the shipped client staged the flow (its summon
// screen looped an idle cauldron, played the summon take on the press,
// looped the in-progress take while the summon resolved, then revealed):
//   1. 'sequence' — summon-bg under the full summon take, the chosen
//      element's flag and prep, sparkles;
//   2. 'manifest' — the in-progress loop under the body/hands/hat forming
//      beat (the bundle's wizard-forming takes), sparkles carried through;
//   3. 'reveal'  — the composited summoned wizard itself (rig idle,
//      recoloured live), FIRST SIGHT of the wizard; the caller reveals the
//      name alongside (R59: drawn at commit, shown here first).
// The bundle carries no Air/WIND prep take (fire/water only) — an Air summon
// simply has no prep overlay; everything else is identical.
//
// Degradation contract (stated, not silent — same shape as rigStage.js): a
// missing sequence source drops only that layer (recorded on report); a
// player/import failure or a fully missing sequence skips forward — the
// REVEAL is the beat that must never be lost. A reveal whose shape set is
// bucket-unreachable substitutes the element's vendored fallback shapes,
// still recoloured to the wizard's own palette; only a TOTAL reveal failure
// degrades to the treatment's stated notice. whenRevealed always resolves
// (with the honest report), never rejects — the caller's instrumentation
// and name reveal are never stranded.
import { el } from '../dom.js';
import { wizardIdentity, animationUrl, elementToken } from '../../../engine/wizardRig.js';
import { recolorAnimation } from '../../../engine/rigRecolor.js';

// Paths relative to the HTML document (app/index.html) — GitHub Pages
// subpath safe, same convention as battle/assets.js and rigAssets.js.
const LOTTIE_BASE = '../assets/cw/lottie';
const RIG_FALLBACK_BASE = '../assets/rig';
// Relative to THIS module's URL (dynamic import resolves module-relative).
const VENDOR_PLAYER = '../../../vendor/lottie.min.js';

// The rig state the reveal draws. Idle is the first-sight pose (the same
// state the duel stage opens on).
export const REVEAL_STATE = 'idle';

const ELEMENT_FLAG = { FIRE: 'fireFlag.json', WATER: 'waterFlag.json', WIND: 'windFlag.json' };
const ELEMENT_PREP = { FIRE: 'firePrep.json', WATER: 'waterPrep.json' }; // no WIND prep in the bundle

/**
 * The ceremony's layer plan for one element — R74a's own asset list, one
 * entry per bundle source, with its phase membership, loop flag, and which
 * layer GATES each phase's completion. Exported so tests can assert the
 * full 2019 set is what plays.
 */
export function summonSequenceLayers(elementKey) {
  const token = elementToken(elementKey);
  const layers = [
    { name: 'summon-bg', file: 'summon-bg.json', phases: ['sequence', 'manifest'], loop: true },
    { name: 'summon', file: 'summon.json', phases: ['sequence'], loop: false, gate: 'sequence' },
    { name: 'flag', file: ELEMENT_FLAG[token] || 'neutralFlag.json', phases: ['sequence'], loop: true },
    { name: 'sparkles', file: 'sparkles.json', phases: ['sequence', 'manifest'], loop: true },
    { name: 'summon-in-progress', file: 'summon-in-progress.json', phases: ['manifest'], loop: true },
    { name: 'body', file: 'body.json', phases: ['manifest'], loop: false, gate: 'manifest' },
    { name: 'hands', file: 'hands.json', phases: ['manifest'], loop: false },
    { name: 'hat', file: 'hat.json', phases: ['manifest'], loop: false },
  ];
  const prep = ELEMENT_PREP[token];
  if (prep) layers.splice(3, 0, { name: 'prep', file: prep, phases: ['sequence'], loop: false });
  return layers;
}

// Raw animation JSON, cached by URL for the session (same precedent as
// rigAssets.js's sessionCache — a re-summon never re-fetches).
const sessionCache = new Map();

async function fetchJson(url, fetchImpl, cache) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`summon ceremony fetch failed: ${res.status}`);
  const json = await res.json();
  cache.set(url, json);
  return json;
}

let lottiePromise = null;
function ensureLottie() {
  if (!lottiePromise) {
    // An already-attached player wins (browser UMD attaches
    // globalThis.lottie; tests inject a stub the same way) — the SAME
    // shipped player the rig stage uses (R78: the engine stays).
    if (globalThis.lottie && typeof globalThis.lottie.loadAnimation === 'function') {
      lottiePromise = Promise.resolve(globalThis.lottie);
    } else {
      lottiePromise = import(VENDOR_PLAYER).then((mod) => {
        const player = globalThis.lottie || (mod && mod.default) || mod;
        if (!player || typeof player.loadAnimation !== 'function') throw new Error('summon player failed to attach');
        return player;
      });
    }
  }
  return lottiePromise;
}

/**
 * Build the summon ceremony for one just-summoned character.
 * `character` is { id, element, tier } — identity is DERIVED from the id
 * (t4/CB-BUILD-022 coordination), never read off recorded ledger fields.
 *
 * Returns { root, identity, report, whenRevealed, phase(), destroy }:
 *  - whenRevealed resolves (never rejects) with the honest degradation
 *    report once the reveal — first sight of the wizard — is on screen.
 */
export function createSummonCeremony({ character, treatment, fetchImpl, cache } = {}) {
  const doFetch = fetchImpl || ((url) => fetch(url));
  const rawCache = cache || sessionCache;
  const identity = wizardIdentity({ id: character.id, element: character.element, tier: character.tier || 0 });
  const layers = summonSequenceLayers(character.element);

  const report = {
    // sequence sources that failed to load (dropped layers, by name)
    missingSequence: [],
    // the whole animated sequence was skipped (player/import failure or no
    // gate source at all) — the reveal still happened
    sequenceDegraded: false,
    // the reveal's shape set came from the vendored fallback (bucket down)
    revealFallback: false,
    // TOTAL reveal failure — no rig draw at all; the stated notice rendered
    revealDegraded: false,
    // the reveal shape set carried no palette slot classes (colour baked at
    // export) — recorded, never hidden (same honesty guard as rigAssets.js)
    unslottedReveal: false,
  };

  const mounts = {}; // layer name -> element
  const anims = {};  // layer name -> lottie instance
  let revealAnim = null;
  let currentPhase = null;
  let destroyed = false;

  const stack = el('div', { class: 'cb-summon-stack' },
    layers.map((layer) => {
      const mount = el('div', { class: 'cb-summon-anim', 'data-anim': layer.name });
      mounts[layer.name] = mount;
      return mount;
    }));
  const revealMount = el('div', { class: 'cb-summon-wizard', 'data-anim': 'reveal-wizard' });
  const root = el('div', { class: 'cb-summon-ceremony loading' }, [stack, revealMount]);

  // ---- preload: every sequence source + the wizard's own recoloured shape
  // set, in memory before anything plays (R74's preload-never-refetch rule,
  // carried to the ceremony).
  const sequenceData = {}; // layer name -> animation JSON
  let revealData = null;

  const preload = (async () => {
    await Promise.all([
      ...layers.map(async (layer) => {
        try {
          sequenceData[layer.name] = await fetchJson(`${LOTTIE_BASE}/${layer.file}`, doFetch, rawCache);
        } catch {
          report.missingSequence.push(layer.name);
        }
      }),
      (async () => {
        let raw = null;
        try {
          raw = await fetchJson(animationUrl(REVEAL_STATE, identity.comboKey), doFetch, rawCache);
        } catch {
          try {
            report.revealFallback = true;
            raw = await fetchJson(`${RIG_FALLBACK_BASE}/fallback/${elementToken(identity.element)}/${REVEAL_STATE}.json`, doFetch, rawCache);
          } catch {
            report.revealDegraded = true;
          }
        }
        if (raw) {
          // Recoloured LIVE to this wizard's own palette — the actual
          // summoned wizard, never a generic or source-coloured clip.
          const { animation, stats } = recolorAnimation(raw, identity.palette);
          if (stats.recoloured === 0) report.unslottedReveal = true;
          revealData = animation;
        }
      })(),
    ]);
  })();

  function setPhase(phase) {
    currentPhase = phase;
    for (const layer of layers) {
      const on = phase !== 'reveal' && layer.phases.includes(phase) && !!anims[layer.name];
      mounts[layer.name].classList.toggle('visible', on);
      const anim = anims[layer.name];
      if (!anim) continue;
      if (on) {
        try { anim.goToAndStop(0, true); anim.play(); } catch { /* best-effort */ }
      } else {
        try { anim.pause(); } catch { /* best-effort */ }
      }
    }
    root.classList.remove('phase-sequence', 'phase-manifest', 'phase-reveal');
    root.classList.add(`phase-${phase}`);
  }

  const gateResolvers = []; // resolved early by destroy() so teardown never strands whenRevealed
  function gateComplete(gateName) {
    const anim = anims[gateName];
    if (!anim || destroyed) return Promise.resolve();
    return new Promise((resolve) => {
      gateResolvers.push(resolve);
      anim.addEventListener('complete', resolve);
    });
  }

  const whenRevealed = (async () => {
    const lottieImport = ensureLottie();
    lottieImport.catch(() => {});
    let lottie = null;
    try { lottie = await lottieImport; } catch { lottie = null; }
    await preload;
    if (destroyed) return report;
    root.classList.remove('loading');

    if (lottie) {
      for (const layer of layers) {
        if (!sequenceData[layer.name]) continue;
        const anim = lottie.loadAnimation({
          container: mounts[layer.name],
          renderer: 'canvas',
          autoplay: false,
          loop: !!layer.loop,
          animationData: sequenceData[layer.name],
        });
        anim.setSubframe(false);
        anims[layer.name] = anim;
      }
      if (revealData) {
        revealAnim = lottie.loadAnimation({
          container: revealMount,
          renderer: 'canvas',
          autoplay: false,
          loop: true,
          animationData: revealData,
        });
        revealAnim.setSubframe(false);
      }
    }

    // Phase 1 — the full summon take for the chosen element.
    if (lottie && anims['summon']) {
      setPhase('sequence');
      await gateComplete('summon');
    } else {
      report.sequenceDegraded = true;
    }
    if (destroyed) return report;

    // Phase 2 — the forming beat (in-progress loop under body/hands/hat).
    if (lottie && anims['body']) {
      setPhase('manifest');
      await gateComplete('body');
    }
    if (destroyed) return report;

    // Phase 3 — FIRST SIGHT: the actual summoned wizard, drawn by the rig.
    setPhase('reveal');
    if (revealAnim) {
      revealMount.classList.add('visible');
      try { revealAnim.goToAndStop(0, true); revealAnim.play(); } catch { /* best-effort */ }
    } else {
      report.revealDegraded = true;
      root.classList.add('degraded');
      // Honest, player-language degradation — the treatment's own stated
      // notice (prose face), same copy contract as the duel stage's.
      root.appendChild(el('div', { class: 'cb-rig-degraded-notice cb-prose' }, treatment.copy.stageDegradedNotice));
    }
    return report;
  })();

  function destroy() {
    destroyed = true;
    for (const resolve of gateResolvers.splice(0)) { try { resolve(); } catch { /* ignore */ } }
    for (const anim of Object.values(anims)) { try { anim.destroy(); } catch { /* ignore */ } }
    if (revealAnim) { try { revealAnim.destroy(); } catch { /* ignore */ } }
  }

  return { root, identity, report, whenRevealed, phase: () => currentPhase, destroy };
}
