// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayResearchAttention from "@/components/workspaces/TodayResearchAttention";
import { readingHref, saveBrowserReadingProgress } from "@/lib/shared-shell/readingProgress";
import type { ReadingSelection } from "@/lib/shared-shell/readingContracts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = "11111111-1111-4111-8111-111111111111";
const langState = vi.hoisted(() => ({ value: "en" as "en" | "zh" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: langState.value }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

const v1: ReadingSelection = { docId: "report-one", sourcePdfSha256: "a".repeat(64), extractedTextSha256: "b".repeat(64), extractorVersion: "research_vault.ingest.extract_pdf_text.v1", segmenterVersion: "page-byte-v1" };
const v2: ReadingSelection = { ...v1, extractedTextSha256: "c".repeat(64), extractorVersion: "research_vault.ingest.extract_pdf_text.v2" };
const two: ReadingSelection = { docId: "report-two", sourcePdfSha256: "d".repeat(64), extractedTextSha256: "e".repeat(64), extractorVersion: "research_vault.ingest.extract_pdf_text.v1", segmenterVersion: "page-byte-v1" };

function body(selection: ReadingSelection, text = "CURRENT SEGMENT TEXT", start = 0, total = 3) {
  return {
    schema: "research_vault.browser_read.v1", report_id: selection.docId,
    selection: { source_pdf_sha256: selection.sourcePdfSha256, extracted_text_sha256: selection.extractedTextSha256, extractor_version: selection.extractorVersion, segmenter_version: selection.segmenterVersion, segment_max_bytes: 4000 },
    source: { catalog_generated_at: "2026-10-20T10:00:00Z", catalog_health: {} }, text_layer_state: "full", segment_count_total: total,
    segments: [{ schema: "research_vault.segment.v1", report_id: selection.docId, source_pdf_sha256: selection.sourcePdfSha256, extracted_text_sha256: selection.extractedTextSha256, extractor_version: selection.extractorVersion, segmenter_version: selection.segmenterVersion, segment_max_bytes: 4000, segment_index: start, page_start: 1, page_end: 1, start_byte: 0, end_byte: new TextEncoder().encode(text).length, segment_text_sha256: "f".repeat(64), replay_state: "EXACT", text }],
  };
}

const item = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, ...extra });
const catalogEnvelope = (items: unknown[], extra: Record<string, unknown> = {}) => ({ available: true, items, ...extra });
const FIVE_ITEMS = [
  item("report-one", "First source report", { institution: "Source desk", published_at: "2026-10-19", summary_points: ["First sentence of the summary.", "Second point never shown."] }),
  item("report-two", "Second source report", { institution: "Other desk", published_at: "2026-10-18", summary_points: ["Other first sentence."] }),
  item("report-three", "Third source report"),
  item("report-four", "Fourth source report", { institution: "Fourth desk" }),
  item("report-five", "Fifth source report", { institution: "Fifth desk" }),
];

type Held = { url: string; init?: RequestInit; resolve: (response: Response) => void };
let held: Held[], root: Root, container: HTMLDivElement, onUnauthenticated: ReturnType<typeof vi.fn>;
let scope: { current: AbortController | null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function flush() { for (let n = 0; n < 6; n++) await act(async () => { await Promise.resolve(); }); }
async function answer(index: number, value: unknown, status = 200) { await act(async () => { held[index].resolve(json(value, status)); }); await flush(); }
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes(text));
  expect(button, text).toBeTruthy();
  await act(async () => button!.click()); await flush();
}
async function clickOpenAt(index: number) {
  const buttons = Array.from(container.querySelectorAll("button")).filter(node => node.textContent?.includes("Check report revision"));
  expect(buttons.length > index, `open button ${index}`).toBeTruthy();
  await act(async () => buttons[index].click()); await flush();
}
async function mount() { await act(async () => root.render(<TodayResearchAttention ownerKey={A} scope={scope} onUnauthenticated={onUnauthenticated} />)); await flush(); }
const links = () => Array.from(container.querySelectorAll("a"));
const candidateLinks = () => links().filter(a => (a.getAttribute("href") || "").includes("segment_start=0"));

