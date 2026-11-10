/** Read the incumbent Macro preview generation without creating a source or authority.
 * The complete wire remains distinct from the legacy Central artifact. The existing
 * dossier, exact-window and reconstructed-history readers consume one admitted core.
 * Admission is scoped to Terminal's PSL read. Other optional owner output is
 * bounded opaque data and must use its own reader before any future rendering.
 * The owner content hash and the gateway's received-byte hash have different scopes.
 */
import { sectorDossiers, sectorWindowMeasurements } from "./sectorDossiers";
import { object, sectorRows, sectorRotationHistory, sectorMeasuredRead,
  type FeedPayload, type Row, type SectorRotationHistory } from "./sectorIntelligence";

export const SECTOR_GENERATION_PATH = "/api/sector-generation?audience=preview";
const MAX_BYTES = 4 * 1024 * 1024;
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
/** Bound ordinary JSON before inspecting companions, including client-injected values. */
export function bounded(value: unknown): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new Set<object>(); let count = 0;
  while (pending.length) {
    const { value: item, depth } = pending.pop()!;
    if (++count > 200000 || depth > 32) return false;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "number") { if (!Number.isFinite(item)) return false; continue; }
    if (typeof item === "string") { if (item.length > 262144) return false; continue; }
    if (typeof item !== "object" || seen.has(item)) return false;
    seen.add(item);
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) return false;
    const entries = Object.entries(item);
    if (entries.length > 10000) return false;
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
  /** Carried typed blocks (lane 1 wire §3): an absent key means every block
   * is unavailable — never an error, never zero. */
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

const TYPED_BLOCK_KEYS = ["r1_rising_priced_share", "r2_display_order", "r2_hazard_qualification",
  "etf_flows", "confluence", "bottoming_watch", "theme_table"] as const;

/** Absent `typed_blocks` ⇒ all seven blocks unavailable/not_produced; a present
 * block keeps its own status/reason verbatim. Nothing is recomputed here —
 * the generation owner is the producer. */
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

export function sectorNativeGeneration(value: unknown): NativeSectorGeneration | null {
  if (!bounded(value) || !keys(value, ["schema", "audience", "source_session", "published_at", "qualification", "projection"])
    || value.schema !== "sector_generation.read/v1" || value.audience !== "preview"
    || !day(value.source_session) || !clock(value.published_at)
    || !["accepted", "stale", "degraded"].includes(String(value.qualification))
    || !keys(value.projection, ["data", "receipt"])) return null;
  const data = value.projection.data, receipt = value.projection.receipt;
  if (!keys(data, ["schema", "audience", "core", "history", "brief", "action_board"], ["typed_blocks"])
    || data.schema !== "sector_native_view.v1" || data.audience !== "preview"
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
  const generation = feed.receipt.source === "generation" && feed.receipt.status === "ready"
    && feed.receipt.path === SECTOR_GENERATION_PATH ? sectorNativeGeneration(feed.data) : null;
  if (!generation) return { generation: null, feed: { data: null, receipt: { ...feed.receipt,
    status: feed.receipt.status === "ready" ? "invalid" : feed.receipt.status, contentHash: null } } };
  if (feed.receipt.asOf !== generation.receipt.source_session) return { generation: null,
    feed: { data: null, receipt: { ...feed.receipt, status: "invalid", contentHash: null } } };
  return { generation, feed: { data: generation.core, receipt: { ...feed.receipt,
    stale: generation.receipt.qualification === "stale" } } };
}
