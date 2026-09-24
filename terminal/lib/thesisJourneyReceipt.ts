/**
 * Redacts a receipt object by stripping any key or string value that looks like
 * a cookie, token, authorization header, email, JWT, or auth user id.
 * The storage-state file path and contents are never written anywhere.
 */

const SENSITIVE_PATTERNS = [
  /cookie/i,
  /token/i,
  /authorization/i,
  /bearer/i,
  /jwt/i,
  /email/i,
  /auth[_-]?user/i,
  /user[_-]?id/i,
  /session[_-]?id/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /apikey/i,
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /cred/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(key));
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    // Do not redact release identifiers (40-hex) or ISO timestamps
    if (/^[0-9a-f]{40}$/i.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return value;
    // Redact strings that look like tokens / emails / UUIDs with domain parts
    if (
      /^[A-Za-z0-9+/=]{20,}$/.test(value) || // long base64-like tokens
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) || // JWT shape
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) // canonical UUID
    ) {
      return "[REDACTED]";
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = isSensitiveKey(k) ? "[REDACTED]" : redactValue(v);
    }
    return result;
  }
  return value;
}

export interface PhaseACase {
  case: string;
  status: number;
  ok: boolean;
  heading?: string;
  testid?: string;
}

export interface PhaseBResult {
  ran: boolean;
  route: string;
  thesisId?: string;
  versions: Array<{ version: number; previousVersion: number | null }>;
  conflictStatus?: number;
  archived: boolean;
  error?: string;
}

export interface ThesisJourneyReceipt {
  capturedAt: string;
  base: string;
  expectedRelease: string;
  phaseA: PhaseACase[];
  phaseB: PhaseBResult;
  browserErrors: string[];
}

export function redactReceipt<T extends ThesisJourneyReceipt>(receipt: T): T {
  return redactValue(receipt) as T;
}

export function validateReceipt(receipt: unknown): receipt is ThesisJourneyReceipt {
  if (typeof receipt !== "object" || receipt === null) return false;
  const r = receipt as Record<string, unknown>;
  if (typeof r.capturedAt !== "string") return false;
  if (typeof r.base !== "string") return false;
  // expectedRelease must be a 40-hex SHA (or "[REDACTED]" from a pre-pass)
  if (typeof r.expectedRelease !== "string") return false;
  if (!/^([0-9a-f]{40}|\[REDACTED\])$/i.test(r.expectedRelease)) return false;
  if (!Array.isArray(r.phaseA)) return false;
  // Phase A must have exactly 5 cases
  if (r.phaseA.length !== 5) return false;
  for (const c of r.phaseA) {
    if (typeof c !== "object" || c === null) return false;
    if (typeof (c as Record<string, unknown>).case !== "string") return false;
    if (typeof (c as Record<string, unknown>).status !== "number") return false;
    if (typeof (c as Record<string, unknown>).ok !== "boolean") return false;
  }
  if (typeof r.phaseB !== "object" || r.phaseB === null) return false;
  if (!Array.isArray(r.browserErrors)) return false;
  return true;
}
