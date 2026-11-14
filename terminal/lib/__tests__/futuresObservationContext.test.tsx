// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FUTURES_REQUEST, type FuturesRequest } from "../futuresRequest";
import { parseFuturesPublishedView, type FuturesPublishedView } from "../futuresTransport";
import { browserFuturesFixture } from "../../e2e/fixtures/futuresPublished";
import FuturesWorkspaceView from "@/components/futures/FuturesWorkspaceView";

const owner = vi.hoisted(() => ({ identity: { kind: "user", userId: "account-a", email: "a@example.test" }, lang: "en" }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => owner.identity }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: owner.lang }), applyLang: vi.fn() }));
vi.mock("@/components/futures/FuturesMicrostructureChart", () => ({ default: () => createElement("div", { "data-testid": "test-chart" }) }));
vi.mock("@/components/futures/FuturesCotPanel", () => ({ default: () => null }));

let root: Root | undefined;
let host: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
let response: (request: FuturesRequest) => Promise<Response>;
const utc = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace(/(?:\.000)?Z$/, " UTC");
const query = (id: string) => host.querySelector('[data-testid="' + id + '"]');
const text = (id: string) => query(id)?.textContent ?? "";
const valid = (data: FuturesPublishedView) => {
  const parsed = parseFuturesPublishedView(data, data.request, Date.now());
  if (!parsed) throw Error("invalid_context_fixture");
  return parsed;
};
async function render(request: FuturesRequest = DEFAULT_FUTURES_REQUEST) {
  await act(async () => { root!.render(createElement(FuturesWorkspaceView, { initialRequest: request })); });
}
async function refresh() {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Refresh source");
  await act(async () => { button!.click(); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  owner.identity = { kind: "user", userId: "account-a", email: "a@example.test" }; owner.lang = "en";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  response = async request => new Response(JSON.stringify(browserFuturesFixture(request)));
  fetcher = vi.fn(async (url: string) => {
    const p = new URL(url, "http://localhost").searchParams;
    const request = { ...DEFAULT_FUTURES_REQUEST, pair: p.get("pair") as "ES" | "NQ",
      cutoffMs: p.has("at") ? Number(p.get("at")) : null };
    return response(request);
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); }); root = undefined; host.remove();
  vi.unstubAllGlobals(); vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("mounted Futures observation context through the existing validated reader", () => {
  it("keeps a between-observations request distinct from the selected publication cutoff", async () => {
    const first = browserFuturesFixture(DEFAULT_FUTURES_REQUEST).replayCutoffsMs[0];
    const requested = first + 30123;
    await render({ ...DEFAULT_FUTURES_REQUEST, cutoffMs: requested });
    expect(text("futures-requested-cutoff")).toBe(utc(requested));
    expect(text("futures-selected-cutoff")).toBe(utc(first));
    expect((host.querySelector('select[aria-label="Published replay frames"]') as HTMLSelectElement).value).toBe(String(first));
    expect(window.location.search).not.toContain(String(first));
  });
  it("separates historical latest intent, source/publication clocks and freshness metadata", async () => {
    const data = browserFuturesFixture(DEFAULT_FUTURES_REQUEST); data.publishedAtMs = data.sourceAsOfMs + 86400000 + 123;
    response = async () => new Response(JSON.stringify(valid(data)));
    await render();
    expect(text("futures-requested-cutoff")).toBe("Latest published frame");
    expect(text("futures-basis")).toContain("Historical source");
    expect(text("futures-source-asof")).toBe(utc(data.sourceAsOfMs));
    expect(text("futures-published-at")).toBe(utc(data.publishedAtMs));
    expect(text("futures-fresh-until")).toBe(utc(data.freshUntilMs));
    expect(text("futures-availability")).toContain("Retrospective vendor capture");
    expect(text("futures-freshness-note")).toContain("Historical observations");
    expect(query("futures-unavailable")).toBeNull();
  });
  it("reports actual loaded intervals separately from later retained selections and selected cutoff", async () => {
    const data = browserFuturesFixture(DEFAULT_FUTURES_REQUEST); data.frames = data.frames.slice(0, 2);
    response = async () => new Response(JSON.stringify(valid(data)));
    await render();
    expect(text("futures-loaded-bounds")).toContain(utc(Number(BigInt(data.frames[0].bar.startNs) / BigInt(1000000))));
    expect(text("futures-loaded-bounds")).toContain(utc(data.frames[1].endMs));
    expect(text("futures-loaded-bounds")).not.toContain(utc(data.cutoffMs));
    expect(text("futures-retained-bounds")).toContain(utc(data.replayCutoffsMs.at(-1)!));
    expect(text("futures-loaded-count")).toBe("Intervals: 2");
    expect(text("futures-retained-count")).toBe("Selections: 2");
  });
  it("keeps the source trading session when loaded UTC intervals cross midnight", async () => {
    const data = browserFuturesFixture(DEFAULT_FUTURES_REQUEST);
    const shift = Date.parse("2026-10-08T23:50:00Z") - Number(BigInt(data.frames[0].bar.startNs) / BigInt(1000000));
    const ns = (value: string) => String(BigInt(value) + BigInt(shift) * BigInt(1000000));
    data.cutoffMs += shift; data.sourceAsOfMs += shift; data.freshUntilMs += shift;
    data.replayCutoffsMs = data.replayCutoffsMs.map(ms => ms + shift);
    data.definition = { ...data.definition, validFromNs: ns(data.definition.validFromNs), validUntilNs: ns(data.definition.validUntilNs), availableAtNs: ns(data.definition.availableAtNs) };
    data.frames = data.frames.map(f => ({ ...f, endMs: f.endMs + shift,
      bar: { ...f.bar, startNs: ns(f.bar.startNs), endNs: ns(f.bar.endNs), availableAtNs: ns(f.bar.availableAtNs) },
      depth: f.depth && { ...f.depth, startNs: ns(f.depth.startNs), endNs: ns(f.depth.endNs) },
      gex: { status: "unavailable", reason: "source_unavailable" } }));
    response = async () => new Response(JSON.stringify(valid(data)));
    await render();
    expect(text("futures-session")).toContain("2026-10-09");
    expect(text("futures-session")).toContain("Session zone unavailable");
    expect(text("futures-loaded-bounds")).toContain("2026-10-08 23:50:00 UTC");
    expect(text("futures-loaded-bounds")).toContain("2026-10-09 00:14:00 UTC");
  });
  it("preserves exact definition nanoseconds beyond JavaScript integer precision", async () => {
    const data = browserFuturesFixture(DEFAULT_FUTURES_REQUEST);
    data.definition.validFromNs = String(BigInt(data.definition.validFromNs) + BigInt(123));
    data.definition.availableAtNs = String(BigInt(data.definition.availableAtNs) + BigInt(789));
    response = async () => new Response(JSON.stringify(valid(data)));
    await render();
    expect(text("futures-definition-id")).toBe(data.definition.id);
    expect(text("futures-definition-start")).toBe(data.definition.validFromNs + " ns");
    expect(text("futures-definition-end")).toBe(data.definition.validUntilNs + " ns");
    expect(text("futures-definition-available")).toBe(data.definition.availableAtNs + " ns");
  });
  it("shows no loaded intervals without inventing an epoch or a continuous history window", async () => {
    const data = browserFuturesFixture(DEFAULT_FUTURES_REQUEST); data.frames = [];
    response = async () => new Response(JSON.stringify(valid(data)));
    await render();
    expect(text("futures-loaded-bounds")).toBe("No intervals loaded");
    expect(text("futures-loaded-count")).toBe("Intervals: 0");
    expect(text("futures-observation-context")).not.toMatch(/Invalid Date|1970-/);
  });
  it.each([{ coverage: "partial", label: "Execution coverage: partial" }, { coverage: "gap", label: "Execution coverage: gap" }] as const)(
    "retains $coverage captured-trade qualification beside the loaded bounds", async ({ coverage, label }) => {
      const data = browserFuturesFixture(DEFAULT_FUTURES_REQUEST); data.tradeCoverage = coverage;
      for (const f of data.frames) f.bar.cvd = null;
      response = async () => new Response(JSON.stringify(valid(data)));
      await render();
      expect(text("futures-trade-coverage")).toBe(label);
      expect(text("futures-partial-coverage")).toContain("only the captured trades");
    });
  it.each([401, 403])("withdraws all admitted source evidence on %s while keeping request intent", async status => {
    const first = browserFuturesFixture(DEFAULT_FUTURES_REQUEST).replayCutoffsMs[0];
    await render({ ...DEFAULT_FUTURES_REQUEST, cutoffMs: first + 1 });
    expect(query("futures-source-details")).not.toBeNull();
    response = async () => new Response("denied", { status });
    await refresh();
    expect(text("futures-requested-cutoff")).toBe(utc(first + 1));
    for (const id of ["futures-selected-cutoff", "futures-session", "futures-loaded-bounds", "futures-retained-bounds", "futures-source-details"])
      expect(query(id)).toBeNull();
    expect(host.querySelector('select[aria-label="Published replay frames"]')).toBeNull();
  });
  it("withdraws old source evidence before a replacement account response arrives", async () => {
    await render(); expect(query("futures-source-details")).not.toBeNull();
    let resolve!: (value: Response) => void;
    response = () => new Promise<Response>(done => { resolve = done; });
    owner.identity = { kind: "user", userId: "account-b", email: "b@example.test" };
    await render();
    expect(text("futures-requested-cutoff")).toBe("Latest published frame");
    expect(query("futures-source-details")).toBeNull(); expect(query("futures-selected-cutoff")).toBeNull();
    await act(async () => { resolve(new Response("denied", { status: 403 })); });
    expect(query("futures-source-details")).toBeNull();
  });
  it("renders Chinese source labels without creating another data read", async () => {
    await render(); const count = fetcher.mock.calls.length;
    owner.lang = "zh"; await render();
    expect(text("futures-requested-cutoff")).toBe("最新已发布帧");
    expect(text("futures-session")).toContain("交易时区不可用");
    expect(text("futures-availability")).toContain("供应商事后采集");
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
});
