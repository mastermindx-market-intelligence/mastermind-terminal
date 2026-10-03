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
      // Duplicate-key JSON on purpose: prefix a second schema key and keep every
      // remaining raw byte. Same malformed bytes as a first-brace injection.
      if (kind === "duplicate") return [Buffer.concat([Buffer.from('{"schema":"x",'), payload.subarray(1)]), receipt];
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

  it("keeps raw payload, payload hash, and header seal intact when only the receipt is mutated", async () => {
    // Receipt-only mutation must fail closed WITHOUT being able to reroute the
    // payload hash or header seal. The verifier must complain about the receipt,
    // never the payload/header.
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.payload_r2_confirmed_at = "2026-08-13T14:30:00Z"; // reverts clock order
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow(/clock ordering mismatch/);
  });

  it("rejects a historical first_consumer_published_at with zero-microsecond fraction that the weak Date.parse() would have silently accepted", async () => {
    // The schema's date-time format accepts ".000000" — but the canonical parser
    // MUST refuse ".000000" because the byte identity rounds to microseconds and
    // a zero-microsecond fraction is indistinguishable from "no fraction" in
    // producer output. The old parser accepted this via Date.parse (it returns
    // a finite ms value); the canonical parser returns null and the ordering
    // check rejects the historical row.
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.prior_receipt = { payload_sha256: body.payload_sha256, receipt_id: "oacfr_" + "1".repeat(25) };
      const id = Object.keys(body.candidates)[0];
      body.candidates[id].first_receipt_id = "oacfr_" + "1".repeat(25);
      body.candidates[id].first_consumer_published_at = "2026-08-13T14:00:00.000000Z";
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow(/historical receipt clock mismatch/);
  });

  it("demonstrates the old-mutant fails closed on the .000000 clock", async () => {
    // The weak Date.parse() implementation silently returns a finite ms value for
    // ".000000Z" — the canonical parser must surface it as null. Confirm the
    // weak implementation accepted it (so the test proves the canonical one is
    // doing the strict envelope check, not relying on the schema).
    const weak = "2026-08-13T14:00:00.000000Z";
    expect(Number.isFinite(Date.parse(weak))).toBe(true);
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.prior_receipt = { payload_sha256: body.payload_sha256, receipt_id: "oacfr_" + "1".repeat(25) };
      const id = Object.keys(body.candidates)[0];
      body.candidates[id].first_receipt_id = "oacfr_" + "1".repeat(25);
      body.candidates[id].first_consumer_published_at = weak;
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow(/historical receipt clock mismatch/);
  });

  it("rejects a Feb 30 historical clock because the schema preempts it", async () => {
    // Feb 30 is schema-preempted: Ajv date-time rejects it before the canonical
    // UTC parser runs. Do not claim the old Date.parse mutant would have accepted
    // Feb 30 through the full verifier — the schema layer already fails closed.
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.prior_receipt = { payload_sha256: body.payload_sha256, receipt_id: "oacfr_" + "1".repeat(25) };
      const id = Object.keys(body.candidates)[0];
      body.candidates[id].first_receipt_id = "oacfr_" + "1".repeat(25);
      body.candidates[id].first_consumer_published_at = "2026-02-30T14:00:00Z";
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow(/options-alpha pair invalid/);
  });

  it("rejects a 1-digit fractional clock that Date.parse and Ajv accept", async () => {
    // Ajv's date-time format accepts ".1". Date.parse also returns a finite value.
    // The canonical parser still requires exactly 6 nonzero digits or none.
    const weak = "2026-08-13T14:00:00.1Z";
    expect(Number.isFinite(Date.parse(weak))).toBe(true);
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.prior_receipt = { payload_sha256: body.payload_sha256, receipt_id: "oacfr_" + "1".repeat(25) };
      const id = Object.keys(body.candidates)[0];
      body.candidates[id].first_receipt_id = "oacfr_" + "1".repeat(25);
      body.candidates[id].first_consumer_published_at = weak;
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow(/options-alpha pair invalid/);
  });

  it("rejects a year-0000 historical clock that Date.parse and Ajv accept", async () => {
    // Ajv's date-time format accepts year 0000. Date.parse returns a finite value
    // (often coerced). The canonical parser refuses year < 1.
    const weak = "0000-01-01T00:00:00Z";
    expect(Number.isFinite(Date.parse(weak))).toBe(true);
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.prior_receipt = { payload_sha256: body.payload_sha256, receipt_id: "oacfr_" + "1".repeat(25) };
      const id = Object.keys(body.candidates)[0];
      body.candidates[id].first_receipt_id = "oacfr_" + "1".repeat(25);
      body.candidates[id].first_consumer_published_at = weak;
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow(/options-alpha pair invalid/);
  });

  it("rejects reverse durability ordering (.000002Z vs confirmation .000001Z)", async () => {
    // durability > confirmation must fail closed. The durable_writes and confirmation
    // are microsecond-precise; reversing them is the exact regression the ordering
    // check defends against.
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.local_durability_confirmed_at = "2026-08-13T14:30:02.000002Z";
      body.payload_r2_confirmed_at = "2026-08-13T14:30:02.000001Z";
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow(/clock ordering mismatch/);
  });

  it("accepts a microsecond-apart forward ordering (.100000Z -> .100001Z)", async () => {
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.local_durability_confirmed_at = "2026-08-13T14:30:02.100000Z";
      body.payload_r2_confirmed_at = "2026-08-13T14:30:02.100001Z";
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    const pair = await fetchOptionsAlphaCandidatePair();
    expect(pair.receipt.local_durability_confirmed_at).toBe("2026-08-13T14:30:02.100000Z");
    expect(pair.receipt.payload_r2_confirmed_at).toBe("2026-08-13T14:30:02.100001Z");
  });

  it("accepts an external last-modified of Thu, 31 Dec 2026 23:59:59 GMT and exposes it as metadata", async () => {
    // Last-Modified is external HTTP evidence. The canonical parser maps ms → µs
    // so the carry into µs must succeed even at end-of-year.
    const last = "Thu, 31 Dec 2026 23:59:59 GMT";
    const initialPayload = await fixture("candidate_feed.json");
    const initialReceipt = await fixture("candidate_feed.receipt.json");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).endsWith("candidate_feed.json") ? Buffer.from(initialPayload) : Buffer.from(initialReceipt);
      return new Response(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), { status: 200, headers: { etag: "synthetic-test-only", "last-modified": last } });
    }) as typeof fetch;
    const pair = await fetchOptionsAlphaCandidatePair();
    expect(pair.metadata.receipt_last_modified).toBe(last);
    expect(pair.metadata.payload_last_modified).toBe(last);
  });

  it("accepts a historical row whose first_receipt_id is distinct from current AND whose prior_receipt is non-self", async () => {
    // Positive case: prior_receipt is non-self, first_receipt_id is distinct from
    // current receipt_id, and the historical clock is valid and <= external
    // last-modified. The verifier must accept the pair.
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      body.prior_receipt = { payload_sha256: body.payload_sha256, receipt_id: "oacfr_" + "1".repeat(25) };
      const id = Object.keys(body.candidates)[0];
      body.candidates[id].first_receipt_id = "oacfr_" + "1".repeat(25);
      body.candidates[id].first_consumer_published_at = "2026-08-13T14:00:00Z";
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    const pair = await fetchOptionsAlphaCandidatePair();
    expect(pair.receipt.prior_receipt).not.toBeNull();
    const firstEntry = Object.values(pair.receipt.candidates as Record<string, { first_receipt_id: string | null }>)[0];
    expect(firstEntry.first_receipt_id).not.toBe(pair.receipt.receipt_id);
  });

  it("rejects a historical row whose first_receipt_id is distinct but whose prior_receipt IS null", async () => {
    // Converse: distinct first_receipt_id with a NULL prior_receipt means the
    // candidate claims a historical first-publish but never had a prior receipt
    // to anchor the lineage. Verifier must fail closed.
    await installPair((payload, receipt) => {
      const body = JSON.parse(receipt.toString());
      const id = Object.keys(body.candidates)[0];
      body.candidates[id].first_receipt_id = "oacfr_" + "1".repeat(25);
      body.candidates[id].first_consumer_published_at = "2026-08-13T14:00:00Z";
      return [payload, Buffer.from(JSON.stringify(body))];
    });
    await expect(fetchOptionsAlphaCandidatePair()).rejects.toThrow(/historical receipt clock mismatch/);
  });
});
