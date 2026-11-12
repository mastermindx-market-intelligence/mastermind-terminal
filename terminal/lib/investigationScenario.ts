import { SCENARIO_VERSION } from "./exposureScenario";
import type { ScenarioInputs } from "./exposureScenario";
import { isValidRoot } from "./flowRoot";
import type { ExposureLens } from "./exposureMapProjection";

/**
 * investigationScenario — the INPUT/REFERENCE-ONLY scenario slice of the
 * Investigation manifest.
 *
 * REPAIR CONTRACT. An earlier draft stored the full scenario capture: the
 * protected `ScenarioBasis` (reference spot, per-greek $mn summaries, emPct),
 * the frozen `ScenarioValue` result, and an offline recomputation of that
 * result. Even derived result/summary values are protected Options data, and
 * persisting or returning that capture through the generic canonical
 * Investigation surface (directSQL/RPC) would bypass the CURRENT recipient's
 * source-use rights. Nothing of that shape survives here.
 *
 * What a manifest may now carry under `scenario_capture` is a REFERENCE
 * REQUEST, never an authority or availability receipt:
 *
 *   - the caller's own panel inputs (target spot, Δσ vol points, days), and
 *   - a pointer to the options_hub source: which root/session/lens/selection
 *     it was, which exact retained native bytes it came from (sha256 +
 *     byte_length), and the clocks the source itself declared.
 *
 * `basis_sha256` is a DIGEST ONLY — not the protected basis, not a
 * `capture:sha256` input digest and not a Matrix version. The `gex`/`moves`
 * hashes refer to exact retained native bytes held elsewhere; this module
 * never reads them and cannot prove they are in fact retained.
 *
 * THE PARSER PROVES NO RIGHTS. Parsing here cannot prove actual retention, a
 * private destination, action rights, or that the referenced source is
 * native-qualified; it validates shape, bounds and internal consistency and
 * nothing more. Real creation/save/resolution lives elsewhere and must refuse
 * absent a qualified private destination, current authorizers and a retained
 * source. A missing source MUST NOT invent a reference, mint an identifier,
 * succeed as an unresolved capture, or substitute the latest one.
 *
 * Pure module: no I/O, no fetches, no callbacks, no identifiers minted, no
 * clock consulted, no hidden defaults, and NO native math mirror (the relative
 * ±3% spot bound needs the protected exact basis and stays native resolution
 * validation — it is deliberately not guessed here). Every refusal is a typed
 * reason or a null — never a thrown error. The engine version is imported
 * from the native owner and frozen as `model_version`; nothing else is
 * imported from the scenario engine, and no basis/value type reaches the
 * persistence shape.
 */

/** Exact `schema` discriminator of the reference-only scenario capture. */
export const SCENARIO_CAPTURE_SCHEMA = "investigation_scenario_reference.v1" as const;

/**
 * Defensive wire bounds. `gexBytes`/`movesBytes` are explicit ceilings on the
 * retained native payloads the digests refer to (8 MiB / 1 MiB); the clock cap
 * is defense-in-depth (the longest accepted form is 35 chars); the selection
 * bounds mirror the native read.selectionKey limits.
 */
export const SCENARIO_CAPTURE_LIMITS = {
  clock: 40,
  selectionPairs: 128,
  selectionKey: 16 * 1024,
  gexBytes: 8 * 1024 * 1024,
  movesBytes: 1024 * 1024,
} as const;

/** A sha256 digest: exactly 64 lowercase hex characters. */
export type ScenarioDigestHex = string;

/** A retained-native-bytes pointer: digest plus exact size. Never the bytes. */
export interface ScenarioDigestReference {
  sha256: ScenarioDigestHex;
  byte_length: number;
}

/**
 * The source reference stored under `source`. Exactly these keys — no URL, no
 * bucket, no raw key, no arbitrary object name, no basis, no result, no
 * summary values, no qualification claim. `source_as_of` is the source's own
 * clock, retained verbatim; an unknown source clock stays an explicit null
 * and is NOT a qualified-current claim. `evaluated_at` is the zone-bearing
 * instant the source evaluation happened at.
 */
