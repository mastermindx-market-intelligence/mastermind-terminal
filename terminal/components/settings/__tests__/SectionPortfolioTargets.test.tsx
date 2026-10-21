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
import { T_ARIA_TARGET, T_ARIA_BAND, type PortfolioTargetsSummary } from "@/lib/portfolioTargets";

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

// ---------------------------------------------------------------------------
// Readback ordering (macro#6819 C2 5979608991 / 5979715088).
//
// The section used to fire a whole-book GET after every POST with no fence,
// so whichever readback resolved LAST painted — an older target could replace
// a newer save, and a cleared target could come back. These cases drive the
// REAL readout (typed input + 500 ms debounce + Clear button) against a
// scripted server that separates WRITE-EFFECT order from RESPONSE order: a
// POST's effect lands when the request ARRIVES, a GET snapshots the book when
// it ARRIVES, and the test releases each response in whatever order it likes.
// They fail RED against the unfenced source (the second POST left before the
// first readback settled, and the stale readback painted), and GREEN against
// the chained, fenced section.
// ---------------------------------------------------------------------------

type ServerPending = {
  method: "GET" | "POST";
  snapshot: PortfolioTargetsSummary | null;
  forcedStatus: number | null;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
};

function installServer(targeted: Record<string, number>, holdings: string[]) {
  const realFetch = globalThis.fetch;
  const stored = new Map(Object.entries(targeted).map(([k, v]) => [k, { target: v, band: 5 }]));
  const pending: ServerPending[] = [];
  const arrivals: string[] = [];
  const failNext: number[] = [];
  const book = (): PortfolioTargetsSummary => summary(
    holdings.filter((tk) => stored.has(tk)).map((tk) => ({
      ticker: tk,
      currentWeightPct: 10,
      targetWeightPct: stored.get(tk)!.target,
      bandPct: stored.get(tk)!.band,
      driftPct: 10 - stored.get(tk)!.target,
      status: "within_band" as const,
    })),
    holdings.filter((tk) => !stored.has(tk)).map((tk) => ({ ticker: tk, currentWeightPct: 10 })),
  );
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = ((init?.method ?? "GET").toUpperCase()) as "GET" | "POST";
    let forcedStatus: number | null = null;
    let label = "GET";
    if (method === "POST") {
      const body = JSON.parse(String(init?.body)) as { action: string; ticker: string; targetWeightPct?: number; bandPct?: number };
      forcedStatus = failNext.shift() ?? null;
      // The write effect lands on arrival — unless this request is scripted to
      // fail, in which case the server never applied it.
      if (forcedStatus === null) {
        if (body.action === "set") stored.set(body.ticker, { target: body.targetWeightPct!, band: body.bandPct ?? 5 });
        else if (body.action === "clear") stored.delete(body.ticker);
      }
      label = `POST ${body.action} ${body.ticker}${body.action === "set" ? ` ${body.targetWeightPct}` : ""}`;
    }
    arrivals.push(label);
    const snapshot = method === "GET" ? book() : null;
    return new Promise<Response>((resolve, reject) => {
      pending.push({ method, snapshot, forcedStatus, resolve, reject });
    });
  }) as typeof fetch;

  return {
    arrivals,
    /** The next POST to ARRIVE fails with this status and its write is not applied. */
    failNextPost(status: number) { failNext.push(status); },
    /** Release the n-th arrival (1-based). GETs answer with the book as it was on arrival. */
    async release(n: number, opts: { networkError?: boolean; status?: number } = {}) {
      const p = pending[n - 1];
      if (!p) throw new Error(`no arrival #${n} (have ${pending.length})`);
      await act(async () => {
        if (opts.networkError) p.reject(new TypeError("network down"));
        else if (p.method === "GET") p.resolve(jsonRes(opts.status ?? 200, opts.status && opts.status >= 400 ? { error: "boom" } : { summary: p.snapshot }));
        else p.resolve(jsonRes(opts.status ?? p.forcedStatus ?? 200, { ok: true }));
      });
      await settle();
    },
    restore() { globalThis.fetch = realFetch; },
  };
}

/** Macrotask-based flush: lets the fetch → json → setState chain run to rest. */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise<void>((r) => setImmediate(r)); });
  }
}

