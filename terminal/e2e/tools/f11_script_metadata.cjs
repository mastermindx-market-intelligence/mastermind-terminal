/* eslint-disable @typescript-eslint/no-require-imports -- Pure Node metadata projection. */
'use strict';

/*
 * F11 script metadata projector (pure CommonJS helper).
 *
 * Projects ONLY the allowed public observable metadata for one fulfilled
 * Next.js static script byte stream. The returned record is "byte 0"
 * evidence: it proves a byte stream was observed and hashed, NOT that any
 * application booted or that the script is semantically valid.
 *
 * The helper performs no eval, no JavaScript interpretation, no filesystem,
 * network, process, environment, clock, or secret access, and never returns
 * body bytes, headers, credentials, or caller input beyond the projected
 * fields.
 *
 * URL policy (route matching, origin binding, extension rules) is owned by
 * the parent. The pathname defense here is an independent second layer and
 * must not be used as, or allowed to weaken, that policy.
 */

const nodeCrypto = require('node:crypto');

const MAX_BODY_BYTES = 32 * 1024 * 1024; // 32 MiB inclusive.
const MAX_PATHNAME_LENGTH = 240;
const MAX_TIME_MS = 600000; // 10 minutes, per duration field.

// Exact MIME tokens that may be projected as themselves.
const MIME_WHITELIST = new Set([
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/octet-stream',
  'text/html',
  'text/plain',
]);

/*
 * Public ASCII path characters only: letters, digits, and _ . / % ( ) [ ] -.
 * This excludes backslash, whitespace, all control bytes, ?, #, :, +, and
 * every non-ASCII byte, so raw queries, fragments, origins, and controls
 * cannot pass.
 */
const PUBLIC_PATH_CHARS = /^[A-Za-z0-9_./%()[\]-]+$/;

// Percent escapes that decode to a path separator, in either hex case.
const ENCODED_SEPARATOR = /%(?:2f|5c)/;

class ScriptMetadataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScriptMetadataError';
    this.code = code;
  }
}

// Fixed, stable diagnostics. Messages never echo caller input.
const INPUT_ERROR = Object.freeze({
  code: 'F11_SCRIPT_METADATA_INPUT',
  message:
    'F11_SCRIPT_METADATA_INPUT: input must be one plain object with named fields',
});
const PATH_ERROR = Object.freeze({
  code: 'F11_SCRIPT_METADATA_PATH',
  message:
    'F11_SCRIPT_METADATA_PATH: pathname must be a public /_next/static/ ASCII path of at most 240 characters with no encoded or raw separator, traversal segment, empty path segment, control, query, fragment, or origin',
});
const BODY_ERROR = Object.freeze({
  code: 'F11_SCRIPT_METADATA_BODY',
  message: 'F11_SCRIPT_METADATA_BODY: body must be a Buffer',
});
const BODY_SIZE_ERROR = Object.freeze({
  code: 'F11_SCRIPT_METADATA_BODY_SIZE',
  message: 'F11_SCRIPT_METADATA_BODY_SIZE: body must hold at most 33554432 bytes',
});
const TIME_ERROR = Object.freeze({
  code: 'F11_SCRIPT_METADATA_TIME',
  message:
    'F11_SCRIPT_METADATA_TIME: fetchMs, bodyMs and fulfillMs must each independently be a finite number of milliseconds from 0 to 600000',
});

function fail(spec) {
  throw new ScriptMetadataError(spec.code, spec.message);
}

// ASCII-only lowering; non-ASCII bytes are never case-mapped.
function asciiLower(value) {
  return value.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

function assertNoTraversalSegments(value) {
  const segments = value.split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    // "." and ".." are traversal; any other empty segment (a double slash
    // or a trailing slash) is ambiguous for a script path.
    if (segment === '.' || segment === '..') fail(PATH_ERROR);
    if (i > 0 && segment.length === 0) fail(PATH_ERROR);
  }
}

function validatePathname(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) fail(PATH_ERROR);
  if (pathname.length > MAX_PATHNAME_LENGTH) fail(PATH_ERROR);
  if (!pathname.startsWith('/_next/static/')) fail(PATH_ERROR);
  if (!PUBLIC_PATH_CHARS.test(pathname)) fail(PATH_ERROR);

  const lowered = asciiLower(pathname);

  // Any percent escape that decodes to "/" or "\" is separator smuggling,
  // including the mixed-case forms %2F and %5C.
  if (ENCODED_SEPARATOR.test(lowered)) fail(PATH_ERROR);

  // A malformed escape is ambiguous; reject it instead of guessing. The
  // decoded view is then held to the same public-character rule, which
  // rejects escapes producing separators, backslashes, controls, or spaces.
  let decoded;
  try {
    decoded = decodeURIComponent(lowered);
  } catch {
    fail(PATH_ERROR);
  }
  if (!PUBLIC_PATH_CHARS.test(decoded) || decoded.includes("%")) fail(PATH_ERROR);

  // Residual encoded separators after one decode (double encoding) stay
  // ambiguous and are rejected; further decoding belongs to the parent.
  if (ENCODED_SEPARATOR.test(decoded)) fail(PATH_ERROR);

  // Traversal ambiguity: no "." or ".." segment, raw or decoded.
  assertNoTraversalSegments(pathname);
  assertNoTraversalSegments(decoded);

  return pathname;
}

function validateBody(body) {
  if (!Buffer.isBuffer(body)) fail(BODY_ERROR);
  if (body.length > MAX_BODY_BYTES) fail(BODY_SIZE_ERROR);
  return body;
}

function validateDuration(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_TIME_MS
  ) {
    fail(TIME_ERROR);
  }
  return value;
}

/*
 * Maps the ContentType header value to one projected mime token:
 *   - absent (undefined or null) -> "missing"
 *   - ASCII-lowered token before the first ";" in the whitelist -> the token
 *   - every other string, and every non-string value -> "other"
 */
function normalizeMime(contentType) {
  if (contentType === undefined || contentType === null) return 'missing';
  if (typeof contentType !== 'string') return 'other';
  const semicolon = contentType.indexOf(';');
  const rawToken = semicolon === -1 ? contentType : contentType.slice(0, semicolon);
  const token = asciiLower(rawToken).trim();
  return MIME_WHITELIST.has(token) ? token : 'other';
}

/*
 * scriptMetadata({ pathname, contentType, body, fetchMs, bodyMs, fulfillMs })
 *
 * Returns exactly:
 *   { pathname, bytes, sha256, mime, fetchMs, bodyMs, fulfillMs }
 *
 * Throws a ScriptMetadataError with a fixed code when any invariant fails.
 * Unknown caller fields are never read and never projected.
 */
function scriptMetadata(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail(INPUT_ERROR);
  }

  const pathname = validatePathname(input.pathname);
  const body = validateBody(input.body);
  const fetchMs = validateDuration(input.fetchMs);
  const bodyMs = validateDuration(input.bodyMs);
  const fulfillMs = validateDuration(input.fulfillMs);

  const sha256 = nodeCrypto.createHash('sha256').update(body).digest('hex');

  return {
    pathname,
    bytes: body.length,
    sha256,
    mime: normalizeMime(input.contentType),
    fetchMs,
    bodyMs,
    fulfillMs,
  };
}

module.exports = { scriptMetadata, ScriptMetadataError };
