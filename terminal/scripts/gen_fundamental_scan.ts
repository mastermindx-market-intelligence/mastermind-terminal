// gen_fundamental_scan — publish scan/fundamental.json (E02) for the Screener.
//
// One compact `mastermind.screener_scan/v1` document of family "fundamental" that the Screener
// reads INSTEAD of one <SYM>.fund.json per ticker. Every manifest key gets exactly one row, so
// rows.length === universe.count and the consumer's four coverage populations always sum to the
// requested universe. Each equity row is `projectFundamental(sym, fund.json)` — the SAME pure
// projector the in-app company evidence panel runs (lib/fundamentalScanProducer.ts) — so the
// screen and the evidence cannot disagree about a value.
//
// Conventions mirror the E01 producer (ingest/gen_technical_scan.py): sorted rows; a run cut
// short by --limit / --budget-seconds marks the rest `not_processed` and publishes
// complete:false; publication is guarded by the client's own adoption rule (an incomplete run
// never replaces a complete generation); the document is validated by the CONSUMER's parser
// before it is written; writes are atomic (unique sibling temp + fsync + rename — the data dir
// is the deploy's hardlink farm); and every run, published or not, writes
// scan/fundamental.receipt.json saying what it decided and why.
//
// Built by ops/terminal-build.sh into scripts/dist/gen_fundamental_scan.mjs and invoked by
// ops/terminal-data. Exit: 0 ok, 1 refused/invalid, 2 aborted (unreadable manifest).

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { adoptGeneration, SCREENER_SCAN_SCHEMA, type AdoptDecision, type GenerationMeta } from "@/lib/screenerScan";
import {
  FUNDAMENTAL_FIELD_IDS,
  FUNDAMENTAL_SCAN_FAMILY,
  FUNDAMENTAL_SCAN_VERSION,
  parseFundamentalScan,
  type FundamentalObservation,
} from "@/lib/fundamentalScan";
import { projectFundamental } from "@/lib/fundamentalScanProducer";

export const SCAN_DIRNAME = "scan";
export const SCAN_FILENAME = "fundamental.json";
export const RECEIPT_FILENAME = "fundamental.receipt.json";
export const RECEIPT_SCHEMA = "mastermind.screener_scan_receipt/v1";
/** The manifest asset class whose fund.json this scan projects. Everything else is
 *  unsupported/asset_class_not_covered (crypto, funds, indices, futures, FX, bonds). */
