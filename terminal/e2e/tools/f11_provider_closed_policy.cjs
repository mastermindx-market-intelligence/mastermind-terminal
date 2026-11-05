"use strict";

/**
 * F11 provider-closed browser route policy — pure decision core.
 *
 * SCOPE (read before integrating):
 *   This module is a pure request classifier for a Playwright browser-context
 *   route handler. It reads only {url, method, resourceType} and returns a
 *   frozen decision. It never touches the network, filesystem, subprocesses,
 *   credentials, or any browser itself, and it never returns response bytes
 *   fetched from anywhere. It proves BROWSER interception scope only:
 *     - it does NOT prove server-side provider closure,
 *     - it does NOT prove subprocess egress denial,
 *     - it does NOT prove dotenv/secret absence,
 *     - it does NOT clear previously refused launches,
 *     - it is not, by itself, an observed browser effect.
 *   The parent harness separately qualifies child env, server imports and
 *   config before launch.
 *
 * INTEGRATION REQUIREMENTS (eventual context caller):
 *   - register BEFORE any navigation, at CONTEXT level (context.route covers
 *     every page in the context, including popups; page.route does not);
 *   - create the context with serviceWorkers: "block" so worker-scoped
 *     requests cannot bypass context routing;
 *   - map decisions: "continue" -> route.continue(); "fulfill" ->
 *     route.fulfill({ status: 503, contentType: "application/json",
 *     body: JSON.stringify(typedUnavailablePayload()) }); "abort" ->
 *     route.abort("blockedbyclient").
 *
 * DECISIONS (DECISION_VALUES = ["continue", "fulfill", "abort"]):
 *   continue — allowlisted route; the request may proceed (same exact loopback
 *              origin only).
 *   fulfill  — provider/data route (xhr/fetch): serve the constant typed
 *              unavailable JSON from typedUnavailablePayload(). Nothing is
 *              fetched and no market, fundamental or bar data is invented.
 *   abort    — refused; no network at all.
 *
 * ALLOWLIST (fail closed everywhere else):
 *   - the exact configured base loopback origin only (http/https, hostname
 *     127.0.0.1 / localhost / [::1], no prefix hosts, no other ports, no
 *     credential-bearing URLs, no scheme-relative spellings);
 *   - document GET of exactly /analysis?symbol=NVDA&lang=en|zh (exactly two
 *     query pairs, exact values, no extras, no duplicates);
 *   - same-origin Next static assets under /_next/static/, the same-origin
 *     root metadata icons (/favicon.ico, /icon,
 *     /icon.<ext>, /apple-icon, /apple-icon.<ext>);
 *   - xhr/fetch data routes are classified BEFORE any origin comparison, so an
 *     API/data path can never be completed against ANY origin, local or
 *     remote;
 *   - eventsource/websocket (dev HMR, realtime provider streams) and
 *     media/texttrack abort; unknown resource types and non-GET methods fail
 *     closed.
 *
 * STRUCTURAL URL PARSING uses the WHATWG parser (node:url): dot segments and
 * backslashes normalize before matching, and percent-encoded spellings are
 * matched byte-exactly (they are not treated as their decoded aliases), so
 * encoded/backslash/traversal variants of disallowed paths cannot slip
 * through. A spelling that only the server would decode simply stays blocked
 * (fail closed), never admitted.
 */

const { URL } = require("node:url");

const POLICY_VERSION = "f11-provider-closed-policy/2";

/** The complete, closed set of decisions this policy can return. */
const DECISION_VALUES = Object.freeze(["continue", "fulfill", "abort"]);

const CONTINUE = "continue";
const FULFILL = "fulfill";
const ABORT = "abort";

/** Hostnames a loopback base origin may use (exact match, no subdomains). */
const LOOPBACK_HOSTNAMES = Object.freeze(["127.0.0.1", "localhost", "[::1]"]);

/** resourceType values a browser context can report (Playwright's set). */
const KNOWN_RESOURCE_TYPES = Object.freeze([
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "texttrack",
  "xhr",
  "fetch",
  "eventsource",
  "websocket",
  "manifest",
  "other",
]);

/** Request/response data routes: never fetched; answered typed-unavailable. */
const DATA_FULFILL_TYPES = Object.freeze(["xhr", "fetch"]);

/** Streaming resources (dev HMR, realtime provider streams): refused. */
const STREAMING_ABORT_TYPES = Object.freeze(["eventsource", "websocket"]);

/** Non-essential resources: refused. */
const NONESSENTIAL_ABORT_TYPES = Object.freeze(["media", "texttrack"]);

/** Same-origin asset types eligible for the static path allowlist. */
const STATIC_ASSET_TYPES = Object.freeze(["script", "stylesheet", "font", "image", "manifest"]);

const APP_DOCUMENT_PATH = "/analysis";
const APP_SYMBOL = "NVDA";
const APP_LANGUAGES = Object.freeze(["en", "zh"]);

/**
 * Justified same-origin static paths:
 *   /_next/static/…                        compiled chunks, css, fonts, media
 *   /favicon.ico, /icon…, /apple-icon…     root metadata icons
 */
