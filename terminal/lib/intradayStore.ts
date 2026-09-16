// Server-only history reader; the existing source selection and bar merge are unchanged.
// Evidence describes construction, never market-data freshness or research admission.
import { promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  type Bar6, tfMinutes, filterUsEquitySession, resampleUsEquitySession,
} from "./intradayShared";
import type { BarOrigin, IntradayAssemblyTrace, StoreRead } from "./intradayEvidence";

const STORE_DIR = path.join(process.cwd(), "public", "data", "intraday");
const HIST_CAP = 20000;
const isUS = (sym: string) => !/\.(SS|SZ|HK|TO)$/i.test(sym) && !/-USD$/i.test(sym);
function storeBase(tf: string): "1h" | "5m" | null {
  const mins = tfMinutes(tf);
  if (mins >= 60) return "1h";
  if (mins >= 5) return "5m";
  return null;
}
async function readStore(sym: string, base: "1h" | "5m") {
  const attempt: StoreRead = { base, status: "unreadable", content_sha256: null };
  let raw: Buffer;
  try {
    raw = await fsp.readFile(path.join(STORE_DIR, `${sym.toUpperCase()}.${base}.json`));
  } catch (error: unknown) {
    attempt.status = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unreadable";
    return { bars: [] as Bar6[], attempt };
  }
  // One read supplies both parsed bars and exact input identity; no second racy metadata read.
  attempt.content_sha256 = createHash("sha256").update(raw).digest("hex");
  try {
    const j = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(j?.bars)) {
      attempt.status = "malformed";
      return { bars: [] as Bar6[], attempt };
    }
    attempt.status = j.bars.length ? "available" : "empty";
    return { bars: j.bars as Bar6[], attempt };
  } catch {
    attempt.status = "malformed";
    return { bars: [] as Bar6[], attempt };
  }
}

// Optional capture preserves the four-argument API and its returned bar values.
export async function withStoredHistory(
  sym: string, tf: string, ext: boolean, live: Bar6[],
  capture?: (trace: IntradayAssemblyTrace) => void,
): Promise<Bar6[]> {
  const storeReads: StoreRead[] = [];
  const finish = (bars: Bar6[], origins: Array<[number, BarOrigin]>) => {
    capture?.({ origins, storeReads });
    return bars;
  };
  const liveOnly = () => finish(live, live.map(bar => [bar[0], "live_tail"]));
  if (!isUS(sym)) return liveOnly();
  let base = storeBase(tf);
  if (!base) return liveOnly();
  const read = async (grain: "5m" | "1h") => {
    const snapshot = await readStore(sym, grain);
    storeReads.push(snapshot.attempt);
    return snapshot.bars;
  };
  let stored: Bar6[] = [];
  if (!ext && tfMinutes(tf) >= 60) {
    stored = await read("5m");
    if (stored.length) base = "5m";
  }
  if (!stored.length) stored = await read(base);
  if (!stored.length) return liveOnly();
  const baseMin = base === "1h" ? 60 : 5;
  const session = ext ? "extended" : "regular";
  const selected = filterUsEquitySession(stored, session);
  const targetMin = tfMinutes(tf);
  const hb = targetMin === baseMin ? selected : resampleUsEquitySession(selected, targetMin, session);
  const liveEp = new Set(live.map(bar => bar[0]));
  const origin: BarOrigin = base === "5m" ? "stored_5m" : "stored_1h";
  const merged: Array<{ bar: Bar6; origin: BarOrigin }> = [];
  for (const bar of hb) if (!liveEp.has(bar[0])) merged.push({ bar, origin });
  for (const bar of live) merged.push({ bar, origin: "live_tail" });
  merged.sort((a, b) => a.bar[0] - b.bar[0]);
  const out: typeof merged = [];
  let last = -1;
  for (const row of merged) if (row.bar[0] !== last) { out.push(row); last = row.bar[0]; }
  const bounded = out.slice(-HIST_CAP);
  return finish(bounded.map(row => row.bar), bounded.map(row => [row.bar[0], row.origin]));
}
