// @vitest-environment jsdom
import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import DislocationsView, { chartNavHref, fmtAge } from "@/components/dislocations/DislocationsView";
import { LangProvider, applyLang } from "@/lib/i18n";
import { displayFor } from "@/lib/dislocations/source";
import type { DislocationEpisode, LiveEntryEpisode } from "@/lib/dislocations/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const freshFile = JSON.parse(
  readFileSync(path.join(process.cwd(), "fixtures/dislocations/fresh.json"), "utf8"),
) as { episodes: LiveEntryEpisode[]; asof: string; pack: { as_of: string } };

function withDisplay(eps: LiveEntryEpisode[]): DislocationEpisode[] {
  return eps.map((ep) => ({ ...ep, display: displayFor(ep) }));
}

function apiBody(
  partial: Record<string, unknown>,
  episodes = withDisplay(freshFile.episodes),
): unknown {
  return {
    state: "ok",
    generated_at: new Date().toISOString(),
    knowable_at_max: null,
    source: {
      asof: new Date().toISOString(),
      pack_as_of: freshFile.pack.as_of,
      pack_fresh: true,
      quote_age_s: 60,
      delayed: true,
      health_state: "in_window",
    },
    episodes,
    count: episodes.length,
    view: "market",
    ...partial,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(lang: "en" | "zh" = "en") {
  applyLang(lang);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LangProvider>
        <DislocationsView />
      </LangProvider>,
    );
  });
}

function unmount() {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T18:00:00.000Z"));
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  applyLang("en");
});

describe("DislocationsView §9", () => {
  it("1 — three groups in order with counts from fixture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(apiBody({})), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    mount();
    await flush();
    const text = container!.textContent ?? "";
    const confirmed = text.indexOf("Confirmed");
    const forming = text.indexOf("Forming");
    const ended = text.indexOf("Ended");
    expect(confirmed).toBeGreaterThan(-1);
    expect(forming).toBeGreaterThan(confirmed);
    expect(ended).toBeGreaterThan(forming);
    expect(text).toMatch(/2/);
    expect(text).toMatch(/3/);
  });

  it("2 — five stances EN and ZH", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(apiBody({})), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    mount("en");
    await flush();
    expect(container!.textContent).toContain("Reclaim held");
    expect(container!.textContent).toContain("Washout, no turn yet");
    unmount();
    mount("zh");
    await flush();
    expect(container!.textContent).toContain("收复已站稳");
    expect(container!.textContent).toContain("洗盘中，尚未转向");
  });

  it("3 — watching line only when both risk_geometry keys present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(apiBody({})), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    mount();
    await flush();
    const watching = container!.querySelectorAll(".watching, p");
    const lines = (container!.textContent ?? "").match(/Turn fails below|跌破/g);
    expect(lines?.length).toBe(1);
  });

  it("4 — ok_empty with pack_fresh false shows behind warn, not quiet empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(
            apiBody({
              state: "ok_empty",
              episodes: [],
              count: 0,
              source: {
                asof: new Date().toISOString(),
                pack_as_of: "2026-09-01",
                pack_fresh: false,
                quote_age_s: null,
                delayed: true,
              },
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    mount();
    await flush();
    expect(container!.textContent).toContain("Not a quiet session, an unknown one");
    expect(container!.textContent).not.toContain("5-minute bars close");
  });

  it("5 — stale renders warn line and rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(apiBody({ state: "stale" })),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    mount();
    await flush();
    expect(container!.querySelector("[data-testid='dislo-stale-warn']")).toBeTruthy();
    expect(container!.querySelectorAll("ol li").length).toBeGreaterThan(0);
  });

  it("6 — source_unavailable, handler_error, and 429 copy", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ state: "source_unavailable" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    mount();
    await flush();
    expect(container!.textContent).toContain("isn't publishing yet");

    unmount();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ state: "handler_error" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    mount();
    await flush();
    expect(container!.textContent).toContain("Try again in a minute");

    unmount();
    fetchMock.mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    mount();
    await flush();
    expect(container!.textContent).toContain("Try again in a minute");

    unmount();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "Retry-After": "12", "content-type": "application/json" },
      }),
    );
    mount();
    await flush();
    expect(container!.textContent).toContain("Back in 12s");
  });

  it("7 — 403 renders paywall card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ state: "forbidden", reason: "paid_tier_required" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    mount();
    await flush();
    expect(container!.querySelector("[data-testid='dislo-paywall']")).toBeTruthy();
    expect(container!.textContent).toContain("paid feature");
  });

  it("8 — age text advances under fake timers", async () => {
    const ep = withDisplay(freshFile.episodes)[0];
    const knowable = ep.display.knowable_at!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(apiBody({ episodes: [ep], count: 1 })),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    mount();
    await flush();
    const ageEl = container!.querySelector("[data-testid='dislo-age']");
    expect(ageEl?.textContent).toBe(fmtAge(knowable, Date.now(), "en"));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await flush();
    expect(ageEl?.textContent).toBe(fmtAge(knowable, Date.now(), "en"));
  });

  it("9 — chart link href equals navHref(ticker)", async () => {
    const ep = withDisplay(freshFile.episodes).find((e) => e.ticker === "NVDA")!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(apiBody({ episodes: [ep], count: 1 })),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    mount();
    await flush();
    const a = container!.querySelector(`a[href="${chartNavHref(ep.ticker)}"]`);
    expect(a).toBeTruthy();
  });
});