export const COVERED_ASSET_CLASS = "Equities";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type FundamentalScanDoc = {
  schema: string;
  family: string;
  family_version: number;
  generation: number;
  generated_at: string;
  complete: boolean;
  universe: { source: "manifest"; as_of: string; count: number };
  fields: string[];
  rows: ({ sym: string } & FundamentalObservation)[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Same rule as the E01 producer's `_safe_name`: a manifest key is never a path. */
export const safeName = (sym: string): boolean =>
  sym !== "" && !sym.includes("/") && !sym.includes("\\") && sym !== "." && sym !== ".." && !sym.includes("\0");

/** `(as_of, {sym: manifest_row})`. Throws on an unreadable manifest — a scan with no requested
 *  universe is not a generation. */
export function readUniverse(dataDir: string): { asOf: string; symbols: Map<string, Record<string, unknown>> } {
  const man: unknown = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
  if (!isObj(man) || !isObj(man.symbols)) throw new Error("manifest has no symbols map");
  const symbols = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(man.symbols)) if (k) symbols.set(k, isObj(v) ? v : {});
  return { asOf: typeof man.as_of === "string" ? man.as_of : "", symbols };
}

/** One observation for one manifest symbol. Reason order is part of the contract: a design-level
 *  `unsupported` outranks a missing file. */
export function classifySymbol(dataDir: string, sym: string, manifestRow: Record<string, unknown>): FundamentalObservation {
  const sec = manifestRow.sec;
  if (typeof sec === "string" && sec !== "" && sec !== COVERED_ASSET_CLASS) {
    return { status: "unsupported", reason: "asset_class_not_covered" };
  }
  if (!safeName(sym)) return { status: "unavailable", reason: "fund_absent" };
  const path = join(dataDir, `${sym}.fund.json`);
  if (!existsSync(path)) return { status: "unavailable", reason: "fund_absent" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { status: "unavailable", reason: "fund_unreadable" };
  }
  return projectFundamental(sym, raw).observation;
}

const isoSeconds = (epochSeconds: number): string => new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

const dropNulls = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;

/** Wire form of an observation: optional metadata that is null is OMITTED (the parser reads a
 *  missing optional key as null), which keeps a full-universe document ~12% smaller. Values and
 *  withheld cells are never touched. */
export function compactObservation(o: FundamentalObservation): FundamentalObservation {
  if (o.status !== "observed") return o;
  const out = dropNulls({ ...o, ccy: dropNulls({ ...o.ccy }), fy: o.fy ? dropNulls({ ...o.fy }) : null });
  return out as FundamentalObservation;
}

export type BuildOptions = { limit?: number; budgetSeconds?: number; clock?: () => number };

export function buildFundamentalScan(dataDir: string, now: number, opts: BuildOptions = {}): FundamentalScanDoc {
  const { asOf, symbols } = readUniverse(dataDir);
  const clock = opts.clock ?? (() => performance.now() / 1000);
  const started = clock();
  const limit = opts.limit ?? 0;
  const budget = opts.budgetSeconds ?? 0;
  let complete = true;
  const rows: FundamentalScanDoc["rows"] = [];
  const syms = [...symbols.keys()].sort();
  syms.forEach((sym, i) => {
    const overLimit = limit > 0 && i >= limit;
    const overBudget = budget > 0 && clock() - started > budget;
    let obs: FundamentalObservation;
    if (overLimit || overBudget) {
      complete = false;
      obs = { status: "unavailable", reason: "not_processed" };
    } else {
      try {
        obs = classifySymbol(dataDir, sym, symbols.get(sym) ?? {});
      } catch {
        // one bad file never aborts the generation
        obs = { status: "unavailable", reason: "fund_unreadable" };
      }
    }
    rows.push({ sym, ...compactObservation(obs) });
  });
  return {
    schema: SCREENER_SCAN_SCHEMA,
    family: FUNDAMENTAL_SCAN_FAMILY,
    family_version: FUNDAMENTAL_SCAN_VERSION,
    generation: Math.trunc(now),
    generated_at: isoSeconds(Math.trunc(now)),
    complete,
    universe: { source: "manifest", as_of: asOf, count: rows.length },
    fields: [...FUNDAMENTAL_FIELD_IDS],
    rows,
  };
}

/** Whole-document validation by the consumer's OWN parser; also refuses any row the reader would
 *  have to downgrade to malformed (that is a producer bug, never something to publish). */
export function validateFundamentalScan(doc: unknown): string | null {
  const parsed = parseFundamentalScan(doc);
  if (!parsed.ok) return parsed.error;
  for (const row of parsed.value.rows.values()) {
    if (row.kind === "malformed") return `row_malformed:${row.error}`;
  }
  return null;
}

/** Compact JSON with recursively sorted keys + "\n" — byte-stable for the receipt's sha256. */
export function encode(doc: unknown): Buffer {
  const sort = (v: unknown): Json => {
    if (Array.isArray(v)) return v.map(sort);
    if (isObj(v)) {
      const out: { [k: string]: Json } = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sort(v[k]);
      return out;
    }
    return v as Json;
  };
  return Buffer.from(`${JSON.stringify(sort(doc))}\n`, "utf8");
}

/** Unique sibling temp + fsync + rename (never in place: public/data is hardlinked). */
export function writeAtomic(path: string, data: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = openSync(tmp, "wx", 0o644);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o644);
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

/** The published generation's adoption metadata, or null when nothing valid is held. */
export function heldGeneration(path: string): GenerationMeta | null {
  try {
    const parsed = parseFundamentalScan(JSON.parse(readFileSync(path, "utf8")));
    return parsed.ok ? { generation: parsed.value.generation, complete: parsed.value.complete } : null;
  } catch {
    return null;
  }
}

function summarize(doc: FundamentalScanDoc) {
  const byStatus: Record<string, number> = { observed: 0, unsupported: 0, unavailable: 0 };
  const byReason: Record<string, Record<string, number>> = {};
  const byField: Record<string, { valued: number; unsupported: Record<string, number>; unavailable: Record<string, number> }> = {};
  for (const f of doc.fields) byField[f] = { valued: 0, unsupported: {}, unavailable: {} };
  for (const r of doc.rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const bucket = (byReason[r.status] ??= {});
    bucket[r.reason] = (bucket[r.reason] ?? 0) + 1;
    if (r.status !== "observed") continue;
    for (const f of doc.fields) {
      const cell = r.f[f as keyof typeof r.f];
      const acc = byField[f];
      if ("v" in cell) acc.valued += 1;
      else acc[cell.s][cell.r] = (acc[cell.s][cell.r] ?? 0) + 1;
    }
  }
  return { by_status: byStatus, by_reason: byReason, by_field: byField };
}

export type Receipt = Record<string, unknown> & { decision: AdoptDecision["reason"]; published: boolean; error: string | null };

export function publish(dataDir: string, doc: FundamentalScanDoc | null, error: string | null = null): Receipt {
  const scanPath = join(dataDir, SCAN_DIRNAME, SCAN_FILENAME);
  const held = heldGeneration(scanPath);
  const invalid = error ?? (doc ? validateFundamentalScan(doc) : "no_document");
  const decision: AdoptDecision = invalid ? { adopt: false, reason: "invalid_incoming" } : adoptGeneration(held, doc);
  const payload = doc && !invalid ? encode(doc) : null;
  if (decision.adopt && payload) writeAtomic(scanPath, payload);
  // What a reader of /data/scan/fundamental.json receives AFTER this run's decision.
  let liveBytes: Buffer | null = null;
  try { liveBytes = readFileSync(scanPath); } catch { liveBytes = null; }
  const receipt: Receipt = {
    schema: RECEIPT_SCHEMA,
    family: FUNDAMENTAL_SCAN_FAMILY,
    decision: decision.reason,
    published: decision.adopt,
    error: invalid,
    held_generation: held,
    generation: doc?.generation ?? null,
    generated_at: doc?.generated_at ?? null,
    complete: doc?.complete ?? null,
    universe: doc?.universe ?? null,
    fields: doc?.fields ?? null,
    sha256: payload ? createHash("sha256").update(payload).digest("hex") : null,
    bytes: payload ? payload.length : null,
    live_generation: liveBytes ? heldGeneration(scanPath) : null,
    live_sha256: liveBytes ? createHash("sha256").update(liveBytes).digest("hex") : null,
    ...(doc && !invalid ? summarize(doc) : {}),
  };
  writeAtomic(join(dataDir, SCAN_DIRNAME, RECEIPT_FILENAME), encode(receipt));
  return receipt;
}

export function parseNow(raw: string | undefined): number {
  if (raw === undefined) return Math.trunc(Date.now() / 1000);
  if (/^\d+$/.test(raw)) return Number(raw);
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(t)) throw new Error(`--now: not epoch seconds or ISO-8601: ${raw}`);
  return Math.trunc(t / 1000);
}

