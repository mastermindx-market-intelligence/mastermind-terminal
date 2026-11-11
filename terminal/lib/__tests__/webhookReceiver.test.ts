// Vitest suite for the reference webhook receiver verifier (PR582 review finding 2).
//
// Fixture signatures are built directly over the documented wire scheme —
// `v1=` + lowercase-hex HMAC-SHA256 of `${timestamp}.${rawBody}`, the same
// material @/lib/webhookSigning's signWebhookPayload emits — so every byte is
// deterministic synthetic data and the suite spawns no processes and touches
// no clock.

import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyWebhookRequest,
  type VerifyWebhookRequestInput,
  type VerifyWebhookResult,
} from "../webhookReceiver";

const ENDPOINT_ID = "ep_test_1";
const OTHER_ENDPOINT_ID = "ep_test_2";
const TEAM_ID = "team_acme";
const SECRET_CURRENT = "whsec_current_0123456789abcdef";
const SECRET_OLD = "whsec_old_fedcba9876543210";
const SECRET_UNKNOWN = "whsec_never_configured";
const TS = 1_700_000_000; // seconds; NOW_MS is its exact ms equivalent
const NOW_MS = TS * 1000;
const FRESH_WINDOW_MS = 300_000;
const ALERT_SCHEMA = "mastermind.alert-fired/v1";
const TEST_SCHEMA = "mastermind.webhook-test/v1";

function sign(secret: string, timestamp: string, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

interface Fixture {
  body?: Record<string, unknown>;
  secret?: string;
  timestamp?: number;
  eventId?: string;
  endpointId?: string;
  secrets?: string[];
  nowMs?: number;
}

function baseInput(rawBody: string, fixture: Fixture = {}): VerifyWebhookRequestInput {
  const timestamp = String(fixture.timestamp ?? TS);
  return {
    rawBody,
    timestamp,
    signature: sign(fixture.secret ?? SECRET_CURRENT, timestamp, rawBody),
    eventId: fixture.eventId,
    secrets: fixture.secrets ?? [SECRET_CURRENT, SECRET_OLD],
    endpointId: fixture.endpointId ?? ENDPOINT_ID,
    teamId: TEAM_ID,
    nowMs: fixture.nowMs ?? NOW_MS,
  };
}

function alertBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: ALERT_SCHEMA, fire_event_id: "fire_001", team_id: TEAM_ID, ...overrides };
}

function alertInput(fixture: Fixture = {}): VerifyWebhookRequestInput {
  return baseInput(JSON.stringify(fixture.body ?? alertBody()), fixture);
}

function testInput(fixture: Fixture = {}): VerifyWebhookRequestInput {
  return baseInput(JSON.stringify(fixture.body ?? { schema: TEST_SCHEMA }), fixture);
}

function expectOk(result: VerifyWebhookResult): asserts result is Extract<VerifyWebhookResult, { ok: true }> {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
}

function expectRejected(result: VerifyWebhookResult, reason: string): void {
  expect(result).toEqual({ ok: false, reason });
}

