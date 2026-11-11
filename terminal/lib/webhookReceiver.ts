// Pure webhook receiver verifier — reference implementation for PR582 review finding 2.
//
// Wire scheme (matches terminal/lib/webhookSigning): a signature is
// `v1=` + lowercase-hex HMAC-SHA256 over the exact UTF-8 bytes of
// `${timestamp}.${rawBody}`. Only the timestamp header and the raw body are
// signed material; every other header — including any event-id header — is
// untrusted. `endpointId`/`teamId` are trusted receiver configuration, never
// read from HTTP headers. The function is pure: it authenticates and
// classifies a single request and performs no caching or other side effects;
// callers use `dedupeKey`/`replayUntilMs` for any replay-cache bookkeeping.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const ALERT_FIRED_SCHEMA = "mastermind.alert-fired/v1";
const WEBHOOK_TEST_SCHEMA = "mastermind.webhook-test/v1";
const FRESHNESS_WINDOW_MS = 300_000;
const SIGNATURE_FORMAT = /^v1=[0-9a-f]{64}$/;
const CANONICAL_SECONDS = /^(0|[1-9][0-9]*)$/;

export type WebhookEventType = "alert.fired" | "webhook.test";

export interface VerifyWebhookRequestInput {
  rawBody: string;
  timestamp: string;
  signature?: string;
  previousSignature?: string;
  eventId?: string;
  secrets: readonly string[];
  endpointId: string;
  teamId: string;
  nowMs: number;
}

export type VerifyWebhookResult =
  | {
      ok: true;
      eventType: WebhookEventType;
      dedupeKey: string;
      replayUntilMs: number | null;
      body: Record<string, unknown>;
    }
  | { ok: false; reason: string };

function hmacSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyWebhookRequest(input: VerifyWebhookRequestInput): VerifyWebhookResult {
  const { rawBody, timestamp, signature, previousSignature, eventId, secrets, endpointId, teamId, nowMs } = input;

  // Trusted receiver configuration: garbage here is an operator error, not an
  // authentication outcome.
  if (typeof rawBody !== "string") return { ok: false, reason: "invalid_raw_body" };
  if (typeof endpointId !== "string" || endpointId.length === 0) return { ok: false, reason: "invalid_endpoint_id" };
  if (typeof teamId !== "string" || teamId.length === 0) return { ok: false, reason: "invalid_team_id" };
  if (
    !Array.isArray(secrets) ||
    secrets.length === 0 ||
    secrets.some((secret) => typeof secret !== "string" || secret.length === 0)
  ) {
    return { ok: false, reason: "invalid_secrets" };
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return { ok: false, reason: "invalid_now_ms" };

  // Timestamp: canonical decimal seconds denoting a safe integer.
  if (typeof timestamp !== "string" || !CANONICAL_SECONDS.test(timestamp)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  const tsSeconds = Number(timestamp);
  if (!Number.isSafeInteger(tsSeconds)) return { ok: false, reason: "invalid_timestamp" };

  // Absolute freshness: the timestamp may be at most 300s old or in the future.
  const ageMs = nowMs - tsSeconds * 1000;
  if (ageMs > FRESHNESS_WINDOW_MS) return { ok: false, reason: "timestamp_expired" };
  if (ageMs < -FRESHNESS_WINDOW_MS) return { ok: false, reason: "timestamp_from_future" };

  // Authenticate before parsing any body bytes. Any provided signature
  // (current or previous, valid `v1=` + 64 lowercase hex) must time-safely
  // match the HMAC of `${timestamp}.${rawBody}` under at least one trusted
  // configured secret.
  const candidates = [signature, previousSignature].filter((value): value is string => typeof value === "string");
  if (candidates.length === 0) return { ok: false, reason: "missing_signature" };
  const wellFormed = candidates.filter((candidate) => SIGNATURE_FORMAT.test(candidate));
  if (wellFormed.length === 0) return { ok: false, reason: "malformed_signature" };
  const authenticated = secrets.some((secret) => {
    const expected = hmacSignature(secret, timestamp, rawBody);
    return wellFormed.some((candidate) => constantTimeEquals(candidate, expected));
  });
  if (!authenticated) return { ok: false, reason: "invalid_signature" };

  // Authenticated: only now interpret the body bytes.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "body_not_object" };
  }
  const body = parsed as Record<string, unknown>;

  if (body.schema === ALERT_FIRED_SCHEMA) {
    const fireEventId = body.fire_event_id;
    if (typeof fireEventId !== "string" || fireEventId.length === 0) {
      return { ok: false, reason: "invalid_fire_event_id" };
    }
    if (body.team_id !== teamId) return { ok: false, reason: "team_mismatch" };
    // The event-id header is unsigned; a supplied one must agree with the
    // signed body or the request is desynced.
    if (eventId !== undefined && eventId !== fireEventId) return { ok: false, reason: "event_id_mismatch" };
    return {
      ok: true,
      eventType: "alert.fired",
      // Durable event identity: dedupe never time-expires.
      dedupeKey: JSON.stringify([endpointId, teamId, "alert.fired", fireEventId]),
      replayUntilMs: null,
      body,
    };
  }

  if (body.schema === WEBHOOK_TEST_SCHEMA) {
    // No signed event identity exists for test pings: the unsigned event-id
    // header is ignored for dedupe and the key pins the exact authenticated
    // bytes instead. This only enables atomic replay-caching of one identical
    // authenticated request until freshness expiry — it is not exactly-once
    // across re-signed retries.
    const materialHash = createHash("sha256").update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
    return {
      ok: true,
      eventType: "webhook.test",
      dedupeKey: JSON.stringify([endpointId, teamId, "webhook.test", materialHash]),
      replayUntilMs: tsSeconds * 1000 + FRESHNESS_WINDOW_MS,
      body,
    };
  }

  return { ok: false, reason: "unsupported_schema" };
}
