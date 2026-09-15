// app/ui/console/actionsPanel.js — CONSOLE ACTIONS: kill switch, run
// activation (A3/O4), per-arm caps editor (frozen once the run starts, R6/
// A2), brand accept/reject per treatment (R22 brand-rejection advance,
// record only), A-list custody actions as named one-click items, and the
// risk-register sign-off list (docs/risk-dossier.md families).
import { el } from '../components/dom.js';
import { patchOverrides } from '../../engine/overrides.js';
import { armDefinitions } from '../../engine/runSimulator.js';
import { parseRiskFamilies } from './riskParser.js';

const CUSTODY_ACTIONS = [
  { id: 'ad-token-renew', label: 'Renew ad-platform API token' },
  { id: 'payment-method-rotate', label: 'Rotate payment method' },
  { id: 'hosting-key-renew', label: 'Renew hosting credentials' },
  { id: 'model-key-renew', label: 'Renew model-provider key' },
  { id: 'identity-verification', label: 'Complete platform identity verification' },
  { id: 'document-appeal', label: 'Submit document-upload appeal' },
];

// R22: a rejected treatment's door arm advances the runner-up (record only
// -- the runner-up build is out of scope for this ticket).
const RUNNER_UP = {
  adjacent: { name: 'Cryptid Circuit', card: 'docs/concept-cards.md#A2' },
  far: { name: 'Open Outcry', card: 'docs/concept-cards.md#F2' },
};

function killSection({ overrides, refresh }) {
  const isKilled = !!overrides.killSwitch;
  return el('div', { class: `cb-card cb-console-kill${isKilled ? ' active' : ''}` }, [
    el('h3', {}, 'Kill switch (A4)'),
    el('p', { class: 'cb-micro' }, isKilled
      ? `STOPPED (reason: ${overrides.killSwitchReason || 'console'}). The participant app renders a stopped-state banner on every route.`
      : 'The run and the participant app are live.'),
    el('div', { class: 'cb-tag-row' }, [
      el('button', {
        class: 'cb-btn danger',
        onClick: () => { patchOverrides({ killSwitch: true, killSwitchReason: 'console', killSwitchAt: Date.now() }); refresh(); },
      }, 'KILL NOW'),
      el('button', {
        class: 'cb-btn secondary',
        onClick: () => { patchOverrides({ killSwitch: false, killSwitchReason: null }); refresh(); },
      }, 'Clear (resume)'),
    ]),
    el('p', { class: 'cb-micro' }, 'Second kill path, independent of this console: append ?kill=1 to the participant app\u2019s URL (e.g. app/index.html?kill=1) \u2014 it sets the same switch with no console interaction at all.'),
  ]);
}

function runActivationSection({ overrides, tunables, refresh }) {
  return el('div', { class: 'cb-card' }, [
    el('h3', {}, 'Run activation (A3/O4)'),
    el('p', { class: 'cb-micro' }, `Mode: ${overrides.runActivation || tunables.runActivation.default}`),
    overrides.runStarted
      ? el('p', {}, [el('span', { class: 'cb-badge win' }, 'RUN ACTIVE'), ` since ${new Date(overrides.runStartedAt).toLocaleString()}`])
      : el('button', {
        class: 'cb-btn win',
        onClick: () => { patchOverrides({ runStarted: true, runStartedAt: Date.now(), runCapsFrozen: true }); refresh(); },
      }, 'ACTIVATE RUN'),
    overrides.runStarted ? el('p', { class: 'cb-micro' }, 'Per-arm caps are now frozen (R6/A2) \u2014 editable again only after this run closes.') : null,
  ]);
}

function capsEditorSection({ overrides, refresh }) {
  const arms = armDefinitions();
  const frozen = !!overrides.runCapsFrozen;
  return el('div', { class: 'cb-card' }, [
    el('h3', {}, `Per-arm cost-per-reservation caps${frozen ? ' (FROZEN)' : ''}`),
    el('div', { class: 'cb-list' }, arms.map((arm) => {
      const current = overrides.perArmCapsUSD?.[arm.id] ?? 100;
      const input = el('input', {
        type: 'number', value: current, class: 'cb-console-input', disabled: frozen,
        onChange: (e) => {
          const next = { ...(overrides.perArmCapsUSD || {}), [arm.id]: Number(e.target.value) };
          patchOverrides({ perArmCapsUSD: next });
          refresh();
        },
      });
      return el('div', { class: 'cb-console-field' }, [el('span', { class: 'cb-micro' }, arm.label), input]);
    })),
  ]);
}

