import { NextResponse } from "next/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rate limiting is the shared limiter's job, not this route's. The private `rateMap` that used to
// live here was a second, worse implementation of it: it never swept, so every distinct source IP
// it ever saw stayed resident for the process lifetime, and it answered a bare 429 with no
// `retry-after` for a well-behaved client to honour. The canonical limiter sweeps, caps live
// buckets, and `tooMany()` carries the header.

// ── base36 random slug (10 chars) ──
function slug(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  for (const b of arr) s += chars[b % 36];
  return s;
}

// ── R2 upload via fetch (S3-compatible presign-free PUT) ──
async function uploadToR2(body: ArrayBuffer, key: string): Promise<void> {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!endpoint || !accessKey || !secretKey || !bucket) throw new Error("R2 environment variables not configured");

  // AWS Signature V4 for R2
  const url = `${endpoint}/${bucket}/${key}`;
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateShort = dateStr.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const contentType = "image/png";
  const contentHash = await sha256Hex(body);

  const headers: Record<string, string> = {
    "content-type": contentType,
    "host": new URL(endpoint).host,
    "x-amz-content-sha256": contentHash,
    "x-amz-date": dateStr,
  };

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join("");
  const canonicalRequest = [
    "PUT",
    `/${bucket}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    contentHash,
  ].join("\n");

  const credentialScope = `${dateShort}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateStr, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const signingKey = await deriveSigningKey(secretKey, dateShort, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, authorization: authHeader },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`R2 upload failed: ${res.status} ${txt.slice(0, 200)}`);
  }
}

// ── Crypto helpers (Web Crypto, available in Node.js 18+) ──
async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | CryptoKey, data: string): Promise<ArrayBuffer> {
  const k = key instanceof ArrayBuffer
    ? await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    : key;
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const sig = await hmac(key, data);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deriveSigningKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secret}`).buffer as ArrayBuffer, date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

// ── POST /api/snapshot ──
// Accepts multipart/form-data with a "file" field (PNG, max 4 MB).
// Returns { url: "/x/<slug>" } on success.
// When R2 env vars are absent, returns 503 with a clear error.
export async function POST(req: Request) {
  // Rate limit by IP — the shared limiter keys on the real visitor behind the CDN
  // (CF-/EO-Connecting-IP), not the CDN edge PoP IP that a raw X-Forwarded-For read returns.
  const rate = rateLimit(req, { name: "snapshot", max: 10 });
  if (!rate.ok) return tooMany(rate);

  // Check R2 config early — 503 before we read the body
  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) {
    return NextResponse.json({ error: "R2 not configured (R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET missing)" }, { status: 503 });
  }

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 }); }

  const file = formData.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Missing file field" }, { status: 400 });

  // Size cap 4 MB
  const MAX_BYTES = 4 * 1024 * 1024;
  const buf = await (file as File).arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Image too large (max 4 MB)" }, { status: 413 });

  const id = slug();
  const key = `snapshots/${id}.png`;

  try {
    await uploadToR2(buf, key);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 502 });
  }

  return NextResponse.json({ url: `/x/${id}` });
}
