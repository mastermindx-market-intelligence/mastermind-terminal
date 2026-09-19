// @vitest-environment jsdom
//
// Rendered-UI coverage for the Portfolio-targets Settings section (B-F08-13 /
// MO-DELTA-003). The section mirrors the holdings readout — Settings is now
// the place a reader sees their own typed weight targets and drift without
// opening /portfolio.
//
// Mounts the real section through react-dom/client (this repo has no
// @testing-library). Fetch is stubbed against /api/portfolio/targets only;
// the section never shells out to git. The empty state, the unreadable line,
// and the loaded readout each get one contract test so a regression in any
// branch fails RED first.
//
// Plain-language law: every visible string this section renders is sourced
// from lib/i18n.tsx with both EN and ZH entries — the test only checks the
// EN rendering to keep the assertion set honest to what the page actually
// shows in the EN locale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SectionPortfolioTargets from "@/components/settings/SectionPortfolioTargets";
import { LEX } from "@/lib/i18n";
import type { SectionProps } from "@/components/settings/types";
import type { PortfolioTargetsSummary } from "@/lib/portfolioTargets";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function baseProps(lang: "en" | "zh"): SectionProps {
  return {
    t: makeT(lang),
    lang,
    identity: { kind: "account", userId: "user-1", email: "a@example.com" },
    email: "a@example.com",
    user: {
      id: "user-1",
      email: "a@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSignInAt: "2026-09-01T00:00:00.000Z",
      provider: "email",
      meta: {},
    },
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
}

type FetchPlan = {
  getStatus?: number;
  getBody?: unknown;
  /** Logs every fetch the section makes — assertions can read it. */
  calls: { url: string; method: string }[];
  nextGet: (url: string) => Promise<Response>;
};

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(plan: FetchPlan) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    plan.calls.push({ url, method });
    if (method === "GET") return plan.nextGet(url);
    if (method === "POST") return jsonRes(200, { ok: true });
    return jsonRes(405, { error: "unsupported" });
  }) as typeof fetch;
  return () => { globalThis.fetch = realFetch; };
}

function summary(
  drifts: PortfolioTargetsSummary["drifts"] = [],
  untargeted: PortfolioTargetsSummary["untargeted"] = [],
  orphaned: PortfolioTargetsSummary["orphaned"] = [],
): PortfolioTargetsSummary {
  return {
    schema: "portfolio_targets.v1",
    weightBasis: "cost",
    targetsSumPct: 0,
    targetsSumOffBy100: 0,
    drifts,
    untargeted,
    orphaned,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let restoreFetch: (() => void) | null = null;

function mount(props: SectionProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<SectionPortfolioTargets {...props} />); });
  return container;
}

function unmount() {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  if (restoreFetch) restoreFetch();
  restoreFetch = null;
  root = null;
  container = null;
}

function text(): string {
  return container?.textContent ?? "";
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  // `vi.useFakeTimers` would help but the section's fetch is async and the
  // vitest run is small; we drive flushes explicitly below.
});

afterEach(() => {
  unmount();
});

