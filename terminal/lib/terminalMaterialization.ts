/** Consumer of Data OS's exact Terminal materialization contract.
 *
 * Normative definition: Macro lib/dataos/terminal_materialization.py and
 * research/TERMINAL_YAHOO_MATERIALIZATION_2026-10-19.md.
 * Verification is local process state, never a JSON Boolean supplied by a producer.
 * Legacy Macro-store view contracts keep their existing interpretation.
 */
const API = "dataos.terminal_yahoo_materialization.v1";
const CODEC = "dataos.terminal_ohlc.rows.v1";
const SHA = /^[a-f0-9]{64}$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const VENUES = ["ARCX", "XASE", "XNAS", "XNYS"];
const PRODUCER_FILES = ["ingest/build_polygon_universe.py", "ingest/polygon_bars.py", "ingest/session_anchor.py", "ingest/dataos_materialization.py"];
const OWNER_FILES = ["lib/dataos/terminal_materialization.py", "lib/dataos/identity.py"];
const REFERENCE_FILES = ["security_master.parquet", "vendor_aliases.parquet"];
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const hash = (value: unknown): value is string => typeof value === "string" && SHA.test(value);
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function instant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m || !day(m[1]) || +m[2] > 23 || +m[3] > 59 || +m[4] > 59
      || (m[5] !== "Z" && (+m[5].slice(1,3) > 23 || +m[5].slice(4,6) > 59))) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
function nyDay(epoch: number): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(epoch));
  const get = (type: string) => p.find(value => value.type === type)?.value;
  return get("year") + "-" + get("month") + "-" + get("day");
}

export function hasDirectMaterialization(payload: unknown): boolean {
  const contract = obj(obj(obj(payload).view).contract), evidence = obj(contract.evidence_mode);
  return Object.prototype.hasOwnProperty.call(contract, "materialization")
    || evidence.registry_row === null || evidence.clock === "observed_at";
}

