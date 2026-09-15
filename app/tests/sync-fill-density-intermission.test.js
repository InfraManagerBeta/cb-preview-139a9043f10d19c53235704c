// app/tests/sync-fill-density-intermission.test.js — f2/C14/A4:
// buildFillPlan actually reads the O7 npcFillDensity setting (the "≥2
// humans required" alternative caps NPC fill and holds the shortfall seat
// open until the wait deadline, then falls back per O7's own rule); and
// createIntermission/intermissionOver (previously dead) drive a real
// intermission window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sync from '../engine/sync.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { mulberry32 } from '../engine/rng.js';

const tunablesRaw = await loadTunables();
const treatment = await loadTreatment('incumbent');

function withNpcFillOverride(id) {
  const t = JSON.parse(JSON.stringify(tunablesRaw));
  const alt = [t.npcFillDensity.default, ...t.npcFillDensity.alternatives].find((a) => a.id === id);
  if (alt) t.npcFillDensity.default = alt;
  return t;
}

test('C14/O7 default (fillTo8): every empty seat gets an NPC fill plan entry, none reserved', () => {
  const tunables = withNpcFillOverride('fillTo8');
  const lobby = sync.createLobby(tunables, { humanEntry: { id: 'p1', characterId: 'c1', name: 'Human', element: 'fire' }, tier: 0, now: 0 });
  const plan = sync.buildFillPlan(lobby, tunables, treatment, mulberry32(1));
  assert.equal(plan.length, 7); // 8 seats - 1 human
  assert.deepEqual(lobby.reservedForHumanSeats, []);
});

test('C14/O7 "fillTo8Min2Humans": with only ONE real human (this single-device build), the shortfall seat is reserved (not NPC-filled) until the wait deadline', () => {
  const tunables = withNpcFillOverride('fillTo8Min2Humans');
  const lobby = sync.createLobby(tunables, { humanEntry: { id: 'p1', characterId: 'c1', name: 'Human', element: 'fire' }, tier: 0, now: 0 });
  const plan = sync.buildFillPlan(lobby, tunables, treatment, mulberry32(1));
  // minHumans=2, currentHumans=1 -> shortfall=1 -> only 6 NPC fill-plan entries (7 empty seats - 1 reserved)
  assert.equal(plan.length, 6);
  assert.equal(lobby.reservedForHumanSeats.length, 1);

  // Before the wait deadline, the reserved seat stays empty even if every
  // planned NPC has arrived.
  sync.advanceLobby(lobby, tunables.timers.lobbyHumanWaitSec.default * 1000 - 5000, { treatment, tunables, random: mulberry32(2) });
  const reservedIdx = lobby.reservedForHumanSeats[0];
  assert.equal(lobby.seats[reservedIdx], null, 'the reserved seat must not be NPC-filled before the wait deadline');

  // At/after the deadline, O7's own fallback rule fills it with an NPC too
  // (a lobby cannot wait forever for a 2nd human that will never arrive on
  // a single device).
  sync.advanceLobby(lobby, tunables.timers.lobbyHumanWaitSec.default * 1000 + 1000, { treatment, tunables, random: mulberry32(3) });
  assert.ok(lobby.seats[reservedIdx], 'expected the reserved seat to fall back to an NPC fill at the wait deadline');
  assert.equal(lobby.seats[reservedIdx].kind, 'npc');
  assert.equal(lobby.reservedForHumanSeats.length, 0);
  assert.ok(lobby.seats.every(Boolean));
});

test('A4/R81: createIntermission produces a 20-30s window (per tunables), and intermissionOver fires only once endsAt passes', () => {
  const intermission = sync.createIntermission(tunablesRaw, 1000, mulberry32(1));
  const durationSec = (intermission.endsAt - intermission.startedAt) / 1000;
  const [min, max] = tunablesRaw.timers.intermissionRangeSec;
  assert.ok(durationSec >= min && durationSec <= max, `expected duration in [${min},${max}]s, got ${durationSec}`);
  assert.equal(sync.intermissionOver(intermission, intermission.endsAt - 1), false);
  assert.equal(sync.intermissionOver(intermission, intermission.endsAt), true);
});
