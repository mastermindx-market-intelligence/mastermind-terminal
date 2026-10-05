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
      new Response(
        JSON.stringify({ state: "source_unavailable", reason: "episodes_not_published" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
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

  it("10 — source_unavailable handler_error shows handler copy, not publishing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ state: "source_unavailable", reason: "handler_error" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    mount();
    await flush();
    expect(container!.textContent).toContain("Try again in a minute");
    expect(container!.textContent).not.toContain("isn't publishing yet");
  });

  it("11 — overlapping fetches: newer generation wins when older resolves last", async () => {
    type Resolver = (v: Response) => void;
    let resolveOld: Resolver;
    let resolveNew: Resolver;
    const oldP = new Promise<Response>((r) => {
      resolveOld = r;
    });
    const newP = new Promise<Response>((r) => {
      resolveNew = r;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(oldP).mockReturnValueOnce(newP);
    vi.stubGlobal("fetch", fetchMock);

    const epOld = withDisplay(freshFile.episodes).find((e) => e.ticker === "GOOGL")!;
    const epNew = withDisplay(freshFile.episodes).find((e) => e.ticker === "NVDA")!;

    mount();
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();

    await act(async () => {
      resolveNew!(
        new Response(
          JSON.stringify(apiBody({ episodes: [epNew], count: 1 })),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await Promise.resolve();
    });
    await flush();
    expect(container!.textContent).toContain("NVDA");
    expect(container!.querySelectorAll("ol li").length).toBe(1);

    await act(async () => {
      resolveOld!(
        new Response(
          JSON.stringify(apiBody({ episodes: [epOld], count: 1 })),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await Promise.resolve();
    });
    await flush();
    expect(container!.textContent).toContain("NVDA");
    expect(container!.textContent).not.toMatch(/GOOGL/);
  });

  it("12 — my → market tab uses market fetch and drops prior tickers", async () => {
    const myEp = withDisplay(freshFile.episodes).find((e) => e.ticker === "GOOGL")!;
    const marketEp = withDisplay(freshFile.episodes).find((e) => e.ticker === "NVDA")!;
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiBody({ view: "my", episodes: [myEp], count: 1 })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(apiBody({ view: "market", episodes: [marketEp], count: 1 })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    mount();
    await flush();
    expect(container!.textContent).toContain("GOOGL");

    const marketTab = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent === "Market",
    );
    expect(marketTab).toBeTruthy();
    await act(async () => {
      marketTab!.click();
    });
    await flush();

    const lastUrl = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(lastUrl).toContain("view=market");
    expect(container!.textContent).toContain("NVDA");
    expect(container!.textContent).not.toMatch(/\bGOOGL\b/);
  });

  it("13 — hidden document does not poll or advance age", async () => {
    const ep = withDisplay(freshFile.episodes)[0];
    const knowable = ep.display.knowable_at!;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify(apiBody({ episodes: [ep], count: 1 })),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    mount();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const ageEl = container!.querySelector("[data-testid='dislo-age']");
    const before = ageEl?.textContent;

    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ageEl?.textContent).toBe(before);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("14 — unknown episode state renders in Ended with UNKNOWN data-state", async () => {
    const raw = { ...freshFile.episodes[0], state: "FUTURE_STATE" };
    const ep = { ...raw, display: displayFor(raw as LiveEntryEpisode) };
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
    const row = container!.querySelector("ol li[data-state='UNKNOWN']");
    expect(row).toBeTruthy();
    expect(container!.textContent).toContain("Status unavailable");
  });

  it("15 — stale with null asof still shows stale warn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(
            apiBody({
              state: "stale",
              source: {
                asof: null,
                pack_as_of: freshFile.pack.as_of,
                pack_fresh: true,
                quote_age_s: 60,
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
    expect(container!.querySelector("[data-testid='dislo-stale-warn']")).toBeTruthy();
    expect(container!.textContent).toContain("— ET");
  });

  it("16 — ZH catalyst detail uses localized until clock", async () => {
    const ep = withDisplay(freshFile.episodes)[0];
    const withCat = {
      ...ep,
      catalyst: {
        coverage: "earnings",
        relevant_until: "2026-10-03T20:30:00.000Z",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(apiBody({ episodes: [withCat], count: 1 })),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    mount("zh");
    await flush();
    const details = container!.querySelector("details");
    await act(async () => {
      (details!.querySelector("summary") as HTMLElement).click();
    });
    await flush();
    expect(container!.textContent).toContain("至");
    expect(container!.textContent).not.toContain("until");
    expect(container!.textContent).toContain("美东");
  });

  it("17 — loading state exposes status line", async () => {
    let resolve!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolve = r;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    mount();
    const loading = container!.querySelector("[data-testid='dislo-loading']");
    expect(loading).toBeTruthy();
    expect(loading?.textContent).toContain("Reading the latest bars");

    await act(async () => {
      resolve(
        new Response(JSON.stringify(apiBody({})), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await Promise.resolve();
    });
    await flush();
    expect(container!.querySelector("[data-testid='dislo-loading']")).toBeFalsy();
  });
});
