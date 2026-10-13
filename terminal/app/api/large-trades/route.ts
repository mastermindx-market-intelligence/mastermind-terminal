import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { validateLargeTradesEnvelope } from "@/lib/largeTrades/engine";
import { makeLargeTradesFixture } from "@/lib/largeTrades/fixtures";
import { isAdmittedLargeTradesSource } from "@/lib/largeTrades/sourceAdmission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "private, no-store";
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const SYMBOL = /^[A-Z0-9^][A-Z0-9.^=_!-]{0,31}$/;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": CACHE_CONTROL } });
}

/**
 * Read-only consumer of the incumbent Macro published-artifact root, matching
 * lib/dislocations/source.ts. The admitted publisher owns large_trades/SYMBOL.json.
 * No provider credentials, upstream URL parameters, collector, live socket or fallback.
 */
export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, { name: "large-trades" });
  if (!limited.ok) {
    const response = tooMany(limited);
    response.headers.set("Cache-Control", CACHE_CONTROL);
    return response;
  }
  const fixtureMode = process.env.NODE_ENV !== "production"
    && process.env.TERMINAL_E2E_FIXTURE === "1";
  if (!fixtureMode) {
    try {
      const supabase = await createClient();
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return json({ state: "signed_out", reason: "authentication_required" }, 401);
    } catch {
      return json({ state: "signed_out", reason: "authentication_unavailable" }, 401);
    }
  }
  const params = new URL(request.url).searchParams;
  const symbol = (params.get("sym") || "").trim().toUpperCase();
  if (params.getAll("sym").length !== 1 || !SYMBOL.test(symbol)) {
    return json({ state: "invalid", reason: "invalid_symbol" }, 400);
  }
  const servedAtNs = (BigInt(Date.now()) * BigInt(1000000)).toString();
  if (fixtureMode) {
    const envelope = makeLargeTradesFixture(symbol);
    return json({ state: "ready", envelope, artifactSha256: null, servedAtNs });
  }

  const publishedRoot = process.env.MACRO_LIVE_DIR || "/var/lib/macro-live/public/live";
  const sourcePath = path.join(publishedRoot, "large_trades", `${symbol}.json`);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    // A final symlink is rejected so a mispublished artifact cannot expose another file.
    handle = await fs.open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) {
      return json({ state: "invalid", reason: "artifact_size_or_type" });
    }
    // The incumbent publisher owns the parent directories and publishes atomically.
    // Cap the actual read as well as stat: a growing artifact cannot allocate unbounded memory.
    const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_ARTIFACT_BYTES) {
      return json({ state: "invalid", reason: "artifact_size_or_type" });
    }
    const bytes = buffer.subarray(0, length);
    let envelope: unknown;
    try { envelope = JSON.parse(bytes.toString("utf8")); }
    catch { return json({ state: "invalid", reason: "artifact_json" }); }
    if (!validateLargeTradesEnvelope(envelope)
      || envelope.instrument.symbol.toUpperCase() !== symbol
      || envelope.provenance.dataMode === "fixture"
      || envelope.provenance.evidenceMode === "FIXTURE"
      || envelope.provenance.dataMode === "unavailable") {
      return json({ state: "invalid", reason: "artifact_contract" });
    }
    if (!isAdmittedLargeTradesSource(envelope)) {
      return json({ state: "unavailable", reason: "feed_not_admitted" });
    }
    return json({
      state: "ready", envelope, servedAtNs,
      artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "ENOENT") return json({ state: "unavailable", reason: "feed_not_published" });
    return json({ state: "unavailable", reason: "published_source_unreadable" });
  } finally {
    await handle?.close().catch(() => {});
  }
}
