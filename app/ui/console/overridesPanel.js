// app/ui/console/overridesPanel.js — O1-O10 switches (R14/AC0 row 1): every
// open item switchable live from the console, writing consoleOverrides,
// each showing its default + alternatives from tunables.json/treatments.
import { el } from '../components/dom.js';
import { patchOverrides, effectiveHypothesisId } from '../../engine/overrides.js';
import { HYPOTHESIS_CARDS, hypothesisCard } from '../../engine/hypotheses.js';

function radioGroup({ name, options, value, onChange }) {
  return el('div', { class: 'cb-console-radio-row' }, options.map((opt) =>
    el('label', { class: `cb-console-radio${opt.value === value ? ' selected' : ''}` }, [
      el('input', {
        type: 'radio', name, checked: opt.value === value,
        onChange: () => onChange(opt.value),
      }),
      el('span', {}, opt.label),
    ])
  ));
}

export function renderOverridesPanel({ overrides, tunables, refresh }) {
  const set = (patch) => { patchOverrides(patch); refresh(); };

  const rows = [];

  // O1: Theme
  rows.push(fieldRow('O1', 'Theme', radioGroup({
    name: 'o1', value: overrides.treatmentId || 'incumbent',
    options: [
      { value: 'incumbent', label: 'Incumbent (default)' },
      { value: 'adjacent', label: 'Adjacent — Scrapyard Kings' },
      { value: 'far', label: 'Far — Undercard' },
    ],
    onChange: (v) => set({ treatmentId: v === 'incumbent' ? null : v }),
  }), 'Switches the whole skin: colors, fonts, nouns, narrator voice, name pool.'));

  // O2: price door arm
  rows.push(fieldRow('O2', 'Displayed entry price', radioGroup({
    name: 'o2', value: overrides.priceDoorArm || 'default',
    options: [
      { value: 'default', label: `$${tunables.priceDoorArms.displayedEntryPriceDefaultUSD} (default)` },
      { value: 'under', label: `$${tunables.priceDoorArms.alternatives.under} (under)` },
      { value: 'over', label: `$${tunables.priceDoorArms.alternatives.over} (over)` },
      { value: 'freePlay', label: 'Free play' },
    ],
    onChange: (v) => set({ priceDoorArm: v }),
  }), 'Door-arm price randomization (R19/O2). Read at the door; the gate cell stays $10.'));

  // O3: legs hypothesis (C13/f2: a REAL switch now -- selects the ACTIVE
  // manifest hypothesis; each card's participant-facing surface appears
  // only when its id is active, app/engine/overrides.js:effectiveHypothesisId).
  // f4/N4 fix: "none" is a real, explicit, SELECTED-BY-DEFAULT option -- a
  // default install renders none of the six surfaces (R6: each hypothesis
  // runs in a later envelope; this build only needs "switchable at
  // delivery", AC0 row 1, not "on by default").
  const activeHypothesisId = effectiveHypothesisId(overrides);
  const NONE_VALUE = 'none';
  rows.push(fieldRow('O3', 'Legs hypothesis', radioGroup({
    name: 'o3', value: activeHypothesisId || NONE_VALUE,
    options: [
      { value: NONE_VALUE, label: 'none (manifest order — each hypothesis runs in a later envelope, R6)' },
      ...HYPOTHESIS_CARDS.map((c) => ({ value: c.id, label: `(${c.order}) ${c.title}` })),
    ],
    onChange: (v) => set({ activeHypothesis: v === NONE_VALUE ? null : v }),
  }), activeHypothesisId
    ? `${hypothesisCard(activeHypothesisId).fairTestLine} Each hypothesis runs only in a later envelope (R6) for the REAL run; here it demonstrates switchable at delivery (AC0 row 1).`
    : 'No manifest hypothesis active -- the default. Each of the six is demonstrated switchable at delivery (AC0 row 1); none renders its surface until explicitly switched on here.'));

  // O4: run activation
  rows.push(fieldRow('O4', 'Run activation', radioGroup({
    name: 'o4', value: overrides.runActivation || tunables.runActivation.default,
    options: [
      { value: 'console', label: 'Console action (default)' },
      { value: 'autoStartOnDeliveryAcceptance', label: 'Auto-start on delivery acceptance' },
    ],
    onChange: (v) => set({ runActivation: v }),
  }), 'Fewer console actions; gates unchanged.'));

  // O5: commit window
  rows.push(fieldRow('O5', 'Commit window', radioGroup({
    name: 'o5', value: overrides.commitWindowSec ?? tunables.timers.commitWindowSec.default,
    options: [tunables.timers.commitWindowSec.default, ...tunables.timers.commitWindowSec.alternatives].map((v) => ({ value: v, label: `${v}s` })),
    onChange: (v) => set({ commitWindowSec: Number(v) }),
  }), 'Live: the duel screen\u2019s commit clock changes immediately (R14 demonstration).'));

  // O6: lobby human wait
  rows.push(fieldRow('O6', 'Lobby human wait', radioGroup({
    name: 'o6', value: overrides.lobbyHumanWaitSec ?? tunables.timers.lobbyHumanWaitSec.default,
    options: [tunables.timers.lobbyHumanWaitSec.default, ...tunables.timers.lobbyHumanWaitSec.alternatives].map((v) => ({ value: v, label: `${v}s` })),
    onChange: (v) => set({ lobbyHumanWaitSec: Number(v) }),
  })));

  // O7: house-opponent fill density
  const fillOptions = [tunables.npcFillDensity.default, ...tunables.npcFillDensity.alternatives];
  rows.push(fieldRow('O7', 'House-opponent fill density', radioGroup({
    name: 'o7', value: overrides.npcFillDensityId || tunables.npcFillDensity.default.id,
    options: fillOptions.map((o) => ({ value: o.id, label: o.id === 'fillTo8' ? 'Fill to 8 (default)' : `Fill to 8, \u22652 humans required` })),
    onChange: (v) => set({ npcFillDensityId: v }),
  }), 'C14: on this single device there is only ever ONE real human, so "\u22652 humans required" can never be satisfied by a live 2nd join. Honest demo semantics: the shortfall seat is held open ("waiting for a 2nd human") instead of NPC-filled, up to the O6 wait; at that deadline it falls back to an NPC fill anyway (a lobby cannot wait forever) \u2014 see app/engine/sync.js buildFillPlan/advanceLobby.'));

  // O8: Load Funds presets
  const presetOptions = [tunables.loadFundsPresets.default, ...tunables.loadFundsPresets.alternatives];
  rows.push(fieldRow('O8', 'Load Funds presets', radioGroup({
    name: 'o8', value: String(overrides.loadFundsPresetsIndex ?? 0),
    options: presetOptions.map((o, i) => ({ value: String(i), label: o.label })),
    onChange: (v) => set({ loadFundsPresetsIndex: Number(v) }),
  })));

  // O9: reveal cadence
  rows.push(fieldRow('O9', 'Reveal cadence', radioGroup({
    name: 'o9', value: overrides.revealCadenceMs ?? tunables.timers.revealCadenceMs.default,
    options: [tunables.timers.revealCadenceMs.default, ...tunables.timers.revealCadenceMs.alternatives].map((v) => ({ value: v, label: `${v}ms` })),
    onChange: (v) => set({ revealCadenceMs: Number(v) }),
  }), 'Live: the battle presentation\u2019s per-beat cadence (R75).'));

  // O10: narrator temperature
  rows.push(fieldRow('O10', 'Narrator temperature', radioGroup({
    name: 'o10', value: overrides.narratorTemperature ?? tunables.narrator.temperature.default,
    options: [tunables.narrator.temperature.default, ...tunables.narrator.temperature.alternatives].map((v) => ({ value: v, label: String(v) })),
    onChange: (v) => set({ narratorTemperature: Number(v) }),
  }), 'Carried as data for the future live model call (t1); the deterministic local engine does not vary output on this value.'));

  // R75 presentation-moment candidate switches (coverage-gap moments)
  const momentRow = (key, label) => fieldRow(`Moment`, label, radioGroup({
    name: `moment-${key}`, value: overrides.presentationMoments?.[key] || 1,
    options: [{ value: 1, label: 'Candidate 1 (default)' }, { value: 2, label: 'Candidate 2' }],
    onChange: (v) => set({ presentationMoments: { ...overrides.presentationMoments, [key]: Number(v) } }),
  }));
  rows.push(momentRow('floorDrain', 'Floor-drain moment'));
  rows.push(momentRow('coinFlip', 'Coin-flip moment'));
  rows.push(momentRow('prizeAward', 'Prize-award moment'));

  return el('section', { class: 'cb-console-section' }, [
    el('h2', {}, 'O-item switches (O1\u2013O10)'),
    el('p', { class: 'cb-micro' }, 'Every open item is switchable live; each write lands in localStorage `consoleOverrides` and is read by the engine/UI on the next render \u2014 no reload required for most switches.'),
    ...rows,
  ]);
}

function fieldRow(oId, label, control, note) {
  return el('div', { class: 'cb-console-field' }, [
    el('div', { class: 'cb-console-field-label' }, [el('span', { class: 'cb-console-oid' }, oId), ' ', label]),
    control,
    note ? el('div', { class: 'cb-micro cb-console-note' }, note) : null,
  ]);
}