const STATIC_PATH_PATTERNS = Object.freeze([
  /^\/_next\/static\//,
  /^\/favicon\.ico$/,
  /^\/(apple-)?icon(\.[0-9a-z]+)?$/,
]);

function makeDecision(value, kind, reason, resourceType) {
  return Object.freeze({
    decision: value,
    kind,
    reason,
    resourceType,
    policyVersion: POLICY_VERSION,
  });
}

/** Parse and fully validate the configured base origin; null when unsafe. */
function parseBaseOrigin(baseOrigin) {
  if (typeof baseOrigin !== "string") return null;
  let url;
  try {
    url = new URL(baseOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!LOOPBACK_HOSTNAMES.includes(url.hostname)) return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  return Object.freeze({ origin: url.origin });
}

/** True when the URL is exactly the intended app document route. */
function isAppDocument(url) {
  if (url.pathname !== APP_DOCUMENT_PATH) return false;
  if ([...url.searchParams.entries()].length !== 2) return false;
  const symbol = url.searchParams.getAll("symbol");
  const lang = url.searchParams.getAll("lang");
  return (
    symbol.length === 1 &&
    lang.length === 1 &&
    symbol[0] === APP_SYMBOL &&
    APP_LANGUAGES.includes(lang[0])
  );
}

function isStaticAssetPath(pathname) {
  return STATIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * Classify one intercepted request against the base loopback origin.
 *
 * @param {{url: string, method: string, resourceType: string}} request
 *   Only url, method and resourceType are read; headers and postData are
 *   never consumed. resourceType is matched case-sensitively.
 * @param {string} baseOrigin The selected loopback origin, e.g.
 *   "http://127.0.0.1:3565". Anything else (non-loopback, credentialed,
 *   unparseable) makes every request fail closed.
 * @returns {Readonly<{decision: string, kind: string, reason: string,
 *   resourceType: string, policyVersion: string}>}
 */
function classifyRequest(request, baseOrigin) {
  const base = parseBaseOrigin(baseOrigin);
  const input = request !== null && typeof request === "object" ? request : null;
  const rawResourceType = input === null ? undefined : input.resourceType;
  const type = typeof rawResourceType === "string" ? rawResourceType : "";

  if (base === null) {
    return makeDecision(ABORT, "policy-config", "abort-invalid-base-origin", type);
  }
  if (input === null || input.method !== "GET") {
    return makeDecision(ABORT, "method", "abort-unsupported-method", type);
  }
  if (!KNOWN_RESOURCE_TYPES.includes(type)) {
    return makeDecision(ABORT, "resource-type", "abort-unknown-resource-type", type);
  }

  const rawUrl = input.url;
  if (typeof rawUrl === "string" && rawUrl.startsWith("//")) {
    return makeDecision(ABORT, "url", "abort-scheme-relative-url", type);
  }
  let url;
  try {
    url = new URL(typeof rawUrl === "string" ? rawUrl : "");
  } catch {
    return makeDecision(ABORT, "url", "abort-unparseable-url", type);
  }
  if (url.username !== "" || url.password !== "") {
    return makeDecision(ABORT, "origin", "abort-credential-bearing-url", type);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return makeDecision(ABORT, "url", "abort-unsupported-scheme", type);
  }

  // Provider/data routes are rejected before any origin comparison: an
  // API/data path is never completed against ANY origin, local or remote.
  if (DATA_FULFILL_TYPES.includes(type)) {
    return makeDecision(FULFILL, "provider-data", "fulfill-provider-data-typed-unavailable", type);
  }
  if (STREAMING_ABORT_TYPES.includes(type)) {
    return makeDecision(ABORT, "streaming", "abort-streaming-resource-blocked", type);
  }
  if (NONESSENTIAL_ABORT_TYPES.includes(type)) {
    return makeDecision(ABORT, "non-essential", "abort-non-essential-resource-blocked", type);
  }

  // Exact origin equality only: foreign hosts, other ports, other schemes and
  // prefix look-alikes all land here.
  if (url.origin !== base.origin) {
    return makeDecision(ABORT, "origin", "abort-foreign-origin", type);
  }

  if (type === "document") {
    return isAppDocument(url)
      ? makeDecision(CONTINUE, "app-document", "continue-app-document", type)
      : makeDecision(ABORT, "app-document", "abort-non-app-document-route", type);
  }
  if (STATIC_ASSET_TYPES.includes(type)) {
    return isStaticAssetPath(url.pathname)
      ? makeDecision(CONTINUE, "next-static", "continue-next-static", type)
      : makeDecision(ABORT, "next-static", "abort-non-static-route", type);
  }
  return makeDecision(ABORT, "unclassified", "abort-unclassified-resource-blocked", type);
}

/**
 * Constant, deterministic payload for "fulfill" decisions on provider/data
 * routes. Contains NO market, fundamental or bar data — only the typed
 * unavailability marker. Pair 1:1 with classifyRequest's "fulfill" decisions.
 */
function typedUnavailablePayload() {
  return Object.freeze({
    unavailable: true,
    reason: "provider-data-route-blocked",
    policyVersion: POLICY_VERSION,
  });
}

module.exports = { classifyRequest, typedUnavailablePayload, DECISION_VALUES, POLICY_VERSION };