function targetInput(ticker: string): HTMLInputElement {
  const label = T_ARIA_TARGET.en.split("{ticker}").join(ticker);
  const el = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!el) throw new Error(`no target input for ${ticker}`);
  return el;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Run the readout's 500 ms debounce and let the resulting POST arrive. */
async function debounce() {
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  await settle();
}

function card(ticker: string) {
  return container?.querySelector(`article[data-ticker="${ticker}"]`) ?? null;
}

function untargetedRow(ticker: string) {
  return container?.querySelector(`[data-ticker="${ticker}"][data-status="untargeted"]`) ?? null;
}

function rerender(props: SectionProps) {
  act(() => { root!.render(<SectionPortfolioTargets {...props} />); });
}

describe("SectionPortfolioTargets readback ordering (macro#6819 C2)", () => {
  let server: ReturnType<typeof installServer> | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    server?.restore();
    server = null;
    vi.useRealTimers();
  });

  async function mountBook(targeted: Record<string, number>, holdings: string[], props = baseProps("en")) {
    server = installServer(targeted, holdings);
    mount(props);
    await server.release(1); // the mount GET
    expect(server.arrivals).toEqual(["GET"]);
    return server;
  }

  it("Save → Save: the older readback released last never paints, and the second POST waits for the first readback", async () => {
    const s = await mountBook({ AAPL: 10 }, ["AAPL"]);
    typeInto(targetInput("AAPL"), "20");
    await debounce();
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20"]);
    await s.release(2);                       // POST 20 ok → readback #3 leaves
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET"]);

    typeInto(targetInput("AAPL"), "30");
    await debounce();
    // Constraint 1: no second POST until the first mutation's readback settles.
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET"]);

    await s.release(3);                       // the OLDER readback (book = 20) lands last-but-one
    // Constraint 2: a readback older than the newest intent is never painted.
    expect(targetInput("AAPL").value).toBe("30");
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET", "POST set AAPL 30"]);

    await s.release(4);                       // POST 30 ok → readback #5
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET", "POST set AAPL 30", "GET"]);
    await s.release(5);
    expect(targetInput("AAPL").value).toBe("30");
    expect(card("AAPL")).not.toBeNull();
  });

  it("Save → Clear: the save's late readback cannot bring the cleared target back", async () => {
    const s = await mountBook({ AAPL: 10 }, ["AAPL"]);
    typeInto(targetInput("AAPL"), "20");
    await debounce();
    await s.release(2);                       // POST 20 ok → readback #3 in flight (book = 20)
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET"]);

    const clear = card("AAPL")!.querySelector("button")!;
    await act(async () => { clear.click(); });
    await settle();
    // The clear's POST is queued behind the save's readback, not raced against it.
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET"]);

    await s.release(3);                       // stale readback: AAPL still 20 — must not repaint later
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET", "POST clear AAPL"]);
    await s.release(4);                       // clear ok → readback #5 (book: AAPL untargeted)
    await s.release(5);
    expect(card("AAPL")).toBeNull();
    expect(untargetedRow("AAPL")).not.toBeNull();
  });

  it("Clear → Save on the same row: the save is written after the clear and the row ends targeted", async () => {
    const s = await mountBook({ AAPL: 10 }, ["AAPL"]);
    const clear = card("AAPL")!.querySelector("button")!;
    await act(async () => { clear.click(); });
    await settle();
    expect(s.arrivals).toEqual(["GET", "POST clear AAPL"]);

    typeInto(targetInput("AAPL"), "25");       // the card is still mounted: the clear has not read back yet
    await debounce();
    expect(s.arrivals).toEqual(["GET", "POST clear AAPL"]);   // queued behind the clear

    await s.release(2);                       // clear ok; its readback is skipped — a newer intent exists
    expect(s.arrivals).toEqual(["GET", "POST clear AAPL", "POST set AAPL 25"]);
    await s.release(3);                       // set ok → the one readback
    expect(s.arrivals).toEqual(["GET", "POST clear AAPL", "POST set AAPL 25", "GET"]);
    await s.release(4);
    expect(card("AAPL")).not.toBeNull();
    expect(untargetedRow("AAPL")).toBeNull();
    expect(targetInput("AAPL").value).toBe("25");
  });

  it("two tickers overlapping: both saves land in order and neither reverts", async () => {
    const s = await mountBook({ AAPL: 10, MSFT: 10 }, ["AAPL", "MSFT"]);
    typeInto(targetInput("AAPL"), "20");
    await debounce();
    typeInto(targetInput("MSFT"), "30");
    await debounce();
    // One chain per SECTION: MSFT's POST waits for AAPL's, so a whole-book
    // readback taken for AAPL can never carry a pre-save MSFT.
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20"]);
    await s.release(2);
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "POST set MSFT 30"]);
    await s.release(3);
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "POST set MSFT 30", "GET"]);
    await s.release(4);
    expect(targetInput("AAPL").value).toBe("20");
    expect(targetInput("MSFT").value).toBe("30");
  });

  it("a later POST failure keeps the prior successful write on screen (readback still runs)", async () => {
    const s = await mountBook({ AAPL: 10 }, ["AAPL"]);
    typeInto(targetInput("AAPL"), "20");
    await debounce();
    await s.release(2);                       // 20 written; readback #3 in flight
    typeInto(targetInput("AAPL"), "30");
    s.failNextPost(503);
    await debounce();
    await s.release(3);                       // readback of 20 — older than the 30 intent, not painted
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET", "POST set AAPL 30"]);
    await s.release(4);                       // 503: the server never applied 30
    // The failed mutation is still the newest intent, so it reads back — and the
    // book says 20, the last write that succeeded.
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET", "POST set AAPL 30", "GET"]);
    await s.release(5);
    expect(targetInput("AAPL").value).toBe("20");
    expect(card("AAPL")).not.toBeNull();
    expect(text()).toContain("We couldn't confirm this change. Refresh to check your saved target.");
  });

  it("a readback that fails after a successful POST hands the section to its own loader (loading → loaded)", async () => {
    const s = await mountBook({ AAPL: 10 }, ["AAPL"]);
    typeInto(targetInput("AAPL"), "20");
    await debounce();
    await s.release(2);                       // POST ok → readback #3
    await s.release(3, { networkError: true });
    // Not a silent stale summary: the owned loader re-runs with its existing states.
    expect(container?.querySelector('[data-testid="portfolio-targets-loading"]')).not.toBeNull();
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET", "GET"]);
    await s.release(4);
    expect(container?.querySelector('[data-testid="portfolio-targets-loaded"]')).not.toBeNull();
    expect(targetInput("AAPL").value).toBe("20");
  });

  it("a readback that answers 5xx after a successful POST also re-reads through the loader", async () => {
    const s = await mountBook({ AAPL: 10 }, ["AAPL"]);
    typeInto(targetInput("AAPL"), "20");
    await debounce();
    await s.release(2);
    await s.release(3, { status: 500 });
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET", "GET"]);
    await s.release(4);
    expect(targetInput("AAPL").value).toBe("20");
  });

  it("owner transition: an in-flight mutation never reads back into, or writes as, the new owner", async () => {
    const s = await mountBook({ AAPL: 10 }, ["AAPL"]);
    typeInto(targetInput("AAPL"), "20");
    await debounce();                          // POST #2 in flight under user-1
    typeInto(targetInput("AAPL"), "30");
    await debounce();                          // queued behind #2 (owner captured = user-1)
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20"]);

    const next = baseProps("en");
    next.email = "b@example.com";
    next.identity = { kind: "account", userId: "user-2", email: "b@example.com" };
    next.user = { ...next.user!, id: "user-2", email: "b@example.com" };
    rerender(next);
    await settle();
    // The owner change re-runs the loader for user-2 (arrival #3).
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET"]);
    await s.release(2);                        // user-1's POST resolves after the switch
    await s.release(3);                        // user-2's book
    // No readback for the old owner, and the queued "30" never left as user-2.
    expect(s.arrivals).toEqual(["GET", "POST set AAPL 20", "GET"]);
    expect(container?.querySelector('[data-testid="portfolio-targets-loaded"]')).not.toBeNull();
  });
});