export interface ScenarioSourceReference {
  owner: "options_hub";
  root: string;
  /** Source session, YYYY-MM-DD. */
  session: string;
  /** The source's declared clock, verbatim, or null when the source had none. */
  source_as_of: string | null;
  /** Zone-bearing ISO instant of the source evaluation. */
  evaluated_at: string;
  lens: ExposureLens;
  /** Native read.selectionKey format: `expiry|economic_expiry_at` pairs joined by commas. */
  selection_key: string;
  /** Digest of the protected basis, for correlation only. Never the basis. */
  basis_sha256: ScenarioDigestHex;
  /** The retained native GEX payload: digest + exact byte length. */
  gex: ScenarioDigestReference;
  /** The retained native moves payload, or null when the source had none. */
  moves: ScenarioDigestReference | null;
}

/**
 * The object stored under an Investigation manifest's optional
 * `scenario_capture` key. Exactly these four keys, nothing else.
 */
export interface ScenarioCapture {
  schema: typeof SCENARIO_CAPTURE_SCHEMA;
  model_version: typeof SCENARIO_VERSION;
  inputs: ScenarioInputs;
  source: ScenarioSourceReference;
}

/**
 * Why creation refused. `invalid_source_reference` covers every way the
 * supplied source fails the reference contract (including passing an old
 * full-value `ScenarioBasis`, which is refused — never converted).
 * `invalid_inputs` covers the caller's own panel inputs. Neither outcome is
 * an auth, save or existence claim.
 */
export type ScenarioCaptureOutcome =
  | { ok: true; capture: ScenarioCapture }
  | { ok: false; reason: "invalid_source_reference" | "invalid_inputs" };

const KEYS_CAPTURE = ["schema", "model_version", "inputs", "source"] as const;
const KEYS_SOURCE = [
  "owner", "root", "session", "source_as_of", "evaluated_at",
  "lens", "selection_key", "basis_sha256", "gex", "moves",
] as const;
const KEYS_INPUTS = ["targetSpot", "deltaSigmaPts", "days"] as const;
const KEYS_DIGEST = ["sha256", "byte_length"] as const;
const LENS_KINDS = ["all", "zero", "next-live", "week"] as const;

const HEX64_RE = /^[0-9a-f]{64}$/;

/**
 * A plain JSON object only: prototype must be Object.prototype (or null), so
 * class instances and `Object.create(x)` spoofs are refused, never unwrapped.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Exact own-DATA key set: every required key present as an own data property,
 * nothing else own (symbols and non-enumerables included via Reflect.ownKeys).
 * Accessor properties are refused WITHOUT being read — a getter is never
 * executed. Order is immaterial.
 */
const exactOwnDataKeys = (raw: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(raw);
  if (own.length !== keys.length) return false;
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (d === undefined || !d.enumerable || !("value" in d) || "get" in d || "set" in d) return false;
  }
  return true;
};

/** A number, and only a number — booleans are not numbers, NaN/±∞ are not finite. */
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** No control characters, no U+007F, no U+2028/U+2029 line separators. */
const isSingleLine = (v: string): boolean =>
  ![...v].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029;
  });

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const daysInMonth = (y: number, m: number): number | null => {
  switch (m) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31;
    case 4: case 6: case 9: case 11: return 30;
    case 2: return isLeapYear(y) ? 29 : 28;
    default: return null;
  }
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Exactly YYYY-MM-DD, a REAL calendar date (no 2026-02-30, no 1-digit month). */
const isCalendarDate = (v: string): boolean => {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const dim = daysInMonth(Number(m[1]), Number(m[2]));
  return dim !== null && Number(m[3]) >= 1 && Number(m[3]) <= dim;
};