describe("SectionPortfolioTargets (B-F08-13 / MO-DELTA-003)", () => {
  it("shows the loading line while the GET is in flight", async () => {
    const calls: { url: string; method: string }[] = [];
    // Resolve later — the first paint must be the loading line, not the
    // empty-card or the unreadable line.
    let resolveGet!: (r: Response) => void;
    const plan: FetchPlan = {
      calls,
      nextGet: () => new Promise<Response>((res) => { resolveGet = res; }),
    };
    restoreFetch = installFetch(plan);
    mount(baseProps("en"));
    // The first paint must be the loading marker before the GET resolves.
    expect(text()).toContain(LEX.acsPortfolioTargetsLoading[0]);
    await act(async () => { resolveGet(jsonRes(200, { summary: summary() })); });
    await flush();
  });

  it("renders the empty card when the summary has no drifts, untargeted, or orphaned rows", async () => {
    const calls: { url: string; method: string }[] = [];
    const plan: FetchPlan = {
      calls,
      nextGet: async () => jsonRes(200, { summary: summary() }),
    };
    restoreFetch = installFetch(plan);
    mount(baseProps("en"));
    await flush();
    const root = container?.querySelector('[data-testid="portfolio-targets-empty"]');
    expect(root).not.toBeNull();
    expect(text()).toContain(LEX.acsPortfolioTargetsEmptyTitle[0]);
    expect(text()).toContain(LEX.acsPortfolioTargetsEmptyBody[0]);
    // The Holdings-page link is the only interactive affordance in the empty
    // state — it must carry the copy, not a generic "Learn more".
    const link = container?.querySelector('a[href="/portfolio"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain(LEX.acsPortfolioTargetsOpenHoldings[0]);
  });

  it("renders the unreadable line when the GET returns 5xx", async () => {
    const calls: { url: string; method: string }[] = [];
    const plan: FetchPlan = {
      calls,
      nextGet: async () => jsonRes(503, { error: "targets unavailable" }),
    };
    restoreFetch = installFetch(plan);
    mount(baseProps("en"));
    await flush();
    const unread = container?.querySelector('[data-testid="portfolio-targets-unreadable"]');
    expect(unread).not.toBeNull();
    expect(text()).toContain(LEX.acsPortfolioTargetsUnreadable[0]);
  });

  it("mounts the readout when the GET returns a non-empty summary", async () => {
    const calls: { url: string; method: string }[] = [];
    const driftRow = {
      ticker: "AAPL",
      currentWeightPct: 35,
      targetWeightPct: 40,
      bandPct: 5,
      driftPct: -5,
      status: "within_band" as const,
    };
    const plan: FetchPlan = {
      calls,
      nextGet: async () => jsonRes(200, { summary: summary([driftRow]) }),
    };
    restoreFetch = installFetch(plan);
    mount(baseProps("en"));
    await flush();
    // The shared PortfolioTargetsReadout stamps its own data-testid
    // ("portfolio-targets") — we reuse it so the live surface and the
    // Settings surface point at the same DOM contract.
    const readout = container?.querySelector('[data-testid="portfolio-targets"]');
    expect(readout).not.toBeNull();
    expect(text()).toContain("AAPL");
  });

  it("renders the zh title and the zh lead sentence in the zh locale", async () => {
    const calls: { url: string; method: string }[] = [];
    const plan: FetchPlan = {
      calls,
      nextGet: async () => jsonRes(200, { summary: summary() }),
    };
    restoreFetch = installFetch(plan);
    mount(baseProps("zh"));
    await flush();
    expect(text()).toContain(LEX.acsPortfolioTargets[1]);
    expect(text()).toContain(LEX.acsPortfolioTargetsSub[1]);
  });

  it("hits /api/portfolio/targets exactly once on mount with a stable summary", async () => {
    const calls: { url: string; method: string }[] = [];
    const plan: FetchPlan = {
      calls,
      nextGet: async () => jsonRes(200, { summary: summary() }),
    };
    restoreFetch = installFetch(plan);
    mount(baseProps("en"));
    await flush();
    const targetsCalls = calls.filter((c) => c.url.endsWith("/api/portfolio/targets") && c.method === "GET");
    expect(targetsCalls.length).toBe(1);
  });

  // MAJOR-3 (h_t586): Settings passes shapeReadoutVisible={false}, so the SHORT basis
  // sentence renders. The LONG sentence (which names the shape readout above) may only be
  // used where that readout is actually on the page — PortfolioView holdings page, not Settings.
  it("renders the SHORT basis sentence in Settings (shapeReadoutVisible=false)", async () => {
    const driftRow = {
      ticker: "AAPL", currentWeightPct: 35, targetWeightPct: 40,
      bandPct: 5, driftPct: -5, status: "within_band" as const,
    };
    const plan: FetchPlan = {
      calls: [],
      nextGet: async () => jsonRes(200, { summary: summary([driftRow]) }),
    };
    restoreFetch = installFetch(plan);
    mount(baseProps("en"));
    await flush();
    // SHORT (Settings): "Weighted by what you paid." — no cross-reference to the shape readout
    expect(text()).toContain("Weighted by what you paid.");
    // LONG must NOT appear in Settings (it cross-references "the shape readout above" which is not there)
    expect(text()).not.toContain("same as the shape readout above");
  });

  // MINOR-2 (h_t586 round 2): ZH SHORT must also render on the Settings surface.
  // RED-first: this would fail if ZH copy were the LONG sentence
  // "按你的建仓成本加权，与上方的持仓构成保持一致。" (which references the shape readout).
  it("renders the ZH SHORT basis sentence in Settings (shapeReadoutVisible=false)", async () => {
    const driftRow = {
      ticker: "AAPL", currentWeightPct: 35, targetWeightPct: 40,
      bandPct: 5, driftPct: -5, status: "within_band" as const,
    };
    const plan: FetchPlan = {
      calls: [],
      nextGet: async () => jsonRes(200, { summary: summary([driftRow]) }),
    };
    restoreFetch = installFetch(plan);
    mount(baseProps("zh"));
    await flush();
    // SHORT (Settings, ZH): "按你的建仓成本加权。" — no cross-reference to the shape readout
    expect(text()).toContain("按你的建仓成本加权。");
    // LONG (ZH) must NOT appear in Settings — it cross-references "the shape readout above" which is not there
    expect(text()).not.toContain("按你的建仓成本加权，与上方的持仓构成保持一致。");
  });
});