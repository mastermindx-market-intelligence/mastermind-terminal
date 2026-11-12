/** Read the incumbent Macro generation without creating a source or authority.
 * The complete wire remains distinct from the legacy Central artifact. The existing
 * dossier, exact-window and reconstructed-history readers consume one admitted core.
 * Admission is scoped to Terminal's PSL read. Other optional owner output is
 * bounded opaque data and must use its own reader before any future rendering.
 * The owner content hash and the gateway's received-byte hash have different scopes.
 */
import { sectorDossiers, sectorWindowMeasurements } from "./sectorDossiers";
import { object, sectorRows, sectorRotationHistory, sectorMeasuredRead,
  type FeedPayload, type Row, type SectorRotationHistory } from "./sectorIntelligence";

/** R3 (COO rulings 2026-11-11): the audience set is closed — `entitled` and
 * `preview`, nothing else. Each audience owns exactly one fixed owner path,
 * and both paths are compile-time constants from that closed set. The route
 * asks the owner for the entitled document first and steps down to the fixed
 * preview document exactly once on a 403 (R2). No path, audience, origin or
 * URL is ever built from a request value, cookie, tier flag, environment
 * override or test override. */
export const SECTOR_GENERATION_AUDIENCE = "entitled" as const;
export const SECTOR_GENERATION_PREVIEW_AUDIENCE = "preview" as const;
export type SectorGenerationAudience =
  | typeof SECTOR_GENERATION_AUDIENCE
  | typeof SECTOR_GENERATION_PREVIEW_AUDIENCE;
export const SECTOR_GENERATION_PATH = `/api/sector-generation?audience=${SECTOR_GENERATION_AUDIENCE}`;
export const SECTOR_GENERATION_PREVIEW_PATH = `/api/sector-generation?audience=${SECTOR_GENERATION_PREVIEW_AUDIENCE}`;
/** The one binding each audience admits: its own document label and its own
 * fixed path. Cross-bindings are invalid in BOTH directions — a preview
 * document on the entitled path, and an entitled document on the preview
 * path, are refused whole and nothing of them is relayed. */
export const SECTOR_GENERATION_BINDINGS: Readonly<
  Record<SectorGenerationAudience, { audience: SectorGenerationAudience; path: string }>
> = {
  [SECTOR_GENERATION_AUDIENCE]: { audience: SECTOR_GENERATION_AUDIENCE, path: SECTOR_GENERATION_PATH },
  [SECTOR_GENERATION_PREVIEW_AUDIENCE]: { audience: SECTOR_GENERATION_PREVIEW_AUDIENCE, path: SECTOR_GENERATION_PREVIEW_PATH },
};
function isSectorGenerationAudience(value: unknown): value is SectorGenerationAudience {
  return value === SECTOR_GENERATION_AUDIENCE || value === SECTOR_GENERATION_PREVIEW_AUDIENCE;
}
/** The audience a fixed generation path carries, or undefined for any other
 * path. This is the receipt half of the R3 four-way binding. */
export function sectorGenerationAudienceOfPath(path: string): SectorGenerationAudience | undefined {
  for (const binding of Object.values(SECTOR_GENERATION_BINDINGS)) {
    if (binding.path === path) return binding.audience;
  }
  return undefined;
}
const MAX_BYTES = 4 * 1024 * 1024;
/** One typed block's value can be up to 516 KiB encoded (COO 19:56Z item 7).
 * UTF-8 bytes ≥ UTF-16 code units, so 516 * 1024 code units admits every
 * string that encodes to 516 KiB; the 4 MiB whole-document byte bound and the
 * ingress content-length guard above it are unchanged. */
