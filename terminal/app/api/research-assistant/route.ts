import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { preflightEvidenceToThesis, validEvidenceQuestion } from "@/lib/evidenceToThesis";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { rateLimit, tooMany } from "@/lib/rateLimit";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 4096;
const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

async function boundedBody(request: Request): Promise<Record<string, unknown> | null> {
  const stated = request.headers.get("content-length");
  if (stated !== null && (!Number.isSafeInteger(Number(stated)) || Number(stated) < 0 || Number(stated) > MAX_REQUEST_BYTES)) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const bytes = new Uint8Array(MAX_REQUEST_BYTES);
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      if (size + next.value.byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      bytes.set(next.value, size);
      size += next.value.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, { name: "research-assistant", max: 10 });
  if (!limited.ok) return tooMany(limited);
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("unauthenticated", 401);
  } catch {
    return errorResponse("authentication_unavailable", 503);
  }
  const body = await boundedBody(request);
  if (!body || Object.keys(body).some((key) => key !== "symbol" && key !== "question")
    || typeof body.symbol !== "string" || !normalizeAnalysisSymbol(body.symbol)
    || !validEvidenceQuestion(body.question)) return errorResponse("invalid_request", 400);
  const result = await preflightEvidenceToThesis(body.symbol, body.question, { signal: request.signal });
  return NextResponse.json(result, { headers: NO_STORE });
}
