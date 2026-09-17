// tools/parity/paths.mjs — where things are, and nothing else. Split out of
// lib.mjs (CB-BUILD-015) so that the harness's pure parts — the
// pre-registration reader, the reference slot map, the comparer, the player
// configuration parsers — can be imported by the node test suite WITHOUT
// pulling in jsdom/node-canvas. lib.mjs re-exports these, so checks A-D are
// untouched.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, '..', '..');