/** Prefix + uint32 BE count + ten date bytes + five binary64 BE values per row. */
export function encodeTerminalRows(input: unknown): Uint8Array {
  if (!Array.isArray(input) || !input.length || input.length > 30000) throw new Error("MATERIALIZATION_ROWS_INVALID");
  const prefix = new TextEncoder().encode(CODEC + "\n");
  const bytes = new Uint8Array(prefix.length + 4 + input.length * 50);
  bytes.set(prefix);
  const view = new DataView(bytes.buffer);
  view.setUint32(prefix.length, input.length, false);
  let offset = prefix.length + 4, prior = "";
  for (const row of input) {
    if (!Array.isArray(row) || row.length !== 6 || !day(row[0]) || row[0] <= prior
        || !row.slice(1).every(finite)) throw new Error("MATERIALIZATION_ROWS_INVALID");
    const [date, o, h, l, c, v] = row;
    if (Math.min(o,h,l,c) <= 0 || h < Math.max(o,c) || l > Math.min(o,c)
        || !Number.isSafeInteger(v) || v < 0) throw new Error("MATERIALIZATION_ROWS_INVALID");
    for (let i = 0; i < 10; i++) bytes[offset++] = date.charCodeAt(i);
    for (const n of [o,h,l,c,v === 0 ? 0 : v]) { view.setFloat64(offset, n, false); offset += 8; }
    prior = date;
  }
  return bytes;
}
function versions(value: unknown, repository: string, files: string[]): boolean {
  const v = obj(value), hashes = obj(v.files_sha256);
  return v.repository === repository && (v.commit === null || typeof v.commit === "string" && /^[a-f0-9]{40}$/.test(v.commit))
    && Object.keys(hashes).length === files.length && files.every(f => hash(hashes[f]))
    && typeof v.code_version === "string" && /^sha256:[a-f0-9]{64}$/.test(v.code_version);
}
function coverage(value: unknown, rows: unknown[][]): boolean {
  const v = obj(value);
  return v.first === rows[0][0] && v.last === rows.at(-1)![0] && v.rows === rows.length;
}
function envelope(symbol: string, payload: unknown): string | null {
  const doc = obj(payload), view = obj(doc.view), c = obj(view.contract), m = obj(c.materialization);
  const e = obj(c.evidence_mode), a = obj(c.adjustment_reference), u = obj(c.field_units), listing = obj(view.listing);
  const observation = obj(doc.source_observation), request = obj(m.request), observed = instant(m.observed_at);
  if (m.schema !== API || m.row_codec !== CODEC) return "MATERIALIZATION_OWNER_VERSION_UNSUPPORTED";
  if (!SYMBOL.test(symbol) || doc.t !== symbol || m.symbol !== symbol
      || typeof m.requested_symbol !== "string" || !SYMBOL.test(m.requested_symbol)
      || m.requested_symbol !== request.symbol || m.alias_namespace !== "yahoo_fetch"
      || typeof listing.security_id !== "string" || !listing.security_id.startsWith("SEC:US-")
      || typeof listing.listing_key !== "string" || !listing.listing_key.startsWith("US-" + listing.mic + "-")
      || !VENUES.includes(String(listing.mic))) return "MATERIALIZATION_IDENTITY_MISMATCH";
  if (doc.src !== "yahoo" || doc.bar_quality !== "real_ohlc" || m.source !== "yahoo"
      || request.adapter !== "yfinance" || request.period !== "max" || request.interval !== "1d"
      || request.auto_adjust !== true || request.session_dates !== "exchange_local" || request.index_timezone !== "America/New_York"
      || typeof m.adapter_version !== "string" || !m.adapter_version || m.adapter_version.length > 100)
    return "MATERIALIZATION_SOURCE_UNSUPPORTED";
  if (view.schema !== "terminal.ohlc_view.v1" || c.schema !== "dataos.view_contract.v1"
      || c.purpose !== "terminal_daily_ohlc" || c.identity_namespace !== "US-<MIC>-<CODE>[.N]"
      || e.mode !== "CURRENT" || e.clock !== "observed_at" || e.registry_row !== null
      || e.output_registry_row !== "terminal.bars.daily.ohlc_json" || e.generation_attested !== false
      || !Array.isArray(e.dependency_generation_ids) || e.dependency_generation_ids.length !== 0
      || a.basis !== "tradj" || a.executable !== false || a.vintage !== "unattested"
      || a.action_revision_set_id !== null || a.as_at !== null
      || u.currency !== "USD" || u.share_basis !== "tradj"
      || !["open","high","low","close"].every(f => u[f] === "USD/share") || u.volume !== "shares"
      || m.historical_availability !== "UNATTESTED" || m.reused !== false)
    return "MATERIALIZATION_CONTRACT_UNSUPPORTED";
  const segments = Array.isArray(view.segments) ? view.segments : [];
  if (segments.length !== 1 || obj(segments[0]).src !== "yahoo" || obj(segments[0]).bar_quality !== "real_ohlc"
      || obj(segments[0]).from !== obj(m.coverage).first || obj(segments[0]).to !== obj(m.coverage).last
      || (listing.src !== undefined && listing.src !== "yahoo") || c.store_vendor !== "yahoo")
    return "MATERIALIZATION_SOURCE_UNSUPPORTED";
  if (!Array.isArray(view.refusal_reasons) || view.refusal_reasons.length
      || view.basis_drift != null || !Array.isArray(view.suspected_breaks) || view.suspected_breaks.length)
    return "MATERIALIZATION_SOURCE_REFUSED";
  if (!Array.isArray(doc.bars) || !doc.bars.length || !coverage(c.coverage, doc.bars)
      || !coverage(m.coverage, doc.bars) || !coverage(observation.coverage, doc.bars))
    return "MATERIALIZATION_COVERAGE_MISMATCH";
  if (observed === null || observed > Date.now() || String(doc.bars.at(-1)?.[0]) > nyDay(observed))
    return "MATERIALIZATION_CLOCK_INVALID";
  if (observation.producer !== PRODUCER_FILES[0] || observation.provider !== "yahoo"
      || observation.qualification !== "OBSERVATION_ONLY" || observation.historical_availability !== "UNATTESTED"
      || observation.observed_at !== m.observed_at || observation.adapter_version !== m.adapter_version
      || observation.digest_codec !== "python.json.compact.v1" || !hash(observation.bars_sha256)
      || observation.bars_sha256 !== m.observation_bars_sha256
      || Object.keys(request).length !== Object.keys(obj(observation.request)).length
      || !Object.entries(request).every(([k,v]) => obj(observation.request)[k] === v))
    return "MATERIALIZATION_OBSERVATION_MISMATCH";
  const ref = obj(m.identity_reference), hashes = obj(ref.files_sha256), readAt = instant(ref.read_at);
  if (ref.generation_attested !== false || ref.generation_id !== null || ref.historical_availability !== "UNATTESTED"
      || Object.keys(hashes).length !== 2 || !REFERENCE_FILES.every(f => hash(hashes[f]))
      || readAt === null || readAt > Date.now()) return "MATERIALIZATION_REFERENCE_UNAVAILABLE";
  if (!versions(m.producer, "mastermindx-market-intelligence/mastermind-terminal", PRODUCER_FILES)
      || !versions(m.owner, "mastermindx-market-intelligence/macro", OWNER_FILES)
      || e.code_version !== obj(m.owner).code_version || !hash(m.bars_sha256))
    return "MATERIALIZATION_CODE_UNATTESTED";
  return null;
}
const marks = new WeakMap<object, { symbol: string; evidence: string; bytes: Uint8Array; problem: string | null }>();
function evidence(payload: unknown): string {
  const d = obj(payload), result = JSON.stringify([d.t,d.src,d.bar_quality,d.view,d.source_observation]);
  if (result.length > 65536) throw new Error("MATERIALIZATION_RECORD_INVALID");
  return result;
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v,i) => v === b[i]);
}
async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length); copy.set(bytes);
  const raw = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(raw), v => v.toString(16).padStart(2,"0")).join("");
}
async function versionDigest(value: unknown): Promise<string> {
  const files = obj(obj(value).files_sha256), sorted = Object.fromEntries(Object.keys(files).sort().map(k => [k, files[k]]));
  return "sha256:" + await digest(new TextEncoder().encode(JSON.stringify(sorted)));
}

