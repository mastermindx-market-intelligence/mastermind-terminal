// @vitest-environment jsdom
/**
 * One guard for the loaded tape (review of #1198, audit r6 G2).
 *
 * The session gauge and the desk's coverage line both describe the same loaded tape, so
 * they read it through the same guard: `feedEvents(feed)` returns `feed.events` when it
 * is an array and an empty tape otherwise. Before the shared guard, the gauge read a
 * non-array `events` as no prints while the coverage line iterated it (a string counted
 * one "row" per character) or threw (an object or a number is not iterable), and the
 * feed list's own `.map` threw. For an array the guard is the identity: the same array
 * object, so every reading of a well-formed tape is unchanged.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedPane, type FeedPayload, type FlowEvent } from "@/components/flowdesk/FeedPane";
import { DEFAULT_FILTERS } from "@/components/flowdesk/FiltersPanel";
import { FlowGauge } from "@/components/flowdesk/FlowGauge";
import { FlowCoverageLine } from "@/components/flowdesk/PrintInspector";
import { FD } from "@/lib/flowdeskStrings";
import { feedEvents, flowCoverage } from "@/lib/flowPrintInspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ev = (over: Partial<FlowEvent> = {}): FlowEvent => ({
  id: "ev1", ts: "2026-10-16T14:05:00Z", root: "SPX", group: "Index", group_zh: "指数",
  right: "C", exp: "2026-10-16", strike: 6000, dte: 0, dte_bucket: "0d",
  mny_bucket: "atm", side: "~buy", n_prints: 12, size: 250, avg_price: 3.1,
  premium: 930000, premium_z: 4.2, baseline_source: "90d", vol_gt_oi: true,
  repeated: false, zerodte: true, signing_source: "iso", ...over,
});
const withEvents = (events: unknown): FeedPayload =>
  ({ asof: "2026-10-16T15:00:00Z", session_date: "2026-10-16", events, unusual_names: [] }) as unknown as FeedPayload;

const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [["a string", "x"], ["an object", {}], ["a number", 5]];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(ui: React.ReactElement) {
  await act(async () => root.render(ui));
}

function pane(feed: FeedPayload) {
  return (
    <FeedPane
      feed={feed}
      connected={false}
      flowMeta={null}
      enrich={null}
      lang="en"
      selectedId={null}
      onSelect={() => {}}
      filters={{ ...DEFAULT_FILTERS }}
      onFiltersChange={() => {}}
      status="data"
      stale={false}
    />
  );
}

describe("feedEvents: the one guard behind the gauge and the coverage line", () => {
  it("is the identity for an array: the same array object, including an empty one", () => {
    const tape = [ev({ id: "a" }), ev({ id: "b", right: "P" })];
    expect(feedEvents(withEvents(tape))).toBe(tape);
    const empty: FlowEvent[] = [];
    expect(feedEvents(withEvents(empty))).toBe(empty);
    expect(flowCoverage(feedEvents(withEvents(tape)))).toEqual(flowCoverage(tape));
  });

  it("reads a missing feed or a missing events field as an empty tape", () => {
    expect(feedEvents(null)).toEqual([]);
    expect(feedEvents(undefined)).toEqual([]);
    expect(feedEvents({} as { events?: FlowEvent[] })).toEqual([]);
  });

  it.each(MALFORMED)("reads %s as an empty tape", (_label, events) => {
    expect(feedEvents(withEvents(events))).toEqual([]);
  });
});

describe.each(MALFORMED)("a malformed events field (%s): the gauge and the line agree, nothing throws", (_label, events) => {
  const feed = withEvents(events);

  it("the coverage line's input is an empty tape: no rows and no missing prints", () => {
    const coverage = flowCoverage(feedEvents(feed));
    expect(coverage.rows).toBe(0);
    expect(coverage.missing).toBe(0);
    expect(coverage.total).toBe(0);
  });

  it("the gauge says there are no prints, as the line does", async () => {
    await render(<FlowGauge feed={feed as never} lang="en" />);
    const gauge = host.querySelector('[data-tut="flow-gauge"]')!;
    expect(gauge.getAttribute("data-gauge-state")).toBe("unavailable");
    expect(host.querySelector('[data-testid="flow-gauge-reason"]')!.textContent).toBe(FD.gaugeNoPrints.en);
  });

  it("FeedPane renders without throwing and draws the empty-tape coverage line", async () => {
    await render(pane(feed));
    const line = host.querySelector('[data-testid="flow-coverage"]')!;
    expect(line).not.toBeNull();
    const fromFeed = line.outerHTML;
    await render(<FlowCoverageLine coverage={flowCoverage([])} lang="en" />);
    expect(fromFeed).toBe(host.querySelector('[data-testid="flow-coverage"]')!.outerHTML);
    expect(host.querySelector(".obs-fc-card")).toBeNull();
  });
});
