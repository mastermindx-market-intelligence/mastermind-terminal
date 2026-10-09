// @vitest-environment jsdom
//
// F08 (macro#6819, C4 comment 5985704124; accepted as lane F08-ALERTCOUNT in 5987672592): the
// existing-alerts header printed "0 total" beside "Loading alerts…" while the FIRST inventory
// read was still in flight. `alerts` starts as [] and `loaded` as false, and the count's gate
// never consulted `loaded` — so a read that had not landed was rendered as a claim that the
// book is empty, which is the exact thing the header comment says it must not do.
//
// Mounted for real: the panel the /alerts page composes (`ExistingAlertsPanel`), inside the
// real LangProvider, with only `fetch` replaced. The inventory GET is HELD on a promise so the
// pending render can be inspected, then released into each of the read's four outcomes.
// Mount pattern copied from alertsCockpitThesisSummary.test.tsx.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { ExistingAlertsPanel } from "@/components/AlertsView";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const alertRow = (symbol: string, id: string) => ({
  id, symbol, active: true, created_at: "2026-08-19T12:00:00Z",
  condition: { type: "signal", target: "BUY" },
});
const TWO_ROWS = [alertRow("NVDA", "a1"), alertRow("SPY", "a2")];

type Outcome =
  | { kind: "rows"; alerts: unknown[] }
  | { kind: "status"; status: number }
  | { kind: "malformed" }
  | { kind: "transport" };

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function settle(outcome: Outcome): Response {
  if (outcome.kind === "rows") return json(200, { alerts: outcome.alerts });
  if (outcome.kind === "status") return json(outcome.status, { error: "x" });
  if (outcome.kind === "malformed") return json(200, {});
  throw new TypeError("Failed to fetch");
}

describe("Existing alerts — the inventory count waits for the read (F08-ALERTCOUNT)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let realFetch: typeof globalThis.fetch;
  let releases: Array<(o: Outcome) => void>;
  let inventoryReads: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    realFetch = globalThis.fetch;
    releases = [];
    inventoryReads = 0;
    // Every inventory GET is held until the test releases it; nothing else matters here.
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/alerts" && (!init?.method || init.method === "GET")) {
        inventoryReads++;
        return new Promise<Response>((resolve, reject) => {
          releases.push((o) => { try { resolve(settle(o)); } catch (e) { reject(e); } });
        });
      }
      return Promise.resolve(json(404, {}));
    }) as typeof globalThis.fetch;
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    container.remove();
    document.documentElement.removeAttribute("data-lang");
    globalThis.fetch = realFetch;
  });

  const flush = () => act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });

  async function mount(lang: "en" | "zh") {
    document.documentElement.setAttribute("data-lang", lang);
    await act(async () => {
      root = createRoot(container);
      root!.render(React.createElement(
        LangProvider, null, React.createElement(ExistingAlertsPanel, { email: "test@example.com" }),
      ));
    });
    await flush();
  }

  async function release(outcome: Outcome) {
    const next = releases.shift();
    expect(next, "an inventory read must be in flight to release").toBeDefined();
    await act(async () => { next!(outcome); });
    await flush();
  }

  const count = () => container.querySelector(".ph .sub");
  const text = () => container.textContent ?? "";
  const state = (name: string) => container.querySelector(`[data-alerts-state="${name}"]`);

  /** The invariant under test: while the first read is pending there is NO number at all. */
  function expectPendingWithoutCount(loading: string) {
    expect(inventoryReads).toBe(1);
    expect(text()).toContain(loading);
    expect(count()).toBeNull();
    expect(state("empty")).toBeNull();
    expect(state("unavailable")).toBeNull();
    expect(container.querySelector(".alerts-signedout")).toBeNull();
  }

  it("EN: no count beside 'Loading alerts…' while the first read is in flight", async () => {
    await mount("en");
    expectPendingWithoutCount("Loading alerts…");
  });

  it("ZH: no count beside '正在加载提醒…' while the first read is in flight", async () => {
    await mount("zh");
    expectPendingWithoutCount("正在加载提醒…");
  });

  it("a real empty book prints '0 total' only once the read has answered", async () => {
    await mount("en");
    expectPendingWithoutCount("Loading alerts…");
    await release({ kind: "rows", alerts: [] });
    expect(text()).not.toContain("Loading alerts…");
    expect(count()?.textContent).toBe("0 total");
    expect(state("empty")).not.toBeNull();
  });

  it("a populated book prints its real count once the read has answered (EN and ZH)", async () => {
    await mount("en");
    expectPendingWithoutCount("Loading alerts…");
    await release({ kind: "rows", alerts: TWO_ROWS });
    expect(count()?.textContent).toBe("2 total");
    expect(container.querySelectorAll(".arow")).toHaveLength(2);

    await act(async () => { root?.unmount(); });
    root = undefined;
    await mount("zh");
    expect(count()).toBeNull();
    await release({ kind: "rows", alerts: TWO_ROWS });
    expect(count()?.textContent).toBe("2 条");
  });

  for (const outcome of [
    { kind: "status", status: 503 },
    { kind: "malformed" },
    { kind: "transport" },
  ] as const) {
    it(`a failed first read (${outcome.kind === "status" ? outcome.status : outcome.kind}) is unavailable — never a zero count`, async () => {
      await mount("en");
      expectPendingWithoutCount("Loading alerts…");
      await release(outcome);
      expect(count()).toBeNull();
      expect(state("unavailable")).not.toBeNull();
      expect(state("empty")).toBeNull();
    });
  }

  it("a 401 first read is signed-out — never a zero count", async () => {
    await mount("en");
    expectPendingWithoutCount("Loading alerts…");
    await release({ kind: "status", status: 401 });
    expect(count()).toBeNull();
    expect(container.querySelector(".alerts-signedout")).not.toBeNull();
    expect(state("unavailable")).toBeNull();
  });

  it("a refresh keeps the last-good count while it is in flight and after it fails", async () => {
    await mount("en");
    await release({ kind: "rows", alerts: TWO_ROWS });
    expect(count()?.textContent).toBe("2 total");

    const refresh = container.querySelector<HTMLButtonElement>("button.alerts-refresh");
    expect(refresh).not.toBeNull();
    await act(async () => { refresh!.click(); });
    await flush();
    expect(inventoryReads).toBe(2);
    expect(count()?.textContent).toBe("2 total");

    await release({ kind: "status", status: 503 });
    expect(count()?.textContent).toBe("2 total");
    expect(container.querySelectorAll(".arow")).toHaveLength(2);
  });
});
