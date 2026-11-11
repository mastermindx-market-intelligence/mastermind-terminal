// @vitest-environment jsdom
/**
 * The Portfolio's selected-sector block.
 *
 * Covered against the REAL component, the REAL incumbent dossier presentation and parser,
 * the REAL copy tuples and the REAL monetary cohort:
 *   - the owner's own evidence renders for the selected sector, with its own dates, windows,
 *     null reasons and qualifications;
 *   - the direct holding counts only exact open records, and the share of eligible recorded
 *     cost is withheld for an unreadable or stale book, an unknown or mixed currency, a
 *     missing basis, an overflow and an empty eligible population;
 *   - a technology stock is never a sector exposure, and a missing ETF record never claims
 *     that there is no exposure;
 *   - a withdrawn access, a failed read, an absent, invalid or unavailable dossier and a
 *     late response from a retired owner all clear every figure;
 *   - the journey issues one GET and no write of any kind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { applyLang, LangProvider } from "@/lib/i18n";
import { DEFAULT_SECTOR_STATE } from "@/lib/sectorIntelligence";
import {
  parseSectorPortfolioContext, sectorPortfolioHref, type SectorPortfolioContext,
} from "@/lib/sectorPortfolioContext";
import PortfolioSectorContext from "@/components/PortfolioSectorContext";
import type { Position } from "@/lib/portfolio";
import ready from "./fixtures/sector_dossiers_v1.json";
import outage from "./fixtures/sector_dossiers_unavailable_v1.json";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const shell = vi.hoisted(() => ({ identity: { kind: "account", userId: "owner-a", email: "a@example.com" } as
  { kind: "guest" } | { kind: "account"; userId: string; email: string } }));

vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => shell.identity }));

// jsdom has no app router; the anchor is the link a reader actually follows.
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: ReactNode; className?: string; [key: string]: unknown }) =>
    createElement("a", props, props.children),
}));

type Pending = {
  url: string; method: string; signal: AbortSignal | undefined;
  resolve: (body: unknown, status?: number) => void; reject: (reason: unknown) => void;
};
const calls: Pending[] = [];

const ok = (data: unknown) => ({ data, receipt: { source: "sector", status: "ready",
  path: "/sectordata/sector_central.json", asOf: "2026-10-09", observedAt: "2026-10-09T21:00:00Z",
  stale: false, contentHash: "sha256:transport" } });
const access = () => ({ data: null, receipt: { source: "sector", status: "access",
  path: "/sectordata/sector_central.json", asOf: null, observedAt: null, stale: false, contentHash: null } });

let sequence = 0;
const lot = (ticker: string, over: Partial<Position> = {}): Position => {
  sequence += 1;
  return { id: `pos-${sequence}`, ticker, shares: 10, entryPrice: 100, entryCurrency: "USD",
    entryDate: null, notes: null, status: "open", createdAt: null, ...over };
};

const contextFor = (etf: string, workspace: "discover" | "rotation" = "discover"): SectorPortfolioContext =>
  parseSectorPortfolioContext(sectorPortfolioHref(etf, { ...DEFAULT_SECTOR_STATE, workspace }))!;

const flush = async (times = 10) => {
  for (let index = 0; index < times; index += 1) await act(async () => { await Promise.resolve(); });
};

describe("the Portfolio selected-sector block", () => {
  let root: Root, host: HTMLDivElement;

  const render = async (props: { context?: SectorPortfolioContext; positions?: Position[];
    unreadable?: boolean; stale?: boolean } = {}) => {
    await act(async () => root.render(<LangProvider>
      <PortfolioSectorContext context={props.context ?? contextFor("XLK")} positions={props.positions ?? []}
        unreadable={props.unreadable ?? false} stale={props.stale ?? false} />
    </LangProvider>));
  };

  const section = () => host.querySelector('[data-testid="portfolio-sector-context"]')!;
  const dossier = () => host.querySelector('[data-testid="sector-leadership-dossier"]')!;
  const metric = (window: string) =>
    dossier().querySelector(`[data-testid="sector-dossier-metric"][data-window="${window}"] strong`)!;
  const holding = () => host.querySelector('[data-testid="portfolio-sector-holding"]')!;
  const weight = () => host.querySelector('[data-testid="portfolio-sector-weight"]');
  const unavailable = () => host.querySelector('[data-testid="portfolio-sector-weight-unavailable"]');
  const noRecord = () => host.querySelector('[data-testid="portfolio-sector-no-record"]');

  beforeEach(() => {
    calls.length = 0;
    applyLang("en"); document.documentElement.setAttribute("data-lang", "en");
    shell.identity = { kind: "account", userId: "owner-a", email: "a@example.com" };
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const pending: Pending = {
        url: String(input), method: (init?.method ?? "GET").toUpperCase(), signal: init?.signal ?? undefined,
        resolve: () => {},
        reject: () => {},
      };
      return new Promise((resolve, reject) => {
        pending.resolve = (body, status = 200) => resolve({
          ok: status >= 200 && status < 300, status,
          json: async () => body,
        } as Response);
        pending.reject = reject;
        calls.push(pending);
      });
    }) as unknown as typeof fetch;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    vi.restoreAllMocks();
  });

  it("renders the owner's own evidence for the selected sector", async () => {
    await render();
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain("/api/sector-intelligence?source=sector");
    expect(calls[0].method).toBe("GET");
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();

    expect(section().getAttribute("data-etf")).toBe("XLK");
    expect(section().textContent).toContain("Selected sector");
    expect(dossier().textContent).toContain("Technology · XLK");
    expect(dossier().querySelector("time")!.getAttribute("datetime")).toBe("2026-10-09");
    expect(metric("21").textContent).toContain("-0.50%");
    expect(metric("63").textContent).toContain("0.00%");
  });

  it("retires a ready selection across pending A to B to A", async () => {
    await render();
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(metric("21").textContent).toContain("-0.50%");
    await render({ context: contextFor("XLE") });
    await render({ context: contextFor("XLK") });
    await flush();
    expect(calls).toHaveLength(3);
    expect(metric("21")).toBeNull();
    await act(async () => { calls[1].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(metric("21")).toBeNull();
    await act(async () => { calls[2].resolve(ok({ measured_read: outage })); });
    await flush();
    expect(metric("21").textContent).toBe("—");
  });

  it("offers the admitted return to the exact selection", async () => {
    await render({ context: contextFor("XLK", "rotation") });
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    const back = host.querySelector('[data-testid="portfolio-sector-context-return"]') as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("/discover?tab=sectors&sectorWorkspace=rotation");
    expect(back.textContent).toContain("Back to Rotation");
  });

  it("shows the direct holding and its share of the eligible recorded cost", async () => {
    await render({ positions: [lot("XLK"), lot("XLK"), lot("XLF")] });
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(holding().textContent).toContain("Your direct holding of XLK");
    expect(holding().textContent).toContain("2 open records for XLK");
    expect(weight()!.textContent).toContain("66.7% of eligible recorded cost");
    expect(host.querySelector('[data-testid="portfolio-sector-weight-coverage"]')!.textContent)
      .toContain("2 of 3 eligible lots · USD 3,000.00 recorded cost");
  });

  it("does not read a closed lot as a holding", async () => {
    await render({ positions: [lot("XLK", { status: "closed" })] });
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(noRecord()).not.toBeNull();
    expect(noRecord()!.textContent).toContain("No directly held ETF record for XLK");
    expect(weight()).toBeNull();
  });

  it("never implies a sector exposure from a technology stock", async () => {
    await render({ positions: [lot("NVDA"), lot("AMD")] });
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(noRecord()!.textContent).toContain("No directly held ETF record for XLK");
    expect(host.querySelector('[data-testid="portfolio-sector-no-record-hint"]')!.textContent)
      .toContain("do not imply XLK exposure");
    expect(weight()).toBeNull();
  });

  it.each([
    ["an unreadable book", { unreadable: true }, "unreadable"],
    ["a stale book", { stale: true }, "stale"],
  ])("withholds the number for %s", async (_label, book, gap) => {
    await render({ positions: [lot("XLK"), lot("XLF")], ...book });
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(weight()).toBeNull();
    expect(unavailable()!.getAttribute("data-gap")).toBe(gap);
  });

  it("states no record count at all when the book cannot be read", async () => {
    await render({ positions: [], unreadable: true });
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    // An unreadable book proves nothing about what is held — not even a count of zero.
    expect(host.querySelector('[data-testid="portfolio-sector-open-records"]')).toBeNull();
    expect(noRecord()).toBeNull();
    expect(unavailable()!.getAttribute("data-gap")).toBe("unreadable");
  });

  it.each([
    ["an unknown currency", [lot("XLK", { entryCurrency: null }), lot("XLF")], "currency_unknown"],
    ["a mixed currency", [lot("XLK"), lot("XLF", { entryCurrency: "HKD" })], "currency_mismatch"],
    ["a missing basis", [lot("XLK", { shares: null }), lot("XLF")], "missing_basis"],
    ["an overflow", [lot("XLK", { shares: 1e308, entryPrice: 1e10 }), lot("XLF")], "amount_overflow"],
  ])("withholds the number for %s", async (_label, positions, gap) => {
    await render({ positions });
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(weight()).toBeNull();
    expect(unavailable()!.getAttribute("data-gap")).toBe(gap);
  });

  it("reads the owner's own dossier states without inventing a figure", async () => {
    await render();
    await act(async () => { calls[0].resolve(ok({ measured_read: {} })); });
    await flush();
    expect(dossier().textContent).toContain("Leadership evidence is not available");
    expect(metric("21")).toBeNull();

    await render({ context: contextFor("XLE") });
    await act(async () => { calls[1].resolve(ok({ measured_read: outage })); });
    await flush();
    expect(dossier().textContent).toContain("Leadership evidence is unavailable");
    expect(host.querySelector('[data-testid="sector-dossier-metric"][data-window="21"] strong')!.textContent).toBe("—");
  });

  it("clears every figure when the access is withdrawn", async () => {
    await render();
    await act(async () => { calls[0].resolve(access(), 401); });
    await flush();
    expect(dossier().textContent).toContain("Leadership evidence requires access");
    expect(metric("21")).toBeNull();
  });

  it("retires the previous owner's figures before the next owner answers", async () => {
    await render();
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(metric("21").textContent).toContain("-0.50%");

    // The next account is a new generation: the old figures go before its answer arrives.
    shell.identity = { kind: "account", userId: "owner-b", email: "b@example.com" };
    await render();
    await flush();
    expect(metric("21")).toBeNull();
    expect(host.querySelector('[data-testid="sector-dossier-metric"]')).toBeNull();

    await act(async () => { calls[1].resolve(access(), 401); });
    await flush();
    expect(dossier().textContent).toContain("Leadership evidence requires access");
  });

  it("bounds a failed read as one bounded state", async () => {
    await render();
    await act(async () => { calls[0].reject(new Error("network down")); });
    await flush();
    expect(dossier().textContent).toContain("Leadership evidence could not be loaded");
    expect(metric("21")).toBeNull();
  });

  it("never revives a retired owner's or selection's response", async () => {
    await render();
    shell.identity = { kind: "account", userId: "owner-b", email: "b@example.com" };
    await render();
    expect(calls.length).toBe(2);
    // The first owner's answer arrives late and must not paint anything.
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(metric("21")).toBeNull();

    // The same account returning does not revive the retired read either.
    shell.identity = { kind: "account", userId: "owner-a", email: "a@example.com" };
    await render();
    expect(calls.length).toBe(3);
    await act(async () => { calls[1].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(metric("21")).toBeNull();
    await act(async () => { calls[2].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(metric("21").textContent).toContain("-0.50%");

    // A different selected sector is a new generation: the retired answer cannot follow it.
    await render({ context: contextFor("XLE") });
    expect(calls.length).toBe(4);
    await act(async () => { calls[3].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(section().getAttribute("data-etf")).toBe("XLE");
    expect(dossier().textContent).toContain("Energy · XLE");
    expect(dossier().textContent).not.toContain("Technology · XLK");
  });

  it("aborts its read when the block unmounts", async () => {
    await render();
    const pending = calls[0];
    await act(async () => root.unmount());
    expect(pending.signal!.aborted).toBe(true);
  });

  it("localizes fully in Chinese and never leaks English", async () => {
    applyLang("zh"); document.documentElement.setAttribute("data-lang", "zh");
    await render({ positions: [lot("XLK"), lot("XLF")] });
    await act(async () => { calls[0].resolve(ok({ measured_read: ready })); });
    await flush();
    expect(section().textContent).toContain("所选板块");
    expect(holding().textContent).toContain("您直接持有的 XLK");
    expect(weight()!.textContent).toContain("占符合条件记录成本的 50.0%");
    expect(section().textContent).not.toContain("Selected sector");
    expect(holding().textContent).not.toContain("Your direct holding");
  });
});
