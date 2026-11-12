// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TranscriptDrawer from "@/components/fin/TranscriptDrawer";
import { LangProvider } from "@/lib/i18n";
import type { Transcript } from "@/lib/fund";
import { canonicalTranscriptBodySha256 } from "@/lib/transcriptSearch";

const edge = vi.hoisted(() => ({ getTx: vi.fn(), verified: vi.fn() }));
vi.mock("@/lib/fund", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/fund")>(), getTx: edge.getTx,
}));
// Observe completion of the real revision check. No unconditional hash success.
vi.mock("@/lib/transcriptSearch", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/transcriptSearch")>();
  return { ...actual, canonicalTranscriptBodySha256: async (value: unknown) => {
    const hash = await actual.canonicalTranscriptBodySha256(value);
    edge.verified(hash);
    return hash;
  } };
});

const transcript: Transcript = {
  schema: "mastermind.tx/v1", ticker: "NVDA", id: "2027Q1", period: "Q1 FY2027",
  date: "2026-05-20", title: "NVDA earnings call",
  segments: [
    { speaker: "Operator", role: "Operator", text: "Welcome to the earnings call." },
    { speaker: "Management", role: "CEO", text: "We will discuss the results." },
    { speaker: "Management", role: "CFO", text: "Verified segment selected by the source result." },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root, host: HTMLDivElement, opener: HTMLButtonElement, foreign: HTMLElement;
let hash: string, revision: ReturnType<typeof deferred<void>>, nextFrame: number;
let frames: Map<number, FrameRequestCallback>;
const scroll = vi.fn();
const drawer = () => document.querySelector<HTMLElement>(".fin-tx-drawer");
const target = () => drawer()?.querySelector<HTMLElement>('.fin-tx-seg[data-segment="3"]');

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); document.documentElement.dataset.lang = "en";
  vi.stubGlobal("crypto", webcrypto);
  hash = (await canonicalTranscriptBodySha256(transcript))!;
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  edge.getTx.mockReset(); edge.verified.mockReset(); scroll.mockClear();
  frames = new Map(); nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("scrollTo", () => {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  opener = document.createElement("button"); opener.textContent = "Open verified source"; document.body.append(opener); opener.focus();
  foreign = document.createElement("article"); foreign.className = "fin-tx-seg"; foreign.dataset.segment = "3"; foreign.tabIndex = -1;
  window.history.replaceState({}, "", "/analysis?symbol=NVDA&page=transcripts");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); opener.remove(); foreign.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});
async function open(expected = hash) {
  revision = deferred<void>(); edge.verified.mockImplementation(() => revision.resolve());
  await act(async () => root.render(<LangProvider><TranscriptDrawer sym="NVDA" id="2027Q1"
    focus={{ segment_index: 2, expected_document_sha256: expected }} onClose={() => root.render(null)} /></LangProvider>));
}
async function frame() {
  expect(frames.size).toBeGreaterThan(0);
  await act(async () => {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16));
  });
}
async function close() {
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(opener);
}

describe("verified transcript focus waits for its own portal", () => {
  it("keeps the cold response path and restores the opener", async () => {
    const response = deferred<Transcript>(); edge.getTx.mockReturnValue(response.promise);
    await open(); expect(drawer()).toBeNull(); await frame();
    expect(document.activeElement).toBe(drawer()?.querySelector('[aria-label="Close transcript"]'));
    await act(async () => { response.resolve(transcript); await revision.promise; });
    expect(document.activeElement).toBe(target());
    expect(scroll.mock.instances).toEqual([target()]);
    await close();
  });

  it.each([false, true])("focuses a fast reopened response after its first frame and ignores the prior copy (foreign target=%s)", async hasForeignTarget => {
    edge.getTx.mockResolvedValue(transcript);
    await open(); await frame(); await act(async () => { await revision.promise; });
    const copy = deferred<void>();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(() => copy.promise) } });
    const button = drawer()!.querySelector<HTMLButtonElement>(".fin-tx-source-actions button")!;
    await act(async () => button.click()); await close();
    if (hasForeignTarget) document.body.append(foreign);
    scroll.mockClear();
    await open(); await act(async () => { await revision.promise; });
    expect(drawer()).toBeNull(); expect(document.activeElement).toBe(opener);
    expect(scroll).not.toHaveBeenCalled();
    await frame();
    expect(document.activeElement).toBe(target());
    expect(scroll.mock.instances).toEqual([target()]);
    await act(async () => copy.reject(new Error("old copy failed")));
    expect(drawer()!.querySelector('.fin-tx-toolbar [role="status"]')?.textContent).toBe("");
    expect(drawer()!.querySelector(".fin-tx-source-actions button")?.textContent).toBe("Copy link");
    await close();
  });

  it("keeps a mismatched revision unavailable and never jumps to an unrelated segment", async () => {
    edge.getTx.mockResolvedValue(transcript); document.body.append(foreign);
    await open("0".repeat(64)); await act(async () => { await revision.promise; }); await frame();
    expect(drawer()!.querySelector('[role="alert"]')?.textContent).toContain("Transcript unavailable");
    expect(target()).toBeNull(); expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(drawer()!.querySelector('[aria-label="Close transcript"]'));
  });
});