/**
 * Zone-bearing ISO date-time: `YYYY-MM-DDTHH:MM:SS[.frac](Z|±HH:MM)`. The zone
 * is REQUIRED — a naive local time is not a source clock and not an instant.
 * `t`/`z` lowercase is accepted (RFC 3339 permits it); leap seconds are not;
 * absurd offsets (> 23:59) are not. The string is validated, never parsed
 * into a Date and never normalized.
 */
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

const isIsoDateTimeWithZone = (v: string): boolean => {
  const m = DATETIME_RE.exec(v);
  if (!m) return false;
  if (!isCalendarDate(`${m[1]}-${m[2]}-${m[3]}`)) return false;
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return false;
  if (m[9] !== undefined && (Number(m[9]) > 23 || Number(m[10]) > 59)) return false;
  return true;
};

/** null (unknown clock) or a real date / zone-bearing date-time within the bound, verbatim. */
const isValidSourceClock = (v: unknown): v is string | null => {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  if (v.length < 1 || v.length > SCENARIO_CAPTURE_LIMITS.clock) return false;
  return isCalendarDate(v) || isIsoDateTimeWithZone(v);
};

/**
 * Days since 1970-01-01 for a proleptic-Gregorian date (Hinnant's algorithm).
 * Pure integer calendar math — no timezone database, no guessing.
 */
const daysFromCivil = (y: number, m: number, d: number): number => {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};

/**
 * UTC seconds of a zone-bearing instant, computed from the offset CARRIED IN
 * THE STRING. Deterministic and exact — this is arithmetic on the declared
 * offset, never a timezone normalization, and is used only to order two
 * instants the source itself declared. Sub-second precision is carried
 * separately (zero-padded to 9 digits) so the ordering stays exact.
 */
const instantSeconds = (v: string): number | null => {
  const m = DATETIME_RE.exec(v);
  if (!m) return null;
  const secs = daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) * 86400
    + Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]);
  const offset = m[8] === "-"
    ? -(Number(m[9]) * 3600 + Number(m[10]) * 60)
    : m[8] === "+" ? Number(m[9]) * 3600 + Number(m[10]) * 60 : 0;
  return secs - offset;
};

/** The fractional part of a zone-bearing instant, zero-padded to 9 digits. */
const fractionOf = (v: string): string => {
  const m = DATETIME_RE.exec(v);
  return m && m[7] !== undefined ? m[7].padEnd(9, "0") : "000000000";
};

/** Strict ScenarioInputs shape + the LOCAL absolute bounds → fresh detached object, or null. */
export function validateScenarioInputs(raw: unknown): ScenarioInputs | null {
  if (!isPlainObject(raw) || !exactOwnDataKeys(raw, KEYS_INPUTS)) return null;
  const { targetSpot, deltaSigmaPts, days } = raw;
  if (!isNum(targetSpot) || !isNum(deltaSigmaPts) || !isNum(days)) return null;
  if (targetSpot <= 0) return null;
  if (deltaSigmaPts < -5 || deltaSigmaPts > 5) return null;
  if (days < 0 || days > 5) return null;
  return { targetSpot, deltaSigmaPts, days };
}

/** A digest reference (gex ≤ 8 MiB, moves ≤ 1 MiB) → fresh detached object, or null. */
const parseDigest = (raw: unknown, maxBytes: number): ScenarioDigestReference | null => {
  if (!isPlainObject(raw) || !exactOwnDataKeys(raw, KEYS_DIGEST)) return null;
  const { sha256, byte_length: byteLength } = raw;
  if (typeof sha256 !== "string" || !HEX64_RE.test(sha256)) return null;
  if (!isNum(byteLength) || !Number.isInteger(byteLength) || byteLength < 1 || byteLength > maxBytes) return null;
  return { sha256, byte_length: byteLength };
};

