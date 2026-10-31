/**
 * Bounded decoding of submitted commodity context for the Investigation owner.
 *
 * This is a transport contract, NOT Investigation admission or a save receipt.
 * The producer's "as_saved_evidence" name is retained for wire compatibility; it
 * proves neither a prior save nor publisher origin. All observations, dates,
 * fingerprints, source URLs and other nested metadata remain untrusted claims.
 * This module performs no I/O, fetching, HTML sanitization, source verification,
 * persistence, monitoring, canonical hashing or navigation.
 *
 * The closed v1 vocabulary and fragment encoding follow Macro's
 * templates/commodity-workspace.js at 82766f6fcea1f2db807830c370f1a03222965ece.
 * New producer vocabulary requires an explicit contract update. A fragment is
 * serializable navigation context, not proof that a future generation restores
 * the same state. A caller still owes the existing Macro URL/rights gates.
 */
export const COMMODITY_SUBMITTED_CONTEXT_SCHEMA = "mmx.commodities.submitted_context.v1";
export const COMMODITY_SUBMITTED_CONTEXT_LIMITS = Object.freeze({
  maxBytes: 65_536,
  maxDepth: 24,
  maxNodes: 4_096,
  maxKeyLength: 128,
});

const FAMILIES = {
  gasoline: "energy", heating_oil: "energy", natgas: "energy", oil: "energy",
  gold: "precious", palladium: "precious", platinum: "precious", silver: "precious",
  copper: "industrial", corn: "grain", soybeans: "grain", wheat: "grain",
  cocoa: "soft", coffee: "soft", cotton: "soft", sugar: "soft", live_cattle: "livestock",
} as const;
export type CommodityContextId = keyof typeof FAMILIES;
type CommodityFamily = (typeof FAMILIES)[CommodityContextId];
export type SubmittedCommodityJson =
  | null | boolean | number | string
  | readonly SubmittedCommodityJson[]
  | { readonly [key: string]: SubmittedCommodityJson };
type SubmittedRecord = { readonly [key: string]: SubmittedCommodityJson };

export interface CommodityReturnState {
  readonly tab: "overview" | "explore" | "relationships" | "compare" | "research";
  readonly asset: CommodityContextId;
  readonly window: "1m" | "5" | "20" | "60" | "252";
  readonly compare: readonly CommodityContextId[];
  readonly hypothesis: "unresolved" | "supply" | "demand" | "supply_recovery" | "demand_contraction" | "rates";
  readonly view: "universe" | "detail";
  readonly query: string;
  readonly family: "all" | CommodityFamily;
  readonly sort: "source" | "name" | "return_asc" | "return_desc";
  readonly trend: "all" | "up" | "down" | "flat" | "unknown";
  readonly momentum: "all" | "bull" | "bear" | "neutral" | "unknown";
  readonly layout: "table" | "map";
}

export interface SubmittedCommodityEvidence {
  readonly schema: "mmx.commodities.as_saved_evidence.v1";
  readonly workspace_fingerprint: string;
  readonly projection_revision: number;
  readonly asset: SubmittedRecord & {
    readonly id: CommodityContextId;
    /** Submitted price-snapshot date; independent of the envelope analysis date. */
    readonly as_of: string | null;
    readonly family: CommodityFamily;
    readonly label: SubmittedRecord & { readonly en: string; readonly zh: string };
  };
  readonly hypothesis: SubmittedRecord | null;
  readonly physical: SubmittedRecord | null;
  readonly gold_physical: SubmittedRecord | null;
  readonly chains: readonly SubmittedRecord[];
  readonly rates: SubmittedRecord | null;
  readonly fx: SubmittedRecord | null;
  readonly ratios: readonly SubmittedRecord[];
  readonly source_receipts: SubmittedRecord;
  readonly live: false;
}

export interface CommoditySubmittedContext {
  readonly schema: typeof COMMODITY_SUBMITTED_CONTEXT_SCHEMA;
  readonly commodity_id: CommodityContextId;
  /** Submitted workspace analysis date, not a freshness or observation claim. */
  readonly as_of: string;
  readonly evidence: SubmittedCommodityEvidence;
  readonly return_state: CommodityReturnState;
}

export type CommodityContextRejection =
  | "invalid_input" | "payload_too_large" | "invalid_json" | "resource_limit"
  | "invalid_structure" | "duplicate_keys" | "unsupported_schema"
  | "invalid_subject" | "invalid_analysis_date" | "invalid_evidence"
  | "invalid_return_state" | "context_mismatch";

