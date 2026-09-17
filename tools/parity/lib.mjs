// tools/parity/lib.mjs — shared harness plumbing: a headless DOM for the
// SHIPPED player (app/vendor/lottie.min.js — the same vendored engine the
// battle stage runs), frame rendering to node-canvas, GIF decoding, and
// image metrics. No browser: jsdom + node-canvas under plain Node.
import { JSDOM } from 'jsdom';
import { createCanvas } from 'canvas';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { __dirname, REPO } from './paths.mjs';

// Re-exported (CB-BUILD-015 split them into paths.mjs so the harness's pure
// parts stay importable without jsdom/node-canvas); every existing caller
// keeps importing them from here.
export { __dirname, REPO };

// ---- headless DOM + the shipped player -------------------------------------
const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;

const require_ = createRequire(import.meta.url);
// The SAME vendored player the app ships (UMD -> module.exports under CJS).
export const lottie = require_(path.join(REPO, 'app', 'vendor', 'lottie.min.js'));

/**
 * Render selected frames of one animation JSON with the shipped player
 * configuration (canvas renderer, setSubframe(false) — the reference's own).
 * Returns { width, height, frame(n) -> ImageData-like {data,width,height} }.
 *
 * Headless caveat (documented in RESULTS.md): under jsdom/node-canvas,
 * goToAndStop across certain layer in-point boundaries can silently corrupt
 * the canvas renderer (frames come back empty and the instance stays
 * broken). `frame()` detects an unexpectedly-empty frame, retries once on a
 * FRESH instance, and reports `null` data via frame.empty when the frame
 * genuinely cannot be rendered headlessly — callers skip and count those.
 */
export function makeRenderer(animationData, { width, height, background = null } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const source = JSON.parse(JSON.stringify(animationData));
  let anim = null;
  const load = () => {
    if (anim) { try { anim.destroy(); } catch { /* ignore */ } }
    anim = lottie.loadAnimation({
      renderer: 'canvas',
      autoplay: false,
      loop: false,
      animationData: JSON.parse(JSON.stringify(source)),
      rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' },
    });
    anim.setSubframe(false);
  };
  load();
  const paint = (n) => {
    ctx.clearRect(0, 0, width, height);
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
    anim.goToAndStop(n, true);
    return ctx.getImageData(0, 0, width, height);
  };
  const hasContent = (img) => {
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 128 && !(background && img.data[i - 3] > 250 && img.data[i - 2] > 250 && img.data[i - 1] > 250)) return true;
    return false;
  };
  let sawContent = false;
  return {
    width, height,
    frame(n) {
      let img = paint(n);
      const ok = background ? contentBBox(img) !== null : hasContent(img);
      if (!ok && sawContent) {
        load(); // renderer corrupted by a boundary frame: retry fresh
        img = paint(n);
        const ok2 = background ? contentBBox(img) !== null : hasContent(img);
        if (!ok2) { load(); img.empty = true; return img; } // genuinely unrenderable headlessly
      }
      if (!img.empty) sawContent = sawContent || (background ? contentBBox(img) !== null : hasContent(img));
      return img;
    },
    png(n, file) {
      this.frame(n);
      fs.writeFileSync(file, canvas.toBuffer('image/png'));
    },
    totalFrames: () => anim.totalFrames,
    destroy: () => { try { anim.destroy(); } catch { /* ignore */ } },
  };
}

// ---- GIF decoding -----------------------------------------------------------
export function decodeGif(file) {
  // omggif is CJS
  const { GifReader } = require_('omggif');
  const reader = new GifReader(fs.readFileSync(file));
  const frames = [];
  const w = reader.width, h = reader.height;
  const carry = new Uint8Array(w * h * 4); // GIF disposal 1: frames composite over the previous
  for (let i = 0; i < reader.numFrames(); i++) {
    reader.decodeAndBlitFrameRGBA(i, carry);
    frames.push({ data: Uint8ClampedArray.from(carry), width: w, height: h, delayCs: reader.frameInfo(i).delay });
  }
  return { width: w, height: h, frames };
}

// ---- image metrics ----------------------------------------------------------
export function isInk(d, i, whiteTol = 24) {
  // "content" pixel: opaque and not the near-white background
  if (d[i + 3] < 128) return false;
  return !(d[i] > 255 - whiteTol && d[i + 1] > 255 - whiteTol && d[i + 2] > 255 - whiteTol);
}

export function contentBBox(img) {
  const { data: d, width: w, height: h } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isInk(d, i)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Diff two same-size images over the UNION of their content silhouettes.
 * Returns { contentPixels, mae, matchPct } where matchPct is the share of
 * content pixels whose max channel delta <= tolerance.
 */
export function diffImages(a, b, { tolerance = 48 } = {}) {
  const w = a.width, h = a.height;
  let content = 0, matched = 0, err = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    const inkA = isInk(a.data, i), inkB = isInk(b.data, i);
    if (!inkA && !inkB) continue;
    content++;
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const dm = Math.max(dr, dg, db);
    err += (dr + dg + db) / 3;
    if (dm <= tolerance && inkA === inkB) matched++;
    else if (dm <= tolerance) matched++; // colour matches even where one side reads as (near-)background
  }
  return { contentPixels: content, mae: content ? err / content : 0, matchPct: content ? (matched / content) * 100 : 100 };
}

/** Resample img over the WHOLE output plane under the affine map that takes
 * srcBox onto dstBox (fit on an anchor frame, then reused for every frame —
 * content outside the anchor boxes transforms too, it is never cropped). */
export function remapToBox(img, srcBox, dstBox, outW, outH, background = [255, 255, 255, 255]) {
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = background[0]; out[i + 1] = background[1]; out[i + 2] = background[2]; out[i + 3] = background[3]; }
  const sx = srcBox.w / dstBox.w, sy = srcBox.h / dstBox.h;
  for (let y = 0; y < outH; y++) {
    const uy = Math.round(srcBox.y0 + (y - dstBox.y0) * sy);
    if (uy < 0 || uy >= img.height) continue;
    for (let x = 0; x < outW; x++) {
      const ux = Math.round(srcBox.x0 + (x - dstBox.x0) * sx);
      if (ux < 0 || ux >= img.width) continue;
      const si = (uy * img.width + ux) * 4;
      const di = (y * outW + x) * 4;
      out[di] = img.data[si]; out[di + 1] = img.data[si + 1]; out[di + 2] = img.data[si + 2]; out[di + 3] = img.data[si + 3];
    }
  }
  return { data: out, width: outW, height: outH };
}

export function writeJson(rel, obj) {
  const file = path.join(__dirname, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  return file;
}

export function savePng(img, file) {
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  const id = x.createImageData(img.width, img.height);
  id.data.set(img.data);
  x.putImageData(id, 0, 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, c.toBuffer('image/png'));
}
