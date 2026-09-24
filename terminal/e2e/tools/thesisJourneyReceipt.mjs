const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = [
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
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /cred/i,
];

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.some((pattern) => pattern.test(key));
}

function preserveLiteral(value) {
  return /^[0-9a-f]{40}$/i.test(value)
    || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function redactString(value) {
  if (preserveLiteral(value)) return value;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return REDACTED;
  if (/^[A-Za-z0-9+/=]{20,}$/.test(value)) return REDACTED;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return REDACTED;
  return value;
}

export function redactReceipt(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactReceipt);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isSensitiveKey(key) ? REDACTED : redactReceipt(child),
  ]));
}

export function validateReceipt(value) {
  if (!value || typeof value !== "object") return false;
  if (!/^[0-9a-f]{40}$/i.test(value.expectedRelease || "")) return false;
  if (typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt))) return false;
  if (!Array.isArray(value.phaseA) || value.phaseA.length !== 5) return false;
  if (!value.phaseA.every((entry) => entry?.ok === true)) return false;
  if (Array.isArray(value.browserErrors) && value.browserErrors.length > 0) return false;
  if (value.phaseB?.ran === true) return false;
  return true;
}
