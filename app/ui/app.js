// app/ui/app.js — bootstrap: load data, build the Game, wire the router.
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { Game } from '../engine/game.js';
import { Ledger } from '../engine/ledger.js';
import { loadOverrides, patchOverrides, effectiveTunables, effectiveTreatmentId } from '../engine/overrides.js';
import { getOrCreatePlayerId, loadSession, patchSession } from './session.js';
import { createRouter } from './router.js';
import { showToast, el } from './components/dom.js';
import { renderKillStopBanner } from './components/chrome.js';
import { applyTreatmentTheme } from './theme.js';
import { installFirstTapArming } from './components/battle/sound.js';

import { mountLanding } from './screens/landing.js';
import { mountScreener } from './screens/screener.js';
import { mountSummon } from './screens/summon.js';
import { mountLobbyEntry } from './screens/lobby-entry.js';
import { mountLobby } from './screens/lobby.js';
import { mountDuel } from './screens/duel.js';
import { mountBracketBoard } from './screens/bracket-board.js';
import { mountSitting } from './screens/sitting.js';
import { mountWallet } from './screens/wallet.js';
import { mountReserve } from './screens/reserve.js';
import { mountPve } from './screens/pve.js';

// R14/console actions ("kill switch ... a second kill path independent of
// the console UI"): visiting the participant app with ?kill=1 sets the kill
// switch directly, with no console interaction at all. Checked before
// anything else renders.
function applyUrlKillParam() {
  const params = new URLSearchParams(location.search);
  if (params.get('kill') === '1') {
    patchOverrides({ killSwitch: true, killSwitchReason: 'url-param', killSwitchAt: Date.now() });
  }
}

// f4/A-g/A-h: this is now a thin alias for the shared
// components/chrome.js:renderKillStopBanner -- ONE source for the stop-
// banner markup/copy, reused by the catch-sites this round added (the
// reveal's logNarration call in duel.js, the PvE Fight handler in pve.js).
const renderKilledBanner = renderKillStopBanner;

async function main() {
  applyUrlKillParam();

  const overrides = loadOverrides();
  const [tunablesRaw, defaultTreatment] = await Promise.all([loadTunables(), loadTreatment('incumbent')]);
  const treatmentId = effectiveTreatmentId(overrides, 'incumbent');
  const treatment = treatmentId === 'incumbent' ? defaultTreatment : await loadTreatment(treatmentId);
  const tunables = effectiveTunables(tunablesRaw, overrides);

  applyTreatmentTheme(treatment);

  const playerId = getOrCreatePlayerId();
  const ledger = new Ledger(); // real localStorage in the browser
  const game = new Game({ ledger, tunables, treatment, playerId });

  // A6: a corrupt/full-storage ledger surfaces a plain-language notice
  // instead of throwing a stack trace at boot -- force the (lazy) load now
  // so the notice, if any, is ready before the first screen mounts.
  ledger.all();
  if (ledger.notice) showToast(ledger.notice);

  // CB-BUILD-017 fix round f4/Finding 2 (AC1): record the "link" moment --
  // the player reaching the app -- unconditionally at boot, BEFORE the
  // landing/screener flow ever renders, and independent of the kill switch
  // route guard below (still non-fatal if the kill switch is active --
  // recordLinkOpened throws KillSwitchFrozenError in that case, caught
  // here so a killed install still boots to its stop banner). This is
  // deliberately NOT ensureAccount (A15 restricted that -- and its $25
  // signup grant -- to a PASSED screener only; this call has no economic
  // side effect and must not reopen that fix).
  try { game.recordLinkOpened(); } catch { /* kill switch active -- non-fatal, the route guard below shows the stop banner */ }

  const ctx = {
    tunables,
    treatment,
    treatmentId,
    game,
    playerId,
    overrides,
    session: loadSession(),
    refreshSession() { ctx.session = loadSession(); return ctx.session; },
    patchSession(p) { ctx.session = patchSession(p); return ctx.session; },
    toast: showToast,
    router: null, // set below
  };

  const rawRoutes = {
    landing: () => mountLanding(ctx),
    screener: () => mountScreener(ctx),
    summon: () => mountSummon(ctx),
    'lobby-entry': () => mountLobbyEntry(ctx),
    lobby: () => mountLobby(ctx),
    duel: () => mountDuel(ctx),
    'bracket-board': () => mountBracketBoard(ctx),
    sitting: () => mountSitting(ctx),
    wallet: () => mountWallet(ctx),
    reserve: () => mountReserve(ctx),
    pve: () => mountPve(ctx),
  };

  // Every route checks the kill switch fresh (it may have been flipped in
  // another tab, by the console, or by a reload carrying ?kill=1) before
  // mounting its screen -- R14/AC0: "kill issues ... halts machine spend and
  // operations within a minute."
  const routes = {};
  for (const [name, fn] of Object.entries(rawRoutes)) {
    routes[name] = () => {
      const live = loadOverrides();
      if (live.killSwitch) { renderKilledBanner(ctx); return; }
      fn();
    };
  }

  ctx.router = createRouter(routes, async () => { ctx.refreshSession(); });

  // CB-BUILD-016/R78a: phones withhold audio until a gesture — the audio
  // layer arms on the player's FIRST tap anywhere (pointerdown, one-shot),
  // so the first thing heard is the summon ceremony (R74a), whose own press
  // is itself a tap. Sound is on by default; the mute control lives on
  // every surface that plays sound.
  installFirstTapArming();

  // A15/R41/R70: the account (and its $25 signup grant) is now written only
  // once the screener PASSES (Game#submitScreener, on pass, calls
  // ensureAccount itself) -- NOT unconditionally here at boot. This used to
  // grant $25 and write the account before the player had even seen the
  // screener, which made the rejected screen's "nothing was saved beyond
  // this screening result" claim false.

  // C18: "reconnect" -- resuming (a page (re)load, not an in-app navigation)
  // into a bracket that hadn't finished last session is exactly the
  // "disconnect-safe: resume from persisted state" case R81/§11 describes.
  if (ctx.session.bracketId && ctx.session.bracket && !ctx.session.bracket.complete) {
    try { game.recordSyncReconnect(ctx.session.bracketId); } catch { /* kill switch or similar -- non-fatal */ }
  }
  // C18: "disconnect" -- leaving mid-bracket (tab close/reload/navigation
  // away from the app entirely). Best-effort: localStorage writes are
  // synchronous, so this can complete inside `beforeunload`.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      try {
        const s = loadSession();
        if (s.bracketId && s.bracket && !s.bracket.complete) game.recordSyncDisconnect(s.bracketId);
      } catch { /* best-effort only */ }
    });
  }

  ctx.router.start();
}

main().catch((err) => {
  // CB-BUILD-013/§12/R83: no raw/developer error text reaches a
  // participant surface -- this used to dump `err.stack` straight into the
  // participant-facing #app div on any boot failure. `console.error` (a
  // developer-only channel, never rendered) still carries the real error
  // for debugging; the participant sees player-safe copy only.
  console.error(err);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '';
    app.appendChild(el('div', { class: 'cb-screen' }, [
      el('div', { class: 'cb-card', style: 'text-align:center;padding:32px 20px;border-color:var(--cb-red);' }, [
        el('h1', { style: 'color:var(--cb-red);' }, 'Something went wrong'),
        el('p', { class: 'cb-legal' }, 'The game couldn\u2019t load. Please reload the page.'),
      ]),
    ]));
  }
});