function brandSection({ overrides, refresh }) {
  return el('div', { class: 'cb-card' }, [
    el('h3', {}, 'Brand accept/reject per treatment (A3)'),
    el('div', { class: 'cb-list' }, ['adjacent', 'far'].map((id) => {
      const decision = overrides.brandDecisions?.[id];
      const label = id === 'adjacent' ? 'Scrapyard Kings' : 'Undercard';
      return el('div', { class: 'cb-console-field' }, [
        el('span', {}, [label, decision ? el('span', { class: `cb-badge ${decision === 'accepted' ? 'win' : 'loss'}` }, decision.toUpperCase()) : null]),
        el('div', { class: 'cb-tag-row' }, [
          el('button', { class: 'cb-btn win', onClick: () => { patchOverrides({ brandDecisions: { ...overrides.brandDecisions, [id]: 'accepted' } }); refresh(); } }, 'Accept'),
          el('button', { class: 'cb-btn danger', onClick: () => { patchOverrides({ brandDecisions: { ...overrides.brandDecisions, [id]: 'rejected' } }); refresh(); } }, 'Reject'),
        ]),
        decision === 'rejected' ? el('p', { class: 'cb-micro' }, `R22 advance: runner-up ${RUNNER_UP[id].name} (${RUNNER_UP[id].card}) advances at this position \u2014 recorded only; its build is out of scope for this ticket.`) : null,
      ]);
    })),
  ]);
}

function custodySection({ overrides, refresh }) {
  return el('div', { class: 'cb-card' }, [
    el('h3', {}, 'A-list custody actions (A1) \u2014 simulated acknowledgments'),
    el('div', { class: 'cb-list' }, CUSTODY_ACTIONS.map((a) => {
      const done = overrides.custodyActions?.[a.id];
      return el('div', { class: 'cb-console-field' }, [
        el('span', {}, a.label),
        done
          ? el('span', { class: 'cb-badge win' }, `DONE ${new Date(done.ts).toLocaleTimeString()}`)
          : el('button', { class: 'cb-btn', onClick: () => { patchOverrides({ custodyActions: { ...overrides.custodyActions, [a.id]: { done: true, ts: Date.now() } } }); refresh(); } }, 'Acknowledge'),
      ]);
    })),
  ]);
}

async function riskSection({ overrides, refresh }) {
  let families = [];
  try {
    const res = await fetch('../docs/risk-dossier.md');
    const text = await res.text();
    families = parseRiskFamilies(text);
  } catch {
    families = [];
  }
  if (families.length === 0) {
    return el('div', { class: 'cb-card' }, [
      el('h3', {}, 'Risk-register sign-off (AC3)'),
      el('p', { class: 'cb-micro' }, 'docs/risk-dossier.md could not be loaded from this location (check that the console is served from the repo root).'),
    ]);
  }
  return el('div', { class: 'cb-card' }, [
    el('h3', {}, 'Risk-register sign-off (AC3) \u2014 docs/risk-dossier.md'),
    el('div', { class: 'cb-list' }, families.map((f) => {
      const state = overrides.riskSignoffs?.[f.id];
      return el('div', { class: 'cb-console-field' }, [
        el('span', {}, [
          el('span', { class: 'cb-console-oid' }, f.id), ' ', f.family,
          f.severity ? el('span', { class: 'cb-micro' }, ` \u2014 severity: ${f.severity}` + (f.feasibility ? `, feasibility: ${f.feasibility}` : '')) : null,
          state ? el('span', { class: `cb-badge ${state === 'signed' ? 'win' : 'loss'}` }, state.toUpperCase()) : null,
        ]),
        el('div', { class: 'cb-tag-row' }, [
          el('button', { class: 'cb-btn win', onClick: () => { patchOverrides({ riskSignoffs: { ...overrides.riskSignoffs, [f.id]: 'signed' } }); refresh(); } }, 'Sign'),
          el('button', { class: 'cb-btn danger', onClick: () => { patchOverrides({ riskSignoffs: { ...overrides.riskSignoffs, [f.id]: 'rejected' } }); refresh(); } }, 'Reject'),
        ]),
      ]);
    })),
  ]);
}

export async function renderActionsPanel({ overrides, tunables, refresh }) {
  const risk = await riskSection({ overrides, refresh });
  return el('section', { class: 'cb-console-section' }, [
    el('h2', {}, 'Console actions'),
    killSection({ overrides, refresh }),
    runActivationSection({ overrides, tunables, refresh }),
    capsEditorSection({ overrides, refresh }),
    brandSection({ overrides, refresh }),
    custodySection({ overrides, refresh }),
    risk,
  ]);
}
