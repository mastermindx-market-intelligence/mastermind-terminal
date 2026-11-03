import type { VolPayload } from "@/components/vol/volTypes";
import { admitVolSmileExpiries, admitVolTermRows, volIsoDay } from "@/components/vol/volShared";
import { flowGetResult, type FlowOutcome } from "./flowClientCache";
import { isValidRoot } from "./flowRoot";
import { nyMarketDate } from "./shared-shell/readingFreshness";

export type StockVolatility =
  | { root: string; status: "unavailable" | "absent" }
  | { root: string; status: "data"; asof: string; stale: boolean;
      term: { expiry: string; iv: number }[];
      smile: { expiry: string; strikes: number[]; callIv: number[] } | null };

export function stockVolatilityRead(root: string, read: FlowOutcome, now = new Date()): StockVolatility {
  if (read.status !== "data") return { root, status: read.status };
  const book = read.data as (VolPayload & { stale?: boolean }) | null;
  const asof = volIsoDay(book?.asof);
  if (book?.schema !== "options_hub.vol/v1" || book.root !== root || !asof || asof > nyMarketDate(now)
      || !Array.isArray(book.term) || !Array.isArray(book.smile)) return { root, status: "unavailable" };
  const admitted = admitVolTermRows(book.term);
  const term = admitted.rows.filter(row => row.exp >= asof).map(row => ({
    expiry: row.exp, iv: row.v > 0 ? row.v : Number.NaN,
  }));
  if (!term.some(row => Number.isFinite(row.iv))) return { root, status: "unavailable" };
  const first = admitVolSmileExpiries(book.smile).expiries.find(row => row.exp >= asof
    && row.points.some(point => point.call_iv > 0));
  const smile = first ? {
    expiry: first.exp, strikes: first.points.map(point => point.strike),
    callIv: first.points.map(point => point.call_iv > 0 ? point.call_iv : Number.NaN),
  } : null;
  return { root, status: "data", asof, stale: book.stale === true, term, smile };
}

export async function getStockVolatility(symbol: string): Promise<StockVolatility> {
  const root = symbol.toUpperCase();
  if (!isValidRoot(root)) return { root, status: "unavailable" };
  const read = await flowGetResult(`vol:${root}`, { refresh: true });
  return stockVolatilityRead(root, read);
}
