import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildWebhookHeaders, signWebhookPayload } from "@/lib/webhookSigning";

// Hand-computed with Node's crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")
// once, then pinned. The function under test is not used to produce the expected digest.
const SECRET = "whsec_test_secret_vector_001";
const TIMESTAMP = 1_700_000_000;
const RAW_BODY = '{"schema":"mastermind.webhook-test/v1"}';
const VECTOR_HEX = "b5368e3ec27af781cde433532330b549d7af4ef49c9a35841d089db979ed997c";
const EMPTY_BODY_HEX = "97556e3e0f2517c35795ebac77b0bd7e1d0024b0d0f55f62e4f787d0f9c72e10";

describe("signWebhookPayload", () => {
  it("matches the pinned HMAC-SHA256 vector", () => {
    expect(signWebhookPayload(SECRET, TIMESTAMP, RAW_BODY)).toBe(VECTOR_HEX);
  });

  it("a changed byte in rawBody produces a different digest", () => {
    const changed = RAW_BODY.replace("v1", "v2");
    const digest = signWebhookPayload(SECRET, TIMESTAMP, changed);
    expect(digest).not.toBe(VECTOR_HEX);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("empty body is legal and produces a real digest, not an empty string", () => {
    const digest = signWebhookPayload(SECRET, TIMESTAMP, "");
    expect(digest).toBe(EMPTY_BODY_HEX);
    expect(digest).not.toBe("");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

// A signature with no stated staleness tolerance is a replayable signature.
// The construction is only half the contract; the window is the other half,
// and this repo ships no verifier, so the documentation IS the deliverable.
describe("the receiver-facing verification contract is documented", () => {
  const deploy = readFileSync(path.join(process.cwd(), "..", "DEPLOY.md"), "utf8");

  it("states the 300-second replay window", () => {
    expect(deploy).toContain("300");
    expect(deploy).toMatch(/\|now − timestamp\| > 300/);
  });

  it("states the construction, the header names and the v1 prefix", () => {
    expect(deploy).toContain("Mastermind-Webhook-Id");
    expect(deploy).toContain("Mastermind-Webhook-Timestamp");
    expect(deploy).toContain("Mastermind-Webhook-Signature");
    expect(deploy).toContain("Mastermind-Webhook-Key-Version");
    expect(deploy).toContain("Mastermind-Webhook-Event-Id");
    expect(deploy).toContain("Mastermind-Webhook-Event-Type");
    expect(deploy).toContain("Mastermind-Webhook-Signature-Previous");
    expect(deploy).toContain("v1=<hex>");
    expect(deploy).toContain('HMAC-SHA256(secret, "<timestamp>.<raw request body>")');
  });

  it("requires a timing-safe comparison and says the secret is shown once", () => {
    expect(deploy).toContain("timing-safe");
    expect(deploy).toContain("timingSafeEqual");
    expect(deploy).toContain("shown once and cannot be shown again");
  });
});

const PREV = "whsec_previous_secret_vector_001";
const EXPIRES = "2026-09-10T12:00:00.000Z";
const NOW_INSIDE = Date.parse("2026-09-10T11:00:00.000Z");
const NOW_AT = Date.parse("2026-09-10T12:00:00.000Z");
const NOW_AFTER = Date.parse("2026-09-10T12:00:01.000Z");

function headerInput(overrides: Partial<Parameters<typeof buildWebhookHeaders>[0]> = {}) {
  return {
    secret: SECRET,
    secretPrevious: null as string | null,
    secretPreviousExpiresAt: null as string | null,
    secretVersion: 2,
    deliveryId: "del-1",
    eventId: "fire-1",
    eventType: "alert.fired",
    timestamp: TIMESTAMP,
    rawBody: RAW_BODY,
    nowMs: NOW_INSIDE,
    ...overrides,
  };
}

describe("buildWebhookHeaders", () => {
  it("current-only: signature, key version, event headers; no previous header", () => {
    const headers = buildWebhookHeaders(headerInput());
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Mastermind-Webhook-Id"]).toBe("del-1");
    expect(headers["Mastermind-Webhook-Timestamp"]).toBe(String(TIMESTAMP));
    expect(headers["Mastermind-Webhook-Signature"]).toBe(`v1=${VECTOR_HEX}`);
    expect(headers["Mastermind-Webhook-Key-Version"]).toBe("2");
    expect(headers["Mastermind-Webhook-Event-Id"]).toBe("fire-1");
    expect(headers["Mastermind-Webhook-Event-Type"]).toBe("alert.fired");
    expect(headers["Mastermind-Webhook-Signature-Previous"]).toBeUndefined();
  });

  it("current+previous inside the window", () => {
    const headers = buildWebhookHeaders(
      headerInput({
        secretPrevious: PREV,
        secretPreviousExpiresAt: EXPIRES,
        nowMs: NOW_INSIDE,
      }),
    );
    expect(headers["Mastermind-Webhook-Signature"]).toBe(`v1=${VECTOR_HEX}`);
    expect(headers["Mastermind-Webhook-Signature-Previous"]).toBe(
      `v1=${signWebhookPayload(PREV, TIMESTAMP, RAW_BODY)}`,
    );
    expect(headers["Mastermind-Webhook-Signature-Previous"]).not.toBe(
      headers["Mastermind-Webhook-Signature"],
    );
  });

  it("previous dropped at expiry", () => {
    const headers = buildWebhookHeaders(
      headerInput({
        secretPrevious: PREV,
        secretPreviousExpiresAt: EXPIRES,
        nowMs: NOW_AT,
      }),
    );
    expect(headers["Mastermind-Webhook-Signature-Previous"]).toBeUndefined();
  });

  it("previous dropped after expiry", () => {
    const headers = buildWebhookHeaders(
      headerInput({
        secretPrevious: PREV,
        secretPreviousExpiresAt: EXPIRES,
        nowMs: NOW_AFTER,
      }),
    );
    expect(headers["Mastermind-Webhook-Signature-Previous"]).toBeUndefined();
  });

  it("key version present and event headers present", () => {
    const headers = buildWebhookHeaders(headerInput({ secretVersion: 3, eventId: "evt-9", eventType: "webhook.test" }));
    expect(headers["Mastermind-Webhook-Key-Version"]).toBe("3");
    expect(headers["Mastermind-Webhook-Event-Id"]).toBe("evt-9");
    expect(headers["Mastermind-Webhook-Event-Type"]).toBe("webhook.test");
  });

  it("no secret in any header value", () => {
    const headers = buildWebhookHeaders(
      headerInput({
        secretPrevious: PREV,
        secretPreviousExpiresAt: EXPIRES,
        nowMs: NOW_INSIDE,
      }),
    );
    for (const [name, value] of Object.entries(headers)) {
      expect(value, name).not.toContain(SECRET);
      expect(value, name).not.toContain(PREV);
    }
  });
});
