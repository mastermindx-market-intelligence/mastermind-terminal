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

/** Prove the fixture API can finish a real read before any browser journey starts. */
async function qualifyProphetFixture(base) {
  const started = Date.now();
  const control = new AbortController();
  // Match the existing flow client allowance; this covers headers and the complete body.
  const timer = setTimeout(() => control.abort(), 25_000);
  let reason = "transport";
  let status;
  try {
    const res = await fetch(`${base}/api/flow?f=prophet_idx`, {
      signal: control.signal,
      redirect: "error",
    });
    status = res.status;
    if (status !== 200) {
      reason = "http_status";
      throw new Error("fixture status");
    }
    if (res.headers.get("x-flow-source") !== "fixture") {
      reason = "fixture_provenance";
      throw new Error("fixture provenance");
    }
    reason = "malformed_json";
    const body = await res.json();
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      body.schema !== "prophet.index/v1" ||
      !Array.isArray(body.plans)
    ) {
      reason = "body_shape";
      throw new Error("fixture body shape");
    }
    console.log(`[fixture-ready] prophet_idx fixture 200 in ${Date.now() - started}ms`);
  } catch {
    const classification = control.signal.aborted ? "timeout" : reason;
    const statusText = Number.isInteger(status) && status >= 100 && status <= 599
      ? ` status=${status}`
      : "";
    // Keep fixture payloads and underlying transport errors out of the diagnostic.
    throw new Error(
      `[fixture-ready] prophet_idx ${classification}${statusText} after ${Date.now() - started}ms`,
    );
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
  await qualifyProphetFixture(base);
}

module.exports = { warmFixtureRoutes };
