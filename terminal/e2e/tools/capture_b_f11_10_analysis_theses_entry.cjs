#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This capture tool is intentionally CommonJS. */
/**
 * B-F11-10a Analysis context-bar theses entry — dark evidence crops.
 *
 * Playwright against the /analysis?symbol=NVDA company view, capturing the new
 * theses control in the Analysis context bar. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f11-10-analysis-theses-entry/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { trackOwnedServer, prepareNamespace } = require("./f11_owned_server.cjs");
const { scriptMetadata } = require("./f11_script_metadata.cjs");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-10-analysis-theses-entry");
const LAYOUT_FILES = [
  "terminal/components/workspaces/AnalysisWorkspace.tsx",
  "terminal/app/company-intelligence.css",
  "terminal/lib/i18n.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3565);
const BASE = `http://127.0.0.1:${PORT}`;
const SYM = "NVDA";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};
const SHOTS = [
  { viewport: "desktop", lang: "en", file: "desktop-en.png" },
  { viewport: "desktop", lang: "zh", file: "desktop-zh.png" },
  { viewport: "tablet", lang: "en", file: "tablet-en.png" },
  { viewport: "tablet", lang: "zh", file: "tablet-zh.png" },
  { viewport: "mobile", lang: "en", file: "mobile-en.png" },
  { viewport: "mobile", lang: "zh", file: "mobile-zh.png" },
];

// This provider-closed capture uses the real app, with no local dotenv authority.
// Do not read or print dotenv values, and do not turn absence into an auth claim.
function assertNoCaptureDotenv(root = ROOT) {
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    try { lstatSync(join(root, name)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw new Error("F11_DOTENV_PRESENT");
  }
}

function captureServerEnv(parent = process.env) {
  const inherited = {};
  for (const name of ["PATH", "HOME", "LANG", "TMPDIR", "TMP", "TEMP"]) {
    if (typeof parent[name] === "string") inherited[name] = parent[name];
  }
  return {
    ...inherited,
    NODE_ENV: "development",
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    ANALYSIS_LOCAL_PREVIEW: "1",
    ADMIN_DEV: "1",
    TERMINAL_E2E_FIXTURE: "1",
    TERMINAL_F11_PROVIDER_CLOSED: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    TERMINAL_REQUIRE_AUTH: "0",
    MMX_SHARED_SHELL: "0",
    MMX_INVESTOR_SHELL_PREVIEW: "0",
    RATE_LIMIT_MAX: "100000",
    HUB_REALTIME_QUOTES: "1",
    FLOW_FIXTURE: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
}

function staticScriptPath(raw, resourceType) {
  if (resourceType !== "script") return undefined;
  try {
    const pathname = new URL(raw).pathname;
    return /^\/_next\/static\/[a-zA-Z0-9_./%\[\]()-]{1,220}$/.test(pathname) ? pathname : undefined;
  } catch { return undefined; }
}

function consoleErrorKind(message) {
  if (/Content Security Policy|violates.*(?:directive|policy)|Refused to (?:load|execute)/i.test(message)) return "csp";
  if (/ChunkLoadError|Failed to load chunk|module factory|Module .*not found/i.test(message)) return "chunk-load";
  if (/hydrat|Minified React error/i.test(message)) return "react-hydration";
  if (/Failed to load resource|ERR_/i.test(message)) return "network-resource";
  return "other";
}

function writeFailureArtifact(out, capturedAtHead, diagnostic, error) {
  const code = typeof error?.message === "string" && /^F11_[A-Z_]+$/.test(error.message) ? error.message : "F11_CAPTURE_FAILED";
  writeFileSync(join(out, "FAILURE.json"), JSON.stringify({
    schema: "terminal.f11-source-component-failure.v1", status: "FAILURE",
    capturedAtHead, failedAt: new Date().toISOString(), errorCode: code, ...diagnostic,
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

// Outcome-manifest lifecycle: exactly these known filenames carry run outcome
// state in OUT. Everything else in OUT is historical evidence (PNGs,
// EVIDENCE.yml, FAIL-*.png) and is never cleared, globbed or rewritten here.
const FIXTURE_TEMP = "FIXTURE.json.tmp";
const OUTCOME_FILES = ["FIXTURE.json", "FAILURE.json"];

function removeKnownOutcomeFile(out, name) {
  const target = join(out, name);
  let stats;
  try { stats = lstatSync(target); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  // lstat (not stat): a symlink — even to a regular file — is an unexpected
  // object in OUT; refuse it instead of following or unlinking through it.
  if (!stats.isFile()) throw new Error("F11_UNEXPECTED_OUTCOME_OBJECT");
  unlinkSync(target);
  return true;
}

function assertNoOutcomeTemp(out) {
  try {
    const found = lstatSync(join(out, FIXTURE_TEMP));
    if (!found.isFile()) throw new Error("F11_UNEXPECTED_OUTCOME_OBJECT");
  } catch (error) { if (error.code === "ENOENT") return; throw error; }
  // A pre-existing temp may belong to a live or uncertain invocation. Never
  // delete it or infer that it is abandoned from its name or age.
  throw new Error("F11_OUTCOME_TEMP_COLLISION");
}

function invalidateStaleOutcomeArtifacts(out) {
  assertNoOutcomeTemp(out);
  const cleared = [];
  for (const name of OUTCOME_FILES) {
    if (removeKnownOutcomeFile(out, name)) cleared.push(name);
  }
  return cleared;
}

function assertAllSixObserved(files, entryObservations) {
  const expected = SHOTS.map((shot) => shot.file);
  const complete = Array.isArray(files) && Array.isArray(entryObservations)
    && files.length === expected.length
    && entryObservations.length === expected.length
    && expected.every((file, index) => files[index] === file)
    && entryObservations.every((observation, index) => observation && observation.file === expected[index]);
  if (!complete || new Set(entryObservations.map((observation) => observation.file)).size !== expected.length) {
    throw new Error("F11_PARTIAL_CAPTURE_NOT_ELIGIBLE_FOR_SUCCESS");
  }
}

function writeSuccessArtifact(out, files, payload) {
  // No success manifest may exist until all six ordered current observations are done.
  assertAllSixObserved(files, payload && payload.entryObservations);
  const body = JSON.stringify(payload, null, 2) + "\n";
  assertNoOutcomeTemp(out);
  try {
    const existing = lstatSync(join(out, "FIXTURE.json"));
    if (!existing.isFile()) throw new Error("F11_UNEXPECTED_OUTCOME_OBJECT");
    throw new Error("F11_SUCCESS_ALREADY_PRESENT");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  // Any cleanup refusal must occur before the success marker can become eligible.
  removeKnownOutcomeFile(out, "FAILURE.json");
  let fd;
  try {
    // Exclusive create: a concurrent or crashed invocation's temp can never be
    // overwritten, so no torn/partial FIXTURE.json is ever renamed into place.
    fd = openSync(join(out, FIXTURE_TEMP), "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("F11_OUTCOME_TEMP_COLLISION");
    throw error;
  }
  try {
    // writeFileSync handles short writes; a single writeSync may write only a prefix.
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(join(out, FIXTURE_TEMP), join(out, "FIXTURE.json"));
  return Buffer.byteLength(body, "utf8");
}

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock() {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`);
}

function startServer() {
  assertNoCaptureDotenv();
  const env = captureServerEnv();
  // Pinned Next16.2.9 Turbopack dev emits a next/dynamic preload name absent
  // from its actual client output (observed F11 static404). Use the supported
  // Webpack dev compiler for these source-component crops; keep the separate
  // canonical PL6/VI Turbopack qualification and all network200 guards intact.
  const child = spawn("npm", ["run", "dev", "--", "--webpack", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.on("data", (buf) => {
    const line = String(buf);
    if (/Ready|compiled|error|Error/i.test(line)) process.stdout.write(`[dev] ${line}`);
  });
  child.stderr.on("data", (buf) => process.stderr.write(`[dev:err] ${buf}`));
  return child;
}

async function stopServer(owner) {
  await owner.stop();
}

async function waitForServer(timeoutMs, owner) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    owner.assertRunning();
    try {
      const res = await fetch(`${BASE}/analysis?symbol=${SYM}`, { redirect: "manual", headers: { Cookie: "mm_e2e_rs30=1" } });
      last = String(res.status);
      owner.assertRunning();
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  await stripDevOverlay(page);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

async function installCaptureBoundary(context, base = BASE, { scriptMetadata: recordScripts = false } = {}) {
  const { classifyRequest, typedUnavailablePayload } = require("./f11_provider_closed_policy.cjs");
  const counts = { forwarded: 0, unavailable: 0, businessUnavailable: 0, componentFundUnavailable: 0, aborted: 0, webSocketsBlocked: 0, redirectOrBadStatus: 0, failedAllowedResponses: [] };
  let signalBusinessRequest;
  const observedBusinessRequest = new Promise(resolve => { signalBusinessRequest = resolve; });
  Object.defineProperty(counts, "waitForBusinessRequest", { value: async (timeoutMs = 10_000) => {
    let timer;
    try {
      await Promise.race([observedBusinessRequest, new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("F11_BUSINESS_REQUEST_BOUNDARY_NOT_EXERCISED")), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  } });
  const requestIds = new WeakMap();
  let nextRequestId = 0;
  const requestId = request => {
    if (!requestIds.has(request)) requestIds.set(request, ++nextRequestId);
    return requestIds.get(request);
  };
  if (recordScripts) {
    counts.publicScripts = [];
    counts.scriptDelivery = [];
    if (typeof context.on !== "function") throw new Error("F11_DELIVERY_OBSERVER_UNAVAILABLE");
    const observe = (event, request) => {
      if (request.resourceType() !== "script") return;
      const decision = classifyRequest({ url: request.url(), method: request.method(), resourceType: "script" }, base);
      const pathname = staticScriptPath(request.url(), "script");
      if (decision.decision !== "continue" || !pathname || counts.scriptDelivery.length >= 64) return;
      const known = ["ERR_CONTENT_DECODING_FAILED", "ERR_BLOCKED_BY_CLIENT", "ERR_ABORTED", "ERR_FAILED", "ERR_CONNECTION_RESET", "ERR_CONNECTION_CLOSED", "ERR_TIMED_OUT"];
      const failure = event === "failed" ? request.failure()?.errorText || "" : "";
      counts.scriptDelivery.push({ requestId: requestId(request), pathname, event,
        ...(event === "failed" ? { errorCode: known.find(code => failure.includes(code)) || "OTHER" } : {}) });
    };
    context.on("requestfinished", request => observe("finished", request));
    context.on("requestfailed", request => observe("failed", request));
  }
  if (typeof context.routeWebSocket !== "function") throw new Error("F11_WEBSOCKET_BOUNDARY_UNSUPPORTED");
  // The crop needs no live stream, including dev HMR. Block before a socket connects.
  await context.routeWebSocket("**/*", (socket) => { counts.webSocketsBlocked++; socket.close(); });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const decision = classifyRequest({ url: request.url(), method: request.method(), resourceType: request.resourceType() }, base);
    if (decision.decision === "fulfill") {
      counts.unavailable++;
      await route.fulfill({ status: 503, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(typedUnavailablePayload()) });
      // Observe only the component's normal business reads, never issue a probe.
      const intercepted = new URL(request.url());
      if (intercepted.pathname.startsWith("/api/") || intercepted.pathname.startsWith("/data/")) counts.businessUnavailable++;
      // AnalysisWorkspace calls getFund(sym) from its settled-symbol effect;
      // fund.ts owns this exact URL. Chrome/other-symbol reads are not this proof.
      if (intercepted.origin === base && intercepted.pathname === `/data/${SYM}.fund.json`) {
        counts.componentFundUnavailable++;
        signalBusinessRequest();
      }
      return;
    }
    if (decision.decision === "continue") {
      // Only policy-qualified loopback documents/assets reach this call. Do not
      // allow a redirect from an otherwise allowed URL to escape the boundary.
      const requestedAt = performance.now();
      const response = await route.fetch({ maxRedirects: 0 });
      const fetchedAt = performance.now();
      const status = response.status();
      if (status !== 200) {
        counts.redirectOrBadStatus++;
        // Diagnose a failed public asset without retaining URLs, queries,
        // headers or bodies. The positive200/event guards remain unchanged.
        if (counts.failedAllowedResponses.length < 8) {
          const resourceType = request.resourceType();
          const families = { document: "analysis-document", script: "next-script", stylesheet: "next-style", font: "next-font", image: "static-image", manifest: "static-manifest" };
          const scriptPath = staticScriptPath(request.url(), resourceType);
          counts.failedAllowedResponses.push({ family: families[resourceType] || "unknown", resourceType: Object.hasOwn(families, resourceType) ? resourceType : "unknown", status, ...(scriptPath ? { scriptPath } : {}) });
        }
        return route.abort("blockedbyclient");
      }
      counts.forwarded++;
      let metadata;
      if (recordScripts && request.resourceType() === "script") {
        if (counts.publicScripts.length >= 32) throw new Error("F11_SCRIPT_METADATA_BOUND");
        const bodyStart = performance.now();
        const bytes = await response.body();
        metadata = scriptMetadata({ pathname: new URL(request.url()).pathname,
          contentType: response.headers()["content-type"], body: bytes,
          fetchMs: fetchedAt - requestedAt, bodyMs: performance.now() - bodyStart, fulfillMs: 0 });
        const encoding = response.headers()["content-encoding"]?.trim().toLowerCase();
        metadata.encoding = encoding ? ["gzip", "br", "deflate", "identity", "zstd"].includes(encoding) ? encoding : "other" : "missing";
        metadata.requestId = requestId(request);
        counts.publicScripts.push(metadata);
      }
      const fulfilledAt = performance.now();
      await route.fulfill({ response });
      if (metadata) metadata.fulfillMs = performance.now() - fulfilledAt;
      return;
    }
    counts.aborted++;
    return route.abort("blockedbyclient");
  });
  return counts;
}

