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
import { T_ARIA_TARGET, type PortfolioTargetsSummary } from "@/lib/portfolioTargets";

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
    expect(text()).toContain("Could not save");
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
