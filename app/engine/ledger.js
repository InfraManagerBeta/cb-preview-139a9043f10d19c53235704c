// app/engine/ledger.js
// Append-only event ledger (localStorage-backed in the browser; an injectable
// storage adapter — same get/setItem shape — for Node tests). Every event is
// timestamped; every ledger-touching action carries a per-action idempotency
// key (R83, §15.7); replaying a key is a no-op. All displayed figures derive
// from the ledger — nothing is tracked "out of band."

export const SCHEMA_VERSION = 1;

export const EVENT_TYPES = Object.freeze({
  // CB-BUILD-017 fix round f4/Finding 2 (AC1): the "link" moment -- the
  // player reaching the app for the first time, BEFORE the screener (the
  // R8a copy, date-of-birth entry, and jurisdiction check all happen AFTER
  // this and take real time). Written once per player, independent of
  // whether they ever pass the screener (unlike ACCOUNT_CREATED, which A15
  // deliberately restricted to a PASSED screener only -- see
  // Game#recordLinkOpened / Game#ensureAccount in game.js). Purely
  // additive: no existing event type, no append() signature, changed.
  LINK_OPENED: 'LINK_OPENED',
  ACCOUNT_CREATED: 'ACCOUNT_CREATED',
  SIGNUP_GRANT: 'SIGNUP_GRANT',
  SCREENER_RESULT: 'SCREENER_RESULT',
  CHARACTER_SUMMONED: 'CHARACTER_SUMMONED',
  NPC_SEATED: 'NPC_SEATED',
  BRACKET_CREATED: 'BRACKET_CREATED',
  BRACKET_COMPLETED: 'BRACKET_COMPLETED',
  DUEL_RESOLVED: 'DUEL_RESOLVED',
  CHARACTER_ADVANCED: 'CHARACTER_ADVANCED',
  CHARACTER_ELIMINATED: 'CHARACTER_ELIMINATED',
  CHARACTER_REENTERED: 'CHARACTER_REENTERED',
  CHARACTER_CASHED_OUT: 'CHARACTER_CASHED_OUT',
  CHARACTER_RETIRED_EMPTY: 'CHARACTER_RETIRED_EMPTY',
  LOAD_FUNDS_DEPOSIT: 'LOAD_FUNDS_DEPOSIT',
  RESERVATION_PRESSED: 'RESERVATION_PRESSED',
  PVE_SESSION_STARTED: 'PVE_SESSION_STARTED',
  PVE_DUEL_RESOLVED: 'PVE_DUEL_RESOLVED',
  PVE_OPPONENT_ZEROED: 'PVE_OPPONENT_ZEROED',
  SYNC_LOBBY_JOINED: 'SYNC_LOBBY_JOINED',
  SYNC_NPC_SEATED: 'SYNC_NPC_SEATED',
  SYNC_COMMIT: 'SYNC_COMMIT',
  SYNC_HESITATED: 'SYNC_HESITATED',
  SYNC_DISCONNECT: 'SYNC_DISCONNECT',
  SYNC_RECONNECT: 'SYNC_RECONNECT',
  NARRATION_GENERATED: 'NARRATION_GENERATED',
  ANCHOR_SET: 'ANCHOR_SET',
  // f1/C22: the true-tie coin flip's commit-reveal record (commitment is
  // appended BEFORE the seed is ever used to decide the flip; the reveal --
  // seed + commitment together -- rides on the DUEL_RESOLVED event's payload
  // so a player can recompute sha256(seed) and the deterministic flip).
  COIN_FLIP_COMMITTED: 'COIN_FLIP_COMMITTED',
  // f1/C16/AC0: the kill-switch shutdown rule for an in-flight bracket.
  BRACKET_VOIDED: 'BRACKET_VOIDED',
  // f1/C18/R22: one-per-account open-response capture (character-recall).
  OPEN_RESPONSE: 'OPEN_RESPONSE',
  // f2/C13/R26 card 4 ("Marquee scheduled brackets"): the reminder opt-in
  // is the one ledger event this card's minimum implementation writes (the
  // schedule/countdown itself is simulated, computed, not ledger-backed).
  MARQUEE_REMINDER_OPT_IN: 'MARQUEE_REMINDER_OPT_IN',
  // f2/C13/R26 card 3 ("Spectate after elimination"): one event per
  // eliminated-player board view, for the §13 "spectate rate" metric.
  SPECTATE_VIEW: 'SPECTATE_VIEW',
});

