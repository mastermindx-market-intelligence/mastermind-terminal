// @vitest-environment jsdom
//
// CompanyListingIdentity (P12.T25) — the identity strip behind alternate listings, mounted in
// isolation with the cache read faked, so every outcome here is the strip's own behaviour:
//
//   - the preview read is the ONE active candidate's fund file, answered by quote_currency
//     only (BABA stays USD with stmt_currency CNY sitting right there in the fixture);
//   - a late answer for a superseded candidate never relabels the strip (BABA resolves last
//     after 9988.HK was selected, and the strip keeps saying HKD);
//   - absent/failed reads say "unavailable" and never disable Open Analysis;
//   - the destination mounts on the workspace's fund prop with NO fund request of its own;
//   - the selection line follows the language and quotes only a query that was actually typed.
//
// The repo has no @testing-library, so this mounts through react-dom/client + act(), the same
// method as companySearchIdentity.test.tsx and portfolioPageReadbackOrder.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CacheOutcome } from "@/lib/dataCache";
import { LangProvider, applyLang } from "@/lib/i18n";

vi.mock("@/lib/dataCache", () => ({ getJSONResult: vi.fn() }));

import CompanyListingIdentity, { type CompanyListingIdentityProps } from "@/components/CompanyListingIdentity";
import { getJSONResult } from "@/lib/dataCache";

const mockGetJSONResult = vi.mocked(getJSONResult);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// P12.T25 fixtures, reduced to the metadata the strip is allowed to read. Both listings of the
// one company carry stmt_currency "CNY"; only quote_currency may ever reach the strip.
const BABA_FUND = { ticker: "BABA", quote_currency: "USD", stmt_currency: "CNY" };
const HK9988_FUND = { ticker: "9988.HK", quote_currency: "HKD", stmt_currency: "CNY" };
const MANIFEST = {
  as_of: "2026-11-02",
  symbols: {
    BABA: { name: "Alibaba", mkt: "NYSE", sec: "Equities" },
    "9988.HK": { name: "Alibaba", mkt: "HKEX", sec: "Equities" },
  },
};

const BABA_FUND_URL = "/data/BABA.fund.json";
const HK9988_FUND_URL = "/data/9988.HK.fund.json";
const MANIFEST_URL = "/data/manifest.json";