const MAX_BLOCK_CHARS = 516 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const has = (value: Row, key: string) => Object.hasOwn(value, key);
function keys(value: unknown, required: string[], optional: string[] = []): value is Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const names = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key))
    && names.every(key => required.includes(key) || optional.includes(key));
}
function day(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const time = new Date(value + "T00:00:00Z");
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value;
}
function clock(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  return !!match && day(match[1]) && +match[2] < 24 && +match[3] < 60
    && (!match[4] || +match[4] < 60) && Number.isFinite(Date.parse(value));
}
/** Bound ordinary JSON before inspecting companions, including client-injected values.
 * The 600k-node walk budget is MEASURED against the real twelve-block specimen
 * served tonight (/tmp/si_plan/v11/rows_specimens/typed_blocks_entitled.json,
 * 482,104 bytes): 26,428 JSON nodes ≈ 18 bytes per node — largest block the
 * curated baskets universe at 14,194 nodes, longest string 284 chars, widest
 * object 49 keys, longest array 83 items. At that density a lawful 4 MiB
 * document holds ≈233,000 nodes, which the previous 200,000 budget would have
 * refused; 600,000 leaves room down to ≈7 bytes per node. The 4 MiB
 * whole-document byte bound plus the ingress content-length guard remain the
 * governing limits, and the budget still sits above a maximal legal single
 * typed block (a 516 KiB array value needs at most 264,192 minimal two-byte
 * elements). Per-container caps: ≤10,000 keys on an object; N-7 (third
 * review): an array whose own length exceeds the remaining budget is refused
 * BEFORE its children are enumerated, so a monster array is never walked. */
export function bounded(value: unknown): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new Set<object>(); let count = 0;
  while (pending.length) {
    const { value: item, depth } = pending.pop()!;
    if (++count > 600000 || depth > 32) return false;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "number") { if (!Number.isFinite(item)) return false; continue; }
    if (typeof item === "string") { if (item.length > MAX_BLOCK_CHARS) return false; continue; }
    if (typeof item !== "object" || seen.has(item)) return false;
    seen.add(item);
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) return false;
    // N-7: refuse a monster array before enumerating — this node is already
    // charged (count), every queued sibling will charge one (pending), and the
    // children would each charge one (item.length). Outcome-preserving: the
    // walk would refuse the same input after enumeration; this skips the walk.
    if (Array.isArray(item) && count + pending.length + item.length > 600000) return false;
    const entries = Object.entries(item);
    if (!Array.isArray(item) && entries.length > 10000) return false;
    for (const [key, entry] of entries) {
      // Opaque companion receipts own their key contract. Ordinary JSON keys
      // such as constructor/prototype are data; the whole-wire byte bound still
      // applies. Do not add a narrower schema before the incumbent reader.
      if (key === "__proto__") return false;
      pending.push({ value: entry, depth: depth + 1 });
    }
  }
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_BYTES; }
  catch { return false; }
}

export interface NativeSectorReceipt {
  schema: "sector_native_view.receipt.v1"; source: "macro.sector";
  generation_id: string; source_session: string; published_at: string;
  qualification: "accepted" | "stale" | "degraded"; input_version: string;
  baseline_session: string | null; content_sha256: string;
}
export interface NativeSectorGeneration {
  receipt: NativeSectorReceipt;
  /** Only the existing measured/dossier/window readers are admitted here. */
  core: Row;
  sectors: Row[];
  history: SectorRotationHistory;
  /** Raw history block, for downstream lenses that parse it themselves. */
  historyWire: Row;
  /** Owner action-board output, transported as bounded opaque data (lane 7). */
  actionBoard: Row;
  /** Carried typed blocks (lane 1 wire §3, twelve names as of COO 19:56Z
   * item 7): an absent key means every block is unavailable — never an error,
   * never zero. Unknown extra names in the owner map are ignored, not refused. */
  typedBlocks: SectorTypedBlocks;
  /** Identity for local presentation reset only, never a new generation allocator. */
  key: string;
}

/** One carried typed block: available with its bounded value, or unavailable
 * with a closed reason. A withheld block is a state, not a missing number. */
export interface SectorTypedBlock {
  status: "available" | "unavailable";
  reason: string | null;
  value: unknown;
}
export type SectorTypedBlocks = Record<string, SectorTypedBlock>;

/** The five entitled-only row blocks. On a preview document they are stubs by
 * Macro's contract (R3 defense in depth): a preview document that carries
 * rows for one of them is refused whole — the paywall, not this parser, is
 * the audience authority, so leaked rows are never a renderable windfall. */
const ENTITLED_ONLY_TYPED_BLOCK_KEYS = ["confluence_universe_sp500", "confluence_universe_nasdaq",
  "confluence_universe_russell", "confluence_universe_baskets", "theme_rows"] as const;

