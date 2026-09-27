/**
 * marketOntologyContext.ts — Transient navigation context for MarketOntology research paths.
 *
 * Package: mastermind.market-ontology-context/v1
 *
 * This module parses, validates, serializes, and clears the closed query vocabulary that
 * communicates WHY the reader arrived at Company Intelligence from a MarketOntology path
 * and reconstructs a safe return link. It is NOT identity, NOT authorization, NOT a research
 * object, and NOT persisted anywhere.
 *
 * Closed vocabulary (frozen):
 *   mo_from      closed enum: exactly "ontology" (anything else → context invalid)
 *   mo_chain    REQUIRED. id: ^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$
 *   mo_focus     optional path node id, same id grammar
 *   mo_path_rev  optional: ^[0-9]{1,9}$
 *   mo_channel   optional TXI exposure-screen id, same id grammar
 *   mo_theme     optional theme node id, same id grammar
 *   mo_company   optional Theme Graph company node id, same id grammar
 *   mo_security  optional OPAQUE Data OS security id, same id grammar; never reparsed, never used as identity
 *   mo_asof      optional strict calendar date YYYY-MM-DD
 *   mo_kc        optional strict calendar date YYYY-MM-DD
 *
 * Rules:
 * - Values are read with URLSearchParams (decoded) and matched against the grammar.
 * - Encoded separators/controls/non-ASCII fail closed.
 * - A DUPLICATE of ANY known `mo_*` key invalidates the whole context.
 * - Unknown `mo_*` keys are ignored, never forwarded, never serialized.
 * - A valid context requires `mo_from=ontology` AND a valid `mo_chain`.
 * - Every other field is optional.
 */

export const MARKET_ONTOLOGY_ORIGIN = "https://www.mastermind-x.com";

export const MO_CONTEXT_KEYS = [
  "mo_from",
  "mo_chain",
  "mo_focus",
  "mo_path_rev",
  "mo_channel",
  "mo_theme",
  "mo_company",
  "mo_security",
  "mo_asof",
  "mo_kc",
] as const;

/** The validated MarketOntology context shape. */
export type MarketOntologyContext = {
  from: "ontology";
  chain: string;
  focus?: string;
  pathRev?: string;
  channel?: string;
  theme?: string;
  company?: string;
  security?: string;
  asof?: string;
  kc?: string;
};

/**
 * Grammar for a node id: starts with alphanumeric, then up to 79 chars of
 * alphanumerics, underscores, dots, colons, or hyphens.
 */
const ID_GRAMMAR = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

/** Grammar for mo_path_rev: 1-9 digits. */
const PATH_REV_GRAMMAR = /^[0-9]{1,9}$/;

/**
 * Strict YYYY-MM-DD date grammar with real calendar validation.
 * Rejects impossible dates like 2026-02-30.
 */
function isValidDate(year: number, month: number, day: number): boolean {
  if (month === 2) {
    // February: 29 in leap years, 28 otherwise
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return day <= (isLeap ? 29 : 28);
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return day <= 30;
  }
  return day <= 31;
}

function validateDate(raw: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw)) return false;
  const year = parseInt(raw.slice(0, 4), 10);
  const month = parseInt(raw.slice(5, 7), 10);
  const day = parseInt(raw.slice(8, 10), 10);
  return isValidDate(year, month, day);
}

/**
 * Validate a single mo_* value against its grammar.
 * Returns the validated value or null if invalid.
 */
function validateField(
  key: string,
  rawValue: string
): string | null {
  switch (key) {
    case "mo_from":
      // Must be exactly "ontology" (case-sensitive)
      return rawValue === "ontology" ? rawValue : null;

    case "mo_chain":
    case "mo_focus":
    case "mo_channel":
    case "mo_theme":
    case "mo_company":
    case "mo_security":
      return ID_GRAMMAR.test(rawValue) ? rawValue : null;

    case "mo_path_rev":
      return PATH_REV_GRAMMAR.test(rawValue) ? rawValue : null;

    case "mo_asof":
    case "mo_kc":
      return validateDate(rawValue) ? rawValue : null;

    default:
      // Unknown keys are ignored by the caller
      return null;
  }
}

/**
 * Parse MarketOntology context from URLSearchParams.
 *
 * Returns a validated MarketOntologyContext or null if the context is invalid
 * (missing required fields, grammar violations, duplicates, or non-ontology from).
 *
 * Rules that cause null:
 * - mo_from is not exactly "ontology"
 * - mo_chain is missing or fails grammar
 * - Any known mo_* key appears more than once (case: multiple values for same key)
 * - Any known mo_* value fails its grammar (including malformed dates like 2026-02-30)
 * - Encoded separators/controls/non-ASCII in values (URLSearchParams decodes, then grammar fails)
 */