async function openAnalysis(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    const applyAttributes = () => {
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.setAttribute("data-lang", l);
      document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    };
    if (document.documentElement) applyAttributes();
    else document.addEventListener("DOMContentLoaded", applyAttributes, { once: true });
  }, lang);
  await page.goto(`${BASE}/analysis?symbol=${SYM}&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  // Wait for the context bar and the theses control to be visible.
  const entry = page.getByLabel(lang === "zh" ? "你的研究论点：NVDA" : "Your theses on NVDA");
  await entry.waitFor({ state: "visible", timeout: 45_000 });
  if (await entry.count() !== 1) throw new Error("F11_THESES_ENTRY_NOT_UNIQUE");
  const href = new URL(await entry.getAttribute("href"), BASE);
  if (href.origin !== BASE || href.pathname !== "/analysis"
      || href.searchParams.get("view") !== "theses" || href.searchParams.get("symbol") !== SYM) {
    throw new Error("F11_THESES_ENTRY_IDENTITY_MISMATCH");
  }
  const bounds = await entry.boundingBox();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error("F11_THESES_ENTRY_EMPTY");
  await stripDevOverlay(page);
  return { symbol: SYM, lang, state: "context-bar-with-theses-control", href: href.pathname + href.search, entryBounds: bounds };
}

async function shoot(page, file, out = OUT) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  return page.screenshot({ path: join(out, file) });
}

async function observeBootstrap(page) {
  return page.evaluate(() => {
    const registry = window.webpackChunk_N_E;
    return {
      readyState: document.readyState, scriptCount: document.scripts.length,
      nextRuntime: typeof window.next === "object", flightArray: Array.isArray(window.__next_f),
      flightConsumerInstalled: Array.isArray(window.__next_f) && window.__next_f.push !== Array.prototype.push,
      webpackRegistryPresent: Array.isArray(registry),
      webpackGroups: Array.isArray(registry) ? registry.length : 0,
      registeredChunkIds: Array.isArray(registry) ? registry.flatMap(entry => Array.isArray(entry?.[0]) ? entry[0] : [])
        .filter(id => typeof id === "string" && /^[a-zA-Z0-9_./()[\]-]{1,180}$/.test(id)).slice(0,32) : [],
      scripts: Array.from(document.scripts).filter(script => script.src).slice(0,32).flatMap(script => {
        try {
          const pathname = new URL(script.src).pathname;
          if (!/^\/_next\/static\/[a-zA-Z0-9_./%[\]()-]{1,240}$/.test(pathname)) return [];
          return [{ pathname, async: script.async, defer: script.defer, type: script.type === "module" ? "module" : !script.type || script.type === "text/javascript" ? "classic" : "other" }];
        } catch { return []; }
      }),
    };
  }).catch(() => ({ unavailable: true }));
}

function writeDiagnosticArtifact(out, payload) {
  if (payload.entryObservations?.length !== 1 || payload.entryObservations[0].file !== "mobile-zh.png") throw new Error("F11_DIAGNOSTIC_CASE_CONTRACT");
  writeFileSync(join(out, "DIAGNOSTIC.json"), JSON.stringify({
    ...payload, schema: "terminal.f11-mobile-zh-diagnostic.v1", status: "DIAGNOSTIC_ONLY_NOT_SIX_CASE_SUCCESS",
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

async function runCapture(mode) {
  if (!["canonical-six", "diagnostic-mobile-zh"].includes(mode)) throw new Error("F11_CAPTURE_MODE");
  const diagnosticOnly = mode === "diagnostic-mobile-zh";
  let namespace;
  let out = OUT;
  if (diagnosticOnly) {
    namespace = prepareNamespace(ROOT);
    out = mkdtempSync(join(ROOT, ".next", "f11", "mobile-zh-diagnostic-"));
    console.log("F11_DIAGNOSTIC_DIRECTORY " + out);
  }
  mkdirSync(out, { recursive: true });
  // Invocation start: a previous run's success/failure manifests are stale the
  // moment this invocation begins. Clear only the known outcome filenames so a
  // failed or partial run can never leave an eligible old FIXTURE.json behind;
  // historical PNGs and EVIDENCE.yml are untouched.
  const clearedOutcome = invalidateStaleOutcomeArtifacts(out);
  if (clearedOutcome.length) process.stdout.write(`cleared stale outcome: ${clearedOutcome.join(", ")}\n`);
  const { chromium } = require("@playwright/test");
  assertNoCaptureDotenv();
  const capturedAtHead = currentGitHead();
  namespace ||= prepareNamespace(ROOT);
  const child = startServer();
  const owner = trackOwnedServer(child);
  const files = [];
  const entryObservations = [];
  let captureProfile;

  try {
    await waitForServer(180_000, owner);
    const browserManifest = JSON.parse(readFileSync(join(require.resolve("playwright-core/package.json"), "..", "browsers.json"), "utf8"));
    const browser = await chromium.launch({ headless: true });
    try {
      captureProfile = {
      server: { command: "next dev --webpack", mode: "development", reactDebugChannel: false, providerClosedChild: true, distDir: ".next/f11", tsconfigPath: "tsconfig.f11.json" },
      node: process.version, next: require("next/package.json").version,
      playwright: require("@playwright/test/package.json").version,
      browser: { version: browser.version(), revision: browserManifest.browsers.find(entry => entry.name === "chromium-headless-shell")?.revision,
        launch: { headless: true }, serviceWorkers: "block", freshContextPerImage: true },
      };
      for (const shot of (diagnosticOnly ? SHOTS.filter(shot => shot.file === "mobile-zh.png") : SHOTS)) {
        process.stdout.write(`capture ${shot.file} … `);
        const context = await browser.newContext({
          viewport: VIEWPORTS[shot.viewport],
          hasTouch: shot.viewport !== "desktop", // tablet + mobile: pointer:coarse, so the 44px floor is what the crops show
          locale: shot.lang === "zh" ? "zh-CN" : "en-US",
          colorScheme: "dark",
          serviceWorkers: "block",
        });
        const boundaryCounts = await installCaptureBoundary(context, BASE, { scriptMetadata: diagnosticOnly });
        await context.addCookies([{ name: "mm_e2e_rs30", value: "1", url: BASE }]);
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        const pageErrorNames = [];
        const consoleErrorKinds = [];
        page.on("console", message => {
          if (message.type() === "error" && consoleErrorKinds.length < 8) consoleErrorKinds.push(consoleErrorKind(message.text()));
        });
        page.on("pageerror", error => {
          const known = ["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError"];
          pageErrorNames.push(known.includes(error.name) ? error.name : "Error");
        });
        try {
          const entry = await openAnalysis(page, shot.lang, VIEWPORTS[shot.viewport]);
          await boundaryCounts.waitForBusinessRequest();
          if (pageErrorNames.length) throw new Error("F11_PAGE_SCRIPT_ERROR");
          const image = await shoot(page, shot.file, out);
          if (boundaryCounts.componentFundUnavailable < 1) throw new Error("F11_BUSINESS_REQUEST_BOUNDARY_NOT_EXERCISED");
          if (boundaryCounts.redirectOrBadStatus !== 0) throw new Error("F11_ALLOWED_ROUTE_DID_NOT_RETURN_200");
          files.push(shot.file);
          entryObservations.push({ ...(diagnosticOnly ? { bootstrapState: await observeBootstrap(page) } : {}), file: shot.file, viewport: VIEWPORTS[shot.viewport], ...entry, requestBoundary: { ...boundaryCounts }, pageErrorNames, image: { bytes: image.length, sha256: createHash("sha256").update(image).digest("hex") } });
          console.log("ok");
        } catch (err) {
          console.log(`FAIL ${err && err.message ? err.message : err}`);
          const bootstrapState = await observeBootstrap(page);
          const diagnostic = { captureProfile, file: shot.file, requestBoundary: { ...boundaryCounts }, pageErrorNames, consoleErrorKinds, bootstrapState };
          writeFailureArtifact(out, capturedAtHead, diagnostic, err);
          console.error("F11_CAPTURE_DIAGNOSTICS " + JSON.stringify(diagnostic));
          try {
            await page.screenshot({ path: join(out, `FAIL-${shot.file}`), fullPage: false });
          } catch { /* ignore */ }
          throw err;
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stopServer(owner);
    namespace.restoreGeneratedTypeFile();
  }

  const fixtureSources = Object.fromEntries([
      "terminal/e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs",
      "terminal/e2e/tools/f11_provider_closed_policy.cjs",
      "terminal/e2e/tools/f11_owned_server.cjs",
      "terminal/e2e/tools/f11_script_metadata.cjs",
      ...(diagnosticOnly ? ["terminal/e2e/tools/diagnose_f11_mobile_zh.cjs"] : []),
      "terminal/tsconfig.f11.json",
      "terminal/tsconfig.json",
      "terminal/next.config.ts",
      "terminal/package-lock.json",
      "terminal/app/(shell)/analysis/page.tsx",
      "terminal/app/(shell)/layout.tsx",
      "terminal/lib/supabase/middleware.ts",
      ".github/workflows/ci.yml",
      ...LAYOUT_FILES,
    ].map((rel) => [rel, sha256File(rel)]));
  if (diagnosticOnly) {
    writeDiagnosticArtifact(out, { capturedAtHead, fixtureSources, captureProfile, serverSettlement: owner.settlement(), generatedTypes: namespace.summary(), entryObservations });
    return { diagnosticOnly: true, out };
  }

  const fixturePayload = {
    schema: "terminal.f11-source-component-fixture.v1",
    capturedAtHead,
    captureProfile,
    serverSettlement: owner.settlement(),
    generatedTypes: namespace.summary(),
    fixtureSources,
    scope: "Real source component, synthetic fixture identity and unavailable market inputs; no authenticated, provider, installed or account proof",
    entryObservations,
  };
  const evidence = [
    "# B-F11-10a Analysis context-bar theses entry — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: tablet, width: 820, height: 1180 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    ...SHOTS.map((s) => `  ${s.file}: { url: "/analysis?symbol=${SYM}&lang=${s.lang}", state: context-bar-with-theses-control }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs",
    "files:",
    ...SHOTS.map((s) => `  - ${s.file}`),
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), `${evidence.join("\n")}\n`);
  // Publish eligibility last, after all six observations and evidence metadata.
  writeSuccessArtifact(OUT, files, fixturePayload);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml at ${capturedAtHead}`);
}

function main() { return runCapture("canonical-six"); }
function diagnoseMobileZh() { return runCapture("diagnostic-mobile-zh"); }

module.exports = { observeBootstrap, diagnoseMobileZh, writeDiagnosticArtifact, assertAllSixObserved, assertNoCaptureDotenv, captureServerEnv, installCaptureBoundary, invalidateStaleOutcomeArtifacts, staticScriptPath, consoleErrorKind, writeFailureArtifact, writeSuccessArtifact, FIXTURE_TEMP };

if (require.main === module) main().catch((err) => {
  console.error(err);
  process.exit(1);
});
