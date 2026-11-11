/** Generated-column expression from 0018_webhook_delivery.sql — string-built, no live DB. */
export const WEBHOOK_DEDUPE_EXPRESSION = "endpoint_id::text || ':' || event_id";

export function webhookDedupeKey(endpointId: string, eventId: string): string {
  return `${endpointId}:${eventId}`;
}