// Recovery is deliberately GET-only. A failed read must not imply an empty book,
// resubmit a successful save, or require leaving and reopening Settings.
describe("SectionPortfolioTargets manual read recovery", () => {
  function retryButton(): HTMLButtonElement {
    const button = container?.querySelector<HTMLButtonElement>('[data-testid="portfolio-targets-unreadable"] button');
    expect(button, "an unreadable read needs a native recovery button").not.toBeNull();
    return button!;
  }

  for (const lang of ["en", "zh"] as const) {
    it(`recovers the mounted ${lang} section from 503 using a localized GET-only retry`, async () => {
      const calls: { url: string; method: string }[] = [];
      let resolveRetry!: (r: Response) => void;
      restoreFetch = installFetch({
        calls,
        nextGet: async () => calls.length === 1
          ? jsonRes(503, { error: "targets unavailable" })
          : new Promise<Response>((resolve) => { resolveRetry = resolve; }),
      });
      mount(baseProps(lang));
      await flush();
      expect(container?.querySelector('[data-testid="portfolio-targets-empty"]')).toBeNull();
      const button = retryButton();
      expect(button.type).toBe("button");
      expect(button.textContent).toBe(LEX.portfolioUnreadableRetry[lang === "zh" ? 1 : 0]);
      button.focus();
      expect(document.activeElement).toBe(button);
      act(() => { button.click(); button.click(); });
      await flush();
      expect(calls).toEqual([
        { url: "/api/portfolio/targets", method: "GET" },
        { url: "/api/portfolio/targets", method: "GET" },
      ]);
      expect(container?.querySelector('[data-testid="portfolio-targets-loading"]')).not.toBeNull();
      expect(container?.querySelector('[data-testid="portfolio-targets-loading"]')?.getAttribute("role")).toBe("status");
      expect(container?.querySelector('[data-testid="portfolio-targets-unreadable"]')).toBeNull();
      // Further activation of the removed button cannot start another pending read.
      act(() => { button.click(); });
      await flush();
      expect(calls).toHaveLength(2);
      await act(async () => { resolveRetry(jsonRes(200, { summary: summary() })); });
      await flush();
      expect(container?.querySelector('[data-testid="portfolio-targets-empty"]')).not.toBeNull();
    });
  }

  it.each(["network", "invalid-json", "missing-summary"] as const)(
    "recovers a %s failure and preserves the recovered weight and band",
    async (failure) => {
      const calls: { url: string; method: string }[] = [];
      const row = { ticker: "AAPL", currentWeightPct: 10, targetWeightPct: 18.75, bandPct: 2.5, driftPct: -8.75, status: "outside_band" as const };
      restoreFetch = installFetch({
        calls,
        nextGet: async () => {
          if (calls.length > 1) return jsonRes(200, { summary: summary([row]) });
          if (failure === "network") throw new TypeError("network unavailable");
          if (failure === "invalid-json") return new Response("{", { status: 200 });
          return jsonRes(200, {});
        },
      });
      mount(baseProps("en"));
      await flush();
      expect(container?.querySelector('[data-testid="portfolio-targets-loaded"]')).toBeNull();
      act(() => retryButton().click());
      await flush();
      expect(targetInput("AAPL").value).toBe("18.75");
      const bandLabel = T_ARIA_BAND.en.split("{ticker}").join("AAPL");
      expect(container?.querySelector<HTMLInputElement>(`input[aria-label="${bandLabel}"]`)?.value).toBe("2.5");
      expect(text()).toContain("Weighted by what you paid.");
      expect(calls.every((c) => c.method === "GET")).toBe(true);
    },
  );

  it("offers another retry after a second failure instead of claiming an empty book", async () => {
    const calls: { url: string; method: string }[] = [];
    restoreFetch = installFetch({
      calls,
      nextGet: async () => calls.length < 3
        ? jsonRes(503, { error: "still unavailable" })
        : jsonRes(200, { summary: summary() }),
    });
    mount(baseProps("en"));
    await flush();
    act(() => retryButton().click());
    await flush();
    expect(container?.querySelector('[data-testid="portfolio-targets-empty"]')).toBeNull();
    act(() => retryButton().click());
    await flush();
    expect(calls).toHaveLength(3);
    expect(container?.querySelector('[data-testid="portfolio-targets-empty"]')).not.toBeNull();
  });

  it("aborts an old owner's retry and rejects its late success after an owner switch", async () => {
    const requests: { signal?: AbortSignal | null; resolve: (r: Response) => void }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => requests.push({ signal: init?.signal, resolve })),
    ) as typeof fetch;
    restoreFetch = () => { globalThis.fetch = realFetch; };
    mount(baseProps("en"));
    await act(async () => requests[0].resolve(jsonRes(503, {})));
    await flush();
    act(() => retryButton().click());
    await flush();
    const next = baseProps("en");
    next.email = "b@example.com";
    next.identity = { kind: "account", userId: "user-2", email: next.email };
    next.user = { ...next.user!, id: "user-2", email: next.email };
    rerender(next);
    await flush();
    expect(requests).toHaveLength(3);
    expect(requests[1].signal?.aborted).toBe(true);
    await act(async () => requests[2].resolve(jsonRes(200, { summary: summary([], [{ ticker: "NEW", currentWeightPct: 100 }]) })));
    await flush();
    await act(async () => requests[1].resolve(jsonRes(200, { summary: summary([], [{ ticker: "OLD", currentWeightPct: 100 }]) })));
    await flush();
    expect(text()).toContain("NEW");
    expect(text()).not.toContain("OLD");
  });

  it("aborts a retry on unmount and keeps its late response out of a new mount", async () => {
    const requests: { signal?: AbortSignal | null; resolve: (r: Response) => void }[] = [];
    const realFetch = globalThis.fetch;
    const fetchStub = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => requests.push({ signal: init?.signal, resolve })),
    ) as typeof fetch;
    globalThis.fetch = fetchStub;
    restoreFetch = () => { globalThis.fetch = realFetch; };
    mount(baseProps("en"));
    await act(async () => requests[0].resolve(jsonRes(503, {})));
    await flush();
    act(() => retryButton().click());
    await flush();
    unmount();
    expect(requests[1].signal?.aborted).toBe(true);
    globalThis.fetch = fetchStub;
    restoreFetch = () => { globalThis.fetch = realFetch; };
    mount(baseProps("en"));
    await act(async () => requests[2].resolve(jsonRes(200, { summary: summary() })));
    await flush();
    await act(async () => requests[1].resolve(jsonRes(200, { summary: summary([], [{ ticker: "OLD", currentWeightPct: 100 }]) })));
    await flush();
    expect(container?.querySelector('[data-testid="portfolio-targets-empty"]')).not.toBeNull();
    expect(text()).not.toContain("OLD");
  });

  it("only re-reads after a committed save and two failed readbacks; never resubmits the save", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const server = installServer({ AAPL: 10 }, ["AAPL"]);
    restoreFetch = server.restore;
    try {
      mount(baseProps("en"));
      await server.release(1);
      typeInto(targetInput("AAPL"), "18.75");
      await debounce();
      await server.release(2); // committed write
      await server.release(3, { status: 503 }); // mutation readback
      await server.release(4, { status: 503 }); // owned loader
      act(() => retryButton().click());
      await settle();
      expect(server.arrivals).toEqual(["GET", "POST set AAPL 18.75", "GET", "GET", "GET"]);
      await server.release(5);
      expect(targetInput("AAPL").value).toBe("18.75");
      expect(server.arrivals.filter((s) => s.startsWith("POST"))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Owner transition generation (Terminal #805 C4 6077639575).
// These fixtures retain the real section + real readout while changing props.
// They do not model a browser sign-out, use real authentication, or send HTTP.
function ownerProps(owner: "A" | "B", lang: "en" | "zh" = "en"): SectionProps {
  const props = baseProps(lang);
  const email = `${owner.toLowerCase()}@example.test`;
  return { ...props, email, identity: { kind: "account", userId: owner, email }, user: { ...props.user!, id: owner, email } };
}

function installOwnerServer() {
  const original = globalThis.fetch;
  let owner: "A" | "B" = "A";
  const targets = { A: 10, B: 80 };
  const requests: { method: string; owner: "A" | "B"; signal?: AbortSignal | null; snapshot: PortfolioTargetsSummary; resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
  const arrivals: string[] = [];
  const book = (value: number) => summary([{ ticker: "AAPL", currentWeightPct: 10, targetWeightPct: value, bandPct: 5, driftPct: 10 - value, status: "within_band" }]);
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (input !== "/api/portfolio/targets") throw new Error(`unexpected fixture endpoint: ${String(input)}`);
    const method = init?.method ?? "GET";
    let label = `${owner} ${method}`;
    if (method === "POST") {
      const payload = JSON.parse(String(init?.body));
      if (payload.action !== "set" || payload.ticker !== "AAPL") throw new Error("unexpected fixture mutation");
      targets[owner] = payload.targetWeightPct;
      label += ` ${payload.targetWeightPct}`;
    } else if (method !== "GET") throw new Error(`unexpected fixture method: ${method}`);
    arrivals.push(label);
    return new Promise<Response>((resolve, reject) => requests.push({ method, owner, signal: init?.signal, snapshot: book(targets[owner]), resolve, reject }));
  }) as typeof fetch;
  return {
    arrivals, requests,
    owner(next: "A" | "B") { owner = next; },
    target(next: "A" | "B", value: number) { targets[next] = value; },
    async release(n: number, outcome: "ok" | "503" | "network" | "missing-summary" | "invalid-json" = "ok") {
      const req = requests[n - 1];
      if (!req) throw new Error(`missing fixture arrival ${n}`);
      await act(async () => {
        if (outcome === "network") req.reject(new TypeError("fixture network failure"));
        else if (outcome === "invalid-json") req.resolve(new Response("{", { status: 200 }));
        else req.resolve(jsonRes(outcome === "503" ? 503 : 200, outcome === "missing-summary" ? {} : { summary: req.snapshot }));
      });
      await settle();
    },
    restore() { globalThis.fetch = original; },
  };
}

describe("SectionPortfolioTargets owner generation (C4 mounted contract)", () => {
  let s: ReturnType<typeof installOwnerServer>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    s = installOwnerServer();
    restoreFetch = s.restore;
  });
  afterEach(() => { vi.useRealTimers(); });

  async function switchOwner(owner: "A" | "B", lang: "en" | "zh" = "en") {
    s.owner(owner);
    rerender(ownerProps(owner, lang));
    await settle();
  }
  async function oldAReadback() {
    mount(ownerProps("A"));
    await s.release(1);
    expect(targetInput("AAPL").value).toBe("10");
    typeInto(targetInput("AAPL"), "20");
    await debounce();
    await s.release(2);
    expect(s.arrivals).toEqual(["A GET", "A POST 20", "A GET"]);
  }
  async function returnAndRetry(target = 20) {
    await switchOwner("B");
    await s.release(4);
    expect(targetInput("AAPL").value).toBe("80");
    s.target("A", target);
    await switchOwner("A");
    await s.release(5, "503");
    const retry = container?.querySelector<HTMLButtonElement>('[data-testid="portfolio-targets-unreadable"] button');
    expect(retry).not.toBeNull();
    act(() => retry!.click());
    await settle();
    await s.release(6);
    expect(targetInput("AAPL").value).toBe(String(target));
    expect(s.arrivals).toEqual(["A GET", "A POST 20", "A GET", "B GET", "A GET", "A GET"]);
  }
  function expectRecovered(target: string, requests = 6) {
    expect(container?.querySelector('[data-testid="portfolio-targets-loading"]')).toBeNull();
    expect(container?.querySelector('[data-testid="portfolio-targets-loaded"]')).not.toBeNull();
    expect(targetInput("AAPL").value).toBe(target);
    expect(s.arrivals).toHaveLength(requests);
    expect(s.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  }

  it.each(["503", "network", "missing-summary", "invalid-json"] as const)(
    "A→B→A: obsolete %s readback cannot restart the loader after Retry recovered",
    async (outcome) => {
      await oldAReadback();
      await returnAndRetry();
      await s.release(3, outcome);
      expect.soft(s.arrivals).toEqual(["A GET", "A POST 20", "A GET", "B GET", "A GET", "A GET"]);
      // An obsolete failed readback must not send request seven or hide target 20.
      expectRecovered("20");
    },
  );

  it("A→B→A: obsolete successful readback cannot replace returned-A Retry data", async () => {
    await oldAReadback(); // GET #3 snapshots A=20
    await returnAndRetry(35); // controlled fixture now supplies A=35
    await s.release(3);
    expectRecovered("35");
  });

  it.each(["503", "ok"] as const)("without Retry: A→B→A rejects obsolete %s readbacks after the returned-A loader succeeds", async (outcome) => {
    await oldAReadback();
    await switchOwner("B");
    await s.release(4);
    s.target("A", 35);
    await switchOwner("A");
    await s.release(5);
    expect(targetInput("AAPL").value).toBe("35");
    await s.release(3, outcome);
    expect.soft(s.arrivals).toEqual(["A GET", "A POST 20", "A GET", "B GET", "A GET"]);
    expectRecovered("35", 5);
  });

  it.each(["503", "ok"] as const)("A→B: obsolete %s readback still cannot replace B or reload", async (outcome) => {
    await oldAReadback();
    await switchOwner("B");
    await s.release(4);
    await s.release(3, outcome);
    expectRecovered("80", 4);
  });

  it.each(["same-owner", "locale"] as const)("%s rerender keeps a valid mutation live before and during readback", async (change) => {
    mount(ownerProps("A"));
    await s.release(1);
    typeInto(targetInput("AAPL"), "20");
    await debounce();
    rerender(ownerProps("A", change === "locale" ? "zh" : "en"));
    await settle();
    await s.release(2); // the legitimate readback must still leave
    expect(s.arrivals).toEqual(["A GET", "A POST 20", "A GET"]);
    rerender(ownerProps("A", "en"));
    await settle();
    await s.release(3);
    expectRecovered("20", 3);
  });

  it("new returned-A mutation still saves, serialized behind the retired readback", async () => {
    await oldAReadback();
    await returnAndRetry();
    typeInto(targetInput("AAPL"), "30");
    await debounce();
    expect(s.arrivals).toHaveLength(6); // existing chain has not been bypassed
    await s.release(3, "503");
    expect(s.arrivals).toEqual(["A GET", "A POST 20", "A GET", "B GET", "A GET", "A GET", "A POST 30"]);
    expect(targetInput("AAPL").value).toBe("30");
    await s.release(7);
    await s.release(8);
    expect(targetInput("AAPL").value).toBe("30");
    expect(s.requests.filter((r) => r.method === "POST")).toHaveLength(2);
    expect(s.arrivals).toHaveLength(8);
  });

  it.each(["503", "ok"] as const)("loader-only A→B→A keeps both abandoned loader signals aborted on late %s", async (outcome) => {
    mount(ownerProps("A"));
    await switchOwner("B");
    s.target("A", 40);
    await switchOwner("A");
    expect(s.requests[0].signal?.aborted).toBe(true);
    expect(s.requests[1].signal?.aborted).toBe(true);
    expect(s.requests[2].signal?.aborted).toBe(false);
    await s.release(3);
    await s.release(1, outcome);
    await s.release(2, outcome);
    expect(targetInput("AAPL").value).toBe("40");
    expect(s.arrivals).toEqual(["A GET", "B GET", "A GET"]);
  });

  it("an already-submitted A POST is neither canceled nor replayed across A→B→A", async () => {
    mount(ownerProps("A"));
    await s.release(1);
    typeInto(targetInput("AAPL"), "20");
    await debounce(); // POST #2 submitted; hold its response
    expect(s.requests[1].signal).toBeUndefined();
    await switchOwner("B");
    await s.release(3);
    await switchOwner("A");
    await s.release(4);
    await s.release(2);
    expectRecovered("20", 4); // no obsolete readback starts after the POST settles
    typeInto(targetInput("AAPL"), "30");
    await debounce();
    await s.release(5);
    await s.release(6);
    expect(targetInput("AAPL").value).toBe("30");
    expect(s.arrivals).toEqual(["A GET", "A POST 20", "B GET", "A GET", "A POST 30", "A GET"]);
  });

  it("keeps the existing queued-POST policy when the same owner returns", async () => {
    mount(ownerProps("A"));
    await s.release(1);
    typeInto(targetInput("AAPL"), "20");
    await debounce(); // submitted first POST remains unresolved
    typeInto(targetInput("AAPL"), "25");
    await debounce(); // queued second intent, same original owner generation
    expect(s.arrivals).toHaveLength(2);
    await switchOwner("B");
    await s.release(3);
    await switchOwner("A");
    await s.release(4);
    await s.release(2);
    expect(s.arrivals).toEqual(["A GET", "A POST 20", "B GET", "A GET", "A POST 25"]);
    await s.release(5);
    // Retiring old readbacks does not add generation cancellation before POST.
    expect(s.requests.filter((r) => r.method === "POST")).toHaveLength(2);
    expect(s.arrivals).toHaveLength(5);
    expect(targetInput("AAPL").value).toBe("20");
    typeInto(targetInput("AAPL"), "30");
    await debounce();
    await s.release(6);
    await s.release(7);
    expect(targetInput("AAPL").value).toBe("30");
  });
});
