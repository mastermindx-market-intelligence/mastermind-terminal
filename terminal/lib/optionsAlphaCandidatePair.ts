/** Server-only verifier for the two-object Options Alpha publication contract. */
import { createHash } from "crypto";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import feedSchema from "@/contracts/options/options.alpha_candidate_feed.v2.schema.json";
import receiptSchema from "@/contracts/options/options.alpha_candidate_feed_publication_receipt.v1.schema.json";
import { R2_BASE } from "@/lib/upstreams";

const PAYLOAD_KEY = "options_alpha/candidate_feed.json";
const RECEIPT_KEY = "options_alpha/candidate_feed.receipt.json";
const MAX_BYTES = 2_000_000;
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validFeed = ajv.compile(feedSchema);
const validReceipt = ajv.compile(receiptSchema);

export type CandidatePair = { feed: Record<string, unknown>; receipt: Record<string, unknown>; metadata: Record<string, string> };

function fail(message: string): never { throw new Error(`options-alpha pair invalid: ${message}`); }
function sha(raw: Uint8Array): string { return createHash("sha256").update(raw).digest("hex"); }
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

/** JSON.parse accepts duplicate names; publication contracts never may. */
type RawNode = { start: number; end: number; properties?: Map<string, RawNode> };

/** Parses JSON structurally without changing numeric spellings, and retains value ranges. */
function parseRawJson(text: string, name: string): RawNode {
  if (text.length > MAX_BYTES) fail(`${name} too large`);
  let i = 0;
  const bad = (): never => fail(`${name} is not strict JSON`);
  const string = (): { value: string; start: number; end: number } => {
    const start = i++; let escaped = false;
    while (i < text.length) { const c = text[i++]; if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') break; }
    if (text[i - 1] !== '"') bad();
    try { return { value: JSON.parse(text.slice(start, i)), start, end: i }; } catch { return bad(); }
  };
  const compareCodePoints = (a: string, b: string) => {
    const aa = Array.from(a), bb = Array.from(b); for (let n = 0; n < Math.min(aa.length, bb.length); n++) { const ac = aa[n].codePointAt(0)!, bc = bb[n].codePointAt(0)!; if (ac !== bc) return ac - bc; } return aa.length - bb.length;
  };
  const value = (depth = 0): RawNode => {
    if (depth > 128) fail(`${name} exceeds maximum JSON depth`);
    const start = i;
    if (text[i] === '"') { const s = string(); return { start, end: s.end }; }
    if (text[i] === "{") {
      i++; const properties = new Map<string, RawNode>();
      let previous: string | null = null;
      if (text[i] !== "}") for (;;) {
        if (text[i] !== '"') bad(); const key = string().value;
        if (text[i++] !== ":") bad(); const child = value(depth + 1);
        if (properties.has(key)) fail(`${name} has duplicate key ${key}`); properties.set(key, child);
        if (previous !== null && compareCodePoints(previous, key) > 0) fail(`${name} object keys are not canonical`); previous = key;
        if (text[i] === "}") break; if (text[i++] !== ",") bad();
      }
      i++; return { start, end: i, properties };
    }
    if (text[i] === "[") {
      i++; if (text[i] !== "]") for (;;) { value(depth + 1); if (text[i] === "]") break; if (text[i++] !== ",") bad(); }
      i++; return { start, end: i };
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!match) return bad(); i += match[0].length; return { start, end: i };
  };
  const root = value(); if (i !== text.length) bad(); return root;
}

function strictJson(bytes: Uint8Array, name: string): { data: Record<string, unknown>; root: RawNode } {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(`${name} is not UTF-8`); }
  const root = parseRawJson(text, name);
  try { return { data: object(JSON.parse(text), name), root }; } catch { return fail(`${name} is not JSON`); }
}

// Do not compare parsed data with JSON.stringify: JS rewrites Python's 1.0 to 1.
// Preserve raw numeric lexemes; the payload hash and seal are over source bytes.
function requireCanonicalRaw(bytes: Uint8Array, _parsed: Record<string, unknown>, name: string): void {
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let quoted = false; let escaped = false;
  for (const char of raw) {
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (/\s/.test(char)) fail(`${name} is not compact canonical JSON`);
  }
}

function headerSeal(raw: Uint8Array, root: RawNode): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const value = root.properties?.get("header")?.properties?.get("header_digest_sha256");
  if (!value || text.slice(value.start, value.end).match(/^"[a-f0-9]{64}"$/) === null) fail("header seal field missing");
  const unsealed = `${text.slice(0, value.start)}""${text.slice(value.end)}`;
  return sha(new TextEncoder().encode(unsealed));
}