describe("verifyWebhookRequest", () => {
  describe("alert.fired", () => {
    it("accepts a valid signed alert with its durable event dedupe key", () => {
      const result = verifyWebhookRequest(alertInput({ eventId: "fire_001" }));
      expectOk(result);
      expect(result.eventType).toBe("alert.fired");
      expect(result.replayUntilMs).toBeNull(); // durable dedupe: no time-boxed replay cache
      expect(result.dedupeKey).toBe(JSON.stringify([ENDPOINT_ID, TEAM_ID, "alert.fired", "fire_001"]));
      expect(result.body).toEqual(alertBody());
    });

    it("rejects a supplied eventId that disagrees with the signed body (same body and signature bytes)", () => {
      const original = alertInput({ eventId: "fire_001" });
      expectOk(verifyWebhookRequest(original));
      expectRejected(verifyWebhookRequest({ ...original, eventId: "fire_999" }), "event_id_mismatch");
    });

    it("rejects an alert signed for a team other than the receiver config", () => {
      expectRejected(
        verifyWebhookRequest(alertInput({ body: alertBody({ team_id: "team_other" }) })),
        "team_mismatch",
      );
    });

    it("rejects an alert without a nonempty fire_event_id", () => {
      expectRejected(
        verifyWebhookRequest(alertInput({ body: alertBody({ fire_event_id: "" }) })),
        "invalid_fire_event_id",
      );
    });

    it("rejects signed schemas other than the two known ones", () => {
      expectRejected(
        verifyWebhookRequest(
          alertInput({ body: { schema: "mastermind.other/v1", fire_event_id: "fire_001", team_id: TEAM_ID } }),
        ),
        "unsupported_schema",
      );
    });
  });

  describe("authentication", () => {
    it("rejects a tampered rawBody whose signature belongs to the original bytes", () => {
      const input = alertInput();
      const tampered: VerifyWebhookRequestInput = {
        ...input,
        rawBody: JSON.stringify(alertBody({ fire_event_id: "fire_002" })),
      };
      expectRejected(verifyWebhookRequest(tampered), "invalid_signature");
    });

    it("rejects signatures made under a secret that is not configured", () => {
      expectRejected(verifyWebhookRequest(alertInput({ secret: SECRET_UNKNOWN })), "invalid_signature");
    });

    it("accepts a previousSignature made with a configured old secret", () => {
      const input = alertInput();
      const withPrevious = (): VerifyWebhookRequestInput => ({
        ...input,
        signature: undefined,
        previousSignature: sign(SECRET_OLD, input.timestamp, input.rawBody),
      });
      const result = verifyWebhookRequest(withPrevious());
      expectOk(result);
      expect(result.eventType).toBe("alert.fired");
      // Rotation midpoint where only the old secret is still configured.
      expectOk(verifyWebhookRequest({ ...withPrevious(), secrets: [SECRET_OLD] }));
    });

    it("rejects missing and malformed signature material", () => {
      const input = alertInput();
      expectRejected(verifyWebhookRequest({ ...input, signature: undefined }), "missing_signature");
      expectRejected(verifyWebhookRequest({ ...input, signature: "v1=deadbeef" }), "malformed_signature");
    });

    it("enforces the absolute 300s freshness boundary on the timestamp", () => {
      expectOk(verifyWebhookRequest(alertInput({ timestamp: TS - FRESH_WINDOW_MS / 1000 })));
      expectRejected(verifyWebhookRequest(alertInput({ timestamp: TS - 301 })), "timestamp_expired");
      expectRejected(verifyWebhookRequest(alertInput({ timestamp: TS + 301 })), "timestamp_from_future");
    });

    it("requires a canonical decimal seconds timestamp", () => {
      const input = alertInput();
      expectRejected(verifyWebhookRequest({ ...input, timestamp: `0${input.timestamp}` }), "invalid_timestamp");
      expectRejected(verifyWebhookRequest({ ...input, timestamp: `${input.timestamp}.0` }), "invalid_timestamp");
    });
  });

  describe("scope and parsing", () => {
    it("scopes the dedupe key to the configured endpoint", () => {
      const first = verifyWebhookRequest(alertInput());
      const second = verifyWebhookRequest(alertInput({ endpointId: OTHER_ENDPOINT_ID }));
      expectOk(first);
      expectOk(second);
      expect(first.dedupeKey).not.toBe(second.dedupeKey);
      expect(second.dedupeKey).toBe(JSON.stringify([OTHER_ENDPOINT_ID, TEAM_ID, "alert.fired", "fire_001"]));
    });

    it("interprets the body only after authentication succeeds", () => {
      expectRejected(verifyWebhookRequest(baseInput("not-json{")), "invalid_json");
      expectRejected(verifyWebhookRequest({ ...baseInput("not-json{"), signature: `v1=${"0".repeat(64)}` }), "invalid_signature");
      expectRejected(verifyWebhookRequest(baseInput('"just a string"')), "body_not_object");
      expectRejected(verifyWebhookRequest(baseInput("[1,2]")), "body_not_object");
    });
  });

  describe("webhook.test", () => {
    it("keeps the replay key stable across changed unsigned event-id headers and time-boxes it", () => {
      const rawBody = JSON.stringify({ schema: TEST_SCHEMA, sent_at: "2023-11-14T22:13:20Z" });
      const first = verifyWebhookRequest(baseInput(rawBody, { eventId: "evt_a" }));
      const second = verifyWebhookRequest(baseInput(rawBody, { eventId: "evt_b" }));
      expectOk(first);
      expectOk(second);
      expect(first.eventType).toBe("webhook.test");
      const expectedKey = JSON.stringify([ENDPOINT_ID, TEAM_ID, "webhook.test", sha256Hex(`${TS}.${rawBody}`)]);
      expect(first.dedupeKey).toBe(expectedKey);
      expect(second.dedupeKey).toBe(expectedKey); // unsigned header ignored for dedupe
      expect(first.replayUntilMs).toBe(TS * 1000 + FRESH_WINDOW_MS);
      expect(second.replayUntilMs).toBe(first.replayUntilMs);
    });

    it("does not dedupe re-signed test pings with different bodies", () => {
      const first = verifyWebhookRequest(testInput({ body: { schema: TEST_SCHEMA, nonce: 1 } }));
      const second = verifyWebhookRequest(testInput({ body: { schema: TEST_SCHEMA, nonce: 2 } }));
      expectOk(first);
      expectOk(second);
      expect(first.dedupeKey).not.toBe(second.dedupeKey);
    });
  });
});
