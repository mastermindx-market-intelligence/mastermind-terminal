export type WebhookUrlOk = { ok: true };
export type WebhookUrlErr = { ok: false; code: "invalid_url" | "not_https" | "private_address" };
export type WebhookUrlCheck = WebhookUrlOk | WebhookUrlErr;

const MAX_URL_LEN = 2048;

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

function intToIpv4(n: number): string {
  const x = n >>> 0;
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
}

function parseOctalOrDec(part: string): number | null {
  if (!/^[0-9]+$/.test(part)) return null;
  if (part.startsWith("0") && part.length > 1 && /^[0-7]+$/.test(part)) {
    return Number.parseInt(part, 8);
  }
  const n = Number.parseInt(part, 10);
  return Number.isFinite(n) ? n : null;
}

function isIpv4Literal(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return false;
  return [m[1], m[2], m[3], m[4]].every((p) => Number(p) <= 255);
}

function isIpv6Literal(s: string): boolean {
  if (!s.includes(":")) return false;
  if (s.includes(".")) {
    const last = s.lastIndexOf(":");
    return last >= 0 && isIpv4Literal(s.slice(last + 1));
  }
  return /^[0-9a-f:]+$/i.test(s) && (s.match(/:/g) || []).length >= 2;
}

/** Decode a hostname that is actually an IPv4/IPv6 literal, including decimal/octal/hex obfuscation. */
export function decodeHostToIp(host: string): string | null {
  const h = host.replace(/^\[|\]$/g, "").trim();
  if (!h) return null;
  if (isIpv4Literal(h) || isIpv6Literal(h)) return h;

  if (/^0x[0-9a-f]+$/i.test(h)) {
    const n = Number.parseInt(h, 16);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) return intToIpv4(n);
    return null;
  }
  if (/^\d+$/.test(h)) {
    const n = h.startsWith("0") && h.length > 1 && /^[0-7]+$/.test(h)
      ? Number.parseInt(h, 8)
      : Number.parseInt(h, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) return intToIpv4(n);
    return null;
  }

  const parts = h.split(".");
  if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^[0-9]+$/.test(p))) {
    const nums = parts.map(parseOctalOrDec);
    if (nums.some((n) => n == null)) return null;
    const [a, b, c, d] = nums as number[];
    if (parts.length === 4) {
      if ([a, b, c, d].some((n) => n < 0 || n > 255)) return null;
      return `${a}.${b}.${c}.${d}`;
    }
    if (parts.length === 3) {
      // a.b.c → a.b.(c>>8).(c&255)  (e.g. 127.0.1)
      if (a > 255 || b > 255 || c > 65535) return null;
      return intToIpv4(ipv4ToInt(a, b, (c >> 8) & 255, c & 255));
    }
    if (parts.length === 2) {
      // a.b → a.(b as 24-bit)  (e.g. 127.1 → 127.0.0.1)
      if (a > 255 || b > 0xffffff) return null;
      return intToIpv4(ipv4ToInt(a, (b >> 16) & 255, (b >> 8) & 255, b & 255));
    }
  }
  return null;
}

function ipv4IsPrivate(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function expandIpv6(ip: string): string | null {
  if (ip.includes(".")) {
    // v4-mapped or v4-compatible
    const last = ip.lastIndexOf(":");
    const v4 = ip.slice(last + 1);
    const head = ip.slice(0, last + 1);
    if (isIpv4Literal(v4)) {
      const [a, b, c, d] = v4.split(".").map(Number);
      const mapped = `${head}${(a << 8) + b}:${(c << 8) + d}`;
      return expandIpv6(mapped);
    }
  }
  const halves = ip.split("::");
  let head = (halves[0] || "").split(":").filter(Boolean);
  let tail = halves.length > 1 ? (halves[1] || "").split(":").filter(Boolean) : [];
  if (halves.length > 2) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const mid = Array(halves.length === 2 ? missing : 0).fill("0");
  const parts = [...head, ...mid, ...tail].map((p) => p.padStart(4, "0").toLowerCase());
  if (parts.length !== 8) return null;
  return parts.join(":");
}

function ipv6IsPrivate(ip: string): boolean {
  const full = expandIpv6(ip);
  if (!full) return ip === "::1";
  if (full === "0000:0000:0000:0000:0000:0000:0000:0001") return true;
  if (full === "0000:0000:0000:0000:0000:0000:0000:0000") return true;
  const first = Number.parseInt(full.slice(0, 4), 16);
  // fc00::/7 unique local; fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  // v4-mapped
  if (full.startsWith("0000:0000:0000:0000:0000:ffff:")) {
    const hi = Number.parseInt(full.split(":")[6], 16);
    const lo = Number.parseInt(full.split(":")[7], 16);
    const v4 = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    return ipv4IsPrivate(v4);
  }
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (isIpv4Literal(ip)) return ipv4IsPrivate(ip);
  if (isIpv6Literal(ip)) return ipv6IsPrivate(ip);
  const decoded = decodeHostToIp(ip);
  if (decoded && decoded !== ip) return isPrivateIp(decoded);
  return false;
}

export function validateWebhookUrl(value: unknown): WebhookUrlCheck {
  if (typeof value !== "string") return { ok: false, code: "invalid_url" };
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LEN) return { ok: false, code: "invalid_url" };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (u.protocol !== "https:") return { ok: false, code: "not_https" };
  if (u.username || u.password) return { ok: false, code: "invalid_url" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, code: "invalid_url" };
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    return { ok: false, code: "private_address" };
  }
  const asIp = decodeHostToIp(host);
  if (asIp && isPrivateIp(asIp)) return { ok: false, code: "private_address" };
  return { ok: true };
}
