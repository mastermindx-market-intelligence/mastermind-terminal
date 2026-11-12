// @vitest-environment jsdom
// Real section + real readout, deterministic transport only. These regressions
// distinguish unusable successful reads from actual empty/null-weight books.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SectionPortfolioTargets from "@/components/settings/SectionPortfolioTargets";
import type { SectionProps } from "@/components/settings/types";
import { LEX } from "@/lib/i18n";
import { computePortfolioTargets, T_ARIA_TARGET, type PortfolioTargetsSummary } from "@/lib/portfolioTargets";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function props(lang: "en" | "zh" = "en", owner = "A"): SectionProps {
  const email = `${owner}@example.test`;
  return {
    lang, email, identity: { kind: "account", userId: owner, email },
    t: (key, fallback) => LEX[key]?.[lang === "zh" ? 1 : 0] ?? fallback ?? key,
    user: { id: owner, email, createdAt: null, lastSignInAt: null, provider: "email", meta: {} },
    onClose: () => {}, onPatchMeta: () => {}, onRefreshUser: async () => {},
  };
}

function book(target = 10): PortfolioTargetsSummary {
  return computePortfolioTargets(
    [{ ticker: "AAPL", shares: 1, entryPrice: 10, entryCurrency: "USD", status: "open" }],
    [{ ticker: "AAPL", targetWeightPct: target, bandPct: 5, updatedAt: null }],
  );
}

const malformed = [
  ["object without arrays", {}],
  ["unknown schema", { ...book(), schema: "portfolio_targets.v2" }],
  ["unknown basis", { ...book(), weightBasis: "market" }],
  ["missing drifts", { ...book(), drifts: undefined }],
  ["non-array untargeted", { ...book(), untargeted: {} }],
  ["non-array orphaned", { ...book(), orphaned: "missing" }],
  ["string total", { ...book(), targetsSumPct: "10" }],
  ["unknown drift status", { ...book(), drifts: [{ ...book().drifts[0], status: "ready" }] }],
  ["string target", { ...book(), drifts: [{ ...book().drifts[0], targetWeightPct: "10" }] }],
  ["missing band", { ...book(), drifts: [{ ...book().drifts[0], bandPct: undefined }] }],
  ["invalid untargeted row", { ...book(), untargeted: [{ ticker: "MSFT", currentWeightPct: "50" }] }],
  ["invalid orphaned row", { ...book(), orphaned: [{ ticker: "OLD", targetWeightPct: 20 }] }],
] as const;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let restoreFetch: (() => void) | null = null;

function mount(next = props()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<SectionPortfolioTargets {...next} />); });
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); });
  }
}

function marker(state: "loaded" | "loading" | "unreadable" | "empty") {
  return container?.querySelector(`[data-testid="portfolio-targets-${state}"]`) ?? null;
}

function retryButton() {
  const button = marker("unreadable")?.querySelector("button");
  if (!button) throw new Error("missing unreadable Retry");
  return button;
}

function targetInput() {
  const input = container?.querySelector<HTMLInputElement>(`input[aria-label="${T_ARIA_TARGET.en.replace("{ticker}", "AAPL")}"]`);
  if (!input) throw new Error("missing AAPL target input");
  return input;
}

function typeTarget(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(targetInput(), value);
    targetInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function installServer() {
  const original = globalThis.fetch;
  let target = 10;
  const requests: { method: string; snapshot: PortfolioTargetsSummary; payload?: Record<string, unknown>; signal?: AbortSignal | null; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (url !== "/api/portfolio/targets") throw new Error(`unexpected endpoint ${String(url)}`);
    const method = init?.method ?? "GET";
    const payload = method === "POST" ? JSON.parse(String(init?.body)) : undefined;
    if (method === "POST") {
      if (payload.action !== "set" || payload.ticker !== "AAPL") throw new Error("unexpected mutation");
      target = payload.targetWeightPct;
    } else if (method !== "GET") throw new Error(`unexpected method ${method}`);
    return new Promise<Response>((resolve) => requests.push({ method, payload, signal: init?.signal, snapshot: book(target), resolve }));
  }) as typeof fetch;
  restoreFetch = () => { globalThis.fetch = original; };
  return {
    requests,
    async release(n: number, options: { summary?: unknown; status?: number } = {}) {
      const request = requests[n - 1];
      if (!request) throw new Error(`missing request ${n}; have ${requests.length}`);
      const body = request.method === "POST" ? { ok: true }
        : { summary: "summary" in options ? options.summary : request.snapshot };
      await act(async () => {
        request.resolve(new Response(JSON.stringify(body), {
          status: options.status ?? 200, headers: { "content-type": "application/json" },
        }));
      });
      await settle();
    },
  };
}

