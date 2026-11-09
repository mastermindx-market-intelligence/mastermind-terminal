import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readingJson } from "@/lib/shared-shell/useReadingScope";
vi.mock("@/lib/supabase/client",()=>({createClient:vi.fn()}));
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("bounds a hanging fetch and aborts its exact request",async()=>{
 let signal:AbortSignal|undefined;
 vi.stubGlobal("fetch",vi.fn((_url:string,init:RequestInit)=>{signal=init.signal!;return new Promise(()=>{});}));
 const pending=readingJson({current:new AbortController()},"/api/shared-shell/today");
 const failure=expect(pending).rejects.toThrow("read deadline");await vi.advanceTimersByTimeAsync(18000);await failure;expect(signal?.aborted).toBe(true);
});
it("bounds a hanging JSON body after headers arrived",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>({json:()=>new Promise(()=>{})})));
 const pending=readingJson({current:new AbortController()},"/api/shared-shell/research/catalog");
 const failure=expect(pending).rejects.toThrow("read deadline");await vi.advanceTimersByTimeAsync(18000);await failure;
});
it("a subject abort ends a hanging JSON body immediately",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>({json:()=>new Promise(()=>{})})));
 const controller=new AbortController(),pending=readingJson({current:controller},"/api/shared-shell/today");
 const failure=expect(pending).rejects.toThrow("inactive");controller.abort();await failure;
});

import { describe } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readingBody } from "@/lib/shared-shell/readingPayloads";
import { researchReadQuery } from "@/lib/shared-shell/readingRequests";
import { sourcePageDestinations } from "@/lib/shared-shell/researchOutline";
import manifest from "./fixtures/research-producer-interface/manifest.json";

// The identity hook is never mounted. This pure transport/parser check must not
// acquire a principal, session or provider; only retained synthetic HTTP bytes.
const docId = "bernstein-2026-07-21-dc-pipeline";
type Case = { file: string; sha256: string; status: number; headers: Record<string, string>; query: Record<string, string | number>; reportId: string };
const cases = manifest.cases as Record<string, Case>;
function bytes(name: string) {
  const item = cases[name];
  const raw = readFileSync(new URL(`./fixtures/research-producer-interface/${item.file}`, import.meta.url));
  expect(createHash("sha256").update(raw).digest("hex")).toBe(item.sha256);
  return raw;
}
function body(name: string) { return JSON.parse(bytes(name).toString("utf8")); }
async function consume(name: string, pinned: ReturnType<typeof readingBody> = null) {
  const item = cases[name], start = Number(item.query.segment_start ?? 0), requestDocId = item.reportId;
  const query = pinned ? researchReadQuery(pinned.selection, start) : new URLSearchParams({ segment_start: "0", max_segments: "2" });
  const url = `/api/shared-shell/research/read/${requestDocId}?${query}`;
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(input).toBe(url);
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (pinned) {
      expect(query.get("source_pdf_sha256")).toBe(item.query.source_pdf_sha256);
      expect(query.get("extracted_text_sha256")).toBe(item.query.extracted_text_sha256);
    }
    expect(query.get("segment_start")).toBe(String(start));
    expect(query.get("max_segments")).toBe(String(item.query.max_segments));
    return new Response(bytes(name).toString("utf8"), { status: item.status, headers: item.headers });
  });
  vi.stubGlobal("fetch", request);
  const { response, value } = await readingJson({ current: new AbortController() }, url);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(request).toHaveBeenCalledTimes(1);
  const parsed = readingBody(value, requestDocId, pinned?.selection ?? null, start);
  expect(parsed).not.toBeNull();
  const sourceValue = body(name);
  expect(value).toEqual(sourceValue);
  return { parsed: parsed!, value: sourceValue };
}

describe("frozen real Research handler HTTP bytes to incumbent reader", () => {
  it("accepts the first canonical window and complete supplied source-page map", async () => {
    const { parsed, value } = await consume("first");
    expect(parsed.selection.docId).toBe(docId);
    expect(parsed.segments).toEqual(value.segments);
    expect(parsed.segments[0].segment_index).toBe(0);
    expect(parsed.outline).toEqual(value.outline);
    expect(parsed.outline).toHaveLength(value.segment_count_total);
    expect(parsed.total).toBeGreaterThan(parsed.segments.length);
    expect(parsed.catalogGeneratedAt).toBe("2026-10-20T06:00:00Z");
    expect(sourcePageDestinations(parsed.outline!)).not.toHaveLength(0);
    expect(parsed.outline![0].page_start).toBe(1);
    expect(parsed.outline!.at(-1)?.page_end).toBe(5);
  });
  it("accepts the real pinned continuation with exact identity, full map and original clock", async () => {
    const first = readingBody(body("first"), docId, null, 0)!;
    const { parsed, value } = await consume("continuation", first);
    expect(parsed.selection).toEqual(first.selection);
    expect(parsed.outline).toEqual(first.outline);
    expect(parsed.catalogGeneratedAt).toBe(first.catalogGeneratedAt);
    const start = Number(cases.continuation.query.segment_start);
    expect(start).toBeGreaterThan(0);
    expect(parsed.segments[0].segment_index).toBe(start);
    expect(parsed.segments).toEqual(value.segments);
    expect(parsed.outline![start]).toEqual({ segment_index: start, page_start: parsed.segments[0].page_start, page_end: parsed.segments[0].page_end });
  });
  it("accepts the producer's all-or-omit response without fabricating unavailable source-page metadata", async () => {
    const sample = body("omitted"), start = Number(cases.omitted.query.segment_start ?? 0);
    const current = readingBody(sample, docId, null, start)!;
    const { parsed, value } = await consume("omitted", current);
    expect(value).not.toHaveProperty("outline");
    expect(parsed).not.toHaveProperty("outline");
    expect(parsed.segments.length).toBeGreaterThan(0);
    expect(parsed.segments).toEqual(value.segments);
    expect(sourcePageDestinations(parsed.outline ?? [])).toEqual([]);
  });
  it("keeps the actual no-text response empty and does not invent a page map", async () => {
    const { parsed, value } = await consume("none");
    expect(value).not.toHaveProperty("outline");
    expect(parsed.outline).toBeUndefined();
    expect(parsed.total).toBe(0);
    expect(parsed.segments).toEqual([]);
    expect(parsed.textLayer).toBe("none");
  });
  it("rejects real response bytes at the wrong continuation window or different selected revision", () => {
    const first = readingBody(body("first"), docId, null, 0)!;
    const raw = body("continuation"), start = Number(cases.continuation.query.segment_start);
    expect(readingBody(raw, docId, first.selection, start + 1)).toBeNull();
    expect(readingBody(raw, docId, { ...first.selection, extractedTextSha256: "0".repeat(64) }, start)).toBeNull();
  });
  it("rejects a supplied map inconsistent with the actual visible source range", () => {
    const raw = body("first");
    raw.outline[0].page_end += 1;
    expect(readingBody(raw, docId, null, 0)).toBeNull();
  });
});
