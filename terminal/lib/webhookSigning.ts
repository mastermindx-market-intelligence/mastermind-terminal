import { createHmac } from "node:crypto";

/** HMAC-SHA256 hex digest of `${timestamp}.${rawBody}` — Stripe's timestamp.body construction. */
export function signWebhookPayload(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}