const TYPED_BLOCK_KEYS = ["r1_rising_priced_share", "r2_display_order", "r2_hazard_qualification",
  "etf_flows", "confluence", "bottoming_watch", "theme_table",
  // Lane 1's v11 increment (COO 19:56Z item 7) — five entitled-only blocks
  // appended after theme_table.
  ...ENTITLED_ONLY_TYPED_BLOCK_KEYS] as const;

/** Absent `typed_blocks` ⇒ all twelve blocks unavailable/not_produced; a present
 * block keeps its own status/reason verbatim. Nothing is recomputed here —
 * the generation owner is the producer. Typed-block names outside the twelve
 * are ignored: the `typed_blocks` map is the owner's open surface, so an
 * unknown (thirteenth or later) name never refuses the generation and never
 * throws — future lane 1 increments arrive without a Terminal release. A
 * value may be up to 516 KiB encoded (see MAX_BLOCK_CHARS); no per-block cap
 * below that exists in this parser. */
export function sectorTypedBlocks(data: Row): SectorTypedBlocks {
  const source = has(data, "typed_blocks") && data.typed_blocks !== null
    && typeof data.typed_blocks === "object" && !Array.isArray(data.typed_blocks)
    ? data.typed_blocks as Row : null;
  const blocks: SectorTypedBlocks = {};
  for (const key of TYPED_BLOCK_KEYS) {
    const block = source ? source[key] : undefined;
    if (block !== null && typeof block === "object" && !Array.isArray(block)) {
      const record = block as Row;
      if (record.status === "available") {
        blocks[key] = { status: "available", reason: null, value: record.value ?? null };
      } else {
        blocks[key] = { status: "unavailable",
          reason: typeof record.reason === "string" ? record.reason : "not_produced", value: null };
      }
    } else blocks[key] = { status: "unavailable", reason: "not_produced", value: null };
  }
  return blocks;
}

/** R3 defense in depth: any of the five entitled-only blocks that is not a
 * stub ({status:"unavailable", value:null}) makes a preview document invalid. */
function previewCarriesEntitledRows(data: Row): boolean {
  const source = has(data, "typed_blocks") && data.typed_blocks !== null
    && typeof data.typed_blocks === "object" && !Array.isArray(data.typed_blocks)
    ? data.typed_blocks as Row : null;
  if (!source) return false;
  for (const name of ENTITLED_ONLY_TYPED_BLOCK_KEYS) {
    const block = source[name];
    if (block === undefined) continue;
    const record = block !== null && typeof block === "object" && !Array.isArray(block) ? block as Row : null;
    if (record === null || record.status !== "unavailable" || (has(record, "value") && record.value !== null)) return true;
  }
  return false;
}

