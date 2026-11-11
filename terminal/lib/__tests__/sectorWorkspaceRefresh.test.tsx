// @vitest-environment jsdom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import SectorIntelligenceWorkspace from "@/components/sector-intelligence/SectorIntelligenceWorkspace";
import { SECTOR_FEEDS } from "../sectorIntelligence";
import { nativeGenerationFixture } from "./fixtures/sectorNativeGeneration";
import capturedGeneration from "./fixtures/sector_generation.captured.preview.v1.json";

const session = vi.hoisted(() => ({ identity: { userId: "owner-a", email: "a@example.test" } }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => session.identity }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }) }));
vi.mock("@/lib/sectorIntelligenceLex", () => ({ useSectorT: () => (key: string) => key }));
vi.mock("@/components/ui/MobileSheet", () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <aside>{children}</aside> : null,
}));
vi.mock("@/components/sector-intelligence/SectorCentralDiscovery", () => ({
  default: (props: unknown) => <output data-testid="owner-view">{JSON.stringify(props)}</output>,
}));
vi.mock("@/components/sector-intelligence/SectorRotationMap", () => ({
  ROTATION_BENCHMARK: "SPY",
  default: (props: unknown) => <output data-testid="owner-view">{JSON.stringify(props)}</output>,
}));
vi.mock("@/components/sector-intelligence/FinvizDiscovery", () => ({
  default: (props: unknown) => <output data-testid="owner-view">{JSON.stringify(props)}</output>,
}));
vi.mock("@/components/sector-intelligence/SectorGroupBrowser", () => ({ default: () => null }));
vi.mock("@/components/sector-intelligence/SectorCompanyComparison", () => ({ default: () => null }));
vi.mock("@/components/sector-intelligence/SectorIntradayComparison", () => ({
  default: () => null, useSectorPresentationClock: () => 0,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stamp = "2026-11-03";
function envelope(source: string, name = "Original Technology", asOf = stamp, stale = false) {
  const core = { as_of: asOf, sectors: [{ id: "xlk", ticker: "XLK", name }] };
  const generation = nativeGenerationFixture(core, name);
  if (stale) { generation.qualification = "stale"; generation.projection.receipt.qualification = "stale"; }
  const data = source === "generation" ? generation : source === "sector" ? core
    : source === "confluence" ? { ok: true, subsectors: [], sectors: [] } : {};
  return { data, receipt: { source, status: "ready", path: source === "generation" ? "/api/sector-generation?audience=preview" : "/" + source, asOf,
    observedAt: "2026-11-05T21:00:00Z", contentHash: source + ":" + name, stale } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("Sector workspace owner revalidation", () => {
  let root: Root, host: HTMLDivElement;
  let hidden: boolean;
  let request: MockInstance<typeof fetch>;
  const sourceOf = (input: RequestInfo | URL) => new URL(String(input), "https://example.test").searchParams.get("source")!;
  const render = async (workspace = "rotation", method = "incumbent") => {
    window.history.replaceState(null, "", "/discover?tab=sectors&sectorWorkspace=" + workspace + "&sectorRotationMethod=" + method);
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
  };
  const click = async (key: string) => {
    const button = [...host.querySelectorAll("button")].find(node => node.textContent === key);
    expect(button, key).toBeTruthy();
    await act(async () => button!.click());
  };
  const visible = async () => {
    hidden = false;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-05T21:00:00Z"));
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    session.identity = { userId: "owner-a", email: "a@example.test" };
    request = vi.spyOn(globalThis, "fetch").mockImplementation(async input => Response.json(envelope(sourceOf(input))));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove(); vi.restoreAllMocks(); vi.useRealTimers();
  });

  it("keeps the independent weekly relative-trend method on its legacy source when native evidence is refused", async () => {
    request.mockImplementation(async input => {
      const source = sourceOf(input);
      return source === "generation" ? Response.json({ data: null,
        receipt: { ...envelope(source).receipt, status: "access", contentHash: null } }, { status: 401 })
        : Response.json(envelope(source));
    });
    await render("rotation", "relative_trend_ema");
    const props = JSON.parse(host.querySelector('[data-testid="owner-view"]')!.textContent!);
    expect(props.status).toBe("ready");
    expect(props.rows).toHaveLength(1);
    expect(props.rows[0].name).toBe("Original Technology");
    expect(props.asOf).toBe(stamp);
    expect(props.history).toBeNull();
  });

  it.each(["rotation", "detail"])("keeps the native stale verdict visible beside its %s measurements", async workspace => {
    request.mockImplementation(async input => Response.json(envelope(sourceOf(input), "Original Technology", stamp, true)));
    await render(workspace);
    expect(host.querySelector('[data-testid="sector-generation-qualification"]')?.getAttribute("data-qualification")).toBe("stale");
    expect(host.textContent).toContain("siGenerationStale");
  });

  it("keeps all eleven native identities selectable when the legacy feed contains only Technology", async () => {
    request.mockImplementation(async input => {
      const source = sourceOf(input);
      if (source !== "generation") return Response.json(envelope(source));
      return Response.json({ data: capturedGeneration, receipt: { ...envelope(source).receipt,
        asOf: capturedGeneration.source_session } });
    });
    await render("detail");
    const select = host.querySelector('select[aria-label="siSector"]') as HTMLSelectElement;
    expect(select.options).toHaveLength(11);
    await act(async () => { select.value = "xlu"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(window.location.search).toContain("sector=xlu");
    expect(host.textContent).toContain("XLU");
    expect(host.querySelector('[data-testid="sector-leadership-dossier"]')?.textContent).toContain("XLU");
    expect(host.querySelector('[data-testid="sector-exact-window-returns"]')?.textContent).toContain("XLU");
    await click("siSourcesPanel");
    expect(host.textContent).toContain(capturedGeneration.projection.receipt.generation_id);
    // The legacy discovery source remains one row; it was never replaced by native core.
    expect(request.mock.calls.filter(([input]) => sourceOf(input) === "sector")).toHaveLength(1);
  });

  it("withdraws native evidence while preserving an independently ready legacy view", async () => {
    await render("detail");
    request.mockImplementation(async input => {
      const source = sourceOf(input);
      return source === "generation" ? Response.json({ data: null,
        receipt: { ...envelope(source).receipt, status: "access", contentHash: null } }, { status: 401 })
        : Response.json(envelope(source, "Legacy remains visible"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(host.textContent).toContain("Legacy remains visible");
    expect(host.querySelector('[data-testid="sector-leadership-dossier"]')?.getAttribute("data-state")).toBe("access");
    expect(host.querySelector('[data-testid="sector-dossier-metric"]')).toBeNull();
    expect(host.querySelector('[data-testid="sector-exact-window-returns"]')).toBeNull();
  });

  it.each(["rotation", "discover", "breadth", "detail"])("adopts revised owner feeds in an open %s workspace without changing its selection", async workspace => {
    await render(workspace);
    expect(request).toHaveBeenCalledTimes(SECTOR_FEEDS.length);
    request.mockImplementation(async input => Response.json(envelope(sourceOf(input), "Revised Technology", "2026-11-05")));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(request).toHaveBeenCalledTimes(SECTOR_FEEDS.length * 2);
    for (const source of SECTOR_FEEDS) expect(request.mock.calls.filter(([input]) => sourceOf(input) === source)).toHaveLength(2);
    expect(host.querySelector("main")?.getAttribute("data-sector-workspace")).toBe(workspace);
    expect(host.textContent).toContain("Revised Technology");
    expect(host.textContent).toContain("2026-11-05");
    expect(window.location.search).toContain("sectorWorkspace=" + workspace);
  });

  it("does not poll hidden tabs and reads immediately on resume before the next interval", async () => {
    await render();
    hidden = true;
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(request).toHaveBeenCalledTimes(SECTOR_FEEDS.length);
    await visible();
    expect(request).toHaveBeenCalledTimes(SECTOR_FEEDS.length * 2);
    expect(host.textContent).toContain(stamp);
  });

  it("coalesces a visibility return with pending interval reads", async () => {
    await render();
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    request.mockImplementation(input => {
      const read = deferred<Response>(); pending.set(sourceOf(input), read); return read.promise;
    });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await visible();
    await visible();
    expect(request).toHaveBeenCalledTimes(SECTOR_FEEDS.length * 2);
    await act(async () => {
      for (const [source, read] of pending) read.resolve(Response.json(envelope(source, "Resumed Technology")));
    });
    expect(host.textContent).toContain("Resumed Technology");
  });

  it("times out a stalled read, clears its pending slot and recovers on the next tick", async () => {
    let first = true;
    request.mockImplementation((input, init) => {
      const source = sourceOf(input);
      if (source !== "generation" || !first) return Promise.resolve(Response.json(envelope(source, "Recovered Technology")));
      first = false;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort",
        () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    });
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(host.querySelector("output")?.textContent).toContain('"status":"error"');
    await act(async () => vi.advanceTimersByTimeAsync(50_000));
    expect(host.textContent).toContain("Recovered Technology");
    expect(request.mock.calls.filter(([input]) => sourceOf(input) === "generation")).toHaveLength(2);
  });

  it.each(["sector", "generation"])("cannot apply a prior account %s response even if parsing finishes after abort", async blockedSource => {
    const body = deferred<ReturnType<typeof envelope>>();
    request.mockImplementation(async input => sourceOf(input) === blockedSource
      ? { ok: true, json: () => body.promise } as Response
      : Response.json(envelope(sourceOf(input))));
    await render();
    const priorSignal = request.mock.calls.find(([input]) => sourceOf(input) === blockedSource)?.[1]?.signal;
    session.identity = { userId: "owner-b", email: "b@example.test" };
    request.mockImplementation(async input => Response.json(envelope(sourceOf(input), "Current Owner Technology")));
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
    expect(priorSignal?.aborted).toBe(true);
    expect(host.textContent).toContain("Current Owner Technology");
    await act(async () => body.resolve(envelope(blockedSource, "Prior Owner Technology")));
    expect(host.textContent).not.toContain("Prior Owner Technology");
    expect(host.textContent).toContain("Current Owner Technology");
  });

  it("cancels a departed source family and revalidates only the active family", async () => {
    await render("discover");
    const body = deferred<ReturnType<typeof envelope>>();
    request.mockImplementation(async input => sourceOf(input) === "finviz"
      ? { ok: true, json: () => body.promise } as Response
      : Response.json(envelope(sourceOf(input))));
    await click("siFeedFinviz");
    const priorSignal = request.mock.calls.find(([input]) => sourceOf(input) === "finviz")?.[1]?.signal;
    await click("siFinvizSectors");
    expect(priorSignal?.aborted).toBe(true);
    await act(async () => body.resolve(envelope("finviz", "Private prior source")));
    expect(host.textContent).not.toContain("Private prior source");
    request.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(request.mock.calls.map(([input]) => sourceOf(input))).toEqual([...SECTOR_FEEDS]);
  });

  it("keeps source dates fixed while polling and updates metadata even for unchanged bytes", async () => {
    await render("detail");
    await click("siSourcesPanel");
    expect(host.textContent).not.toContain("siStale");
    request.mockImplementation(async input => Response.json(envelope(sourceOf(input), "Original Technology", stamp, true)));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(host.textContent).toContain("siStale");
    expect(host.textContent).toContain(stamp);
    expect(host.textContent).toContain("2026-11-05T21:00:00Z");
    expect(host.textContent).not.toContain("2026-11-05T21:01:00");
  });

  it("revokes accepted data on an access response instead of retaining an authorized-looking snapshot", async () => {
    await render();
    request.mockImplementation(async input => Response.json({
      data: null, receipt: { ...envelope(sourceOf(input)).receipt, status: "access", contentHash: null },
    }, { status: 401 }));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(host.textContent).not.toContain("Original Technology");
    expect(host.querySelector("output")?.textContent).toContain('"status":"access"');
  });
});
