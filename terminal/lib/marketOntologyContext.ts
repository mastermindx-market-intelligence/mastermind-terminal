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
 *   mo_from      closed enum: exactly "ontology" or "transmission" (anything else → context invalid)
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
 * - A valid context requires `mo_from` from the closed origin enum AND a valid `mo_chain`.
 * - Every other field is optional when absent; a present-but-invalid value
 *   invalidates the whole context.
 */

// Measured 2026-09-27: the apex ontology URL redirects to this www URL. The
// pure helper stays on the served www host; lib/originNav.ts separately allows
// both macro hosts without canonicalizing them.
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

type MoKey = (typeof MO_CONTEXT_KEYS)[number];
type Validator = (rawValue: string) => string | null;

function validateFrom(rawValue: string): MarketOntologyContext["from"] | null {
  return ORIGINS.has(rawValue as MarketOntologyOrigin)
    ? (rawValue as MarketOntologyContext["from"])
    : null;
}

/** The validated MarketOntology context shape. */
export type MarketOntologyContext = {
  from: "ontology" | "transmission";
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

type MarketOntologyOrigin = MarketOntologyContext["from"];
const ORIGINS: ReadonlySet<MarketOntologyOrigin> = new Set(["ontology", "transmission"]);

const FIELD_VALIDATORS = {
  mo_from: validateFrom,
  mo_chain: (rawValue: string) => (ID_GRAMMAR.test(rawValue) ? rawValue : null),
  mo_focus: (rawValue: string) => (ID_GRAMMAR.test(rawValue) ? rawValue : null),
  mo_path_rev: (rawValue: string) =>
    PATH_REV_GRAMMAR.test(rawValue) ? rawValue : null,
  mo_channel: (rawValue: string) => (ID_GRAMMAR.test(rawValue) ? rawValue : null),
  mo_theme: (rawValue: string) => (ID_GRAMMAR.test(rawValue) ? rawValue : null),
  mo_company: (rawValue: string) => (ID_GRAMMAR.test(rawValue) ? rawValue : null),
  mo_security: (rawValue: string) => (ID_GRAMMAR.test(rawValue) ? rawValue : null),
  mo_asof: (rawValue: string) => (validateDate(rawValue) ? rawValue : null),
  mo_kc: (rawValue: string) => (validateDate(rawValue) ? rawValue : null),
} satisfies Record<MoKey, Validator>;

/** Validate a single known mo_* value against its grammar. */
function validateField(key: MoKey, rawValue: string): string | null {
  return FIELD_VALIDATORS[key](rawValue);
}

function hasValidQueryValue(key: MoKey, value: string | undefined): value is string {
  return value !== undefined && validateField(key, value) !== null;
}

/**
 * Parse MarketOntology context from URLSearchParams.
 *
 * Returns a validated MarketOntologyContext or null if the context is invalid
 * (missing required fields, grammar violations, duplicates, or an unknown origin).
 *
 * Rules that cause null:
 * - mo_from is not exactly "ontology" or "transmission"
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

  // mo_from must come from the closed origin enum.
  const fromValidated = validateFrom(params.get("mo_from") ?? "");
  if (fromValidated === null) {
    return null;
  }

  // mo_chain is required and must pass grammar.
  const chainValidated = validateField("mo_chain", params.get("mo_chain") ?? "");
  if (chainValidated === null) {
    return null;
  }

  // Build the validated context
  const ctx: MarketOntologyContext = {
    from: fromValidated,
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
 * Returns params carrying exactly the mo_* fields of ctx and no other mo_* key.
 * Known-but-absent keys and unknown keys already present in params are removed;
 * non-mo_* keys remain in their original order. Every ctx field is revalidated with
 * the parse grammar, and an illegal field is omitted.
 */
export function serializeMarketOntologyContext(
  ctx: MarketOntologyContext,
  into?: URLSearchParams
): URLSearchParams {
  const result = clearMarketOntologyContext(into ?? new URLSearchParams());

  const fields: Array<readonly [MoKey, keyof MarketOntologyContext]> = [
    ["mo_from", "from"],
    ["mo_chain", "chain"],
    ["mo_focus", "focus"],
    ["mo_path_rev", "pathRev"],
    ["mo_channel", "channel"],
    ["mo_theme", "theme"],
    ["mo_company", "company"],
    ["mo_security", "security"],
    ["mo_asof", "asof"],
    ["mo_kc", "kc"],
  ];
  for (const [queryKey, contextKey] of fields) {
    const value = ctx[contextKey];
    if (hasValidQueryValue(queryKey, value)) {
      result.set(queryKey, value);
    }
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
    if (/^mo_/i.test(key)) {
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
 * Strip every mo_* query parameter, including unknown keys, without changing
 * any other parameter or its position.
 */
export function stripMarketOntologyParams(params: URLSearchParams): URLSearchParams {
  return clearMarketOntologyContext(params);
}

/**
 * Construct the return href for navigating back to the validated origin.
 *
 * Format: ontology contexts return to `${MARKET_ONTOLOGY_ORIGIN}/ontology.html`
 * + (pathRev ? `?rev=${pathRev}` : "") + (focus ? `#ox-leg-${encodeURIComponent(focus)}` : "").
 * Transmission contexts return to `${MARKET_ONTOLOGY_ORIGIN}/transmission.html#tx-chain-${encodeURIComponent(chain)}`.
 *
 * The grammar permits dots and colons; encodeURIComponent is what makes the fragment
 * one opaque token. Illegal hand-built values are omitted.
 */
export function marketOntologyReturnHref(ctx: MarketOntologyContext): string {
  if (ctx.from === "transmission") {
    return `${MARKET_ONTOLOGY_ORIGIN}/transmission.html#tx-chain-${encodeURIComponent(ctx.chain)}`;
  }

  let href = `${MARKET_ONTOLOGY_ORIGIN}/ontology.html`;

  if (ctx.pathRev && hasValidQueryValue("mo_path_rev", ctx.pathRev)) {
    href += `?rev=${ctx.pathRev}`;
  }

  if (ctx.focus && hasValidQueryValue("mo_focus", ctx.focus)) {
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
    if (/^mo_/i.test(key)) {
      hasMoKey = true;
    }
  });
  return hasMoKey;
}
