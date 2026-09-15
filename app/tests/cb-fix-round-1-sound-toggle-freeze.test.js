// app/tests/cb-fix-round-1-sound-toggle-freeze.test.js
// CB-BUILD-fix-round-1 #3: flipping SOUND OFF mid-reveal must never freeze
// the combatants. The reviewer's probe: setSoundEnabled(false) called
// stopAll(), which fired the presentation freeze hook (meant for unmount/
// skip/result teardown), pausing every wizard player — a looping idle never
// recovers — and then NULLED the hook, so the real unmount teardown no
// longer froze anything. The fix separates concerns: the toggle stops/starts
// AUDIO only (stopAudio); the teardown path (stopAll) keeps freeze+stop.
//
// These are real behavioural probes against the imported module (sound.js
// is importable in Node: Audio is only constructed lazily, and the
// overrides layer falls back to a memory storage), reproducing the
// reviewer's setPresentationFreezeHook-counter reproduction exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setPresentationFreezeHook, setSoundEnabled, stopAll, stopAudio } from '../ui/components/battle/sound.js';

test('CB-BUILD-fix-round-1 #3: setSoundEnabled(false) must NOT invoke the presentation freeze hook (the reviewer\'s counter probe)', () => {
  let freezeCalls = 0;
  setPresentationFreezeHook(() => { freezeCalls += 1; });

  setSoundEnabled(false); // the mid-reveal SOUND OFF tap
  assert.equal(freezeCalls, 0, 'the sound toggle froze the combatants (freeze hook fired)');

  setSoundEnabled(true);
  setSoundEnabled(false);
  assert.equal(freezeCalls, 0, 'repeated toggling must never fire the freeze hook');

  // The hook must still be ARMED after the toggle (the old bug also nulled
  // it, disarming the real unmount teardown): stopAll() — the unmount /
  // skip / result path — must still freeze exactly once.
  stopAll();
  assert.equal(freezeCalls, 1, 'the unmount teardown path (stopAll) must still fire the freeze hook after a sound toggle');

  // One-shot semantics unchanged: a second stopAll with no re-registered
  // hook does nothing.
  stopAll();
  assert.equal(freezeCalls, 1, 'the freeze hook is one-shot per registration');

  setPresentationFreezeHook(null); // cleanup
});

test('CB-BUILD-fix-round-1 #3: stopAudio never touches the freeze hook; stopAll still does (separation of concerns)', () => {
  let freezeCalls = 0;
  setPresentationFreezeHook(() => { freezeCalls += 1; });

  stopAudio();
  stopAudio();
  assert.equal(freezeCalls, 0, 'stopAudio must be audio-only');

  stopAll();
  assert.equal(freezeCalls, 1, 'stopAll keeps the freeze+stop teardown path');

  setPresentationFreezeHook(null); // cleanup
});

test('CB-BUILD-fix-round-1 #3: the duel screen\'s unmount teardown still routes through stopAll (freeze + audio), and the sound toggle through setSoundEnabled', () => {
  const duelSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/duel.js'), 'utf8');
  assert.ok(
    /ctx\.router\.onUnmount\(\(\) => \{ clearInterval\(timerHandle\); clearTimeout\(timerHandle\); stopAll\(\); \}\);/.test(duelSrc),
    'the unmount teardown must keep the full stopAll (freeze + audio) path'
  );
  assert.ok(
    duelSrc.includes('setSoundEnabled(!isSoundEnabled())'),
    'the sound toggle goes through setSoundEnabled'
  );
  const soundSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/components/battle/sound.js'), 'utf8');
  const setterBody = soundSrc
    .slice(soundSrc.indexOf('export function setSoundEnabled'), soundSrc.indexOf('// ---- scheduling'))
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'); // code only, not the explanatory comments
  assert.ok(!/\bstopAll\(\)/.test(setterBody), 'setSoundEnabled must never call stopAll (that is the teardown path)');
  assert.ok(/\bstopAudio\(\)/.test(setterBody), 'setSoundEnabled(false) stops audio only');
});