/** Verify one complete artifact before any return-window projection or chart transform. */
export async function verifyTerminalMaterialization(symbol: string, payload: unknown): Promise<string | null> {
  if (!hasDirectMaterialization(payload)) return null;
  try {
    const problem = envelope(symbol,payload);
    if (problem) return problem;
    const bytes = encodeTerminalRows(obj(payload).bars), key = evidence(payload);
    const m = obj(obj(obj(payload).view).contract).materialization, materialization = obj(m);
    const [actual, producer, owner] = await Promise.all([digest(bytes), versionDigest(materialization.producer), versionDigest(materialization.owner)]);
    const failure = actual !== materialization.bars_sha256 ? "MATERIALIZATION_CONTENT_MISMATCH"
      : producer !== obj(materialization.producer).code_version || owner !== obj(materialization.owner).code_version ? "MATERIALIZATION_CODE_MISMATCH" : null;
    if (key !== evidence(payload)) return "MATERIALIZATION_EVIDENCE_CHANGED";
    marks.set(payload as object, {symbol,evidence:key,bytes,problem:failure});
    return terminalMaterializationRefusal(symbol,payload);
  } catch { return "MATERIALIZATION_VERIFICATION_UNAVAILABLE"; }
}

/** A changed bar OR changed refusal/evidence invalidates an earlier verification. */
export function terminalMaterializationRefusal(symbol: string, payload: unknown): string | null {
  if (!hasDirectMaterialization(payload)) return null;
  try {
    const problem = envelope(symbol,payload);
    if (problem) return problem;
    const mark = marks.get(payload as object);
    if (!mark || mark.symbol !== symbol) return "MATERIALIZATION_NOT_VERIFIED";
    if (mark.evidence !== evidence(payload)) return "MATERIALIZATION_EVIDENCE_CHANGED";
    if (!equal(mark.bytes, encodeTerminalRows(obj(payload).bars))) return "MATERIALIZATION_CONTENT_CHANGED";
    return mark.problem;
  } catch { return "MATERIALIZATION_RECORD_INVALID"; }
}