// ── reads the test releases by hand, in request order per URL ────────────────
type Deferred = { promise: Promise<CacheOutcome>; resolve: (outcome: CacheOutcome) => void };
function defer(): Deferred {
  let resolve!: (outcome: CacheOutcome) => void;
  const promise = new Promise<CacheOutcome>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const calls: string[] = [];
const queue = new Map<string, Deferred[]>();
function release(url: string, index: number, outcome: CacheOutcome): Promise<void> {
  const pending = queue.get(url)?.[index];
  expect(pending, `expected a read of ${url} #${index}`).toBeTruthy();
  return act(async () => {
    pending!.resolve(outcome);
    await pending!.promise;
  });
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  calls.length = 0;
  queue.clear();
  mockGetJSONResult.mockReset();
  mockGetJSONResult.mockImplementation((url: string) => {
    const pending = defer();
    calls.push(url);
    const list = queue.get(url) ?? [];
    list.push(pending);
    queue.set(url, list);
    return pending.promise;
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-lang");
});

async function mountStrip(props: CompanyListingIdentityProps): Promise<void> {
  await act(async () => {
    root.render(
      <LangProvider>
        <CompanyListingIdentity {...props} />
      </LangProvider>,
    );
  });
}

async function rerenderStrip(props: CompanyListingIdentityProps): Promise<void> {
  await act(async () => {
    root.render(
      <LangProvider>
        <CompanyListingIdentity {...props} />
      </LangProvider>,
    );
  });
}

function openButton(): HTMLButtonElement {
  const button = host.querySelector("button");
  expect(button, "the strip renders its Open Analysis action").toBeTruthy();
  return button!;
}

describe("CompanyListingIdentity — the preview labels the selected candidate", () => {
  it("shows the exact symbol, the manifest row's venue, and quote_currency — never stmt_currency", async () => {
    await mountStrip({ symbol: "BABA", name: "Alibaba", query: "alibaba", preview: true, venue: "NYSE", onOpen: vi.fn() });
    expect(host.textContent).toContain("Trading currency loading"); // unresolved until the read lands
    await release(BABA_FUND_URL, 0, { status: "data", data: BABA_FUND });
    const text = host.textContent ?? "";
    expect(text).toContain("BABA");
    expect(text).toContain("Alibaba");
    expect(text).toContain("Venue NYSE");
    expect(text).toContain("Trading currency USD");
    expect(text).toContain("Selected from “alibaba”");
    expect(text).not.toContain("CNY"); // the statement currency never becomes the trading one
    // One read for the one active candidate — and no manifest re-read, because the dialog's
    // row arrived as the venue prop.
    expect(calls).toEqual([BABA_FUND_URL]);
  });

  it("a late answer for a superseded candidate never relabels the strip", async () => {
    await mountStrip({ symbol: "BABA", preview: true, venue: "NYSE", onOpen: vi.fn() });
    await rerenderStrip({ symbol: "9988.HK", preview: true, venue: "HKEX", onOpen: vi.fn() });
    expect(host.textContent).toContain("9988.HK");
    // 9988.HK's answer lands first, then BABA's — the response that started EARLIER lands LAST.
    await release(HK9988_FUND_URL, 0, { status: "data", data: HK9988_FUND });
    await release(BABA_FUND_URL, 0, { status: "data", data: BABA_FUND });
    const text = host.textContent ?? "";
    expect(text).toContain("Venue HKEX");
    expect(text).toContain("Trading currency HKD");
    expect(text).not.toContain("USD");
    expect(text).not.toContain("NYSE");
    // One read per candidate that was actually selected — never per typed character.
    expect(calls).toEqual([BABA_FUND_URL, HK9988_FUND_URL]);
  });

  it("an absent read says unavailable and Open Analysis stays enabled", async () => {
    const onOpen = vi.fn();
    await mountStrip({ symbol: "BABA", preview: true, venue: "NYSE", onOpen });
    await release(BABA_FUND_URL, 0, { status: "absent", httpStatus: 404 });
    expect(host.textContent).toContain("Trading currency unavailable");
    const button = openButton();
    expect(button.hasAttribute("disabled")).toBe(false);
    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a failed read says the same unavailable and the action still works", async () => {
    const onOpen = vi.fn();
    await mountStrip({ symbol: "BABA", preview: true, venue: "NYSE", onOpen });
    await release(BABA_FUND_URL, 0, { status: "unavailable", reason: "network" });
    expect(host.textContent).toContain("Trading currency unavailable");
    const button = openButton();
    expect(button.hasAttribute("disabled")).toBe(false);
    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("leaves a preview's missing source venue unknown without re-reading the loaded manifest", async () => {
    await mountStrip({ symbol: "BABA", preview: true, onOpen: vi.fn() });
    expect(calls).toEqual([BABA_FUND_URL]);
    await release(BABA_FUND_URL, 0, { status: "data", data: BABA_FUND });
    expect(host.textContent).toContain("Venue unavailable");
    expect(host.textContent).toContain("Trading currency USD");
    expect(openButton().disabled).toBe(false);
  });

});

describe("CompanyListingIdentity — the destination reads only the workspace's fund", () => {
  it("labels from the fund prop without issuing any read of its own", async () => {
    await mountStrip({ symbol: "BABA", query: "", fund: BABA_FUND, venue: "NYSE", onOpen: vi.fn() });
    expect(mockGetJSONResult).not.toHaveBeenCalled();
    const text = host.textContent ?? "";
    expect(text).toContain("Trading currency USD");
    expect(text).not.toContain("CNY");
    expect(text).toContain("Selected in company search"); // an empty query is never quoted
    expect(text).not.toContain("Selected from");
  });

  it("reads the cached manifest for the destination's exact listing venue", async () => {
    await mountStrip({ symbol: "BABA", fund: BABA_FUND });
    expect(calls).toEqual([MANIFEST_URL]);
    await release(MANIFEST_URL, 0, { status: "data", data: MANIFEST });
    expect(host.textContent).toContain("Venue NYSE");
    await rerenderStrip({ symbol: "9988.HK", fund: HK9988_FUND });
    await release(MANIFEST_URL, 1, { status: "data", data: MANIFEST });
    expect(host.textContent).toContain("Venue HKEX");
    expect(host.textContent).toContain("Trading currency HKD");
    expect(calls.filter(url => url.endsWith(".fund.json"))).toEqual([]);
  });

  it("shows the workspace's loading state, then refuses a row about a different ticker", async () => {
    await mountStrip({ symbol: "BABA", fund: BABA_FUND, loading: false });
    expect(host.textContent).toContain("Trading currency USD");
    await rerenderStrip({ symbol: "BABA", fund: null, loading: true });
    expect(host.textContent).toContain("Trading currency loading");
    // The 9988.HK row (HKD) is not about BABA: unavailable, and never HKD.
    await rerenderStrip({ symbol: "BABA", fund: HK9988_FUND, loading: false });
    const text = host.textContent ?? "";
    expect(text).toContain("Trading currency unavailable");
    expect(text).not.toContain("HKD");
    // Never a second fund request — the workspace already holds the read. The one manifest
    // call is the permitted venue fallback, answered from the shared cache.
    expect(calls.filter((url) => url.endsWith(".fund.json"))).toEqual([]);
    expect(calls.filter((url) => url === MANIFEST_URL)).toEqual([MANIFEST_URL]);
  });
});

describe("CompanyListingIdentity — the selection line follows the language", () => {
  it("quotes a typed query in English and Chinese", async () => {
    await mountStrip({ symbol: "BABA", query: "alibaba", preview: true, venue: "NYSE", onOpen: vi.fn() });
    await release(BABA_FUND_URL, 0, { status: "data", data: BABA_FUND });
    expect(host.textContent).toContain("Selected from “alibaba”");
    expect(host.textContent).toContain("Open Analysis");
    expect(host.textContent).toContain("Trading currency USD");

    document.documentElement.setAttribute("data-lang", "zh");
    // The provider switches the way production does — applyLang's mm:lang event — not by a
    // remount, so the strip's re-render follows the real language path.
    await act(async () => applyLang("zh"));
    await rerenderStrip({ symbol: "BABA", query: "alibaba", preview: true, venue: "NYSE", onOpen: vi.fn() });
    const zh = host.textContent ?? "";
    expect(zh).toContain("从“alibaba”中选择");
    expect(zh).toContain("打开分析");
    expect(zh).toContain("交易货币 USD");
    expect(zh).toContain("交易场所 NYSE");
    expect(zh).not.toContain("Selected from");
  });

  it("an empty query says the generic selected line; no query prop says nothing", async () => {
    await mountStrip({ symbol: "BABA", query: "", preview: true, venue: "NYSE" });
    expect(host.textContent).toContain("Selected in company search");
    document.documentElement.setAttribute("data-lang", "zh");
    await act(async () => applyLang("zh"));
    await rerenderStrip({ symbol: "BABA", query: "", preview: true, venue: "NYSE" });
    expect(host.textContent).toContain("在公司搜索中选择");
    expect(host.textContent).not.toContain("“”"); // never quote the empty string

    await rerenderStrip({ symbol: "BABA", preview: true, venue: "NYSE" });
    expect(host.textContent).not.toContain("Selected");
  });
});
