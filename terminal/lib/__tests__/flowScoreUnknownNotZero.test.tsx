// @vitest-environment jsdom
/**
 * UI-truth law on the Flow Desk score surfaces: an UNKNOWN score is not a zero.
 *
 * A missing/non-finite flowScore used to be folded to 0 and rendered as a filled
 * "0"-ring (and an unknown tier as a "LOW" chip) — unknown was shown as a reading.
 * Here: RingGauge renders a muted no-reading mark ("—", no arc, data-score-state
 * "unavailable", named by naLabel) for null/NaN, keeps "0" for a true zero, and the
 * FlowCard / InspectorPane / WatchlistRail consumers pass null through instead of
 * folding it, dropping the tier chip when there is no score to tier.
 *
 * The REAL RingGauge, FlowCard, InspectorPane and WatchlistRail are mounted; no
 * transport is involved, so nothing is mocked.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RingGauge } from "@/components/ui/RingGauge";
import { FlowCard } from "@/components/flowdesk/FlowCard";
import { InspectorPane } from "@/components/flowdesk/InspectorPane";
import { WatchlistRail, type WatchlistRailProps } from "@/components/flowdesk/WatchlistRail";
import type { FlowEvent, FlowScore, ScoreTier } from "@/components/flowdesk/FeedPane";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

const ev = (over: Partial<FlowEvent> = {}): FlowEvent => ({
  id: "ev1",
  ts: "2026-10-16T14:05:00Z",
  root: "SPX",
  group: "Index",
  group_zh: "指数",
  right: "C",
  exp: "2026-10-16",
  strike: 6000,
  dte: 0,
  dte_bucket: "0d",
  mny_bucket: "atm",
  side: "~buy",
  n_prints: 12,
  size: 250,
  avg_price: 3.1,
  premium: 930000,
  premium_z: 4.2,
  baseline_source: "90d",
  vol_gt_oi: true,
  repeated: false,
  zerodte: true,
  signing_source: "iso",
  ...over,
});

const scored = (score: number, tier: ScoreTier = "HIGH"): FlowScore => ({
  score,
  tier,
  components: [],
});

// WatchlistRail takes its own stricter feed shape (typed unusual_names).
const railFeed = (events: FlowEvent[]): WatchlistRailProps["feed"] => ({
  asof: "2026-10-16T15:00:00Z",
  session_date: "2026-10-16",
  events,
  unusual_names: [],
});

const ring = (scope: ParentNode = host) => scope.querySelector<HTMLElement>(".obs-ring");
const ringValue = (scope: ParentNode = host) => scope.querySelector<HTMLElement>(".obs-ring-value");
const rows = () => [...host.querySelectorAll<HTMLElement>(".obs-fd-wl-row")];
const rowRoots = () => rows().map((r) => r.querySelector<HTMLElement>(".obs-fd-wl-ticker")?.textContent);

describe("RingGauge: an unknown value is a no-reading mark, never a zero", () => {
  it("null renders —, named by naLabel, with no arc and data-score-state unavailable", async () => {
    await render(<RingGauge value={null} naLabel="Score unavailable" size="sm" />);
    expect(ringValue()!.textContent).toBe("—");
    expect(ring()!.getAttribute("aria-label")).toBe("Score unavailable");
    expect(host.querySelector(".obs-ring-arc")).toBeNull();
    expect(ring()!.getAttribute("data-score-state")).toBe("unavailable");
    expect(ring()!.className).toContain("obs-ring--na");
  });

  it("NaN renders the same no-reading mark", async () => {
    await render(<RingGauge value={NaN} naLabel="评分不可用" size="sm" />);
    expect(ringValue()!.textContent).toBe("—");
    expect(ring()!.getAttribute("aria-label")).toBe("评分不可用");
    expect(host.querySelector(".obs-ring-arc")).toBeNull();
    expect(ring()!.getAttribute("data-score-state")).toBe("unavailable");
  });

  it("a true zero still reads 0 — zero is a reading, not an unknown", async () => {
    await render(<RingGauge value={0} size="sm" />);
    expect(ringValue()!.textContent).toBe("0");
    expect(ring()!.getAttribute("aria-label")).toBe("0 out of 100");
    expect(host.querySelector(".obs-ring-arc")).not.toBeNull();
    expect(ring()!.getAttribute("data-score-state")).toBeNull();
    expect(ring()!.className).not.toContain("obs-ring--na");
  });
});

describe("FlowCard: a missing flowScore is not a 0 ring", () => {
  it("EN: an event without flowScore shows the na mark named 'Score unavailable', never a 0", async () => {
    await render(
      <FlowCard ev={ev({ id: "a" })} enrichEv={null} lang="en" selected={false}
        onSelect={() => {}} expanded={false} onToggleExpand={() => {}} />,
    );
    const card = host.querySelector('[data-tut="flow-card"]')!;
    expect(card.querySelector(".obs-ring")!.getAttribute("aria-label")).toBe("Score unavailable");
    expect(card.querySelector(".obs-ring-value")!.textContent).toBe("—");
    expect(card.querySelector(".obs-ring")!.getAttribute("data-score-state")).toBe("unavailable");
    expect(card.querySelector(".obs-ring-arc")).toBeNull();
  });

  it("ZH: the na mark is named 评分不可用", async () => {
    await render(
      <FlowCard ev={ev({ id: "a" })} enrichEv={null} lang="zh" selected={false}
        onSelect={() => {}} expanded={false} onToggleExpand={() => {}} />,
    );
    expect(host.querySelector(".obs-ring")!.getAttribute("aria-label")).toBe("评分不可用");
    expect(host.querySelector(".obs-ring-value")!.textContent).toBe("—");
  });

  it("an event with flowScore 0 still reads 0 — zero is not unknown", async () => {
    await render(
      <FlowCard ev={ev({ id: "a", flowScore: scored(0, "LOW") })} enrichEv={null} lang="en"
        selected={false} onSelect={() => {}} expanded={false} onToggleExpand={() => {}} />,
    );
    expect(host.querySelector(".obs-ring-value")!.textContent).toBe("0");
    expect(host.querySelector(".obs-ring")!.getAttribute("aria-label")).toBe("0 out of 100");
    expect(host.querySelector(".obs-ring")!.getAttribute("data-score-state")).toBeNull();
  });
});

describe("InspectorPane hero: no score means no tier chip and a na mark", () => {
  it("EN: a missing flowScore drops the tier chip and names the ring 'Score unavailable'", async () => {
    await render(<InspectorPane event={ev({ id: "a" })} tickerCtx={null} enrichEv={null} lang="en" />);
    expect(host.querySelector(".obs-insp-tier")).toBeNull();
    expect(host.textContent).not.toContain("LOW");
    expect(host.querySelector(".obs-insp-hero .obs-ring")!.getAttribute("aria-label")).toBe("Score unavailable");
    expect(host.querySelector(".obs-insp-hero .obs-ring-value")!.textContent).toBe("—");
  });

  it("ZH: no tier chip (never 偏低) and the na mark is 评分不可用", async () => {
    await render(<InspectorPane event={ev({ id: "a" })} tickerCtx={null} enrichEv={null} lang="zh" />);
    expect(host.querySelector(".obs-insp-tier")).toBeNull();
    expect(host.textContent).not.toContain("偏低");
    expect(host.querySelector(".obs-insp-hero .obs-ring")!.getAttribute("aria-label")).toBe("评分不可用");
  });

  it("a scored event still shows its tier chip", async () => {
    await render(
      <InspectorPane event={ev({ id: "a", flowScore: scored(64, "HIGH") })} tickerCtx={null} enrichEv={null} lang="en" />,
    );
    expect(host.querySelector(".obs-insp-tier")).not.toBeNull();
    expect(host.querySelector(".obs-insp-hero .obs-ring-value")!.textContent).toBe("64");
  });
});

describe("WatchlistRail: an unscored root is a na mark, sorted after scored roots", () => {
  it("EN: unscored root shows the na mark and sorts after the scored one, with localized add labels", async () => {
    await render(
      <WatchlistRail feed={railFeed([ev({ id: "z", root: "ZZZ" }), ev({ id: "a", root: "AAA", flowScore: scored(42) })])}
        tide={null} lang="en" watchlist={[]} onToggleTicker={() => {}} onPickTicker={() => {}} />,
    );
    expect(rowRoots()).toEqual(["AAA", "ZZZ"]);
    const naRow = rows()[1];
    expect(naRow.querySelector(".obs-ring")!.getAttribute("aria-label")).toBe("Score unavailable");
    expect(naRow.querySelector(".obs-ring-value")!.textContent).toBe("—");
    expect(rows()[0].querySelector(".obs-ring-value")!.textContent).toBe("42");
    const add = naRow.querySelector<HTMLButtonElement>("button.obs-fd-wl-btn.add")!;
    expect(add.getAttribute("aria-label")).toBe("Add ZZZ to watchlist");
  });

  it("ZH: unscored root shows the na mark with Chinese labels", async () => {
    await render(
      <WatchlistRail feed={railFeed([ev({ id: "z", root: "ZZZ" }), ev({ id: "a", root: "AAA", flowScore: scored(42) })])}
        tide={null} lang="zh" watchlist={[]} onToggleTicker={() => {}} onPickTicker={() => {}} />,
    );
    expect(rowRoots()).toEqual(["AAA", "ZZZ"]);
    const naRow = rows()[1];
    expect(naRow.querySelector(".obs-ring")!.getAttribute("aria-label")).toBe("评分不可用");
    expect(naRow.querySelector<HTMLButtonElement>("button.obs-fd-wl-btn.add")!.getAttribute("aria-label")).toBe("将 ZZZ 加入观察列表");
  });

  it("a watched root with no finite score keeps its row and shows the na mark, with localized remove label", async () => {
    await render(
      <WatchlistRail feed={railFeed([ev({ id: "z", root: "ZZZ" })])}
        tide={null} lang="en" watchlist={["ZZZ"]} onToggleTicker={() => {}} onPickTicker={() => {}} />,
    );
    const row = rows()[0];
    expect(row.querySelector(".obs-ring")!.getAttribute("aria-label")).toBe("Score unavailable");
    expect(row.querySelector<HTMLButtonElement>("button.obs-fd-wl-btn:not(.add)")!.getAttribute("aria-label"))
      .toBe("Remove ZZZ from watchlist");
  });

  it("ZH remove label is Chinese", async () => {
    await render(
      <WatchlistRail feed={railFeed([ev({ id: "z", root: "ZZZ" })])}
        tide={null} lang="zh" watchlist={["ZZZ"]} onToggleTicker={() => {}} onPickTicker={() => {}} />,
    );
    expect(rows()[0].querySelector<HTMLButtonElement>("button.obs-fd-wl-btn:not(.add)")!.getAttribute("aria-label"))
      .toBe("将 ZZZ 移出观察列表");
  });

  it("a watched root outside the feed still shows no ring (as today)", async () => {
    await render(
      <WatchlistRail feed={railFeed([])} tide={null} lang="en" watchlist={["QQQ"]}
        onToggleTicker={() => {}} onPickTicker={() => {}} />,
    );
    expect(rows()[0].querySelector(".obs-ring")).toBeNull();
  });
});