async function fetchRaw(key: string): Promise<{ raw: Uint8Array; etag: string; lastModified: string }> {
  const response = await fetch(`${R2_BASE}/${key}`, { headers: { "User-Agent": "mastermind-terminal/1.0" }, cache: "no-store", signal: AbortSignal.timeout(3_000) });
  const etag = response.headers.get("etag"); const lastModified = response.headers.get("last-modified");
  if (!response.ok || !etag || !lastModified || Number.isNaN(Date.parse(lastModified))) fail(`${key} unavailable or lacks immutable metadata`);
  const raw = new Uint8Array(await response.arrayBuffer()); if (raw.byteLength > MAX_BYTES) fail(`${key} too large`);
  return { raw, etag, lastModified };
}

export async function fetchOptionsAlphaCandidatePair(): Promise<CandidatePair> {
  const [payload, receiptObject] = await Promise.all([fetchRaw(PAYLOAD_KEY), fetchRaw(RECEIPT_KEY)]);
  const parsedFeed = strictJson(payload.raw, "payload"); const parsedReceipt = strictJson(receiptObject.raw, "receipt");
  const feed = parsedFeed.data; const receipt = parsedReceipt.data;
  requireCanonicalRaw(payload.raw, feed, "payload"); requireCanonicalRaw(receiptObject.raw, receipt, "receipt");
  if (!validFeed(feed)) fail(`feed schema: ${ajv.errorsText(validFeed.errors)}`);
  if (!validReceipt(receipt)) fail(`receipt schema: ${ajv.errorsText(validReceipt.errors)}`);
  const header = object(feed.header, "feed.header"); const r2 = object(receipt.r2, "receipt.r2");
  if (receipt.feed_id !== feed.feed_id || receipt.feed_schema !== feed.schema) fail("feed identity mismatch");
  if (receipt.payload_sha256 !== sha(payload.raw) || receipt.payload_bytes !== payload.raw.byteLength || r2.payload_sha256 !== receipt.payload_sha256) fail("payload raw hash or size mismatch");
  const expectedReceiptId = `oacfr_${sha(new TextEncoder().encode(`options.alpha_candidate_feed_publication_receipt/v1|${receipt.payload_sha256}`)).slice(0, 25)}`;
  if (receipt.receipt_id !== expectedReceiptId) fail("receipt identity mismatch");
  if (r2.payload_key !== PAYLOAD_KEY || r2.etag !== payload.etag) fail("payload R2 binding mismatch");
  const campaigns = object(object(feed.source_receipts, "feed.source_receipts").campaigns, "feed.source_receipts.campaigns");
  const prefix = object(receipt.campaign_prefix, "receipt.campaign_prefix");
  if (prefix.path !== campaigns.path || prefix.records !== campaigns.records || prefix.prefix_sha256 !== campaigns.prefix_sha256) fail("campaign prefix mismatch");
  const formed = feed.formed_candidates;
  if (!Array.isArray(formed) || !Array.isArray(feed.abstentions) || header.formed_candidate_count !== formed.length || header.abstention_count !== feed.abstentions.length) fail("feed counts mismatch");
  const formedIds = new Set(formed.map((item) => object(item, "formed candidate").candidate_id));
  const receiptCandidates = object(receipt.candidates, "receipt.candidates");
  if (formedIds.size !== formed.length || Object.keys(receiptCandidates).length !== formedIds.size || Object.keys(receiptCandidates).some((id) => !formedIds.has(id))) fail("receipt candidate map mismatch");
  const utc = (value: unknown): number => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) ? Date.parse(value) : Number.NaN;
  const generated = utc(feed.generated_at), durability = utc(receipt.local_durability_confirmed_at), confirmation = utc(receipt.payload_r2_confirmed_at), external = Date.parse(receiptObject.lastModified);
  if (![generated, durability, confirmation, external].every(Number.isFinite) || generated > durability || durability > confirmation) fail("receipt clock ordering mismatch");
  const prior = receipt.prior_receipt;
  if (prior !== null && object(prior, "receipt.prior_receipt").receipt_id === receipt.receipt_id) fail("receipt self prior");
  for (const [id, entryValue] of Object.entries(receiptCandidates)) {
    const entry = object(entryValue, `receipt candidate ${id}`);
    if (entry.first_receipt_id === receipt.receipt_id) { if (entry.first_consumer_published_at !== null) fail("current first receipt clock mismatch"); }
    else { const first = utc(entry.first_consumer_published_at); if (prior === null || !Number.isFinite(first) || first > external) fail("historical receipt clock mismatch"); }
  }
  if (header.header_digest_sha256 !== headerSeal(payload.raw, parsedFeed.root)) fail("header seal mismatch");
  // Last-Modified is external evidence for a newly-current receipt, not a clock to order
  // against producer confirmation. It is the only clock a client may use to resolve a current
  // candidate's null first_consumer_published_at; this server never writes it into source data.
  return { feed, receipt, metadata: { payload_etag: payload.etag, payload_last_modified: payload.lastModified, receipt_etag: receiptObject.etag, receipt_last_modified: receiptObject.lastModified, served_at: new Date().toISOString() } };
}
