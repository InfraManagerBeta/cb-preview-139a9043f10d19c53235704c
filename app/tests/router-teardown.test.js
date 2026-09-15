// app/tests/router-teardown.test.js — f4/A-i: app/ui/router.js's
// onUnmount(fn) mechanism. Pure logic (no real browser needed) once
// `window`/`location` are minimally stubbed -- router.js only touches
// them INSIDE function bodies (createRouter/render/navigate), never at
// module-load time, so stubbing them before calling createRouter(...) is
// enough to exercise the real, shipped router code in Node.
//
// `render()` is `async` (awaits `onChange(route)` before mounting the
// screen), so the actual screen-mount call lands a microtask later than
// the synchronous `navigate()`/hashchange call that triggered it -- tests
// that check a mount count `await flush()` first. The teardown call
// itself (`unmountCurrent()`) runs synchronously, BEFORE that first
// `await`, so it's always observable immediately.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function stubBrowserGlobals(initialHash = '') {
  const listeners = [];
  global.location = { hash: initialHash };
  global.window = {
    addEventListener(type, fn) { if (type === 'hashchange') listeners.push(fn); },
  };
  return { fireHashChange: () => listeners.forEach((fn) => fn()) };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('f4/A-i: onUnmount registers a teardown callback that render() calls (synchronously, before mounting the next screen)', async () => {
  stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');

  let landingMounts = 0, otherMounts = 0;
  const routes = {
    landing: () => { landingMounts++; },
    other: () => { otherMounts++; },
  };
  const router = createRouter(routes, async () => {});
  router.start();
  await flush();
  assert.equal(landingMounts, 1);

  let torndown = 0;
  router.onUnmount(() => { torndown++; });

  router.navigate('other'); // different route -> sets location.hash, no render() yet in this stub (real browsers dispatch hashchange async)
  assert.equal(torndown, 0, 'expected no teardown to fire until the actual render happens');

  // Same-route re-navigation (e.g. the router's own re-entry path) calls
  // render() directly and synchronously.
  router.navigate('other');
  assert.equal(torndown, 1, 'expected the registered teardown to fire exactly once, synchronously, before the next mount');
  await flush();
  assert.equal(otherMounts, 1);

  // A second navigation with NO new registration must not call anything again (already cleared).
  router.navigate('landing');
  assert.equal(torndown, 1, 'expected the teardown to be cleared after firing once -- not called again on a later navigation');
});

test('f4/A-i: a browser back/forward (hashchange event) also runs the registered teardown before the next mount', async () => {
  const { fireHashChange } = stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');
  let otherMounted = 0;
  const routes = { landing: () => {}, other: () => { otherMounted++; } };
  const router = createRouter(routes, async () => {});
  router.start();
  await flush();

  let torndown = false;
  router.onUnmount(() => { torndown = true; });

  global.location.hash = '#/other'; // simulate the browser's back/forward button changing the hash
  fireHashChange();

  assert.equal(torndown, true, 'expected a hashchange-driven navigation to run the registered teardown too, not just explicit navigate() calls');
  await flush();
  assert.equal(otherMounted, 1);
});

test('f4/A-i: re-registering onUnmount replaces the previous callback -- only the LATEST registered teardown runs', async () => {
  stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');
  const routes = { landing: () => {}, other: () => {} };
  const router = createRouter(routes, async () => {});
  router.start();
  await flush();

  let firstCalled = false, secondCalled = false;
  router.onUnmount(() => { firstCalled = true; });
  router.onUnmount(() => { secondCalled = true; }); // supersedes the first

  router.navigate('other');
  router.navigate('other'); // same-route re-render actually fires render()
  assert.equal(firstCalled, false);
  assert.equal(secondCalled, true);
});

test('f4/A-i: a teardown callback that throws does not block the next screen from mounting', async () => {
  stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');
  let mounted = false;
  const routes = { landing: () => {}, other: () => { mounted = true; } };
  const router = createRouter(routes, async () => {});
  router.start();
  await flush();
  router.onUnmount(() => { throw new Error('boom'); });
  router.navigate('other');
  router.navigate('other');
  await flush();
  assert.equal(mounted, true, 'expected navigation to succeed even if teardown threw');
});

test('f4/A-i: a screen that never calls onUnmount behaves exactly as before (no-op teardown)', async () => {
  stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');
  let otherMounted = 0;
  const routes = { landing: () => {}, other: () => { otherMounted++; } };
  const router = createRouter(routes, async () => {});
  router.start();
  await flush();
  router.navigate('other'); // no onUnmount ever registered
  router.navigate('other');
  await flush();
  assert.equal(otherMounted, 1);
});
