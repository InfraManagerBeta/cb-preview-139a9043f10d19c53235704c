// tools/parity/player-config.mjs — CB-BUILD-015: both sides' player
// configuration, PARSED from the shipped sources rather than retyped.
//
// Reference side: `assets/cw/reference/Animation-index.js` — the 2019
// `animationInstance()` factory every DuelPlayer animation went through.
// Engine side: `app/ui/components/battle/rigStage.js` — the stage's own
// `lottie.loadAnimation` call and loop policy.
//
// Pure (fs + regex): importable by the node test suite with no jsdom and no
// native canvas, which is why it lives apart from the runners that use it.
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './paths.mjs';

export const REFERENCE_FACTORY = path.join(REPO, 'assets', 'cw', 'reference', 'Animation-index.js');
export const STAGE_SOURCE = path.join(REPO, 'app', 'ui', 'components', 'battle', 'rigStage.js');

/**
 * The 2019 player configuration, out of the reference's own factory.
 * Throws if the factory no longer declares it — better to stop than to
 * invent a configuration and call the result "the reference".
 */
export function parseReferencePlayerConfig(file = REFERENCE_FACTORY) {
  const src = fs.readFileSync(file, 'utf8');
  const body = /function animationInstance\([\s\S]*?\n\}/.exec(src);
  if (!body) throw new Error(`player-config: animationInstance() not found in ${file}`);
  const text = body[0];
  const bool = (key) => {
    const m = new RegExp(`${key}\\s*:\\s*(true|false)`).exec(text);
    return m ? m[1] === 'true' : null;
  };
  const str = (key) => {
    const m = new RegExp(`${key}\\s*:\\s*'([^']+)'`).exec(text);
    return m ? m[1] : null;
  };
  const config = {
    renderer: str('renderer'),
    autoplay: bool('autoplay'),
    loop: bool('loop'),
    progressiveLoad: bool('progressiveLoad'),
    subframe: /setSubframe\(false\)/.test(text) ? false : (/setSubframe\(true\)/.test(text) ? true : null),
    // the reference's own setSpeed line is commented out — "we always want
    // animations to run on the frames they're supposed to"
    setSpeed: /^\s*animation\.setSpeed\(/m.test(text),
    source: path.relative(REPO, file),
  };
  if (config.renderer !== 'canvas' || config.autoplay !== false || config.loop !== false || config.subframe !== false || config.setSpeed) {
    throw new Error(`player-config: ${config.source} no longer declares the 2019 player configuration: ${JSON.stringify(config)}`);
  }
  return config;
}

/**
 * The stage's player configuration, out of the shipped stage source.
 * `loopClips` is passed in by the caller that imported the stage's own
 * exported LOOP_CLIPS (kept out of here so this module stays dependency-free
 * for the test suite); when omitted it is read from the source text.
 */
export function parseStagePlayerConfig(file = STAGE_SOURCE, loopClips = null) {
  const src = fs.readFileSync(file, 'utf8');
  const declaredLoop = (/LOOP_CLIPS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(src) || [])[1];
  const config = {
    renderer: (/renderer:\s*'([^']+)'/.exec(src) || [])[1] || null,
    autoplay: /autoplay:\s*false/.test(src) ? false : (/autoplay:\s*true/.test(src) ? true : null),
    subframe: /setSubframe\(false\)/.test(src) ? false : (/setSubframe\(true\)/.test(src) ? true : null),
    loopClips: (loopClips ? [...loopClips] : (declaredLoop || '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)).sort(),
    setSpeed: /setSpeed\(/.test(src),
    source: path.relative(REPO, file),
  };
  if (config.renderer !== 'canvas' || config.autoplay !== false || config.subframe !== false || config.setSpeed) {
    throw new Error(`player-config: ${config.source} no longer declares the stage player configuration: ${JSON.stringify(config)}`);
  }
  return config;
}
