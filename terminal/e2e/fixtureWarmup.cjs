"use strict";

// Incumbent serial route warm-up. HTTP completion is not compiler/hydration proof.
const ROUTES = Object.freeze([
  "/terminal?symbol=NVDA", "/options", "/portfolio", "/alerts", "/analysis",
  "/discover", "/admin", "/embed/chart?symbol=NVDA", "/login", "/reset-password",
  "/api/me", "/api/watchlist", "/api/layouts", "/api/watchlist/annotations",
]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "AbortError", "TimeoutError", "FixtureBodyLimit"]);
function errorName(error) { return ERROR_NAMES.has(error?.name) ? error.name : "OtherError"; }

async function observeResponse(url, timeoutMs, deps = {}) {
  const now = deps.now || Date.now;
  const fetcher = deps.fetch || globalThis.fetch;
  const schedule = deps.setTimeout || setTimeout;
  const unschedule = deps.clearTimeout || clearTimeout;
  const started = now();
  const control = new AbortController();
  const state = { status: null, headersReceived: false, bodyComplete: false,
    bodyBytes: 0, timedOut: false, errorName: null, cancelRequested: false };
  let reader;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = schedule(() => {
      state.timedOut = true;
      control.abort();
      const error = new Error("fixture request deadline");
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
  const work = (async () => {
    const response = await fetcher(url, { signal: control.signal });
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new TypeError();
    state.status = response.status;
    state.headersReceived = true;
    if (response.body !== null) {
      reader = response.body.getReader();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (!ArrayBuffer.isView(part.value) || !Number.isSafeInteger(part.value.byteLength)) throw new TypeError();
        state.bodyBytes += part.value.byteLength;
        if (state.bodyBytes > MAX_BODY_BYTES) {
          const error = new Error("fixture response bound");
          error.name = "FixtureBodyLimit";
          throw error;
        }
      }
    }
    if (!control.signal.aborted) state.bodyComplete = true;
  })();
  try {
    await Promise.race([work, deadline]);
  } catch (error) {
    state.errorName = errorName(error);
  } finally {
    unschedule(timer);
    if (!state.bodyComplete || state.timedOut) {
      control.abort();
      if (reader) {
        state.cancelRequested = true;
        // Abort covers the same fetch/body deadline. Do not wait beyond it for
        // an arbitrary cancellation promise or claim network disposal from it.
        try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      }
    }
    try { reader?.releaseLock(); } catch {}
  }
  return Object.freeze({ ...state, elapsedMs: Math.max(0, now() - started) });
}

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

async function warmFixtureRoutes(base, options = {}) {
  const deps = options.deps || {};
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log || console.log;
  const emit = options.onOutcome || (() => {});
  const required = options.requiredHtmlRoutes || [];
  if (required.some((route) => !ROUTES.includes(route))) throw new TypeError("unknown fixture readiness route");
  const deadline = now() + 120_000;
  let readiness = null;
  while (now() < deadline) {
    readiness = await observeResponse(`${base}/login`, Math.min(5_000, deadline - now()), deps);
    emit({ phase: "readiness", route: "/login", ...readiness });
    // Any completed HTTP status establishes a responding server, not a compiled
    // application. Strong selected-HTML readiness is an explicit caller choice.
    if (readiness.bodyComplete && !readiness.timedOut) break;
    await sleep(Math.min(1_000, Math.max(0, deadline - now())));
  }
  if (!readiness?.bodyComplete || readiness.timedOut) {
    emit({ phase: "readiness_failed" });
    const error = new Error("fixture readiness unavailable");
    error.name = "FixtureReadinessUnavailable";
    throw error;
  }
  const outcomes = [];
  const started = now();
  for (const route of ROUTES) {
    const outcome = { route, ...await observeResponse(`${base}${route}`, 90_000, deps) };
    outcomes.push(outcome);
    emit({ phase: "route", ...outcome });
    log(`[warmup] ${route} headers=${outcome.status ?? "none"} body=${outcome.bodyComplete ? "complete" : "incomplete"} timeout=${outcome.timedOut} in ${outcome.elapsedMs}ms`);
  }
  const summary = {
    phase: "summary", routes: outcomes.length,
    headersReceived: outcomes.filter((row) => row.headersReceived).length,
    bodiesComplete: outcomes.filter((row) => row.bodyComplete && !row.timedOut).length,
    non2xx: outcomes.filter((row) => row.status !== null && (row.status < 200 || row.status >= 300)).length,
    timedOut: outcomes.filter((row) => row.timedOut).length,
    failed: outcomes.filter((row) => row.errorName !== null).length,
    selectedHtmlReady: required.every((route) => outcomes.some((row) => row.route === route && row.bodyComplete && !row.timedOut && row.status >= 200 && row.status < 300)),
    elapsedMs: Math.max(0, now() - started),
  };
  emit(summary);
  log(`[warmup] observed ${summary.routes} routes: headers=${summary.headersReceived} bodies=${summary.bodiesComplete} non2xx=${summary.non2xx} timeouts=${summary.timedOut}`);
  if (!summary.selectedHtmlReady) {
    const error = new Error("selected fixture HTML readiness unavailable");
    error.name = "FixtureHtmlReadinessUnavailable";
    throw error;
  }
  await qualifyProphetFixture(base);
  return { readiness, outcomes, summary };
}
module.exports = { ROUTES, MAX_BODY_BYTES, observeResponse, warmFixtureRoutes };
