// @vitest-environment jsdom
/**
 * Failure-state truth on the EOD context belt: a settled read that did not land is not an
 * unpublished one.
 *
 * The belt reads four artifacts of its own (darkpool, oiconf, moves:<root>, vol:<root>)
 * and is handed the two level stores by the Exposure Desk. The REAL flowClientCache runs
 * against a stubbed fetch, so the chain is exercised end to end: transport →
 * classification → per-source read state → rendered copy.
 *
 * Only a 404/410 may print "not published" / "hasn't published yet". A 5xx, a rejected
 * fetch or an unparseable body renders "could not load" with a Retry that re-reads the
 * failed keys in place — and only those.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/Tip", () => ({
  Tip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EodContextBelt } from "@/components/eodcontext/EodContextBelt";
import { flowInvalidate } from "@/lib/flowClientCache";
import type { EodReadStatus, StructureGexState } from "@/lib/eodContext";

const DP_LOAD_ERROR = "Could not load the off-exchange panel";
const DP_ABSENT = "hasn't published yet";
const BELT_LOAD_ERROR = "Could not load the settled structure";
const BELT_EMPTY = "No settled structure published for this ticker yet";
const BELT_LOADING = "Reading the settled structure…";
const CELL_FAILED = "could not load";
const CELL_ABSENT = "not published";
const CELL_READING = "reading…";

type Answer = { status: number; body: string };
type Reply = Answer | "reject" | "pending";
const json = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });
const UNAVAILABLE = json(503, { error: "feed unavailable" });
const ABSENT = json(404, { error: "not published" });
const UNPARSEABLE: Answer = { status: 200, body: "<html>upstream error page</html>" };

const ROOT = "NVDA";
const DARKPOOL = json(200, {
  schema: "darkpool_eod.v1",
  asof: "2026-10-08",
  universe: [{ ticker: "NVDA", asof: "2026-10-08", oe_share: 0.46, oe_z: 1.8, trend_pp: -2.4, ratio_z: -0.9, n_days: 60 }],
});
const MOVES = json(200, { asof: "2026-10-08", root: ROOT, expected_move: { pct: 3.2, lo: 128, hi: 136 } });
const VOL = json(200, { asof: "2026-10-08", root: ROOT, iv_rank_252: 42, atm_iv: 0.48 });
const OICONF = json(200, { asof: "2026-10-08", confirmed: [{ root: "NVDA", right: "C", exp: "2026-10-17", strike: 140, delta_oi: 12000 }] });
const OICONF_OTHER_ROOT = json(200, { asof: "2026-10-08", confirmed: [{ root: "AMD", right: "C", exp: "2026-10-17", strike: 160, delta_oi: 900 }] });
const LEVELS: StructureGexState = { asof: "2026-10-08", call_wall: 140, put_wall: 120, gamma_flip: 130, max_pain: 132 };
const LEVELS_READ = { gexstate: "data", gex: "data" } as const;
const NO_LEVELS = { gexstate: "absent", gex: "absent" } as const;

let replies: Record<string, Reply>;
const keyOf = (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://terminal.test");
  if (url.pathname === "/api/flow") return url.searchParams.get("f") ?? "";
  return url.pathname;
};
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const reply = replies[keyOf(input)] ?? ABSENT;
  if (reply === "reject") throw new TypeError("Failed to fetch");
  if (reply === "pending") return new Promise<Response>(() => undefined);
  return new Response(reply.body, { status: reply.status, headers: { "content-type": "application/json" } });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  flowInvalidate();
  replies = { darkpool: DARKPOOL, oiconf: OICONF, [`moves:${ROOT}`]: MOVES, [`vol:${ROOT}`]: VOL };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  flowInvalidate();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
type Levels = { gexstate: EodReadStatus; gex: EodReadStatus };
async function mount(opts: { root?: string; gexState?: StructureGexState | null; levelReads?: Levels; onRetryLevels?: () => void } = {}) {
  await act(async () => root.render(
    <EodContextBelt
      root={opts.root ?? ROOT}
      gexState={opts.gexState === undefined ? LEVELS : opts.gexState}
      gex={null}
      lang="en"
      levelReads={opts.levelReads ?? LEVELS_READ}
      onRetryLevels={opts.onRetryLevels}
    />,
  ));
  await settle();
}
const text = (el: ParentNode | null = host) => (el as Element | null)?.textContent ?? "";
const within = (selector: string) => host.querySelector(selector);
const darkPool = () => within('section[aria-label="Dark pool positioning context"]');
const strip = () => within('section[aria-label="End-of-day options structure context"]');
const cell = (key: string) => within(`[data-testid="eod-cell-${key}"]`);
// The cell is label · value · note; its textContent runs them together, so the value is
// read from its own span (a regex on the whole cell could never see a standalone "0").
const cellValue = (key: string) => text(cell(key)?.children[1] ?? null);
const requested = (key: string) => fetchMock.mock.calls.filter(([u]) => keyOf(u) === key).length;
const retryIn = (el: ParentNode | null) =>
  el ? [...el.querySelectorAll("button")].find((b) => b.textContent === "Retry") ?? null : null;
async function clickRetry(el: ParentNode | null) {
  const button = retryIn(el);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
  await settle();
}

const FAILURES: [string, Reply][] = [
  ["a 5xx", UNAVAILABLE],
  ["a rejected fetch (network failure)", "reject"],
  ["an unparseable 200", UNPARSEABLE],
];

describe("EOD belt — dark pool: a failed read is not an unpublished panel", () => {
  it.each(FAILURES)("renders the load error with Retry for %s", async (_label, reply) => {
    replies.darkpool = reply;
    await mount();
    const error = within('[data-testid="eod-darkpool-load-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(DP_LOAD_ERROR);
    expect(retryIn(darkPool())).not.toBeNull();
    expect(text(darkPool())).not.toContain(DP_ABSENT);
  });

  it("keeps the unpublished copy for a real 404, with nothing to retry", async () => {
    replies.darkpool = ABSENT;
    await mount();
    expect(text(darkPool())).toContain(DP_ABSENT);
    expect(within('[data-testid="eod-darkpool-load-error"]')).toBeNull();
    expect(retryIn(darkPool())).toBeNull();
  });

  it("does not claim the panel is unpublished while it is still being read", async () => {
    replies.darkpool = "pending";
    await mount();
    expect(text(darkPool())).not.toContain(DP_ABSENT);
    expect(within('[data-testid="eod-darkpool-load-error"]')).toBeNull();
  });

  it("re-reads in place: Retry asks the store again and renders what it answers", async () => {
    replies.darkpool = UNAVAILABLE;
    await mount();
    replies.darkpool = DARKPOOL;
    await clickRetry(darkPool());
    expect(requested("darkpool")).toBe(2);
    expect(within('[data-testid="eod-darkpool-load-error"]')).toBeNull();
    expect(text(darkPool())).not.toContain(DP_ABSENT);
    expect(text(darkPool())).toContain("46");
  });

  it("a Retry that fails again stays a load error", async () => {
    replies.darkpool = UNAVAILABLE;
    await mount();
    replies.darkpool = "reject";
    await clickRetry(darkPool());
    expect(requested("darkpool")).toBe(2);
    expect(within('[data-testid="eod-darkpool-load-error"]')).not.toBeNull();
    expect(text(darkPool())).not.toContain(DP_ABSENT);
  });
});

describe("EOD belt — structure: a failed read is not an unpublished value", () => {
  it.each(FAILURES)("a whole belt that did not load says so, with Retry, for %s", async (_label, reply) => {
    replies.oiconf = reply;
    replies[`moves:${ROOT}`] = reply;
    replies[`vol:${ROOT}`] = reply;
    await mount({ gexState: null, levelReads: NO_LEVELS });
    const error = within('[data-testid="eod-structure-load-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(BELT_LOAD_ERROR);
    expect(retryIn(strip())).not.toBeNull();
    expect(text(strip())).not.toContain(BELT_EMPTY);
  });

  it("keeps the empty belt only when every source proved absence, with nothing to retry", async () => {
    replies.oiconf = ABSENT;
    replies[`moves:${ROOT}`] = ABSENT;
    replies[`vol:${ROOT}`] = ABSENT;
    await mount({ gexState: null, levelReads: NO_LEVELS });
    expect(text(strip())).toContain(BELT_EMPTY);
    expect(within('[data-testid="eod-structure-load-error"]')).toBeNull();
    expect(retryIn(strip())).toBeNull();
  });

  it.each(FAILURES)("marks only the failed cell as not loaded for %s, and offers Retry", async (_label, reply) => {
    replies[`moves:${ROOT}`] = reply;
    replies[`vol:${ROOT}`] = ABSENT;
    await mount();
    expect(text(cell("expMove"))).toContain(CELL_FAILED);
    expect(text(cell("expMove"))).not.toContain(CELL_ABSENT);
    expect(text(cell("ivPct"))).toContain(CELL_ABSENT);
    expect(text(cell("callWall"))).toContain("140");
    expect(within('[data-testid="eod-structure-partial-error"]')).not.toBeNull();
    expect(retryIn(strip())).not.toBeNull();
  });

  it("a failed OI-confirmation read is never a count of zero", async () => {
    replies.oiconf = UNAVAILABLE;
    await mount();
    expect(text(cell("oiConf"))).toContain(CELL_FAILED);
    expect(cellValue("oiConf")).toBe("—");
  });

  it("a published feed that confirmed nothing for this root is still a real zero", async () => {
    replies.oiconf = OICONF_OTHER_ROOT;
    await mount();
    expect(cellValue("oiConf")).toBe("0");
    expect(text(cell("oiConf"))).not.toContain(CELL_FAILED);
    expect(within('[data-testid="eod-structure-partial-error"]')).toBeNull();
  });

  it("Retry re-reads only the keys that failed and renders what they answer", async () => {
    replies[`moves:${ROOT}`] = UNAVAILABLE;
    replies[`vol:${ROOT}`] = ABSENT;
    await mount();
    replies[`moves:${ROOT}`] = MOVES;
    await clickRetry(strip());
    expect(requested(`moves:${ROOT}`)).toBe(2);
    expect(requested(`vol:${ROOT}`)).toBe(1);
    expect(requested("oiconf")).toBe(1);
    expect(text(cell("expMove"))).toContain("±3.2%");
    expect(within('[data-testid="eod-structure-partial-error"]')).toBeNull();
  });

  it("does not claim anything is unpublished while the belt is still being read", async () => {
    replies.oiconf = "pending";
    replies[`moves:${ROOT}`] = "pending";
    replies[`vol:${ROOT}`] = "pending";
    await mount({ gexState: null, levelReads: { gexstate: "loading", gex: "loading" } });
    expect(text(strip())).toContain(BELT_LOADING);
    expect(text(strip())).not.toContain(BELT_EMPTY);
    expect(text(strip())).not.toContain(CELL_ABSENT);
  });

  it("a cell still being read says so rather than 'not published'", async () => {
    replies[`moves:${ROOT}`] = "pending";
    await mount();
    expect(text(cell("expMove"))).toContain(CELL_READING);
    expect(text(cell("expMove"))).not.toContain(CELL_ABSENT);
  });

  it("a root switch does not carry the previous root's failure onto the new root", async () => {
    replies[`moves:${ROOT}`] = UNAVAILABLE;
    await mount();
    expect(text(cell("expMove"))).toContain(CELL_FAILED);
    replies["moves:AMD"] = "pending";
    replies["vol:AMD"] = "pending";
    await mount({ root: "AMD" });
    expect(text(cell("expMove"))).toContain(CELL_READING);
    expect(text(cell("expMove"))).not.toContain(CELL_FAILED);
  });
});

describe("EOD belt — level cells follow the desk's own level reads", () => {
  it("a level store that did not load is 'could not load', and Retry asks the desk to re-read it", async () => {
    const onRetryLevels = vi.fn();
    await mount({ gexState: null, levelReads: { gexstate: "unavailable", gex: "absent" }, onRetryLevels });
    expect(text(cell("callWall"))).toContain(CELL_FAILED);
    expect(text(cell("callWall"))).not.toContain(CELL_ABSENT);
    expect(text(cell("expMove"))).toContain("±3.2%");
    await clickRetry(strip());
    expect(onRetryLevels).toHaveBeenCalledTimes(1);
    expect(requested(`moves:${ROOT}`)).toBe(1);
  });

  it("levels both stores proved absent stay 'not published'", async () => {
    await mount({ gexState: null, levelReads: NO_LEVELS });
    expect(text(cell("callWall"))).toContain(CELL_ABSENT);
    expect(within('[data-testid="eod-structure-partial-error"]')).toBeNull();
  });

  it("levels still being read say so", async () => {
    await mount({ gexState: null, levelReads: { gexstate: "loading", gex: "loading" } });
    expect(text(cell("callWall"))).toContain(CELL_READING);
  });
});
