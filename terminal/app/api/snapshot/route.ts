import { NextResponse } from "next/server";
import { rateLimit, tooMany } from "@/lib/rateLimit";
import { validatePng } from "@/lib/pngValidate";

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
    // Log the provider's own words server-side; never put them in the throw. This message used to
    // carry 200 chars of R2's response straight back to the browser via `e?.message`, which on an
    // InvalidAccessKeyId / SignatureDoesNotMatch response means the bucket name, the endpoint host
    // and the access key id — handed to whoever POSTed a file.
    const txt = await res.text().catch(() => "");
    console.error(`[snapshot] R2 upload failed: ${res.status} ${txt.slice(0, 500)}`);
    throw new Error("upload_unavailable");
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
//
// This is an INGRESS BOUNDARY: it takes anonymous bytes from the internet and stores them under our
// own bucket domain, served as an image. It previously accepted whatever arrived — the only check
// was a length, and it ran AFTER the whole body had been materialised. A JS file, a ZIP, an HTML
// document or 4 MB of zeros all became a "chart snapshot" on our CDN.
//
// The order below is the security property, not a style preference. Each step is cheaper than the
// one after it, and every rejection happens before the expense it would have caused:
//
//   1. rate limit                        — before any body read
//   2. R2 config                         — 503 before reading a body we could not store anyway
//   3. Content-Length                    — reject an oversized body from its header, before parsing
//   4. parse multipart
//   5. File.size                         — BEFORE arrayBuffer(), so an oversized file never gets a
//                                          second full-size copy made of it
//   6. declared MIME                     — advisory only; the client writes it, so it is a courtesy
//                                          check that produces a better error, never evidence
//   7. PNG structure                     — the actual proof, read from the bytes
//   8. R2                                — only now
//
// No R2 call is made for any rejected body.
const MAX_BYTES = 4 * 1024 * 1024;
// multipart framing (boundaries, headers, CRLFs) around a single part. Small and bounded — it
// exists so a legitimate 4 MB file is not rejected by its own envelope.
const MULTIPART_OVERHEAD = 8 * 1024;

// Stable public error codes. The client gets these; diagnostics go to the server log.
const fail = (code: string, status: number) =>
  NextResponse.json({ code }, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  // Rate limit by IP — the shared limiter keys on the real visitor behind the CDN
  // (CF-/EO-Connecting-IP), not the CDN edge PoP IP that a raw X-Forwarded-For read returns.
  const rate = rateLimit(req, { name: "snapshot", max: 10 });
  if (!rate.ok) return tooMany(rate);

  // R2 config — 503 before we read the body. The env var NAMES used to be in the response; that is
  // infrastructure detail and it is now log-only.
  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) {
    console.error("[snapshot] R2 not configured (R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET)");
    return fail("upload_unavailable", 503);
  }

  // Reject on the declared length before parsing anything. Absent or unparseable Content-Length is
  // NOT a rejection — it is normal for chunked encoding — the size checks below still bound it.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES + MULTIPART_OVERHEAD) return fail("too_large", 413);

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return fail("invalid_body", 400); }

  const file = formData.get("file");
  if (!file || typeof file === "string") return fail("invalid_body", 400);

  // BEFORE arrayBuffer(). Reading a 4 MB+ file into an ArrayBuffer just to measure it doubles the
  // peak allocation of the exact request we are about to refuse.
  if ((file as File).size > MAX_BYTES) return fail("too_large", 413);

  // Advisory only. The client writes this header, so a wrong value earns a clearer error while a
  // right one proves nothing — validatePng below is what actually decides.
  const declaredType = (file as File).type;
  if (declaredType && declaredType !== "image/png") return fail("invalid_png", 415);

  const buf = await (file as File).arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return fail("too_large", 413); // re-check: `size` is client metadata

  const png = validatePng(new Uint8Array(buf));
  if (!png.ok) return fail(png.code === "not_png" ? "invalid_png" : png.code, 415);

  const id = slug();
  const key = `snapshots/${id}.png`;

  try {
    await uploadToR2(buf, key);
  } catch {
    // uploadToR2 logs the provider's response; the public answer stays stable and generic.
    return fail("upload_unavailable", 502);
  }

  return NextResponse.json({ url: `/x/${id}` }, { headers: { "cache-control": "no-store" } });
}