export type CommoditySubmittedContextResult =
  | {
    readonly ok: true;
    readonly qualification: "submitted_unverified";
    readonly submittedContext: CommoditySubmittedContext;
    readonly macroReturnHash: string;
  }
  | { readonly ok: false; readonly reason: CommodityContextRejection };

const ROOT_KEYS = ["schema", "commodity_id", "as_of", "evidence", "return_state"];
const EVIDENCE_KEYS = [
  "schema", "workspace_fingerprint", "projection_revision", "asset", "hypothesis",
  "physical", "gold_physical", "chains", "rates", "fx", "ratios", "source_receipts", "live",
];
const RETURN_KEYS = [
  "tab", "asset", "window", "compare", "hypothesis", "view", "query",
  "family", "sort", "trend", "momentum", "layout",
];
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const DISALLOWED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isRecord(value: unknown): value is SubmittedRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: SubmittedRecord, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function oneOf(value: unknown, choices: readonly string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}

function isCommodityId(value: unknown): value is CommodityContextId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FAMILIES, value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Reject NUL and lone UTF-16 surrogates; never repair or normalize submitted text. */
function isScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function checkJson(value: unknown, depth: number, count: { nodes: number }): CommodityContextRejection | null {
  count.nodes += 1;
  if (depth > COMMODITY_SUBMITTED_CONTEXT_LIMITS.maxDepth
    || count.nodes > COMMODITY_SUBMITTED_CONTEXT_LIMITS.maxNodes) return "resource_limit";
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "string") return isScalarText(value) ? null : "invalid_structure";
  if (typeof value === "number") {
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
      ? null : "invalid_structure";
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const failure = checkJson(entry, depth + 1, count);
      if (failure) return failure;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key.length === 0 || key.length > COMMODITY_SUBMITTED_CONTEXT_LIMITS.maxKeyLength
        || CONTROL_CHARACTERS.test(key) || !isScalarText(key) || DISALLOWED_KEYS.has(key)) return "invalid_structure";
      const failure = checkJson(entry, depth + 1, count);
      if (failure) return failure;
    }
    return null;
  }
  return "invalid_structure";
}

/**
 * JSON.parse has already validated the grammar. Scan only keys and structural
 * tokens to reject last-key-wins ambiguity, including escaped equivalent keys.
 * Strings consume their own punctuation, so commas/braces inside text are inert.
 */
function hasDuplicateKeys(serialized: string): boolean {
  const frames: Array<{ keys: Set<string>; expectingKey: boolean } | null> = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]/g;
  for (const match of serialized.matchAll(tokens)) {
    const token = match[0];
    if (token === "{") frames.push({ keys: new Set(), expectingKey: true });
    else if (token === "[") frames.push(null);
    else if (token === "}" || token === "]") frames.pop();
    else {
      const frame = frames[frames.length - 1];
      if (token === "," && frame) frame.expectingKey = true;
      else if (token[0] === '"' && frame?.expectingKey) {
        const key = JSON.parse(token) as string;
        if (frame.keys.has(key)) return true;
        frame.keys.add(key);
        frame.expectingKey = false;
      }
    }
  }
  return false;
}

function supportedHypothesis(asset: CommodityContextId, value: unknown): boolean {
  if (value === "unresolved") return true;
  if (asset === "oil") return oneOf(value, ["supply", "demand", "supply_recovery", "demand_contraction"]);
  if (asset === "gold") return value === "rates";
  return asset === "copper" && value === "demand";
}

function validReturnState(value: unknown): value is CommodityReturnState {
  if (!isRecord(value) || !hasExactKeys(value, RETURN_KEYS) || !isCommodityId(value.asset)) return false;
  return oneOf(value.tab, ["overview", "explore", "relationships", "compare", "research"])
    && oneOf(value.window, ["1m", "5", "20", "60", "252"])
    && Array.isArray(value.compare) && value.compare.length <= 4
    && value.compare.every(isCommodityId) && new Set(value.compare).size === value.compare.length
    && supportedHypothesis(value.asset, value.hypothesis)
    && oneOf(value.view, ["universe", "detail"])
    && typeof value.query === "string" && value.query.length <= 80 && !CONTROL_CHARACTERS.test(value.query)
    && oneOf(value.family, ["all", "energy", "precious", "industrial", "grain", "soft", "livestock"])
    && oneOf(value.sort, ["source", "name", "return_asc", "return_desc"])
    && oneOf(value.trend, ["all", "up", "down", "flat", "unknown"])
    && oneOf(value.momentum, ["all", "bull", "bear", "neutral", "unknown"])
    && oneOf(value.layout, ["table", "map"]);
}

function nullableRecord(value: unknown): boolean {
  return value === null || isRecord(value);
}

