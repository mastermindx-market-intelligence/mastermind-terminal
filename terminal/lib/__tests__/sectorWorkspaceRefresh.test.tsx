// @vitest-environment jsdom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import SectorIntelligenceWorkspace from "@/components/sector-intelligence/SectorIntelligenceWorkspace";
import { SECTOR_FEEDS } from "../sectorIntelligence";
import { SECTOR_GENERATION_PATH, SECTOR_GENERATION_PREVIEW_PATH } from "../sectorNativeGeneration";
import { nativeGenerationFixture } from "./fixtures/sectorNativeGeneration";
import { syntheticCycleHistory } from "./fixtures/sectorCycleHistory";
import capturedGeneration from "./fixtures/sector_generation.captured.preview.v1.json";
import entitledBlocksJson from "./fixtures/typed_blocks_entitled.json";

const session = vi.hoisted(() => ({ identity: { kind: "account" as const, userId: "owner-a", email: "a@example.test" } }));
const appearance = vi.hoisted(() => ({ theme: null as "dark" | "light" | null }));
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({
  useOptionalSharedShellPresentation: () => appearance.theme ? { context: { theme: appearance.theme } } : null,
}));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => session.identity }));
// ZH without mounting LangProvider (same approach as sectorNativeRowMount):
// the depth lexicon resolves its locale through this override.
const G = globalThis as unknown as { __SI_REFRESH_LANG?: "en" | "zh" };
G.__SI_REFRESH_LANG = "en";
vi.mock("@/lib/i18n", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return { ...m, useLang: () => ({ lang: G.__SI_REFRESH_LANG ?? "en" }) };
});
vi.mock("@/lib/sectorIntelligenceLex", async original => ({
  ...await original<typeof import("@/lib/sectorIntelligenceLex")>(),
  useSectorT: () => (key: string) => key,
}));
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

/** R4 fixture law: the capture is a PREVIEW document and is never modified.
 * The entitled round is a clone with both audience labels flipped and the five
 * real producer specimens planted; the lapsed round is the same capture
 * carrying the five audience_not_entitled stubs the owner serves a
 * non-entitled member. */
