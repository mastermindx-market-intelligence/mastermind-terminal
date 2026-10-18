import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { completedReturnSession, decodeReturnSeries, isoDay, record, validSymbol, returnSessions, RETURNS_HORIZONS, type ReturnsHorizon } from "@/lib/returnsIntelligence";
import { qualifyReturnsForecast } from "@/lib/returnsEvidence";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const abstain = (reason: string, status = 200) => reply({ schema: "returns.forecast.v1", status: "abstain", reasons: [reason] }, status);
async function readExisting(symbol: string, suffix: ".json" | ".seasonal.json"): Promise<unknown> {
  const handle = await open(path.join(process.cwd(), "public", "data", symbol + suffix), "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error("SOURCE_SIZE");
    const raw = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error("SOURCE_SIZE");
    return JSON.parse(raw);
  } finally { await handle.close(); }
}

/** Additive consumer of the existing per-symbol outlook artifact. No indicator
 * votes, generic seasonal win rates, or GEX signs are converted to probability.
 */
export async function GET(req: Request): Promise<Response> {
  const rl = rateLimit(req, { name: "returns-forecast", max: 60 });
  if (!rl.ok) return tooMany(rl);
  try {
    const auth = await createClient(), { data, error } = await auth.auth.getClaims();
    if (error || !data?.claims?.sub) return abstain("ACCESS_REQUIRED", 401);
  } catch { return abstain("ACCESS_UNAVAILABLE", 503); }
  const params = new URL(req.url).searchParams, symbol = params.get("symbol"), asOf = isoDay(params.get("asOf")), horizon = Number(params.get("horizon")), completed = completedReturnSession();
  if (!validSymbol(symbol) || !asOf || !RETURNS_HORIZONS.includes(horizon as ReturnsHorizon)) return abstain("INVALID_REQUEST", 400);
  if (!completed) return abstain("SESSION_CLOCK_UNAVAILABLE", 503);
  if (asOf > completed) return abstain("INCOMPLETE_SESSION", 400);
  if (returnSessions(asOf, asOf)?.length !== 1) return abstain("NOT_A_TRADING_SESSION", 400);
  try {
    const [raw, outlook] = await Promise.all([readExisting(symbol, ".json"), readExisting(symbol, ".seasonal.json")]);
    const series = decodeReturnSeries(symbol, raw, asOf), owner = record(outlook);
    if (series.asOf !== asOf) return abstain("PRICE_CUTOFF_UNAVAILABLE", 404);
    if (owner.symbol !== symbol) return abstain("CONTEXT_MISMATCH", 404);
    if (owner.schema !== "mastermind.seasonal_outlook/v1" || !Array.isArray(owner.returns_forecasts)) return abstain("QUALIFIED_FORECAST_NOT_PUBLISHED", 404);
    const candidates = owner.returns_forecasts.filter(value => { const o = record(value); return o.symbol === symbol && o.asOf === asOf && o.horizon === horizon; });
    if (candidates.length !== 1) return abstain(candidates.length ? "AMBIGUOUS_FORECAST_VINTAGE" : "QUALIFIED_FORECAST_NOT_PUBLISHED", 404);
    const result = qualifyReturnsForecast(candidates[0], { symbol, asOf, horizon: horizon as ReturnsHorizon, basis: series.basis, quality: series.quality });
    return reply(result.status === "ready" ? result.forecast : { schema: "returns.forecast.v1", ...result });
  } catch (error) { return abstain(record(error).code === "ENOENT" ? "QUALIFIED_FORECAST_NOT_PUBLISHED" : "SOURCE_READ_UNAVAILABLE", record(error).code === "ENOENT" ? 404 : 503); }
}
