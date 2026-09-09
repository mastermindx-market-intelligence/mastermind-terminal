import { describe, expect, it } from "vitest";
import { signWebhookPayload } from "@/lib/webhookSigning";

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
