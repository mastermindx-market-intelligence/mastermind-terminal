"use strict";

// One route warm-up owner for Playwright and standalone fixture captures.
// See globalSetup.ts for the measured cold-compilation failure and unchanged timeout policy.

/** Every route the suite navigates to, plus the API routes its first assertions depend on. */
const ROUTES = [
  "/terminal?symbol=NVDA",
  "/options",
  "/portfolio",
  "/alerts",
  "/analysis",
  "/discover",
  "/admin",
  "/embed/chart?symbol=NVDA",
  "/login",
  "/reset-password",
  // API routes compile on first request too, and these are awaited inside specs rather than
  // during navigation — so their compile lands squarely inside an `expect.poll` budget.
  "/api/me",
  "/api/watchlist",
  "/api/layouts",
  "/api/watchlist/annotations",
  // Compile chart dependencies before explicit reloads. Cold route compilation can
  // publish a dev hot update while the router is reinitializing. GET also warms
  // POST-only modules via405 without issuing their write operation.
  "/api/quote?view=regular&syms=NVDA",
  "/api/drawings?symbol=NVDA",
  "/api/scripts/list",
  "/api/study-templates",
  "/api/ext-quote?syms=NVDA",
  "/api/flow?f=gexstate%3ANVDA",
  "/api/brain/me",
  "/api/brain/chart/state",
  "/api/collect",
  "/data/NVDA.opts.json",
];

/** One request, with its own ceiling: a warm-up must never outlast the thing it protects. */
async function warm(url, timeoutMs) {
  const started = Date.now();
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: control.signal });
    // The STATUS is irrelevant — 401/404/307 all mean the route compiled, which is the point.
    return `${res.status} in ${Date.now() - started}ms`;
  } catch (err) {
    return `skipped after ${Date.now() - started}ms (${err.name})`;
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} base */
async function warmFixtureRoutes(base) {
  // Playwright's ordering of webServer vs globalSetup has moved between releases, so do not
  // assume the server is already up — wait for it rather than warming into a closed port.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/login`, { signal: AbortSignal.timeout(5_000) });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  // SERIAL, not parallel: twelve simultaneous cold compiles contend for the same dev server and
  // measure worse than doing them one at a time.
  const started = Date.now();
  for (const route of ROUTES) {
    const result = await warm(`${base}${route}`, 90_000);
    console.log(`[warmup] ${route} → ${result}`);
  }
  console.log(`[warmup] ${ROUTES.length} routes compiled in ${Math.round((Date.now() - started) / 1000)}s`);
}

module.exports = { warmFixtureRoutes };