export function sectorNativeGeneration(value: unknown, expected?: SectorGenerationAudience): NativeSectorGeneration | null {
  if (!bounded(value) || !keys(value, ["schema", "audience", "source_session", "published_at", "qualification", "projection"])
    || value.schema !== "sector_generation.read/v1"
    // R3: the audience is closed, and the route/browser caller passes the
    // audience of the fixed path it actually fetched. The outer label, the
    // nested projection label and that expected audience must all agree.
    || !isSectorGenerationAudience(value.audience) || (expected !== undefined && value.audience !== expected)
    || !day(value.source_session) || !clock(value.published_at)
    || !["accepted", "stale", "degraded"].includes(String(value.qualification))
    || !keys(value.projection, ["data", "receipt"])) return null;
  const data = value.projection.data, receipt = value.projection.receipt;
  if (!keys(data, ["schema", "audience", "core", "history", "brief", "action_board"], ["typed_blocks"])
    || data.schema !== "sector_native_view.v1" || data.audience !== value.audience
    || !keys(receipt, ["schema", "source", "generation_id", "source_session", "published_at", "qualification",
      "input_version", "baseline_session", "content_sha256"])
    || receipt.schema !== "sector_native_view.receipt.v1" || receipt.source !== "macro.sector"
    || typeof receipt.generation_id !== "string" || !TOKEN.test(receipt.generation_id)
    || typeof receipt.input_version !== "string" || !TOKEN.test(receipt.input_version)
    || typeof receipt.content_sha256 !== "string" || !HASH.test(receipt.content_sha256)
    || receipt.source_session !== value.source_session || receipt.published_at !== value.published_at
    || receipt.qualification !== value.qualification
    || (receipt.baseline_session !== null && (!day(receipt.baseline_session) || receipt.baseline_session > value.source_session))
    || !keys(data.core, ["as_of", "sectors"], ["measured_read", "dated_context", "captured_classification"])
    || data.core.as_of !== value.source_session) return null;
  // R3 defense in depth: the preview document carries the five entitled-only
  // row blocks as stubs by contract; rows on one of them refuse the document.
  if (value.audience === SECTOR_GENERATION_PREVIEW_AUDIENCE && previewCarriesEntitledRows(data)) return null;

  const core = data.core, sectors = sectorRows(core), history = sectorRotationHistory(data.history);
  if (!sectors.length || sectors.length > 100 || !Array.isArray(core.sectors)
    || sectors.length !== core.sectors.length || !history || history.asOf !== value.source_session
    || Object.keys(history.series).length !== sectors.length) return null;
  const tickers = new Set<string>();
  for (const row of sectors) {
    if (row.kind !== "sector" || typeof row.ticker !== "string" || tickers.has(row.ticker)
      || history.series[String(row.id)]?.ticker !== row.ticker) return null;
    tickers.add(row.ticker);
  }
  // Brief/action-board have their explicitly declared older baseline. They are
  // transported as owner output, never copied into this read-only PSL consumer.
  const baseline = receipt.baseline_session ?? receipt.source_session;
  if (object(data.brief).as_of !== baseline || object(data.action_board).as_of !== baseline) return null;
  if (has(core, "measured_read")) {
    const read = object(core.measured_read);
    if (read.schema !== "leadership_rotation_context.measured_group_read/v1"
      || !["available", "partial", "unavailable"].includes(String(read.status))) return null;
    if (keys(read, ["schema", "status", "reason"]) && read.status === "unavailable" && read.reason === "projection_error") {
      // The owner's explicit no-measurement representation is still a valid generation.
    } else {
      const generation = object(read.generation);
      if (!Array.isArray(read.groups) || read.groups.length > 128 || !has(read, "cohort")
        || generation.session_end !== value.source_session || generation.benchmark !== "SPY"
        || sectorMeasuredRead(core).state === "invalid") return null;
    }
    // Closed companion schemas and parent binding stay with their existing readers.
    if (sectorDossiers(core).state === "invalid" || sectorWindowMeasurements(core).state === "invalid") return null;
  }
  return { receipt: receipt as unknown as NativeSectorReceipt, core, sectors, history,
    historyWire: data.history as Row, actionBoard: data.action_board as Row, typedBlocks: sectorTypedBlocks(data),
    key: `${receipt.generation_id}|${receipt.content_sha256}` };
}

/** A non-ready/invalid native feed never falls back to a static Central artifact. */
export function nativeSectorEvidence(feed?: FeedPayload): {
  generation: NativeSectorGeneration | null; feed: FeedPayload | undefined;
} {
  if (!feed) return { generation: null, feed: undefined };
  // R3: a generation receipt is admitted only on one of the two fixed paths,
  // and the document's audience must equal the audience of that exact path —
  // a cross-bound pairing is withdrawn like any invalid feed, never relayed.
  const expected = feed.receipt.source === "generation" && feed.receipt.status === "ready"
    ? sectorGenerationAudienceOfPath(feed.receipt.path) : undefined;
  const generation = expected !== undefined ? sectorNativeGeneration(feed.data, expected) : null;
  if (!generation) return { generation: null, feed: { data: null, receipt: { ...feed.receipt,
    status: feed.receipt.status === "ready" ? "invalid" : feed.receipt.status, contentHash: null } } };
  if (feed.receipt.asOf !== generation.receipt.source_session) return { generation: null,
    feed: { data: null, receipt: { ...feed.receipt, status: "invalid", contentHash: null } } };
  return { generation, feed: { data: generation.core, receipt: { ...feed.receipt,
    stale: generation.receipt.qualification === "stale" } } };
}
