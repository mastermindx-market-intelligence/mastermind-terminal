import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { verifyTerminalMaterialization } from "@/lib/terminalMaterialization";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { buildCurrentBasket, completedReturnSession, decodeReturnSeries, isoDay, record, validSymbol, RETURNS_HORIZONS, type ReturnSeries, type ReturnsHorizon } from "@/lib/returnsIntelligence";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

async function boundedBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("BODY");
  let bytes = 0, text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw new Error("SIZE"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

/** A bounded projection over existing daily files, not another data acquisition owner. */
export async function POST(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "returns-basket", max: 12 });
  if (!rl.ok) return tooMany(rl);
  try {
    const auth = await createClient();
    const { data, error } = await auth.auth.getClaims();
    if (error || !data?.claims?.sub) return reply({ status: "access_required" }, 401);
  } catch { return reply({ status: "access_unavailable" }, 503); }
  let input: Record<string, unknown>;
  try { input = record(await boundedBody(req)); } catch (error) { return reply({ status: "invalid_request" }, error instanceof Error && error.message === "SIZE" ? 413 : 400); }
  const symbols = input.symbols, horizon = input.horizon, membershipAsOf = isoDay(input.membershipAsOf), cutoff = completedReturnSession();
  if (!Array.isArray(symbols) || symbols.length < 2 || symbols.length > 256 || !symbols.every(validSymbol)
    || new Set(symbols).size !== symbols.length || !RETURNS_HORIZONS.includes(horizon as ReturnsHorizon) || !membershipAsOf || membershipAsOf > new Date().toISOString().slice(0, 10)) return reply({ status: "invalid_request" }, 400);
  if (!cutoff) return reply({ status: "session_clock_unavailable" }, 503);
  const through = input.through == null ? cutoff : isoDay(input.through);
  if (!through || through > cutoff) return reply({ status: "invalid_cutoff" }, 400);
  const series: ReturnSeries[] = [], failed: { symbol: string; reason: "absent" | "unavailable" | "invalid" }[] = [];
  for (let start = 0; start < symbols.length; start += 6) {
    await Promise.all(symbols.slice(start, start + 6).map(async symbol => {
      let handle;
      try {
        // The closed symbol alphabet cannot carry a path separator or URL.
        handle = await open(path.join(process.cwd(), "public", "data", `${symbol}.json`), "r");
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) { failed.push({ symbol, reason: "invalid" }); return; }
        const raw = await handle.readFile({ encoding: "utf8" });
        if (Buffer.byteLength(raw) > 2 * 1024 * 1024) { failed.push({ symbol, reason: "invalid" }); return; }
        const document = JSON.parse(raw);
        await verifyTerminalMaterialization(symbol, document);
        const decoded = decodeReturnSeries(symbol, document, through);
        if (!decoded.bars.length || decoded.quality === "refused") { failed.push({ symbol, reason: "invalid" }); return; }
        series.push(decoded);
      } catch (error) {
        failed.push({ symbol, reason: record(error).code === "ENOENT" ? "absent" : error instanceof SyntaxError ? "invalid" : "unavailable" });
      } finally { await handle?.close(); }
    }));
  }
  if (failed.length) return reply({ status: "incomplete", reason: "MEMBERS_UNAVAILABLE", missing: failed.map(f => f.symbol).sort(), receipts: failed });
  // Stable request order, regardless of disk completion order.
  const ordered = symbols.map(symbol => series.find(s => s.symbol === symbol)!);
  return reply(buildCurrentBasket(ordered, horizon as ReturnsHorizon, membershipAsOf));
}
