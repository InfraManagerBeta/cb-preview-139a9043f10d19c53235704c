// tools/parity/find-canonical.mjs — identify WHICH library combo the bundle
// GIFs render (the canonical wizard's cosmetic traits are not documented
// anywhere in the bundle; the shape silhouette identifies them). Renders
// idle frame 0 of every power-1 combo (all elements) at low resolution and
// scores silhouette IoU + grayscale MAE against the GIF's first frame.
// Writes results/canonical-combo.json with the ranked candidates.
import fs from 'node:fs';
import path from 'node:path';
import { makeRenderer, decodeGif, contentBBox, remapToBox, isInk, writeJson, REPO, __dirname } from './lib.mjs';
import { RIG_COMBOS, RIG_BUCKET_BASE } from '../../app/data/rigManifest.js';

const CACHE = path.join(__dirname, 'results', 'cache');
fs.mkdirSync(CACHE, { recursive: true });

async function fetchClip(state, combo) {
  const file = path.join(CACHE, `${state}-${combo}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(`${RIG_BUCKET_BASE}/${state}-${combo}.json`);
  if (!res.ok) throw new Error(`${res.status} for ${state}-${combo}`);
  const text = await res.text();
  fs.writeFileSync(file, text);
  return JSON.parse(text);
}

const gif = decodeGif(path.join(REPO, 'assets', 'cw', 'renders', 'gifs', 'CW_Battle Idle.gif'));
const target = gif.frames[0];
const targetBox = contentBBox(target);

// Palette-independent matching: the library's parts all carry BLACK outline
// ink; two renders of the same shapes share outline geometry regardless of
// slot colours. Score = IoU of (dilated) dark-ink masks after bbox mapping.
function inkMask(img, thresh = 90) {
  const { data: d, width: w, height: h } = img;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] > 128 && d[i] < thresh && d[i + 1] < thresh && d[i + 2] < thresh) m[y * w + x] = 1;
    }
  }
  // 1px dilation to forgive resampling jitter
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) dil[yy * w + xx] = 1;
      }
    }
  }
  return dil;
}
const targetInk = inkMask(target);

function score(img) {
  const box = contentBBox(img);
  if (!box) return { iou: 0 };
  const remapped = remapToBox(img, box, targetBox, gif.width, gif.height);
  const ink = inkMask(remapped);
  let inter = 0, uni = 0;
  for (let i = 0; i < ink.length; i++) {
    if (ink[i] || targetInk[i]) uni++;
    if (ink[i] && targetInk[i]) inter++;
  }
  return { iou: uni ? inter / uni : 0 };
}

const candidates = RIG_COMBOS.filter((c) => /-1-/.test(c));
console.log(`scoring ${candidates.length} power-1 combos against CW_Battle Idle frame 0…`);
const ranked = [];
for (const combo of candidates) {
  try {
    const clip = await fetchClip('idle', combo);
    const r = makeRenderer(clip, { width: 500, height: 407, background: '#FFFFFF' });
    const img = r.frame(0);
    r.destroy();
    const s = score(img);
    ranked.push({ combo, ...s });
    process.stderr.write('.');
  } catch (e) {
    process.stderr.write('x');
  }
}
ranked.sort((a, b) => b.iou - a.iou);
process.stderr.write('\n');
console.log('top 10:');
for (const r of ranked.slice(0, 10)) console.log(`  ${r.combo}  inkIoU=${r.iou.toFixed(3)}`);
writeJson('results/canonical-combo.json', { method: 'dilated black-outline-ink IoU (palette-independent) vs CW_Battle Idle frame 0', top: ranked.slice(0, 20) });