export function parseMarketOntologyContext(
  params: URLSearchParams
): MarketOntologyContext | null {
  // Check for duplicate keys first — any duplicate of a known mo_* key invalidates
  for (const key of MO_CONTEXT_KEYS) {
    const allValues = params.getAll(key);
    if (allValues.length > 1) {
      return null;
    }
  }

  // mo_from must be exactly "ontology" — use validateField for consistent grammar check
  const fromValidated = validateField("mo_from", params.get("mo_from") ?? "");
  if (fromValidated === null) {
    return null;
  }

  // mo_chain is REQUIRED and must pass grammar — use validateField for consistent grammar check
  const chainValidated = validateField("mo_chain", params.get("mo_chain") ?? "");
  if (chainValidated === null) {
    return null;
  }

  // Build the validated context
  const ctx: MarketOntologyContext = {
    from: "ontology",
    chain: chainValidated,
  };

  // Parse optional fields; any grammar failure on a known optional key invalidates the whole context
  const optionalFields: Array<{
    key: (typeof MO_CONTEXT_KEYS)[number];
    ctxKey: keyof Omit<MarketOntologyContext, "from" | "chain">;
  }> = [
    { key: "mo_focus", ctxKey: "focus" },
    { key: "mo_path_rev", ctxKey: "pathRev" },
    { key: "mo_channel", ctxKey: "channel" },
    { key: "mo_theme", ctxKey: "theme" },
    { key: "mo_company", ctxKey: "company" },
    { key: "mo_security", ctxKey: "security" },
    { key: "mo_asof", ctxKey: "asof" },
    { key: "mo_kc", ctxKey: "kc" },
  ];

  for (const { key, ctxKey } of optionalFields) {
    const allValues = params.getAll(key);
    if (allValues.length === 0) {
      continue;
    }
    // allValues.length === 1 because duplicates were checked above
    const raw = allValues[0];
    const validated = validateField(key, raw);
    // Any known mo_* key present but failing grammar → entire context invalid
    if (validated === null) {
      return null;
    }
    (ctx as Record<string, string | undefined>)[ctxKey] = validated;
  }

  return ctx;
}

/**
 * Serialize a valid MarketOntologyContext into URLSearchParams.
 *
 * Writes ONLY the closed keys of a valid ctx. Unknown/extra fields are never emitted.
 * When writing into existing params, only the closed known keys are overwritten;
 * any pre-existing unknown mo_* keys are preserved (as they should be — they are not
 * forwarded, but they existed in the URL and the serializer must not silently drop them
 * if they were put there by some other party).
 */
export function serializeMarketOntologyContext(
  ctx: MarketOntologyContext,
  into?: URLSearchParams
): URLSearchParams {
  const result = into ? new URLSearchParams(into.toString()) : new URLSearchParams();

  // Strip ALL mo_* keys (known or unknown) before writing validated fields.
  // This implements "unknown mo_* keys are never serialized" — any pre-existing mo_*
  // in the URL is cleared; the validated ctx fields are written fresh.
  const keysToDelete = [...result.keys()].filter((k) => k.startsWith("mo_"));
  for (const key of keysToDelete) {
    result.delete(key);
  }

  // mo_from is always "ontology" for a valid context
  result.set("mo_from", ctx.from);

  // mo_chain is always present
  result.set("mo_chain", ctx.chain);

  // Optional fields — only emit if present
  if (ctx.focus !== undefined) {
    result.set("mo_focus", ctx.focus);
  }
  if (ctx.pathRev !== undefined) {
    result.set("mo_path_rev", ctx.pathRev);
  }
  if (ctx.channel !== undefined) {
    result.set("mo_channel", ctx.channel);
  }
  if (ctx.theme !== undefined) {
    result.set("mo_theme", ctx.theme);
  }
  if (ctx.company !== undefined) {
    result.set("mo_company", ctx.company);
  }
  if (ctx.security !== undefined) {
    result.set("mo_security", ctx.security);
  }
  if (ctx.asof !== undefined) {
    result.set("mo_asof", ctx.asof);
  }
  if (ctx.kc !== undefined) {
    result.set("mo_kc", ctx.kc);
  }

  return result;
}

/**
 * Clear ALL keys starting with "mo_" (known or unknown) from URLSearchParams.
 * Leaves all other parameters untouched.
 */
export function clearMarketOntologyContext(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams(params.toString());

  // Collect all keys starting with "mo_"
  const keysToDelete: string[] = [];
  result.forEach((_, key) => {
    if (key.startsWith("mo_")) {
      keysToDelete.push(key);
    }
  });

  // Delete them all
  for (const key of keysToDelete) {
    result.delete(key);
  }

  return result;
}

/**
 * Construct the return href for navigating back to MarketOntology.
 *
 * Format: `${MARKET_ONTOLOGY_ORIGIN}/ontology.html` + (pathRev ? `?rev=${pathRev}` : "") + (focus ? `#ox-leg-${encodeURIComponent(focus)}` : "")
 *
 * SECURITY: mo_focus is already validated by ID_GRAMMAR (and by parse rejecting any
 * focus value that fails grammar), so a context passed to this function has a focus
 * that matches the id grammar. The dot (`.`) IS valid in ID_GRAMMAR, so `a..b` would
 * pass grammar — but it was already accepted by parse() and is therefore a legitimate
 * focus node id. encodeURIComponent prevents any injection risk in the fragment.
 */
export function marketOntologyReturnHref(ctx: MarketOntologyContext): string {
  let href = `${MARKET_ONTOLOGY_ORIGIN}/ontology.html`;

  if (ctx.pathRev !== undefined) {
    href += `?rev=${ctx.pathRev}`;
  }

  if (ctx.focus !== undefined) {
    // encodeURIComponent is defensive: ID_GRAMMAR already validated this focus value
    href += `#ox-leg-${encodeURIComponent(ctx.focus)}`;
  }

  return href;
}

/**
 * Check if ANY key starting with "mo_" is present in the URLSearchParams.
 * Used to decide whether to strip context on symbol switch.
 */
export function hasMarketOntologyContext(params: URLSearchParams): boolean {
  let hasMoKey = false;
  params.forEach((_, key) => {
    if (key.startsWith("mo_")) {
      hasMoKey = true;
    }
  });
  return hasMoKey;
}
