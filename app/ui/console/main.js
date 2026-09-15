// app/ui/console/main.js — the operator console bootstrap. Reachable by
// URL only (no participant-facing link into it, per the brief); a plain
// "operator" link lives in the root redirect page's footer instead.
import { loadTunables, loadTreatment } from '../../engine/dataLoader.js';
import { loadOverrides, effectiveTunables, effectiveTreatmentId } from '../../engine/overrides.js';
import { el } from '../components/dom.js';
import { applyTreatmentTheme } from '../theme.js';
import { renderOverridesPanel } from './overridesPanel.js';
import { renderRunPanel } from './runPanel.js';
import { renderActionsPanel } from './actionsPanel.js';

async function main() {
  const tunablesRaw = await loadTunables();
  const root = document.getElementById('console-root');

  async function render() {
    const overrides = loadOverrides();
    const tunables = effectiveTunables(tunablesRaw, overrides);
    const treatmentId = effectiveTreatmentId(overrides, 'incumbent');
    const treatment = await loadTreatment(treatmentId);
    applyTreatmentTheme(treatment); // the console re-skins too (R14: O1 changes the whole running app, including this surface)

    root.innerHTML = '';
    const header = el('div', { class: 'cb-console-header' }, [
      el('h1', {}, 'Cheddar Battles \u2014 Operator Console'),
      el('p', { class: 'cb-micro' }, 'Operator-facing. Not a participant surface. Reachable by URL only.'),
      overrides.killSwitch ? el('div', { class: 'cb-console-kill-banner' }, `RUN STOPPED (${overrides.killSwitchReason || 'console'})`) : null,
      el('p', { class: 'cb-micro' }, [
        'Participant app: ',
        el('a', { href: './index.html', target: '_blank', rel: 'noopener' }, 'open in a new tab'),
        ' \u2014 switch an O-item here, then reload that tab to see it take effect.',
      ]),
    ]);

    const actions = await renderActionsPanel({ overrides, tunables, refresh: render });

    root.appendChild(el('div', {}, [
      header,
      renderOverridesPanel({ overrides, tunables, refresh: render }),
      renderRunPanel({ overrides, tunables, refresh: render }),
      actions,
    ]));
  }

  await render();
}

main().catch((err) => {
  console.error(err);
  document.getElementById('console-root').innerHTML = `<pre style="color:#D41E30;white-space:pre-wrap;">${String(err && err.stack || err)}</pre>`;
});