afterEach(() => {
  if (root) act(() => { root!.unmount(); });
  container?.remove();
  restoreFetch?.();
  root = null;
  container = null;
  restoreFetch = null;
  vi.useRealTimers();
});

describe("Settings targets successful-response integrity", () => {
  it.each(malformed)("%s is unreadable rather than empty or loaded", async (_name, summary) => {
    const server = installServer();
    mount();
    await server.release(1, { summary });
    expect(marker("unreadable")).not.toBeNull();
    expect(marker("loaded")).toBeNull();
    expect(marker("empty")).toBeNull();
    expect(retryButton().textContent).toBe(LEX.portfolioUnreadableRetry[0]);
    expect(server.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  it.each(["en", "zh"] as const)("%s Retry is one GET and recovers from an unusable 200", async (lang) => {
    const server = installServer();
    mount(props(lang));
    await server.release(1, { summary: { ...book(), schema: "unknown" } });
    expect(marker("unreadable")?.textContent).toContain(LEX.acsPortfolioTargetsUnreadable[lang === "zh" ? 1 : 0]);
    act(() => { retryButton().click(); });
    await settle();
    expect(server.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
    expect(marker("loading")).not.toBeNull();
    await server.release(2);
    expect(marker("loaded")).not.toBeNull();
    expect(marker("unreadable")).toBeNull();
  });

  const valid = [
    ["empty", computePortfolioTargets([], []), "empty"],
    ["populated", book(), "loaded"],
    ["unweighable and orphaned", computePortfolioTargets(
      [{ ticker: "AAPL", shares: null, entryPrice: null, status: "open" },
       { ticker: "MSFT", shares: null, entryPrice: null, status: "open" }],
      [{ ticker: "AAPL", targetWeightPct: 20, bandPct: 5, updatedAt: null },
       { ticker: "OLD", targetWeightPct: 10, bandPct: 2, updatedAt: null }]), "loaded"],
    ["orphan-only", computePortfolioTargets([], [{ ticker: "OLD", targetWeightPct: 20, bandPct: 5, updatedAt: null }]), "loaded"],
  ] as const;

  it.each(valid)("valid %s retains its existing presentation", async (_name, summary, state) => {
    const server = installServer();
    mount();
    await server.release(1, { summary });
    expect(marker(state)).not.toBeNull();
    expect(marker("unreadable")).toBeNull();
    if (summary.orphaned.length) expect(container?.textContent).toContain("OLD");
    if (_name === "populated") {
      expect(summary.drifts[0]?.currentWeightPct).toBe(100);
      expect(container?.querySelector('[data-ticker="AAPL"][data-status="outside_band"]')).not.toBeNull();
    }
    if (_name === "unweighable and orphaned") {
      expect(summary.costGap).toBeNull();
      expect(container?.querySelector('[data-ticker="AAPL"][data-status="unweighable"]')?.textContent)
        .toContain("Current weight unavailable.");
      expect(container?.querySelector('[data-testid="targets-empty"]')?.textContent)
        .toBe("Current weights require positive, comparable entry costs.");
    }
    expect(server.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  it.each(["unknown schema", "object without arrays"])("unusable %s mutation readback hands off to authoritative GET without replaying POST", async (name) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = installServer();
    mount();
    await server.release(1);
    typeTarget("20");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await settle();
    await server.release(2);
    expect(server.requests.map((r) => r.method)).toEqual(["GET", "POST", "GET"]);
    await server.release(3, { summary: malformed.find(([label]) => label === name)![1] });
    expect(server.requests.map((r) => r.method)).toEqual(["GET", "POST", "GET", "GET"]);
    expect(marker("loading")).not.toBeNull();
    expect(marker("loaded")).toBeNull();
    await server.release(4, { status: 503 });
    expect(marker("unreadable")).not.toBeNull();
    act(() => { retryButton().click(); });
    await settle();
    await server.release(5);
    expect(targetInput().value).toBe("20");
    expect(server.requests.map((r) => r.method)).toEqual(["GET", "POST", "GET", "GET", "GET"]);
    expect(server.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(server.requests[1].payload).toMatchObject({ action: "set", ticker: "AAPL", targetWeightPct: 20 });
  });
});