/** A minimal localStorage-shaped in-memory adapter, for Node/tests or as a fallback. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return createMemoryStorage();
}

const LEDGER_KEY = 'cheddarBattles.ledger.v1';

export class Ledger {
  constructor(storage, ledgerKey = LEDGER_KEY) {
    this.storage = resolveStorage(storage);
    this.ledgerKey = ledgerKey;
    this._cache = null;
    this._keyIndex = null;
    // A6: a plain-language notice for the UI to surface (a toast/banner),
    // set instead of letting a corrupt-JSON parse or a full-quota write
    // throw all the way up to a boot-time stack trace. Never re-thrown.
    this.notice = null;
  }

  _load() {
    if (this._cache) return this._cache;
    const raw = this.storage.getItem(this.ledgerKey);
    if (!raw) { this._cache = []; this._keyIndex = new Set(); return this._cache; }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('ledger: stored value is not an array');
      this._cache = parsed;
    } catch {
      // A6: corrupt localStorage JSON must not throw at boot. Quarantine the
      // unreadable blob under a side key (best-effort -- never destroyed
      // outright, so a support flow could still recover it) and start a
      // fresh, empty ledger instead of crashing the whole app.
      this._quarantineCorruptBlob(raw);
      this._cache = [];
      this.notice = 'Your saved game data could not be read, so a fresh ledger was started. The unreadable copy was kept, not deleted.';
    }
    this._keyIndex = new Set(this._cache.map((e) => e.key));
    return this._cache;
  }

  _quarantineCorruptBlob(raw) {
    try {
      this.storage.setItem(`${this.ledgerKey}.corrupt.${Date.now()}`, raw);
    } catch {
      // Best-effort only: if quarantining itself fails (e.g., storage is
      // completely full), still proceed with a fresh in-memory ledger rather
      // than throw.
    }
  }

  _persist() {
    try {
      this.storage.setItem(this.ledgerKey, JSON.stringify(this._cache));
    } catch (err) {
      // A6: never let a storage write failure propagate as an uncaught
      // exception. The in-memory ledger (this._cache) still holds the
      // event for the rest of this session; only the durable save failed.
      this.notice = isQuotaExceededError(err)
        ? 'Storage is full -- this action was recorded for this session, but may not be saved after you close the app.'
        : 'Your progress could not be saved just now.';
    }
  }

  /**
   * Append an event. `key` is the idempotency action key (R83): if an event
   * with this key already exists, this is a no-op and the existing event is
   * returned unchanged (replaying it changes nothing — invariant #7).
   */
  append({ key, type, playerId, payload = {}, ts = Date.now() }) {
    if (!key) throw new Error('Ledger.append: every event requires an idempotency key');
    this._load();
    if (this._keyIndex.has(key)) {
      return this._cache.find((e) => e.key === key);
    }
    const event = {
      schemaVersion: SCHEMA_VERSION,
      id: `${ts}-${Math.random().toString(36).slice(2, 10)}`,
      key,
      type,
      playerId,
      ts,
      payload,
    };
    this._cache.push(event);
    this._keyIndex.add(key);
    this._persist();
    return event;
  }

  /** Replay-safe re-append: returns {event, replayed:boolean}. */
  appendChecked(args) {
    this._load();
    const existedBefore = this._keyIndex.has(args.key);
    const event = this.append(args);
    return { event, replayed: existedBefore };
  }

  all() {
    return [...this._load()];
  }

  /** R83: does an event with this idempotency key already exist? Lets a
   * caller check-before-compute so a replayed/retried action can return the
   * ALREADY-persisted result instead of recomputing (and potentially
   * consuming more RNG or disagreeing with what's on the ledger). */
  hasKey(key) {
    this._load();
    return this._keyIndex.has(key);
  }

  /** The event already recorded under this key, if any (see hasKey). */
  findByKey(key) {
    this._load();
    return this._cache.find((e) => e.key === key) || null;
  }

  byType(type) {
    return this._load().filter((e) => e.type === type);
  }

  byPlayer(playerId) {
    return this._load().filter((e) => e.playerId === playerId);
  }

  byPlayerAndType(playerId, type) {
    return this._load().filter((e) => e.playerId === playerId && e.type === type);
  }

  clearAll() {
    this._cache = [];
    this._keyIndex = new Set();
    this._persist();
  }
}

/** Build a stable idempotency key from named parts (R83/§15.7). */
export function actionKey(...parts) {
  return parts.map((p) => String(p)).join('::');
}

/** A6: recognize a storage-quota failure across browsers/Node fakes (the
 * DOMException name is the standard signal; legacy code/message forms are
 * matched too so a test double doesn't need to construct a real DOMException). */
export function isQuotaExceededError(err) {
  if (!err) return false;
  if (err.name === 'QuotaExceededError') return true;
  if (err.code === 22 || err.code === 1014) return true;
  return /quota/i.test(err.message || '');
}