/**
 * The native read.selectionKey format: `expiry|economic_expiry_at` pairs
 * joined by commas. Bounded (≤128 pairs, ≤16 KiB), single-line, each expiry a
 * real YYYY-MM-DD at/after the source session, each economic expiry a
 * zone-bearing instant, pairs unique and strictly sorted as full expiry/economic-instant strings. A URL or
 * any other user-URI shape cannot parse as pairs. What is NOT checked here:
 * whether the economic expiry's America/New_York date equals its expiry —
 * that needs the native timezone convention and is native resolution
 * validation, deliberately not guessed.
 */
const parseSelectionKey = (raw: unknown, session: string):
  { readonly pairs: readonly string[] } | null => {
  if (typeof raw !== "string") return null;
  if (raw.length < 1 || raw.length > SCENARIO_CAPTURE_LIMITS.selectionKey) return null;
  if (!isSingleLine(raw)) return null;
  const parts = raw.split(",");
  if (parts.length > SCENARIO_CAPTURE_LIMITS.selectionPairs) return null;
  let prev: string | null = null;
  for (const part of parts) {
    const sep = part.indexOf("|");
    if (sep < 0) return null;
    const expiry = part.slice(0, sep);
    const economic = part.slice(sep + 1);
    if (!isCalendarDate(expiry)) return null;
    if (!isIsoDateTimeWithZone(economic)) return null;
    if (expiry < session) return null;
    if (prev !== null && !(prev < part)) return null;
    prev = part;
  }
  return { pairs: parts };
};

/**
 * The lens: exactly `all` / `zero` / `next-live` / `week` (kind only), or
 * `one` with a real `exp` date. No other kind (not even `ex-zero`), no extra
 * property on a kindless lens. A `one` lens must select its one expiry from
 * the selection key; a `zero` lens selects the source session, so the session
 * must be the only selected expiry. Dynamic lenses (`next-live`/`week`)
 * are validated as shapes only — a captured-time dynamic lens cannot be
 * re-evaluated with the current clock anywhere; that judgment stays native.
 */
