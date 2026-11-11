// @vitest-environment jsdom
import { NEWS_VIEW } from "./fixtures/newsEditorial";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTickerNewsFeed } from "@/components/news/useTickerNewsFeed";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = {
  sequence: 20, source: "massive:reuters.com", source_item_id: "report-1",
  story_id: "ev2_shared", source_count: 2, item_count: 2,
  title: "Company updates acquisition consideration", url: "https://www.reuters.com/report-1",
  teaser: "", published_at: "2026-10-20T06:00:00Z", updated_at: null,
  received_at: "2026-10-20T06:00:01Z", universe_revision: "u1", editorial_view: NEWS_VIEW,
  reporting_state: "reports_differ",
};
const snapshot = (rows: Record<string, unknown>[] = [row]) => ({
  schema: "ticker_news.snapshot.v1", editorial_view: NEWS_VIEW, ticker: "NVDA", security_id: "SEC:NVDA",
  state: "live", rows, next_cursor: rows.length ? 20 : null, has_more: false,
  source_health: { state: "live" },
});
const change = {
  ...row, sequence: 21, kind: "upsert", security_ids: ["SEC:NVDA"],
  observed_at: "2026-10-20T06:00:02Z",
};

class TestEvents extends EventTarget {
  static latest: TestEvents;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  closed = false;
  constructor(readonly url: string) { super(); TestEvents.latest = this; }
  close() { this.closed = true; }
  emit(name: string, payload: unknown) {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(payload) }));
  }
}

function Probe() {
  const feed = useTickerNewsFeed("NVDA");
  return <output data-state={feed.loadState}
    data-reporting-state={feed.snapshot?.rows[0]?.reporting_state ?? ""}
    data-story={feed.snapshot?.rows[0]?.story_id ?? ""} />;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("EventSource", TestEvents);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("shared comparison evidence through the mounted feed consumer", () => {
  it("replaces the qualified state on reconciliation and clears it when the group is removed", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot()))
      .mockResolvedValueOnce(Response.json(snapshot([{ ...row, sequence: 21, reporting_state: "not_compared" }])))
      .mockResolvedValueOnce(Response.json(snapshot([])));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<Probe />));
    expect(host.querySelector("output")?.dataset.reportingState).toBe("reports_differ");

    await act(async () => TestEvents.latest.emit("upsert", change));
    expect(host.querySelector("output")?.dataset.reportingState).toBe("not_compared");

    await act(async () => TestEvents.latest.emit("remove", {
      ...change, sequence: 22, kind: "remove", title: "", url: "", teaser: "",
      source_count: null, item_count: null, published_at: null, updated_at: null, received_at: null,
      reporting_state: "not_compared",
    }));
    expect(host.querySelector("output")?.dataset.story).toBe("");
    expect(host.querySelector("output")?.dataset.reportingState).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("purges comparison evidence on restriction and rejects an older in-flight refresh", async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<Probe />));
    await act(async () => TestEvents.latest.emit("upsert", change));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => TestEvents.latest.emit("restricted", { detail: "scope changed" }));
    expect(TestEvents.latest.closed).toBe(true);
    expect(host.querySelector("output")?.dataset.state).toBe("restricted");
    expect(host.querySelector("output")?.dataset.reportingState).toBe("");

    await act(async () => release(Response.json(snapshot())));
    expect(host.querySelector("output")?.dataset.state).toBe("restricted");
    expect(host.querySelector("output")?.dataset.story).toBe("");
    expect(host.querySelector("output")?.dataset.reportingState).toBe("");
  });
});