function validLabel(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["en", "zh"].every(key => {
    const text = value[key];
    return typeof text === "string" && text.length > 0 && text.length <= 160;
  });
}

function validEvidence(value: SubmittedRecord, assetId: CommodityContextId): boolean {
  const asset = value.asset;
  if (!hasExactKeys(value, EVIDENCE_KEYS)
    || typeof value.workspace_fingerprint !== "string" || value.workspace_fingerprint.length !== 64
    || !/^[0-9a-f]+$/.test(value.workspace_fingerprint)
    || typeof value.projection_revision !== "number" || !Number.isSafeInteger(value.projection_revision)
    || value.projection_revision < 1 || value.live !== false
    || !isRecord(asset) || !isCommodityId(asset.id) || asset.family !== FAMILIES[assetId]
    || !(asset.as_of === null || isDate(asset.as_of))
    || !validLabel(asset.label)
    || !nullableRecord(value.hypothesis)
    || !nullableRecord(value.physical) || (assetId !== "oil" && value.physical !== null)
    || !nullableRecord(value.gold_physical) || (assetId !== "gold" && value.gold_physical !== null)
    || !nullableRecord(value.rates) || !nullableRecord(value.fx)
    || !isRecord(value.source_receipts)) return false;
  return [value.chains, value.ratios].every(entries =>
    Array.isArray(entries) && entries.length <= 64 && entries.every(isRecord));
}

function macroReturnHash(state: CommodityReturnState): string {
  const params = new URLSearchParams();
  params.set("window", state.window);
  params.set("compare", state.compare.join(","));
  params.set("hypothesis", state.hypothesis);
  if (state.view === "universe") params.set("view", "universe");
  if (state.query) params.set("q", state.query);
  for (const key of ["family", "trend", "momentum"] as const) {
    if (state[key] !== "all") params.set(key, state[key]);
  }
  if (state.sort !== "source") params.set("sort", state.sort);
  if (state.layout === "map") params.set("layout", "map");
  return "#cw/" + state.tab + "/" + state.asset + "?" + params.toString();
}

/**
 * Accept only a bounded JSON string: no object coercion, getters or toJSON hooks.
 * Success returns detached, read-only-typed semantic JSON, not original bytes or
 * an immutable stored revision. Source authenticity and ownership are unproven.
 */
export function decodeCommoditySubmittedContext(serialized: unknown): CommoditySubmittedContextResult {
  const reject = (reason: CommodityContextRejection): CommoditySubmittedContextResult => ({ ok: false, reason });
  if (typeof serialized !== "string") return reject("invalid_input");
  if (serialized.length > COMMODITY_SUBMITTED_CONTEXT_LIMITS.maxBytes
    || new TextEncoder().encode(serialized).byteLength > COMMODITY_SUBMITTED_CONTEXT_LIMITS.maxBytes) {
    return reject("payload_too_large");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { return reject("invalid_json"); }
  const structureFailure = checkJson(parsed, 0, { nodes: 0 });
  if (structureFailure) return reject(structureFailure);
  if (hasDuplicateKeys(serialized)) return reject("duplicate_keys");
  if (!isRecord(parsed) || !hasExactKeys(parsed, ROOT_KEYS)) return reject("invalid_structure");
  if (parsed.schema !== COMMODITY_SUBMITTED_CONTEXT_SCHEMA) return reject("unsupported_schema");
  if (!isCommodityId(parsed.commodity_id)) return reject("invalid_subject");
  if (!isDate(parsed.as_of)) return reject("invalid_analysis_date");
  if (!isRecord(parsed.evidence)) return reject("invalid_evidence");
  if (parsed.evidence.schema !== "mmx.commodities.as_saved_evidence.v1") return reject("unsupported_schema");
  if (!validReturnState(parsed.return_state)) return reject("invalid_return_state");
  if (!validEvidence(parsed.evidence, parsed.commodity_id)) return reject("invalid_evidence");
  const asset = parsed.evidence.asset as SubmittedRecord;
  const hypothesis = parsed.evidence.hypothesis;
  if (asset.id !== parsed.commodity_id || parsed.return_state.asset !== parsed.commodity_id
    || (hypothesis === null
      ? parsed.return_state.hypothesis !== "unresolved"
      : (hypothesis as SubmittedRecord).id !== parsed.return_state.hypothesis)) {
    return reject("context_mismatch");
  }
  return {
    ok: true,
    qualification: "submitted_unverified",
    submittedContext: parsed as unknown as CommoditySubmittedContext,
    macroReturnHash: macroReturnHash(parsed.return_state),
  };
}