const entitledBlocks = entitledBlocksJson as Record<string, { status: string; reason: string | null; value: unknown }>;
const entitledDoc = () => {
  const doc = structuredClone(capturedGeneration) as typeof capturedGeneration & { audience: string };
  doc.audience = "entitled";
  (doc.projection.data as Record<string, unknown>).audience = "entitled";
  (doc.projection.data as Record<string, unknown>).typed_blocks = structuredClone(entitledBlocks);
  return doc;
};
const previewDoc = () => {
  const doc = structuredClone(capturedGeneration);
  (doc.projection.data as Record<string, unknown>).typed_blocks = Object.fromEntries(
    ["confluence_universe_sp500", "confluence_universe_nasdaq", "confluence_universe_russell",
      "confluence_universe_baskets", "theme_rows"].map(name =>
      [name, { status: "unavailable", reason: "audience_not_entitled", value: null }]));
  return doc;
};

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
    appearance.theme = null;
    // All selectors in this harness use codec-admitted simple sector ids.
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-05T21:00:00Z"));
    // jsdom has no matchMedia; the calls board's phone-disclosure query needs it.
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
          matches: false, media: query, onchange: null,
          addListener: () => {}, removeListener: () => {},
          addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
        }),
      });
    }
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    session.identity = { kind: "account" as const, userId: "owner-a", email: "a@example.test" };
    request = vi.spyOn(globalThis, "fetch").mockImplementation(async input => Response.json(envelope(sourceOf(input))));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    G.__SI_REFRESH_LANG = "en";
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });

  const historyEnvelope = (patch: Record<string, unknown> = {}) => ({ data: syntheticCycleHistory, receipt: {
    source: "history", status: "ready", path: "/sectordata/sector_cycles.json", asOf: "2026-11-12",
    observedAt: "2026-11-13T00:00:00Z", contentHash: "a".repeat(64), stale: false, ...patch,
  } });
  const historyRequests = () => request.mock.calls.filter(([input]) => sourceOf(input) === "history");

  it("opens only the history feeds, keeps host selection and restores Back focus without refetch", async () => {
    request.mockImplementation(async input => Response.json(sourceOf(input) === "history" ? historyEnvelope() : envelope(sourceOf(input))));
    vi.mocked(window.requestAnimationFrame).mockImplementation(callback => { callback(0); return 1; });
    const original = "/sectors?workspaceMarket=us&sectorWorkspace=cycles&sector=xlk&sectorJob=brief&sectorSource=finviz";
    const metadata = { next: "retained" };
    window.history.replaceState(metadata, "", original);
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
    expect(request.mock.calls.map(([input]) => sourceOf(input)).sort()).toEqual(["events", "history"]);
    expect(host.querySelector('[data-testid="cycle-chart-panel"]')).not.toBeNull();
    const choose = host.querySelector<HTMLButtonElement>('[data-sector-choice="xlf"]')!;
    await act(async () => { choose.focus(); choose.click(); });
    expect(new URLSearchParams(window.location.search).get("sector")).toBe("xlf");
    expect(window.history.state.next).toBe("retained");
    expect(host.querySelector('[data-testid="cycle-hero"]')?.textContent).toContain("Financials");
    expect(document.activeElement?.getAttribute("data-sector-choice")).toBe("xlf");
    expect(historyRequests()).toHaveLength(1);
    await act(async () => {
      window.history.replaceState(metadata, "", original);
      window.dispatchEvent(new PopStateEvent("popstate", { state: metadata }));
    });
    expect(host.querySelector('[data-testid="cycle-hero"]')?.textContent).toContain("Technology");
    expect(document.activeElement?.getAttribute("data-sector-choice")).toBe("xlk");
    expect(historyRequests()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(historyRequests()).toHaveLength(2);
  });

  it.each(["control", "popstate"])("restores the Cycle dossier opener after history rebind through %s", async way => {
    const returned = deferred<Response>();
    let reads = 0;
    request.mockImplementation(async input => sourceOf(input) === "history"
      ? ++reads === 3 ? returned.promise : Response.json(historyEnvelope())
      : Response.json(envelope(sourceOf(input))));
    vi.mocked(window.requestAnimationFrame).mockImplementation(callback => { callback(0); return 1; });
    const original = "/sectors?workspaceMarket=us&sectorWorkspace=cycles&sector=xlk";
    window.history.replaceState(null, "", original);
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
    const opener = host.querySelector<HTMLButtonElement>('[data-sector-return-focus="cycle-dossier"]')!;
    await act(async () => { opener.focus(); opener.click(); });
    expect(host.querySelector('[data-testid="sector-native-dossier"]')).not.toBeNull();
    if (way === "control") await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="sector-native-dossier-back"]')!.click());
    else await act(async () => {
      window.history.replaceState(null, "", original);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(host.querySelector('[data-testid="cycle-chart-panel"]')).toBeNull();
    await act(async () => returned.resolve(Response.json(historyEnvelope())));
    expect(host.querySelector('[data-testid="cycle-hero"]')?.textContent).toContain("Technology");
    expect(document.activeElement).toBe(host.querySelector('[data-sector-return-focus="cycle-dossier"]'));
    expect(window.location.search).toContain("sectorWorkspace=cycles");
    expect(window.location.search).toContain("sector=xlk");
  });

  it("updates same-byte stale metadata, retires a replacement hash and withdraws denied readings", async () => {
    let receipt: Record<string, unknown> = {};
    request.mockImplementation(async input => Response.json(sourceOf(input) === "history" ? historyEnvelope(receipt) : envelope(sourceOf(input))));
    await render("cycles");
    const slider = () => host.querySelector<HTMLInputElement>('input[type="range"][aria-valuetext]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider(), "2");
      slider().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(slider().value).toBe("2");
    receipt = { stale: true }; await visible();
    expect(host.textContent).toContain("Historical snapshot");
    expect(slider().value).toBe("2");
    receipt = { contentHash: "b".repeat(64) }; await visible();
    expect(slider().value).not.toBe("2");
    receipt = { status: "access" }; await visible();
    expect(host.querySelector('[data-testid="cycle-chart-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="cycle-history-unavailable"]')?.textContent).toContain("siStatusAccess");
  });

  it("keeps an unknown URL sector explicit until the reader chooses an admitted identity", async () => {
    request.mockImplementation(async input => Response.json(sourceOf(input) === "history" ? historyEnvelope() : envelope(sourceOf(input))));
    window.history.replaceState(null, "", "/sectors?sectorWorkspace=cycles&sector=ghost");
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
    expect(host.querySelector('[data-testid="cycle-history-unknown-sector"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="cycle-chart-panel"]')).toBeNull();
    expect(window.location.search).toContain("sector=ghost");
    const select = host.querySelector<HTMLSelectElement>('[data-testid="cycle-history-unknown-sector"] select')!;
    await act(async () => { select.value = "xlf"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector('[data-testid="cycle-hero"]')?.textContent).toContain("Financials");
    expect(window.location.search).toContain("sector=xlf");
  });

  it("never attaches a previous actor's late history to the next account", async () => {
    const old = deferred<Response>();
    let reads = 0;
    request.mockImplementation(async input => sourceOf(input) === "history"
      ? ++reads === 1 ? old.promise : Response.json(historyEnvelope({ status: "access" }))
      : Response.json(envelope(sourceOf(input))));
    await render("cycles");
    session.identity = { kind: "account", userId: "owner-b", email: "b@example.test" };
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
    await act(async () => old.resolve(Response.json(historyEnvelope())));
    expect(host.querySelector('[data-testid="cycle-chart-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="cycle-history-unavailable"]')?.textContent).toContain("siStatusAccess");
    expect(historyRequests()).toHaveLength(2);
  });

  it.each(["/sectors", "/discover?tab=sectors&sectorWorkspace=discover"])("uses the shell theme at %s without rewriting legacy state or refetching sources", async href => {
    appearance.theme = "light";
    const url = href + (href.includes("?") ? "&" : "?") + "sectorTheme=dark";
    const retained = { mmxSectorDepthReturn: "retained", unrelated: "retained" };
    window.history.replaceState(retained, "", url);
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
    expect(host.querySelectorAll("main")).toHaveLength(1);
    expect(host.querySelector("main")?.id).toBe("shared-shell-content");
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")?.textContent).toBe("siNativeTitle");
    expect(host.querySelector("main")?.dataset.sectorTheme).toBe("light");
    expect(host.textContent).not.toContain("siUseLight"); expect(host.textContent).not.toContain("siUseDark");
    const reads = request.mock.calls.length;
    appearance.theme = "dark";
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
    expect(host.querySelector("main")?.dataset.sectorTheme).toBe("dark");
    expect(request.mock.calls).toHaveLength(reads);
    expect(window.location.pathname + window.location.search).toBe(url);
    expect(window.history.state).toEqual(retained);
  });

  it("preserves the standalone sector theme control", async () => {
    await render("discover");
    expect(host.querySelector("h1")?.textContent).toBe("siTitle");
    expect(host.querySelector("main")?.dataset.sectorTheme).toBe("dark");
    await click("siUseLight");
    expect(host.querySelector("main")?.dataset.sectorTheme).toBe("light");
    expect(new URLSearchParams(window.location.search).get("sectorTheme")).toBe("light");
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
    session.identity = { kind: "account" as const, userId: "owner-b", email: "b@example.test" };
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

  it.each([
    ["en", "Not included in your current subscription."],
    ["zh", "当前订阅不包含此读数。"],
  ])("R4: a member whose entitlement lapsed gets the preview and no row value survives (%s)", async (lang, card) => {
    G.__SI_REFRESH_LANG = lang as "en" | "zh";
    request.mockImplementation(async input => {
      const source = sourceOf(input);
      if (source !== "generation") return Response.json(envelope(source));
      return Response.json({ data: entitledDoc(), receipt: { source, status: "ready",
        path: SECTOR_GENERATION_PATH, asOf: capturedGeneration.source_session,
        observedAt: "2026-11-05T21:00:00Z", contentHash: "generation:entitled", stale: false } });
    });
    window.history.replaceState(null, "",
      "/discover?tab=sectors&sectorWorkspace=detail&sectorJob=research&sectorView=drivers&sector=xlk");
    await act(async () => root.render(<SectorIntelligenceWorkspace />));
    // Entitled round: the member had the five row tables.
    expect(host.textContent).toContain("Software - Application");
    expect(host.querySelector('[data-theme-rows="true"]')!.querySelectorAll("tbody tr")).toHaveLength(49);
    // SAME identity, entitlement lapsed server-side: the next revalidation
    // serves the preview document with the five audience stubs.
    request.mockImplementation(async input => {
      const source = sourceOf(input);
      if (source !== "generation") return Response.json(envelope(source));
      return Response.json({ data: previewDoc(), receipt: { source, status: "ready",
        path: SECTOR_GENERATION_PREVIEW_PATH, asOf: capturedGeneration.source_session,
        observedAt: "2026-11-05T22:00:00Z", contentHash: "generation:preview", stale: false } });
    });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    // No row value survives — not in the DOM, and never from the prior state.
    expect(host.textContent).not.toContain("Software - Application");
    expect(host.textContent).not.toContain("Memory, HBM & Storage");
    expect(host.querySelector('[data-theme-rows="true"]')).toBeNull();
    // The five readers show the bilingual subscription card instead.
    expect(host.querySelector("[data-universe]")).not.toBeNull();
    expect(host.textContent).toContain(card);
    for (const id of ["nasdaq", "russell", "baskets"]) {
      await act(async () => { host.querySelector<HTMLButtonElement>(`[data-universe="${id}"]`)?.click(); });
      expect(host.textContent, `tab ${id}`).toContain(card);
    }
  });
});
