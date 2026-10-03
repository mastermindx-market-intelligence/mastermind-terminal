import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { fetchOptionsAlphaCandidatePair } from "@/lib/optionsAlphaCandidatePair";

const fixture = (name: string) => readFile(path.join(process.cwd(), "lib/__tests__/fixtures", name));
const lm = "Thu, 13 Aug 2026 14:30:02 GMT";

async function installPair(mutate?: (payload: Buffer, receipt: Buffer) => [Buffer, Buffer], etag = "synthetic-test-only") {
  const initialPayload = await fixture("candidate_feed.json");
  const initialReceipt = await fixture("candidate_feed.receipt.json");
  const [nextPayload, nextReceipt] = mutate?.(initialPayload, initialReceipt) ?? [initialPayload, initialReceipt];
  const payload = Buffer.from(nextPayload);
  const receipt = Buffer.from(nextReceipt);
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).endsWith("candidate_feed.json") ? payload : receipt;
    return new Response(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), {
      status: 200, headers: { etag, "last-modified": lm },
    });
  }) as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("Options Alpha R2 payload/receipt verifier", () => {
  it("accepts exact raw bytes emitted by the Python composer and retains external metadata", async () => {
    await installPair();
    const pair = await fetchOptionsAlphaCandidatePair();
    expect(pair.feed.schema).toBe("options.alpha_candidate_feed/v2");
    expect(pair.receipt.r2).toMatchObject({ etag: "synthetic-test-only", payload_key: "options_alpha/candidate_feed.json" });
    expect(pair.metadata).toMatchObject({ payload_etag: "synthetic-test-only", receipt_etag: "synthetic-test-only", receipt_last_modified: lm });
  });

  it.each(["duplicate", "hash", "etag", "clock", "authority", "map", "inactive"]) ("fails closed for %s corruption", async (kind) => {
    await installPair((payload, receipt) => {
      if (kind === "duplicate") return [Buffer.from(payload.toString().replace('{', '{"schema":"x",')), receipt];
      const body = JSON.parse(receipt.toString()); const feed = JSON.parse(payload.toString());
      if (kind === "hash") body.payload_sha256 = "0".repeat(64);
      if (kind === "etag") body.r2.etag = "wrong";
      if (kind === "clock") body.payload_r2_confirmed_at = "not-an-external-clock";
      if (kind === "map") delete body.candidates[Object.keys(body.candidates)[0]];
      if (kind === "inactive") feed.activation.all_preconditions_cleared = true;
      if (kind === "authority") feed.authority.may_trade = true;
      return [Buffer.from(JSON.stringify(feed)), Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow("options-alpha pair invalid");
  });

  it("rejects a Python-valid float lexeme when its raw bytes no longer match the receipt hash", async () => {
    await installPair((payload, receipt) => [Buffer.from(payload.toString().replace('"schema_version":1', '"schema_version":1.0')), receipt]);
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow("payload raw hash or size mismatch");
  });

  it("rejects a bad header seal even when the receipt is rebound to its corrupted payload", async () => {
    await installPair((payload, receipt) => {
      const feed = JSON.parse(payload.toString()); feed.header.header_digest_sha256 = "0".repeat(64);
      const raw = Buffer.from(JSON.stringify(feed)); const digest = createHash("sha256").update(raw).digest("hex"); const body = JSON.parse(receipt.toString());
      body.payload_sha256 = body.r2.payload_sha256 = digest; body.payload_bytes = raw.length;
      body.receipt_id = "oacfr_" + createHash("sha256").update(`options.alpha_candidate_feed_publication_receipt/v1|${digest}`).digest("hex").slice(0, 25);
      for (const entry of Object.values(body.candidates) as Array<Record<string, unknown>>) { entry.first_receipt_id = body.receipt_id; entry.first_consumer_published_at = null; }
      return [raw, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow("header seal mismatch");
  });

  it.each(["clock-order", "current-first-nonnull", "historical-without-prior", "self-prior"]) ("enforces semantic receipt rule %s", async (kind) => {
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString()); const id = Object.keys(body.candidates)[0];
      if (kind === "clock-order") body.payload_r2_confirmed_at = "2026-08-13T14:30:00Z";
      if (kind === "current-first-nonnull") body.candidates[id].first_consumer_published_at = "2026-08-13T14:30:00Z";
      if (kind === "historical-without-prior") { body.candidates[id].first_receipt_id = "oacfr_" + "1".repeat(25); body.candidates[id].first_consumer_published_at = "2026-08-13T14:30:00Z"; }
      if (kind === "self-prior") body.prior_receipt = { receipt_id: body.receipt_id, payload_sha256: body.payload_sha256 };
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow("options-alpha pair invalid");
  });
});
