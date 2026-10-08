/**
 * Pure candidate Options reference/session decoding for the Investigation owner.
 * No I/O, enrollment, source-rights decision or retained-coordinate membership.
 * Callers still owe exact-byte/schema/root/subject verification and current rights.
 * The byte ceiling is supplied by the qualified producer contract, never a request.
 */
function isLowercaseSha256Hex(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 64) {
    return false;
  }
  for (let index = 0; index < 64; index += 1) {
    const code = value.charCodeAt(index);
    const isDigit = code >= 48 && code <= 57;
    const isLowerHex = code >= 97 && code <= 102;
    if (!isDigit && !isLowerHex) {
      return false;
    }
  }
  return true;
}

function isCanonicalPositiveDecimal(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  const first = value.charCodeAt(0);
  if (first < 49 || first > 57) {
    return false;
  }
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

function isCanonicalGregorianDate(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10) {
    return false;
  }
  if (value.charCodeAt(4) !== 45 || value.charCodeAt(7) !== 45) {
    return false;
  }
  let year = 0;
  for (let index = 0; index < 4; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
    year = year * 10 + (code - 48);
  }
  let month = 0;
  for (let index = 5; index < 7; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
    month = month * 10 + (code - 48);
  }
  let day = 0;
  for (let index = 8; index < 10; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
    day = day * 10 + (code - 48);
  }
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const limit = daysInMonth[month - 1] ?? 0;
  return day <= limit;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseOptionsMatrixVersionRef(
  versionRef: unknown,
  fingerprint: unknown,
  maxBytes: number,
): { sha256: string; byteLength: number; sourceSession: string | null } | null {
  if (typeof versionRef !== "string" || versionRef.length > 256) {
    return null;
  }
  if (typeof maxBytes !== "number" || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return null;
  }

  let position = 0;

  const shaPrefix = "sha256:";
  if (versionRef.slice(position, position + shaPrefix.length) !== shaPrefix) {
    return null;
  }
  position += shaPrefix.length;

  const digest = versionRef.slice(position, position + 64);
  if (!isLowercaseSha256Hex(digest)) {
    return null;
  }
  position += 64;

  const bytesPrefix = ":bytes:";
  if (versionRef.slice(position, position + bytesPrefix.length) !== bytesPrefix) {
    return null;
  }
  position += bytesPrefix.length;

  const sessionPrefix = ":session:";
  const sessionIndex = versionRef.indexOf(sessionPrefix, position);
  if (sessionIndex < 0) {
    return null;
  }

  const bytesText = versionRef.slice(position, sessionIndex);
  if (!isCanonicalPositiveDecimal(bytesText)) {
    return null;
  }
  const byteLength = Number(bytesText);
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > maxBytes) {
    return null;
  }

  const sessionText = versionRef.slice(sessionIndex + sessionPrefix.length);
  let sourceSession: string | null;
  if (sessionText === "unknown") {
    sourceSession = null;
  } else if (isCanonicalGregorianDate(sessionText)) {
    sourceSession = sessionText;
  } else {
    return null;
  }

  if (typeof fingerprint !== "string" || fingerprint !== digest) {
    return null;
  }

  return { sha256: digest, byteLength, sourceSession };
}

export function readOptionsMatrixSourceSession(
  payload: unknown,
): { ok: true; sourceSession: string | null } | { ok: false; reason: "invalid_source_session" | "source_session_mismatch" } {
  const invalid = { ok: false as const, reason: "invalid_source_session" as const };
  try {
    if (!isPlainRecord(payload)) {
      return invalid;
    }

    let session: string | null = null;
    const sessionDescriptor = Object.getOwnPropertyDescriptor(payload, "session");
    if (sessionDescriptor !== undefined) {
      if (sessionDescriptor.get !== undefined || sessionDescriptor.set !== undefined) {
        return invalid;
      }
      const sessionValue = sessionDescriptor.value;
      if (sessionValue !== null) {
        if (!isCanonicalGregorianDate(sessionValue)) {
          return invalid;
        }
        session = sessionValue;
      }
    }

    let asof: string | null = null;
    const metaDescriptor = Object.getOwnPropertyDescriptor(payload, "_build_meta");
    if (metaDescriptor !== undefined) {
      if (metaDescriptor.get !== undefined || metaDescriptor.set !== undefined) {
        return invalid;
      }
      const metaValue = metaDescriptor.value;
      if (metaValue !== null) {
        if (!isPlainRecord(metaValue)) {
          return invalid;
        }
        const asofDescriptor = Object.getOwnPropertyDescriptor(metaValue, "asof_date");
        if (asofDescriptor !== undefined) {
          if (asofDescriptor.get !== undefined || asofDescriptor.set !== undefined) {
            return invalid;
          }
          const asofValue = asofDescriptor.value;
          if (asofValue !== null) {
            if (!isCanonicalGregorianDate(asofValue)) {
              return invalid;
            }
            asof = asofValue;
          }
        }
      }
    }

    if (session !== null && asof !== null) {
      if (session !== asof) {
        return { ok: false, reason: "source_session_mismatch" };
      }
      return { ok: true, sourceSession: session };
    }
    return { ok: true, sourceSession: session ?? asof };
  } catch {
    return invalid;
  }
}
