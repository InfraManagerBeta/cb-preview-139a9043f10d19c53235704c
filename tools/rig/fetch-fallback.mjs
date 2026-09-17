// tools/rig/fetch-fallback.mjs — vendor the offline fallback shape sets
// (one full ten-state combo per element) and the tier-1 affinity-cape FX
// overlays from the public bucket into assets/rig/. The runtime fetches a
// wizard's own combo from the bucket; when that fetch fails (offline of the
// bucket) the stage substitutes the element's fallback SHAPES — still
// recoloured to the wizard's own palette, so combatants stay visually
// distinct — rather than showing nothing or a shared clip. See
// app/ui/components/battle/rigAssets.js for the degradation contract.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const BASE = 'https://storage.googleapis.com/cheeze-wizards-production/0x0d8c864da1985525e0af0acbeef6562881827bd5/wizard-animations';

// One well-formed, complete combo per element (power tier 1, the same
// head02/hat01/wand01 cosmetics wherever the library carries them, so the
// three fallbacks read as the same "understudy" character across elements).
const FALLBACK_COMBOS = {
  FIRE: 'FIRE-1-head02-cape04-hat01-wand01',
  WATER: 'WATER-1-head02-cape02-hat01-wand01',
  WIND: 'WIND-1-head02-cape03-hat01-wand01',
};
const STATES = ['idle', 'charge', 'chargeloop', 'attack', 'hit', 'reset', 'cancel', 'win', 'lose', 'draw'];

async function save(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  JSON.parse(text); // validate
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  process.stderr.write('.');
}

for (const [element, combo] of Object.entries(FALLBACK_COMBOS)) {
  for (const state of STATES) {
    await save(`${BASE}/${state}-${combo}.json`, path.join(REPO, 'assets', 'rig', 'fallback', element, `${state}.json`));
  }
  for (const kind of ['win', 'lose']) {
    await save(`${BASE}/affinitycape${kind}-${element}-1.json`, path.join(REPO, 'assets', 'rig', 'fx', `affinitycape${kind}-${element}.json`));
  }
}
fs.writeFileSync(path.join(REPO, 'assets', 'rig', 'FALLBACK-COMBOS.json'), JSON.stringify(FALLBACK_COMBOS, null, 2) + '\n');
process.stderr.write('\n');
console.log('fallback sets vendored to assets/rig/');