const parseLens = (raw: unknown, session: string, expiries: ReadonlySet<string>): ExposureLens | null => {
  if (!isPlainObject(raw)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(raw, "kind");
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
  const kind: unknown = descriptor.value;
  if (typeof kind !== "string") return null;
  if (kind === "one") {
    if (!exactOwnDataKeys(raw, ["kind", "exp"])) return null;
    const exp = raw.exp;
    if (typeof exp !== "string" || !isCalendarDate(exp)) return null;
    if (expiries.size !== 1 || !expiries.has(exp)) return null;
    return { kind: "one", exp };
  }
  if ((LENS_KINDS as readonly string[]).includes(kind)) {
    if (!exactOwnDataKeys(raw, ["kind"])) return null;
    if (kind === "zero" && (expiries.size !== 1 || !expiries.has(session))) return null;
    return { kind } as ExposureLens;
  }
  return null;
};

/**
 * Strict ScenarioSourceReference shape → fresh detached object, or null.
 * Enforces, in order: plain object, exact keys, hub owner, native root rule,
 * real session, verbatim source clock (null kept null), zone-bearing
 * evaluated_at, clock ordering (evaluated_at cannot precede the session nor a
 * known source_as_of), the selection key, digest shapes and bounds, and the
 * lens/selection agreement. Everything is rebuilt — the result shares no
 * structure with `raw`.
 */
const parseSource = (raw: unknown): ScenarioSourceReference | null => {
  if (!isPlainObject(raw) || !exactOwnDataKeys(raw, KEYS_SOURCE)) return null;
  if (raw.owner !== "options_hub") return null;
  const root = raw.root;
  if (typeof root !== "string" || !isValidRoot(root)) return null;
  const session = raw.session;
  if (typeof session !== "string" || !isCalendarDate(session)) return null;
  const sourceAsOf = raw.source_as_of;
  if (!isValidSourceClock(sourceAsOf)) return null;
  const evaluatedAt = raw.evaluated_at;
  if (typeof evaluatedAt !== "string"
    || evaluatedAt.length < 1
    || evaluatedAt.length > SCENARIO_CAPTURE_LIMITS.clock
    || !isIsoDateTimeWithZone(evaluatedAt)) return null;
  // Clock ordering: a bare date compares by its calendar date; two instants
  // compare exactly via the offsets they carry. Nothing is normalized.
  if (evaluatedAt.slice(0, 10) < session) return null;
  if (typeof sourceAsOf === "string") {
    if (isIsoDateTimeWithZone(sourceAsOf)) {
      const src = instantSeconds(sourceAsOf);
      const ev = instantSeconds(evaluatedAt);
      if (src === null || ev === null || src > ev) return null;
      if (src === ev && fractionOf(sourceAsOf) > fractionOf(evaluatedAt)) return null;
    } else if (sourceAsOf > evaluatedAt.slice(0, 10)) return null;
  }
  const selectionKey = raw.selection_key;
  if (typeof selectionKey !== "string") return null;
  const selection = parseSelectionKey(selectionKey, session);
  if (!selection) return null;
  const basisSha = raw.basis_sha256;
  if (typeof basisSha !== "string" || !HEX64_RE.test(basisSha)) return null;
  const gex = parseDigest(raw.gex, SCENARIO_CAPTURE_LIMITS.gexBytes);
  if (!gex) return null;
  let moves: ScenarioDigestReference | null = null;
  if (raw.moves !== null) {
    moves = parseDigest(raw.moves, SCENARIO_CAPTURE_LIMITS.movesBytes);
    if (!moves) return null;
  }
  const lens = parseLens(raw.lens, session, new Set(selection.pairs.map((p) => p.slice(0, p.indexOf("|")))));
  if (!lens) return null;
  return {
    owner: "options_hub",
    root,
    session,
    source_as_of: sourceAsOf,
    evaluated_at: evaluatedAt,
    lens,
    selection_key: selectionKey,
    basis_sha256: basisSha,
    gex,
    moves,
  };
};

/**
 * Parse a stored reference-only scenario capture back into a ScenarioCapture,
 * or null. A pure shape read: no clock, no live data, no availability
 * argument, no rights judgment, no math. What it enforces is exactly the
 * frozen wire contract — schema discriminator, frozen engine version, exact
 * key sets at both levels, strict input bounds, and the full source
 * reference rules. Anything extra (including an old full-value basis or
 * result) is refused, never dropped and never converted.
 */
export function parseScenarioCapture(raw: unknown): ScenarioCapture | null {
  if (!isPlainObject(raw) || !exactOwnDataKeys(raw, KEYS_CAPTURE)) return null;
  if (raw.schema !== SCENARIO_CAPTURE_SCHEMA || raw.model_version !== SCENARIO_VERSION) return null;
  const inputs = validateScenarioInputs(raw.inputs);
  if (!inputs) return null;
  const source = parseSource(raw.source);
  if (!source) return null;
  return { schema: SCENARIO_CAPTURE_SCHEMA, model_version: SCENARIO_VERSION, inputs, source };
}

/**
 * Validate the caller's explicit reference + panel inputs and detach them
 * into a capture. This is a PURE constructor: its ok result is NOT an
 * auth/save/existence claim, proves nothing about retention or rights, and
 * mints nothing. The source must already be a complete reference — a missing
 * source refuses (no invented reference, no minted id, no "unresolved
 * capture" success, no latest-substitution), and an old full-value
 * `ScenarioBasis` refuses as `invalid_source_reference`, never converted.
 */
export function createScenarioCapture(source: unknown, inputs: unknown): ScenarioCaptureOutcome {
  const frozenSource = parseSource(source);
  if (!frozenSource) return { ok: false, reason: "invalid_source_reference" };
  const frozenInputs = validateScenarioInputs(inputs);
  if (!frozenInputs) return { ok: false, reason: "invalid_inputs" };
  return {
    ok: true,
    capture: {
      schema: SCENARIO_CAPTURE_SCHEMA,
      model_version: SCENARIO_VERSION,
      inputs: frozenInputs,
      source: frozenSource,
    },
  };
}
