import type { TickerNewsRightsBasis } from "@/lib/newsTypes";

// Optional #9015 snapshot provenance. Both parsers are total: they never
// throw and never consult the clock — an expired receipt is still a receipt;
// judging freshness belongs to consumers, not the contract.

const MAX_TIMESTAMP_CHARS = 128;

export function parseUniverseKnownAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  if (
    !out ||
    out.length > MAX_TIMESTAMP_CHARS ||
    out.includes("\0") ||
    !Number.isFinite(Date.parse(out))
  ) {
    return null;
  }
  return out;
}

function parseProvenanceText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  if (!out || out.length > max || out.includes("\0")) return null;
  return out;
}

export function parseRightsBasis(value: unknown): TickerNewsRightsBasis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const receiptId = parseProvenanceText(obj.receipt_id, 256);
  const source = parseProvenanceText(obj.source, 128);
  const provider = parseProvenanceText(obj.provider, 128);
  const effectiveAt = parseUniverseKnownAt(obj.effective_at);
  const expiresAt = parseUniverseKnownAt(obj.expires_at);
  if (
    receiptId === null ||
    source === null ||
    provider === null ||
    effectiveAt === null ||
    expiresAt === null ||
    Date.parse(effectiveAt) > Date.parse(expiresAt)
  ) {
    return null;
  }
  return {
    receipt_id: receiptId,
    source,
    provider,
    effective_at: effectiveAt,
    expires_at: expiresAt,
  };
}
