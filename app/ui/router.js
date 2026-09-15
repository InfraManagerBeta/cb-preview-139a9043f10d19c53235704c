// app/ui/router.js — a tiny hash router. Routes are plain strings; screens
// register themselves in the `routes` map built by app.js.
//
// f4/A-i: `onUnmount(fn)` -- the currently-mounted screen registers a
// teardown callback; `render()` calls (and clears) whatever the PREVIOUS
// screen registered before mounting the next one, on every navigation
// (an explicit `navigate()` call, a `hashchange` from the browser
// back/forward buttons, or a same-route re-render). This is the mechanism
// duel.js uses to clear its tick interval, reveal timeouts, and
// intermission interval on teardown -- so navigating away mid-commit can
// no longer let a stale timer fire an auto-commit (or any other ledger
// mutation) after the screen is gone. Nothing else changes: a screen that
// never calls `onUnmount` behaves exactly as before (no-op on the next
// render).
export function createRouter(routes, onChange) {
  let unmountCurrent = null;

  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    return hash || 'landing';
  }

  async function render() {
    if (unmountCurrent) {
      const fn = unmountCurrent;
      unmountCurrent = null;
      try { fn(); } catch { /* teardown must never block navigation */ }
    }
    const route = currentRoute();
    const screen = routes[route] || routes['landing'];
    await onChange(route);
    await screen();
  }

  window.addEventListener('hashchange', render);
  return {
    navigate(route) {
      if (currentRoute() === route) { render(); return; }
      location.hash = `#/${route}`;
    },
    start() { render(); },
    current: currentRoute,
    /** Register a teardown callback for the screen mounting RIGHT NOW.
     * Replaces any previously-registered callback (a screen that
     * re-registers mid-lifecycle, e.g. duel.js moving from the commit tick
     * to the reveal timeline, only needs the LATEST one run). Cleared
     * (called once, then dropped) on the next render -- whatever that
     * render turns out to be. */
    onUnmount(fn) { unmountCurrent = fn; },
  };
}
