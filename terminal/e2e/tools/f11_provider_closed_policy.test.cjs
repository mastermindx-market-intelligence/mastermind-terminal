"use strict";

/**
 * Tests for the F11 provider-closed browser route policy.
 *
 * Pure node:test suite over the pure decision core: no browser, no server,
 * no network, no playwright, no writes. The only I/O is reading the two
 * module sources to prove they stay dependency-free.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { URL } = require("node:url");

const {
  classifyRequest,
  typedUnavailablePayload,
  DECISION_VALUES,
  POLICY_VERSION,
} = require("./f11_provider_closed_policy.cjs");

const BASE = "http://127.0.0.1:3565";
const POLICY_FILE = "f11_provider_closed_policy.cjs";
const TEST_FILE = "f11_provider_closed_policy.test.cjs";

const docUrl = (lang = "en") => `${BASE}/analysis?symbol=NVDA&lang=${lang}`;
// Convenience builder for well-formed requests. Callers that need a raw
// undefined method or resourceType must build the object literally.
const req = (url, method = "GET", resourceType = "document") => ({ url, method, resourceType });

const DOC_CONTINUE = {
  decision: "continue",
  kind: "app-document",
  reason: "continue-app-document",
  resourceType: "document",
  policyVersion: POLICY_VERSION,
};
const STATIC_CONTINUE = {
  decision: "continue",
  kind: "next-static",
  reason: "continue-next-static",
  policyVersion: POLICY_VERSION,
};

function sourceOf(file) {
  return readFileSync(join(__dirname, file), "utf8");
}

function requiresOf(source) {
  return [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
}

// True when a URL survives the policy's early gates (scheme-relative,
// unparseable, credentials, non-http(s) schemes) that precede route classes.
function passesEarlyGates(url) {
  if (typeof url !== "string" || url.startsWith("//")) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "") return false;
  return u.protocol === "http:" || u.protocol === "https:";
}

// --- Independent allowlist oracle used by the corpus sweep (T-corpus). ---
function independentlyAllowed(url, method, resourceType) {
  if (method !== "GET") return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== BASE) return false;
  if (u.username !== "" || u.password !== "") return false;
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (resourceType === "document") {
    if (u.pathname !== "/analysis") return false;
    if ([...u.searchParams.entries()].length !== 2) return false;
    const [symbol] = u.searchParams.getAll("symbol");
    const [lang] = u.searchParams.getAll("lang");
    return symbol === "NVDA" && (lang === "en" || lang === "zh");
  }
  if (["script", "stylesheet", "font", "image", "manifest"].includes(resourceType)) {
    return [
      /^\/_next\/static\//,
      /^\/favicon\.ico$/,
      /^\/(apple-)?icon(\.[0-9a-z]+)?$/,
    ].some((re) => re.test(u.pathname));
  }
  return false;
}

test("policy module surface: dependency-free, network-free, frozen exports", () => {
  const policySource = sourceOf(POLICY_FILE);
  const testSource = sourceOf(TEST_FILE);

  // The policy requires exactly one builtin: the URL parser.
  assert.deepEqual(requiresOf(policySource), ["node:url"]);
  // The test file's own requires are the declared pure set (incl. this module).
  assert.deepEqual(requiresOf(testSource), [
    "node:test",
    "node:assert/strict",
    "node:fs",
    "node:path",
    "node:url",
    "./f11_provider_closed_policy.cjs",
  ]);
  // No network/process/browser entry points in the policy source.
  assert.doesNotMatch(policySource, /\bnode:(https?|net|dgram|dns|tls|child_process|fs|worker_threads|cluster)\b/);
  assert.doesNotMatch(policySource, /\bfetch\s*\(/);
  assert.doesNotMatch(policySource, /XMLHttpRequest|new WebSocket|EventSource\s*\(|createConnection|\bexecSync\b|\bspawnSync\b/);
  assert.doesNotMatch(policySource, /\bprocess\.(env|exit|cwd|binding)\b/);
  assert.doesNotMatch(policySource, /\blocalStorage\b/);
  // Neither file depends on playwright (the word may appear in prose only).
  assert.doesNotMatch(policySource, /require\([^)]*playwright/i);
  assert.doesNotMatch(testSource, /require\([^)]*playwright/i);

  assert.deepEqual(DECISION_VALUES, ["continue", "fulfill", "abort"]);
  assert.ok(Object.isFrozen(DECISION_VALUES));
  assert.equal(typeof POLICY_VERSION, "string");
  assert.ok(POLICY_VERSION.length > 0);
  assert.equal(typeof classifyRequest, "function");
  assert.equal(typeof typedUnavailablePayload, "function");
});

test("allowed app documents: exact /analysis?symbol=NVDA&lang=en|zh document GETs continue", () => {
  for (const url of [
    docUrl("en"),
    docUrl("zh"),
    `${BASE}/analysis?lang=zh&symbol=NVDA`, // param order is irrelevant
    `${docUrl("en")}#client-only-fragment`, // fragments are never transmitted
  ]) {
    const d = classifyRequest(req(url), BASE);
    assert.deepEqual(d, { ...DOC_CONTINUE });
    assert.ok(Object.isFrozen(d));
  }
  // Each base origin admits only its own exact origin: the request URL must
  // carry the same host spelling (canonicalized) as the configured base.
  assert.deepEqual(
    classifyRequest(req("http://localhost:3565/analysis?symbol=NVDA&lang=en"), "http://localhost:3565"),
    { ...DOC_CONTINUE },
  );
  assert.deepEqual(
    classifyRequest(req("http://[::1]:3565/analysis?symbol=NVDA&lang=en"), "http://[::1]:3565"),
    { ...DOC_CONTINUE },
  );
  // WHATWG canonicalization: "127.0.0.01" IS 127.0.0.1 — the browser connects
  // to the same selected loopback origin either way, so canonical equality
  // admits it (this is the same origin, not a look-alike).
  assert.deepEqual(
    classifyRequest(req("http://127.0.0.01:3565/analysis?symbol=NVDA&lang=en"), BASE),
    { ...DOC_CONTINUE },
  );
  // But a genuinely different host under a look-alike spelling stays foreign.
  assert.equal(
    classifyRequest(req("http://127.0.0.1.evil.com:3565/analysis?symbol=NVDA&lang=en"), BASE).decision,
    "abort",
  );
});

test("document negatives: wrong/missing params, duplicates, path aliases, traversal", () => {
  const negatives = [
    `${BASE}/analysis?symbol=AAPL&lang=en`, // wrong symbol
    `${BASE}/analysis?symbol=nvda&lang=en`, // case-sensitive symbol
    `${BASE}/analysis?lang=en`, // missing symbol
    `${BASE}/analysis?symbol=NVDA`, // missing lang
    `${BASE}/analysis?symbol=NVDA&lang=fr`, // unsupported lang
    `${BASE}/analysis?symbol=NVDA&lang=EN`, // case-sensitive lang
    `${BASE}/analysis?symbol=NVDA&lang=en&lang=zh`, // duplicate lang
    `${BASE}/analysis?symbol=NVDA&symbol=AAPL&lang=en`, // duplicate symbol
    `${BASE}/analysis?symbol=NVDA&lang=en&extra=1`, // extra param
    `${BASE}/analysis?%73ymbol=NVDA&lang=en&extra=1`, // encoded key + extra param
    `${BASE}/analysis?`, // no params
    `${BASE}/analysis`, // no query at all
    `${BASE}/analysis/`, // trailing slash
    `${BASE}/Analysis?symbol=NVDA&lang=en`, // case-sensitive path
    `${BASE}/analysis%3Fsymbol=NVDA&lang=en`, // encoded "?" stays in the path
    `${BASE}/%61nalysis?symbol=NVDA&lang=en`, // percent alias is NOT decoded
    `${BASE}/analysis/../../api/quotes?symbol=NVDA&lang=en`, // dot-segment escape
    `${BASE}/analysis/..%2F..%2Fapi/quotes?symbol=NVDA&lang=en`, // encoded escape stays blocked
    `${BASE}/analysis%2F..%2Fapi?symbol=NVDA&lang=en`, // encoded slash stays blocked
    `${BASE}\\api\\quotes?symbol=NVDA&lang=en`, // backslash path normalizes to /api/quotes
    `${BASE}/company?symbol=NVDA&lang=en`, // arbitrary document path
    `${BASE}/`, // bare root
    `${BASE}/_next/static/chunks/page.js`, // static path is not a document route
  ];
  for (const url of negatives) {
    const d = classifyRequest(req(url), BASE);
    assert.equal(d.decision, "abort", url);
    assert.equal(d.kind, "app-document", url);
    assert.equal(d.reason, "abort-non-app-document-route", url);
  }
});

test("allowed Next static assets and root icons: script/css/font/image/manifest continue", () => {
  const positives = [
    ["/_next/static/chunks/app/analysis/page-abc123.js", "script"],
    ["/_next/static/css/app-layout.css", "stylesheet"],
    ["/_next/static/media/inter-var.woff2", "font"],
    ["/_next/static/media/logo.svg", "image"],
    ["/favicon.ico", "image"],
    ["/icon", "image"],
    ["/icon.svg", "image"],
    ["/apple-icon", "image"],
    ["/apple-icon.png", "image"],
    ["/_next/static/manifest.json", "manifest"],
  ];
  for (const [path, type] of positives) {
    const d = classifyRequest(req(`${BASE}${path}`, "GET", type), BASE);
    assert.deepEqual(d, { ...STATIC_CONTINUE, resourceType: type }, path);
  }
});

test("static negatives: wrong type/path pairs and non-allowlisted same-origin paths abort", () => {
  const negatives = [
    ["/api/quotes", "script"],
    ["/analysis?symbol=NVDA&lang=en", "script"], // document path is not a script route
    ["/public-secret.png", "image"],
    ["/_next/staticX/escape.js", "script"], // prefix look-alike
    ["/_next/../api/quotes", "script"], // dot-segment normalizes to /api/quotes
    ["/_next/webpack-hmr", "script"],
    ["/robots.txt", "script"],
    ["/sitemap.xml", "script"],
    ["/manifest.json", "manifest"], // root manifest is not justified
  ];
  for (const [path, type] of negatives) {
    const d = classifyRequest(req(`${BASE}${path}`, "GET", type), BASE);
    assert.equal(d.decision, "abort", `${type} ${path}`);
    assert.equal(d.kind, "next-static", `${type} ${path}`);
    assert.equal(d.reason, "abort-non-static-route", `${type} ${path}`);
  }
  // A document-typed request for a static asset is refused (documents are
  // only ever /analysis).
  const d = classifyRequest(req(`${BASE}/_next/static/chunks/page.js`), BASE);
  assert.equal(d.decision, "abort");
  assert.equal(d.kind, "app-document");
});

test("provider/data routes: xhr/fetch fulfill typed-unavailable BEFORE origin/path checks", () => {
  const dataUrls = [
    `${BASE}/api/quotes`,
    `${BASE}/api/fundamentals?symbols=NVDA`,
    `${BASE}/analysis?symbol=NVDA&lang=en`, // data type on the app path: type wins
    `${BASE}/%61pi%2Fquotes`, // encoded alias of an API path
    `${BASE}\\api\\quotes`, // backslash alias of an API path
    `${BASE}/api/../analysis?symbol=NVDA&lang=en`,
    "https://accounted.example.com/api/quotes", // foreign origin: data check fires first
  ];
  for (const url of dataUrls) {
    for (const type of ["xhr", "fetch"]) {
      const d = classifyRequest(req(url, "GET", type), BASE);
      assert.equal(d.decision, "fulfill", `${type} ${url}`);
      assert.equal(d.kind, "provider-data", `${type} ${url}`);
      assert.equal(d.reason, "fulfill-provider-data-typed-unavailable", `${type} ${url}`);
      assert.ok(Object.isFrozen(d));
    }
  }
  // Same decision for the same data route regardless of origin: the origin is
  // never consulted for data routes, so no API request is ever completed.
  assert.deepEqual(
    classifyRequest(req(`${BASE}/api/quotes`, "GET", "xhr"), BASE),
    classifyRequest(req("https://accounted.example.com/api/quotes", "GET", "xhr"), BASE),
  );
});

test("streaming and non-essential resources abort (dev HMR, realtime, media)", () => {
  // ws/wss schemes fail closed at the scheme gate (they are not http/https).
  for (const url of ["ws://127.0.0.1:3565/hub", "wss://127.0.0.1:3565/hub"]) {
    const d = classifyRequest(req(url, "GET", "websocket"), BASE);
    assert.equal(d.decision, "abort", url);
    assert.equal(d.reason, "abort-unsupported-scheme", url);
  }
  // http(s) streaming endpoints fail closed at the resource-type gate.
  const streaming = [
    [`${BASE}/_next/webpack-hmr`, "eventsource"],
    [`https://127.0.0.1:3565/realtime`, "websocket"],
  ];
  for (const [url, type] of streaming) {
    const d = classifyRequest(req(url, "GET", type), BASE);
    assert.equal(d.decision, "abort", `${type} ${url}`);
    assert.equal(d.reason, "abort-streaming-resource-blocked", `${type} ${url}`);
  }
  for (const [url, type] of [
    [`${BASE}/video.mp4`, "media"],
    [`${BASE}/captions.vtt`, "texttrack"],
  ]) {
    const d = classifyRequest(req(url, "GET", type), BASE);
    assert.equal(d.decision, "abort", `${type} ${url}`);
    assert.equal(d.reason, "abort-non-essential-resource-blocked", `${type} ${url}`);
  }
});

test("origin negatives: foreign hosts, other ports, other schemes, prefix look-alikes", () => {
  const foreign = [
    "https://accounted.example.com/analysis?symbol=NVDA&lang=en",
    "http://accounted.example.com:3565/analysis?symbol=NVDA&lang=en",
    "http://127.0.0.1:4711/analysis?symbol=NVDA&lang=en", // arbitrary other port
    "http://localhost:3565/analysis?symbol=NVDA&lang=en", // base is 127.0.0.1 here
    "http://[::1]:3565/analysis?symbol=NVDA&lang=en", // base is 127.0.0.1 here
    "https://127.0.0.1:3565/analysis?symbol=NVDA&lang=en", // scheme change
    "http://127.0.0.1.evil.com:3565/analysis?symbol=NVDA&lang=en", // prefix look-alike
    "http://sub.127.0.0.1.nip.io:3565/analysis?symbol=NVDA&lang=en",
    "http://0.0.0.0:3565/analysis?symbol=NVDA&lang=en",
  ];
  for (const url of foreign) {
    const d = classifyRequest(req(url), BASE);
    assert.equal(d.decision, "abort", url);
    assert.equal(d.kind, "origin", url);
    assert.equal(d.reason, "abort-foreign-origin", url);
  }
  // Same foreign-origin refusals for static types.
  const d = classifyRequest(req("http://127.0.0.1:4711/_next/static/x.js", "GET", "script"), BASE);
  assert.deepEqual({ ...d, kind: d.kind }, {
    decision: "abort",
    kind: "origin",
    reason: "abort-foreign-origin",
    resourceType: "script",
    policyVersion: POLICY_VERSION,
  });
});

test("scheme-relative and credential-bearing URLs fail closed", () => {
  const d = classifyRequest(req("//127.0.0.1:3565/analysis?symbol=NVDA&lang=en"), BASE);
  assert.equal(d.decision, "abort");
  assert.equal(d.reason, "abort-scheme-relative-url");

  const credentialed = [
    "http://user:pass@127.0.0.1:3565/analysis?symbol=NVDA&lang=en",
    "http://user@127.0.0.1:3565/analysis?symbol=NVDA&lang=en",
    "http://:pass@127.0.0.1:3565/analysis?symbol=NVDA&lang=en",
    "http://token@127.0.0.1:3565/_next/static/x.js",
  ];
  for (const url of credentialed) {
    const c = classifyRequest(req(url), BASE);
    assert.equal(c.decision, "abort", url);
    assert.equal(c.reason, "abort-credential-bearing-url", url);
  }
});

test("unsupported methods fail closed everywhere", () => {
  const methodCases = [
    ["POST", docUrl("en"), "document"],
    ["HEAD", docUrl("en"), "document"],
    ["PUT", docUrl("en"), "document"],
    ["get", docUrl("en"), "document"], // methods are case-sensitive
    ["POST", `${BASE}/_next/static/x.js`, "script"],
    ["POST", `${BASE}/api/quotes`, "xhr"],
    ["DELETE", `${BASE}/api/quotes`, "fetch"],
  ];
  for (const [method, url, type] of methodCases) {
    const d = classifyRequest(req(url, method, type), BASE);
    assert.equal(d.decision, "abort", String(method));
    assert.equal(d.kind, "method", String(method));
    assert.equal(d.reason, "abort-unsupported-method", String(method));
  }
  // An absent method fails closed (literal object: the builder would fill in GET).
  const absent = classifyRequest({ url: docUrl("en"), method: undefined, resourceType: "document" }, BASE);
  assert.equal(absent.decision, "abort");
  assert.equal(absent.reason, "abort-unsupported-method");
});

test("unknown resource types and non-http(s) schemes fail closed", () => {
  // Literal object for the absent type: the builder would fill in "document".
  const absentType = classifyRequest({ url: docUrl("en"), method: "GET", resourceType: undefined }, BASE);
  assert.equal(absentType.decision, "abort");
  assert.equal(absentType.reason, "abort-unknown-resource-type");
  for (const type of ["", "serviceworker", "DOCUMENT", "paint", "beacon"]) {
    const d = classifyRequest(req(docUrl("en"), "GET", type), BASE);
    assert.equal(d.decision, "abort", String(type));
    assert.equal(d.reason, "abort-unknown-resource-type", String(type));
  }
  // "other" never continues on any path.
  for (const path of ["/_next/static/x.js", "/whatever", docUrl("en").slice(BASE.length)]) {
    const d = classifyRequest(req(`${BASE}${path}`, "GET", "other"), BASE);
    assert.equal(d.decision, "abort", path);
    assert.equal(d.reason, "abort-unclassified-resource-blocked", path);
  }
  for (const url of [
    "file:///etc/passwd",
    "data:text/html,hi",
    "blob:http://127.0.0.1:3565/uuid",
    "ftp://127.0.0.1:3565/x",
    "javascript:void(0)",
    "chrome-extension://abc/x",
  ]) {
    const d = classifyRequest(req(url), BASE);
    assert.equal(d.decision, "abort", url);
    assert.equal(d.reason, "abort-unsupported-scheme", url);
  }
});

test("unparseable URLs fail closed", () => {
  for (const url of [undefined, "", "not a url", "http://", "http://[::1"]) {
    const d = classifyRequest(req(url), BASE);
    assert.equal(d.decision, "abort", String(url));
    assert.equal(d.reason, "abort-unparseable-url", String(url));
  }
});

test("unsafe base origins make every request fail closed", () => {
  const badBases = [
    undefined,
    "",
    "https://accounted.example.com", // non-loopback base
    "http://0.0.0.0:3565",
    "http://user@127.0.0.1:3565", // credentialed base
    "http://127.0.0.1:3565/app", // base with a path
    "http://127.0.0.1:3565/?x=1", // base with a query
    "file:///tmp",
    "http://127.0.0.1.evil.com:3565", // prefix look-alike base
  ];
  for (const base of badBases) {
    const d = classifyRequest(req(docUrl("en")), base);
    assert.equal(d.decision, "abort", String(base));
    assert.equal(d.kind, "policy-config", String(base));
    assert.equal(d.reason, "abort-invalid-base-origin", String(base));
  }
});

test("typedUnavailablePayload is constant, frozen, and invents no data", () => {
  const a = typedUnavailablePayload();
  const b = typedUnavailablePayload();
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(Object.keys(a), ["unavailable", "reason", "policyVersion"]);
  assert.equal(a.unavailable, true);
  assert.equal(a.reason, "provider-data-route-blocked");
  assert.equal(a.policyVersion, POLICY_VERSION);
  // Round-trips as JSON with no numeric/market fields anywhere.
  const round = JSON.parse(JSON.stringify(a));
  assert.deepEqual(round, { unavailable: true, reason: a.reason, policyVersion: POLICY_VERSION });
});

test("headers and postData are never consumed; input is not mutated; results deterministic", () => {
  const bare = req(docUrl("en"));
  const withSensitive = {
    url: docUrl("en"),
    method: "GET",
    resourceType: "document",
    headers: { cookie: "session=secret", authorization: "Bearer secret" },
    postData: "anything",
  };
  assert.deepEqual(classifyRequest(withSensitive, BASE), classifyRequest(bare, BASE));
  assert.deepEqual(classifyRequest(withSensitive, BASE), DOC_CONTINUE);

  // A blocked request stays blocked no matter what headers claim.
  const hostile = {
    url: `${BASE}/api/quotes`,
    method: "GET",
    resourceType: "xhr",
    headers: { "x-allow": "please" },
  };
  const hostileBare = req(`${BASE}/api/quotes`, "GET", "xhr");
  assert.deepEqual(classifyRequest(hostile, BASE), classifyRequest(hostileBare, BASE));
  assert.equal(classifyRequest(hostile, BASE).decision, "fulfill");
  assert.deepEqual(
    classifyRequest(req(`${BASE}/secret`, "GET", "image", { headers: { "x-allow": "please" } }), BASE).decision,
    classifyRequest(req(`${BASE}/secret`, "GET", "image"), BASE).decision,
  );

  // Freezing the input before the call proves the policy never mutates it.
  const frozen = Object.freeze({ ...bare });
  assert.doesNotThrow(() => classifyRequest(frozen, BASE));

  // Determinism over the whole corpus (pairwise deep equality across runs).
  const corpus = [
    req(docUrl("en")),
    req(docUrl("zh")),
    req(`${BASE}/analysis?symbol=AAPL&lang=en`),
    req(`${BASE}/api/quotes`, "GET", "xhr"),
    req(`${BASE}/_next/webpack-hmr`, "GET", "eventsource"),
    req(`${BASE}/_next/static/x.js`, "GET", "script"),
    req("https://accounted.example.com/analysis?symbol=NVDA&lang=en"),
    req("//127.0.0.1:3565/analysis?symbol=NVDA&lang=en"),
    req("http://user:pass@127.0.0.1:3565/analysis?symbol=NVDA&lang=en"),
    req(docUrl("en"), "POST"),
  ];
  for (const input of corpus) {
    assert.deepEqual(classifyRequest(input, BASE), classifyRequest(input, BASE), input.url);
  }
});

test("corpus sweep: every decision is typed, and continue implies the independent allowlist", () => {
  const urls = [
    docUrl("en"),
    docUrl("zh"),
    `${BASE}/analysis?lang=zh&symbol=NVDA`,
    `${docUrl("en")}#frag`,
    `${BASE}/analysis?symbol=AAPL&lang=en`,
    `${BASE}/analysis?symbol=NVDA&lang=fr`,
    `${BASE}/analysis?symbol=NVDA&lang=en&extra=1`,
    `${BASE}/analysis?symbol=NVDA&symbol=NVDA&lang=en`,
    `${BASE}/analysis`,
    `${BASE}/analysis/`,
    `${BASE}/%61nalysis?symbol=NVDA&lang=en`,
    `${BASE}/analysis%3Fsymbol=NVDA&lang=en`,
    `${BASE}/analysis/../../api/quotes?symbol=NVDA&lang=en`,
    `${BASE}\\api\\quotes?symbol=NVDA&lang=en`,
    `${BASE}/company?symbol=NVDA&lang=en`,
    `${BASE}/_next/static/chunks/app/page.js`,
    `${BASE}/_next/static/css/app.css`,
    `${BASE}/_next/static/media/f.woff2`,
    `${BASE}/_next/image?url=%2Fx.png&w=64`,
    `${BASE}/favicon.ico`,
    `${BASE}/icon.svg`,
    `${BASE}/apple-icon.png`,
    `${BASE}/_next/staticX/x.js`,
    `${BASE}/_next/../api/quotes`,
    `${BASE}/api/quotes`,
    `${BASE}/%61pi%2Fquotes`,
    `${BASE}/_next/webpack-hmr`,
    `${BASE}/video.mp4`,
    `${BASE}/captions.vtt`,
    `${BASE}/robots.txt`,
    `${BASE}/manifest.json`,
    "https://accounted.example.com/analysis?symbol=NVDA&lang=en",
    "http://127.0.0.1:4711/analysis?symbol=NVDA&lang=en",
    "http://localhost:3565/analysis?symbol=NVDA&lang=en",
    "https://127.0.0.1:3565/analysis?symbol=NVDA&lang=en",
    "http://127.0.0.1.evil.com:3565/analysis?symbol=NVDA&lang=en",
    "http://user:pass@127.0.0.1:3565/analysis?symbol=NVDA&lang=en",
    "//127.0.0.1:3565/analysis?symbol=NVDA&lang=en",
    "file:///etc/passwd",
    "data:text/html,hi",
    "ws://127.0.0.1:3565/hub",
  ];
  const types = [
    "document",
    "script",
    "stylesheet",
    "font",
    "image",
    "manifest",
    "xhr",
    "fetch",
    "eventsource",
    "websocket",
    "media",
    "texttrack",
    "other",
    undefined,
  ];
  const FULFILL_TYPES = new Set(["xhr", "fetch"]);

  let checked = 0;
  for (const url of urls) {
    for (const type of types) {
      for (const method of ["GET", "POST"]) {
        // Literal object: an undefined type must stay undefined here.
        const input = { url, method, resourceType: type };
        const d = classifyRequest(input, BASE);

        // Decision hygiene: typed, frozen, reasoned.
        assert.ok(DECISION_VALUES.includes(d.decision), JSON.stringify(input));
        assert.ok(Object.isFrozen(d));
        assert.match(d.reason, /^[a-z-]+$/);
        assert.ok(d.kind.length > 0);
        assert.equal(d.policyVersion, POLICY_VERSION);
        assert.equal(typeof d.resourceType, "string");

        // continue ONLY on the independent allowlist; everything else —
        // including every data, streaming and hostile entry — never continues,
        // so no disallowed route can reach the network.
        const allowed = independentlyAllowed(url, method, typeof type === "string" ? type : "");
        if (d.decision === "continue") {
          assert.ok(allowed, `unexpected continue: ${JSON.stringify(input)}`);
          assert.equal(method, "GET");
        } else {
          assert.ok(!allowed, `allowlisted route not honored: ${JSON.stringify(input)}`);
          if (method === "GET" && FULFILL_TYPES.has(type)) {
            // xhr/fetch fulfill typed-unavailable once the early gates pass
            // (scheme-relative, credentials and non-http(s) schemes abort first).
            const expected = passesEarlyGates(url) ? "fulfill" : "abort";
            assert.equal(d.decision, expected, JSON.stringify(input));
          }
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 900, `corpus too small: ${checked}`);
});

// Parent server-closure control: a local image optimizer may fetch its URL upstream.
test("no Next image optimizer path can forward an upstream/provider request", () => {
  for (const target of ["https://provider.invalid/prices", "/api/quote", "/_next/static/media/logo.png"]) {
    const d = classifyRequest(req(`${BASE}/_next/image?url=${encodeURIComponent(target)}&w=64&q=75`, "GET", "image"), BASE);
    assert.equal(d.decision, "abort");
  }
});

test("encoded path separators cannot be forwarded as static files, while encoded Next bracket names remain allowed", () => {
  for (const path of ["/_next/static/%2f..%2f..%2fapi/quote", "/_next/static/%5c..%5c..%5capi/quote"]) {
    assert.equal(classifyRequest(req(`${BASE}${path}`, "GET", "script"), BASE).decision, "abort", path);
  }
  assert.equal(classifyRequest(req(`${BASE}/_next/static/chunks/%5Bproject%5D_app.js`, "GET", "script"), BASE).decision, "continue");
});

test("static path decoding ambiguities refuse without a blanket percent ban", () => {
  for (const path of ["/_next/static/chunks/a%00.js", "/_next/static/chunks/a%0a.js", "/_next/static/chunks/a%7f.js", "/_next/static/%252fapi/quote", "/_next/static/%255capi/quote", "/_next/static/%252e%252e/api/quote", "/_next/static/chunks/%GG.js"]) {
    assert.equal(classifyRequest(req(`${BASE}${path}`, "GET", "script"), BASE).decision, "abort", path);
  }
  assert.equal(classifyRequest(req(`${BASE}/_next/static/chunks/%5Bapp%5D/%5Bpage%5D.js`, "GET", "script"), BASE).decision, "continue");
});
