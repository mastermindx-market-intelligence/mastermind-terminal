import { createHmac } from "node:crypto";

/** HMAC-SHA256 hex digest of `${timestamp}.${rawBody}` — Stripe's timestamp.body construction. */
export function signWebhookPayload(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export type WebhookHeaderInput = {
  secret: string;
  secretPrevious: string | null;
  secretPreviousExpiresAt: string | null;
  secretVersion: number;
  deliveryId: string;
  eventId: string;
  eventType: string;
  timestamp: number;
  rawBody: string;
  nowMs: number;
};

/** Receiver-facing header set. Never puts a secret in a header value. */
export function buildWebhookHeaders(input: WebhookHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Mastermind-Webhook-Id": input.deliveryId,
    "Mastermind-Webhook-Timestamp": String(input.timestamp),
    "Mastermind-Webhook-Signature": `v1=${signWebhookPayload(input.secret, input.timestamp, input.rawBody)}`,
    "Mastermind-Webhook-Key-Version": String(input.secretVersion),
    "Mastermind-Webhook-Event-Id": input.eventId,
    "Mastermind-Webhook-Event-Type": input.eventType,
  };
  const previous = input.secretPrevious;
  const expiresAt = input.secretPreviousExpiresAt;
  if (previous && expiresAt) {
    const expiresMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs > input.nowMs) {
      headers["Mastermind-Webhook-Signature-Previous"] =
        `v1=${signWebhookPayload(previous, input.timestamp, input.rawBody)}`;
    }
  }
  return headers;
}
