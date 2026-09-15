// app/ui/session.js
// Transient, resumable UI session state — separate from the permanent
// append-only ledger. A sealed commit or an in-progress lobby/bracket lives
// here so a reload/disconnect resumes exactly where it left off (§11:
// "disconnect-safe: resume from persisted state; a sealed commit stands").
// This is NOT a source of truth for game facts (the ledger is); it is just
// "where was I" pointer state plus the not-yet-resolved sync-bracket state.

const PLAYER_ID_KEY = 'cheddarBattles.playerId';
const SESSION_KEY = 'cheddarBattles.session.v1';

export function getOrCreatePlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

const defaultSession = () => ({
  activeCharacterId: null,
  lobby: null,
  bracketId: null,
  bracket: null,
  humanSeatIndex: null,
  commitWindow: null,
  pendingMatch: null, // {roundIndex, matchIndex} the human is currently facing
  pveOpponent: null,
  lastResult: null, // last resolved duel outcome, for the result-card screen
  // R75: "skippable after the first full playthrough of a session" -- set
  // true the first time a duel's full battle-presentation timeline plays to
  // its natural end (not skipped) in this browser session.
  hasSeenDuelPlaythrough: false,
});

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? { ...defaultSession(), ...JSON.parse(raw) } : defaultSession();
  } catch {
    return defaultSession();
  }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function patchSession(patch) {
  const session = loadSession();
  const next = { ...session, ...patch };
  saveSession(next);
  return next;
}

export function clearSyncState() {
  return patchSession({ lobby: null, bracketId: null, bracket: null, humanSeatIndex: null, commitWindow: null, pendingMatch: null });
}

// ---- C19/R67/§15.11: real app-session tracking -----------------------------
// `sessionNumber` (threaded into Game#loadFunds) must be the CURRENT
// session's number, not "count of prior deposits + 1" (which isn't a
// session number at all -- two deposits in the same sitting would get two
// different numbers, and a player who never deposits would never get a
// session number). A "session" here is judgment-call-documented (per the
// order) as: the app is in the SAME session as last time UNLESS (a) at
// least NEW_SESSION_GAP_MS (30 minutes) has passed since the app was last
// touched, OR (b) this is a tab that has never seen the app before this
// boot (sessionStorage is browser-tab-scoped and cleared on tab close, so
// "no tab-scoped marker yet" is a reasonable, standard proxy for "a new
// tab/window", per-R67's "new session on app boot" language).
//
// The number-crunching (computeSessionNumber) is a PURE function, testable
// without any real browser storage; getOrCreateSessionNumber is the thin,
// untested-by-necessity glue that reads/writes the two real browser stores.

export const NEW_SESSION_GAP_MS = 30 * 60 * 1000;
const SESSION_META_KEY = 'cheddarBattles.appSession.v1';
const TAB_SEEN_KEY = 'cheddarBattles.tabSeen';

/**
 * Pure: given the persisted session meta (`{ number, startedAt, lastSeenAt }`
 * or null on a brand-new install), decide the CURRENT session number and the
 * next meta to persist.
 */
export function computeSessionNumber(meta, { now = Date.now(), isNewTab = false, gapMs = NEW_SESSION_GAP_MS } = {}) {
  if (!meta) {
    const fresh = { number: 1, startedAt: now, lastSeenAt: now };
    return { number: fresh.number, meta: fresh };
  }
  if (isNewTab || (now - meta.lastSeenAt) >= gapMs) {
    const next = { number: meta.number + 1, startedAt: now, lastSeenAt: now };
    return { number: next.number, meta: next };
  }
  return { number: meta.number, meta: { ...meta, lastSeenAt: now } };
}

function readSessionMeta() {
  try {
    const raw = localStorage.getItem(SESSION_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSessionMeta(meta) {
  localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta));
}

/** True the FIRST time this is called in this browser tab (sessionStorage is
 * cleared when the tab closes, so an absent marker means a fresh tab/window). */
function isNewTab() {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    if (sessionStorage.getItem(TAB_SEEN_KEY)) return false;
    sessionStorage.setItem(TAB_SEEN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Get (creating/advancing as needed) this browser's CURRENT app-session
 * number. Call once per screen mount that needs it (e.g. right before
 * opening the Load Funds sheet) -- cheap, idempotent within the same
 * session, and always reflects "now". */
export function getOrCreateSessionNumber(now = Date.now()) {
  const { number, meta } = computeSessionNumber(readSessionMeta(), { now, isNewTab: isNewTab() });
  writeSessionMeta(meta);
  return number;
}