export type RunOptions = { dataDir: string; now?: number; limit?: number; budgetSeconds?: number };
export type RunResult = { code: 0 | 1 | 2; receipt: Receipt; line: string };

export function runFundamentalScan(opts: RunOptions): RunResult {
  const now = opts.now ?? Math.trunc(Date.now() / 1000);
  const t0 = performance.now();
  let doc: FundamentalScanDoc;
  try {
    doc = buildFundamentalScan(opts.dataDir, now, { limit: opts.limit, budgetSeconds: opts.budgetSeconds });
  } catch (e) {
    const name = e instanceof Error ? e.constructor.name : "Error";
    const receipt = publish(opts.dataDir, null, `aborted:${name}`);
    return { code: 2, receipt, line: `[gen_fundamental_scan] ABORTED (${name}); held=${JSON.stringify(receipt.held_generation)}` };
  }
  const receipt = publish(opts.dataDir, doc);
  const st = (receipt.by_status ?? {}) as Record<string, number>;
  const line = `[gen_fundamental_scan] generation=${receipt.generation} complete=${receipt.complete} ` +
    `rows=${doc.universe.count} observed=${st.observed ?? 0} unsupported=${st.unsupported ?? 0} ` +
    `unavailable=${st.unavailable ?? 0} decision=${receipt.decision} published=${receipt.published} ` +
    `(${((performance.now() - t0) / 1000).toFixed(1)}s)`;
  return { code: receipt.error === null ? 0 : 1, receipt, line };
}

export function parseArgs(argv: readonly string[]): RunOptions {
  const out: RunOptions = { dataDir: resolve("public/data") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`${flag}: missing value`);
      return v;
    };
    const num = (): number => {
      const n = Number(value());
      if (!Number.isFinite(n) || n < 0) throw new Error(`${flag}: not a non-negative number`);
      return n;
    };
    if (flag === "--data-dir") out.dataDir = resolve(value());
    else if (flag === "--limit") out.limit = Math.trunc(num());
    else if (flag === "--budget-seconds") out.budgetSeconds = num();
    else if (flag === "--now") out.now = parseNow(value());
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  let opts: RunOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`[gen_fundamental_scan] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const result = runFundamentalScan(opts);
  console.log(result.line);
  process.exitCode = result.code;
}