beforeEach(() => {
  langState.value = "en";
  onUnauthenticated = vi.fn();
  scope = { current: new AbortController() };
  held = [];
  window.history.replaceState({}, "", "/today");
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(resolve => held.push({ url: String(input), init, resolve }))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("Today research attention", () => {
  it("composes continuation before secondary briefing with one catalog request and unchanged pinned resume",async()=>{
    saveBrowserReadingProgress(A,{selection:v1,segmentStart:7});
    await act(async()=>root.render(<TodayResearchAttention ownerKey={A} scope={scope} onUnauthenticated={onUnauthenticated}
      render={({continuation,briefing})=><div><aside data-slot="continuation">{continuation}</aside><section data-slot="briefing">{briefing}</section></div>}/>));
    await flush();expect(held).toHaveLength(1);await answer(0,catalogEnvelope(FIVE_ITEMS));
    const slots=Array.from(container.querySelectorAll("[data-slot]"));expect(slots.map(node=>node.getAttribute("data-slot"))).toEqual(["continuation","briefing"]);
    expect(slots[0].querySelector("a")?.getAttribute("href")).toBe(readingHref(v1,7));expect(slots[1].textContent).toContain("First source report");
    expect(held.every(request=>request.url==="/api/shared-shell/research/catalog")).toBe(true);
  });
  it("mounting fetches only the catalog, renders at most three real rows, and never reads a report", async () => {
    await mount();
    expect(held).toHaveLength(1);
    expect(held[0].url).toContain("/api/shared-shell/research/catalog");
    await answer(0, catalogEnvelope(FIVE_ITEMS));
    expect(container.textContent).toContain("First source report");
    expect(container.textContent).toContain("Source desk · 2026-10-19");
    expect(container.textContent).toContain("First sentence of the summary.");
    expect(container.textContent).not.toContain("Second point never shown.");
    expect(container.textContent).toContain("Third source report");
    expect(container.textContent).not.toContain("Fourth source report");
    expect(container.textContent).not.toContain("Fifth source report");
    expect(held).toHaveLength(1);
    expect(held.every(call => !call.url.includes("/read/"))).toBe(true);
    expect(links().some(a => a.getAttribute("href") === "/research")).toBe(true);
  });

  it("uses a saved report title outside the three briefing rows without adding catalog clutter", async () => {
    saveBrowserReadingProgress(A, { selection: { ...v1, docId: "report-four" }, segmentStart: 4 });
    await mount(); await answer(0, catalogEnvelope(FIVE_ITEMS));
    const continuation = container.querySelector('section[aria-labelledby$="-continue"]');
    expect(continuation?.querySelector("h3")?.textContent).toBe("Fourth source report");
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(held).toHaveLength(1);
  });

  it("preview and stale catalogs show their own notices plus the server generation line", async () => {
    await mount();
    await answer(0, catalogEnvelope(FIVE_ITEMS.slice(0, 1), { preview: true, stale: true, generated_at: "2026-10-20T10:00:00Z" }));
    expect(container.textContent).toContain("catalog preview");
    expect(container.textContent).toContain("catalog is behind");
    expect(container.textContent).toContain("Catalog generated 2026-10-20T10:00:00Z");
  });

  it("an empty catalog is its own state and keeps the library link", async () => {
    await mount();
    await answer(0, catalogEnvelope([]));
    expect(container.textContent).toContain("No reports are available in the catalog yet");
    expect(links().some(a => a.getAttribute("href") === "/research")).toBe(true);
  });

  it("catalog 503 is a visible unavailable state whose retry refetches only the catalog", async () => {
    await mount();
    await answer(0, {}, 503);
    expect(container.textContent).toContain("unavailable right now");
    expect(container.textContent).not.toContain("No reports are available");
    await click("Retry catalog");
    expect(held).toHaveLength(2);
    expect(held[1].url).toContain("/catalog");
    expect(held[1].url).not.toContain("/read/");
  });

  it("a malformed catalog payload fails loudly instead of falling back to empty", async () => {
    await mount();
    await answer(0, { items: "not-a-list" });
    expect(container.textContent).toContain("unavailable right now");
    expect(container.textContent).not.toContain("No reports are available");
  });

  it.each([402, 403])("catalog %d stays a rights state with a plans link", async status => {
    await mount();
    await answer(0, {}, status);
    expect(container.textContent).toContain("Current access does not permit this research selection");
    expect(links().some(a => a.getAttribute("href") === "/plans.html")).toBeTruthy();
    expect(container.textContent).not.toContain("No reports are available");
  });

  it("catalog 401 invalidates through the parent and exposes no private candidate", async () => {
    expect(saveBrowserReadingProgress(A, { selection: v1, segmentStart: 4 })).toBe(true);
    await mount();
    await answer(0, {}, 401);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("session ended");
    expect(candidateLinks()).toHaveLength(0);
    expect(held.every(call => !call.url.includes("/read/"))).toBe(true);
  });

  it("a changed current tuple keeps the old resume pin and URL while exposing a distinct pinned candidate", async () => {
    expect(saveBrowserReadingProgress(A, { selection: v1, segmentStart: 4 })).toBe(true);
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First source report")]));
    const urlBefore = window.location.href;
    await click("Check current report revision");
    expect(held[1].url).toBe("/api/shared-shell/research/read/report-one?segment_start=0&max_segments=2");
    expect(held[1].url).not.toContain("sha256");
    await answer(1, body(v2, "CURRENT REVISION TEXT"));
    expect(container.textContent).toContain("A different current revision is available");
    expect(container.textContent).toContain("only on this origin and browser profile");
    expect(container.textContent).not.toContain("CURRENT REVISION TEXT");
    expect(links().some(a => a.getAttribute("href") === readingHref(v2, 0))).toBe(true);
    expect(links().some(a => a.getAttribute("href") === readingHref(v1, 4))).toBe(true);
    expect(window.location.href).toBe(urlBefore);
    expect(window.localStorage.length).toBe(2);
  });

  it("the same tuple reports a match and switches nothing", async () => {
    expect(saveBrowserReadingProgress(A, { selection: v1, segmentStart: 2 })).toBe(true);
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First source report")]));
    await click("Check current report revision");
    await answer(1, body(v1));
    expect(container.textContent).toContain("matches the current revision");
    expect(container.textContent).not.toContain("A different current revision is available");
    expect(candidateLinks()).toHaveLength(0);
    expect(links().filter(a => (a.getAttribute("href") || "").includes("segment_start=2"))).toHaveLength(1);
  });

  it("a row action probes the unpinned current read and exposes its exact pinned link", async () => {
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First source report"), item("report-two", "Second source report")]));
    await clickOpenAt(1);
    expect(held[1].url).toBe("/api/shared-shell/research/read/report-two?segment_start=0&max_segments=2");
    await answer(1, body(two));
    expect(links().some(a => a.getAttribute("href") === readingHref(two, 0))).toBe(true);
    expect(container.textContent).not.toContain("A different current revision is available");
  });

  it("allows one charged revision check at a time, including repeated synchronous clicks", async () => {
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First source report"), item("report-two", "Second source report")]));
    const buttons = Array.from(container.querySelectorAll("button")).filter(node => node.textContent?.includes("Check report revision"));
    await act(async () => { buttons[0].click(); buttons[0].click(); buttons[1].click(); }); await flush();
    expect(held).toHaveLength(2);
    expect(buttons.every(button => button.disabled)).toBe(true);
    await answer(1, body(v1));
    expect(buttons.every(button => !button.disabled)).toBe(true);
    await clickOpenAt(1); expect(held).toHaveLength(3); await answer(2, body(two));
    const candidates = candidateLinks(); expect(candidates).toHaveLength(1);
    expect(candidates[0].getAttribute("href")).toBe(readingHref(two, 0));
  });

  it("aborting the owner scope discards the late read without resurrecting state", async () => {
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First")]));
    await clickOpenAt(0);
    await act(async () => { scope.current!.abort(); });
    await act(async () => { held[1].resolve(json(body(v1))); });
    await flush();
    expect(candidateLinks()).toHaveLength(0);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it("an aborted scope also discards the late catalog answer", async () => {
    await mount();
    await act(async () => { scope.current!.abort(); });
    await answer(0, catalogEnvelope(FIVE_ITEMS));
    expect(container.textContent).not.toContain("First source report");
    expect(container.textContent).not.toContain("unavailable right now");
  });

  it("a malformed read response fails loudly instead of fabricating a candidate", async () => {
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First")]));
    await clickOpenAt(0);
    await answer(1, { hello: "world" });
    expect(container.textContent).toContain("could not be confirmed");
    expect(candidateLinks()).toHaveLength(0);
  });

  it("a 429 read reports the server wait without inventing a timer or auto-retrying", async () => {
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First")]));
    await clickOpenAt(0);
    await answer(1, {}, 429);
    expect(container.textContent).toContain("asked you to wait");
    expect(held).toHaveLength(2);
    expect(candidateLinks()).toHaveLength(0);
  });

  it.each([402, 403])("a %d read stays a local rights state with a plans link", async status => {
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First")]));
    await clickOpenAt(0);
    await answer(1, {}, status);
    expect(container.textContent).toContain("Current access does not permit this research selection");
    expect(links().some(a => a.getAttribute("href") === "/plans.html")).toBeTruthy();
    expect(candidateLinks()).toHaveLength(0);
  });

  it("a 401 read invalidates through the parent and keeps no candidate", async () => {
    await mount();
    await answer(0, catalogEnvelope([item("report-one", "First")]));
    await clickOpenAt(0);
    await answer(1, {}, 401);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(candidateLinks()).toHaveLength(0);
  });

  it.each([
    {language:"en",state:"unavailable",status:503,payload:{},copy:"unavailable right now"},
    {language:"zh",state:"unavailable",status:503,payload:{},copy:"研究目录目前不可用"},
    {language:"en",state:"preview and stale",status:200,payload:catalogEnvelope([item("report-one","First")],{preview:true,stale:true}),copy:"catalog preview",other:"catalog is behind"},
    {language:"zh",state:"preview and stale",status:200,payload:catalogEnvelope([item("report-one","First")],{preview:true,stale:true}),copy:"目录预览",other:"目录更新滞后"},
    {language:"en",state:"empty",status:200,payload:catalogEnvelope([]),copy:"No reports are available in the catalog yet"},
    {language:"zh",state:"empty",status:200,payload:catalogEnvelope([]),copy:"目录中暂无可用报告"},
  ] as const)("localizes $state ($language)",async({language,status,payload,copy,...rest})=>{
    langState.value=language;await mount();await answer(0,payload,status);expect(container.textContent).toContain(copy);
    if("other" in rest)expect(container.textContent).toContain(rest.other);
    expect(links().some(a=>a.getAttribute("href")==="/research")).toBe(true);
  });
});
