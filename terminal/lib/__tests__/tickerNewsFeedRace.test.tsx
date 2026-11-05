// @vitest-environment jsdom
import { NEWS_VIEW } from "./fixtures/newsEditorial";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import { useTickerNewsFeed } from "@/components/news/useTickerNewsFeed";

const { stateWrites } = vi.hoisted(() => ({
  stateWrites: [] as unknown[],
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const useState: typeof actual.useState = ((init: unknown) => {
    const [value, setValue] = actual.useState(init as never);
    const set = (next: unknown) => {
      stateWrites.push(next);
      return (setValue as (value: unknown) => unknown)(next);
    };
    return [value, set];
  }) as unknown as typeof actual.useState;
  return { ...actual, useState };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (storyId: string, title: string, sequence = 1) => ({
  sequence,
  source: "benzinga",
  source_item_id: storyId + "-item",
  story_id: storyId,
  source_count: 1,
  item_count: 1,
  title,
  url: "https://www.benzinga.com/news/" + storyId,
  teaser: "Short lead",
  published_at: "2026-10-05T14:00:00+00:00",
  updated_at: "2026-10-05T14:01:00+00:00",
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1", editorial_view: NEWS_VIEW,
});

const snapshot = (ticker: string, rows: ReturnType<typeof row>[], state = "live") => ({
  schema: "ticker_news.snapshot.v1", editorial_view: NEWS_VIEW,
  ticker,
  security_id: "SEC:" + ticker,
  state,
  rows,
  next_cursor: rows[rows.length - 1]?.sequence ?? null,
  has_more: false,
  source_health: { state: state === "quiet" ? "live" : state, last_successful_catchup: "2026-10-05T14:01:01+00:00" },
});

function changePayload(sequence: number, storyId: string, title: string) {
  return {
    sequence,
    kind: "upsert",
    source: "benzinga",
    source_item_id: storyId + "-item",
    story_id: storyId,
    title,
    url: "https://www.benzinga.com/news/" + storyId,
    teaser: "",
    security_ids: ["SEC:NVDA"],
    universe_revision: "sp500-r1", editorial_view: NEWS_VIEW,
    observed_at: "2026-10-05T14:02:00+00:00",
  };
}

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  closed = false;
  readyState = FakeEventSource.OPEN;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, cb: EventListener) {
    const list = this.listeners.get(name) ?? [];
    list.push(cb as (event: MessageEvent) => void);
    this.listeners.set(name, list);
  }

  emit(name: string, payload: unknown) {
    this.emitRaw(name, JSON.stringify(payload));
  }

  emitRaw(name: string, data: string) {
    for (const cb of this.listeners.get(name) ?? []) {
      cb(new MessageEvent(name, { data }));
    }
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

type Deferred = {
  promise: Promise<Response>;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
};

function defer(): Deferred {
  let resolve!: (value: Response) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function response(body: unknown, status = 200) {
  return Promise.resolve(jsonResponse(body, status));
}

function FeedProbe({ symbol }: { symbol: string }) {
  const feed = useTickerNewsFeed(symbol);
  return (
    <div
      data-testid="feed"
      data-load-state={feed.loadState}
      data-live={feed.liveInterrupted ? "yes" : "no"}
      data-title={feed.snapshot?.rows[0]?.title ?? ""}
      data-ticker={feed.snapshot?.ticker ?? ""}
      data-has-snapshot={feed.snapshot ? "yes" : "no"}
    />
  );
}

let host: HTMLDivElement;
let root: Root;
let rootMounted = false;
let realFetch: typeof globalThis.fetch;
let realEventSource: typeof globalThis.EventSource;

function readFeed() {
  const el = host.querySelector<HTMLDivElement>("[data-testid=feed]");
  if (!el) throw new Error("feed probe missing");
  return {
    loadState: el.getAttribute("data-load-state"),
    live: el.getAttribute("data-live"),
    title: el.getAttribute("data-title") ?? "",
    ticker: el.getAttribute("data-ticker") ?? "",
    hasSnapshot: el.getAttribute("data-has-snapshot"),
  };
}

async function settle(work: () => void) {
  await act(async () => {
    work();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  rootMounted = true;
  realFetch = globalThis.fetch;
  realEventSource = globalThis.EventSource;
  FakeEventSource.instances = [];
  stateWrites.length = 0;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: FakeEventSource as unknown as typeof EventSource,
  });
});

async function unmountRoot() {
  if (!rootMounted) return;
  rootMounted = false;
  await act(async () => root.unmount());
}

afterEach(async () => {
  await unmountRoot();
  host.remove();
  globalThis.fetch = realFetch;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: realEventSource,
  });
  vi.restoreAllMocks();
});

describe("useTickerNewsFeed races", () => {
  it("late INITIAL response for a previous symbol never paints", async () => {
    const lateAapl = defer();
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/news/AAPL")) return lateAapl.promise;
      if (url.includes("/api/news/MSFT")) {
        return response(snapshot("MSFT", [row("ev2_m", "Microsoft current story")]));
      }
      throw new Error("unexpected " + url);
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="AAPL" />);
    });
    expect(readFeed().loadState).toBe("loading");
    expect(readFeed().hasSnapshot).toBe("no");

    await act(async () => {
      root.render(<FeedProbe symbol="MSFT" />);
    });
    expect(readFeed().title).toBe("Microsoft current story");
    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().ticker).toBe("MSFT");

    await act(async () => {
      lateAapl.resolve(jsonResponse(snapshot("AAPL", [row("ev2_a", "Apple stale story")])));
      await lateAapl.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readFeed().title).toBe("Microsoft current story");
    expect(readFeed().ticker).toBe("MSFT");
    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().title).not.toContain("Apple stale story");
  });

  it("out-of-order background refreshes keep the latest issued snapshot", async () => {
    const background: Deferred[] = [];
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      if (calls === 1) return response(snapshot("NVDA", [row("ev2_a", "Initial headline", 1)]));
      const pending = defer();
      background.push(pending);
      return pending.promise;
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    expect(readFeed().title).toBe("Initial headline");
    const stream = FakeEventSource.instances[0];
    expect(stream).toBeTruthy();

    await settle(() => {
      stream.emit("upsert", changePayload(2, "ev2_a", "Headline A"));
      stream.emit("upsert", changePayload(3, "ev2_b", "Headline B"));
    });
    expect(background).toHaveLength(2);

    await act(async () => {
      background[1].resolve(jsonResponse(snapshot("NVDA", [row("ev2_b", "Headline B", 3)])));
      await background[1].promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readFeed().title).toBe("Headline B");
    expect(readFeed().loadState).toBe("ready");

    await act(async () => {
      background[0].resolve(jsonResponse(snapshot("NVDA", [row("ev2_a", "Headline A stale", 2)])));
      await background[0].promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readFeed().title).toBe("Headline B");
    expect(readFeed().loadState).toBe("ready");

    // A superseded refresh that FAILS must not write unavailable over the newer snapshot.
    await settle(() => {
      stream.emit("upsert", changePayload(4, "ev2_d", "Headline D"));
      stream.emit("upsert", changePayload(5, "ev2_e", "Headline E"));
    });
    expect(background).toHaveLength(4);

    await act(async () => {
      background[3].resolve(jsonResponse(snapshot("NVDA", [row("ev2_e", "Headline E", 5)])));
      await background[3].promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readFeed().title).toBe("Headline E");
    expect(readFeed().loadState).toBe("ready");

    await act(async () => {
      background[2].resolve(jsonResponse({ detail: "upstream missing" }, 503));
      await background[2].promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readFeed().title).toBe("Headline E");
    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().live).toBe("no");
  });

  it("a successful refresh after a background failure returns to ready with the fresh snapshot", async () => {
    let phase: "initial" | "fail" | "recover" = "initial";
    globalThis.fetch = vi.fn(() => {
      if (phase === "initial") return response(snapshot("NVDA", [row("ev2_a", "First headline", 1)]));
      if (phase === "fail") return response({ detail: "upstream missing" }, 503);
      return response(snapshot("NVDA", [row("ev2_d", "Recovered headline", 4)]));
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    expect(readFeed().loadState).toBe("ready");
    const stream = FakeEventSource.instances[0];
    expect(stream).toBeTruthy();

    phase = "fail";
    await settle(() => {
      stream.emit("upsert", changePayload(2, "ev2_b", "Lost headline"));
    });
    expect(readFeed().loadState).toBe("unavailable");
    expect(readFeed().live).toBe("no");
    // The snapshot is retained (the panel hides it); only the state went unavailable.
    expect(readFeed().title).toBe("First headline");

    phase = "recover";
    await settle(() => {
      stream.emit("upsert", changePayload(4, "ev2_d", "Recovered headline"));
    });

    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().title).toBe("Recovered headline");
    expect(readFeed().ticker).toBe("NVDA");
    expect(readFeed().live).toBe("no");
  });

  it("background refresh failure ends unavailable and renders no story rows", async () => {
    const scenarios: Array<{ name: string; fail: () => Promise<Response> }> = [
      {
        name: "http 503",
        fail: () => response({ detail: "upstream missing" }, 503),
      },
      {
        name: "network error",
        fail: () => Promise.reject(new TypeError("network down")),
      },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      if (index > 0) {
        await unmountRoot();
        root = createRoot(host);
        rootMounted = true;
        FakeEventSource.instances = [];
      }
      let phase: "initial" | "refresh" = "initial";
      globalThis.fetch = vi.fn(() => {
        if (phase === "initial") return response(snapshot("NVDA", [row("ev2_a", "Kept headline")]));
        return scenario.fail();
      }) as unknown as typeof globalThis.fetch;

      await act(async () => {
        root.render(<FeedProbe symbol="NVDA" />);
      });
      expect(readFeed().title, scenario.name).toBe("Kept headline");
      expect(readFeed().loadState, scenario.name).toBe("ready");
      expect(readFeed().live, scenario.name).toBe("no");

      phase = "refresh";
      await settle(() => {
        FakeEventSource.instances.at(-1)!.emit("upsert", changePayload(2, "ev2_a", "Ignored failure"));
      });

      // Master contract (AC-E13-01): a failed refresh ends unavailable, not interrupted.
      expect(readFeed().loadState, scenario.name).toBe("unavailable");
      expect(readFeed().live, scenario.name).toBe("no");

      // The panel therefore hides the rows instead of showing them as live-interrupted.
      await unmountRoot();
      root = createRoot(host);
      rootMounted = true;
      FakeEventSource.instances = [];
      phase = "initial";
      await act(async () => {
        root.render(<TickerNewsPanel symbol="NVDA" lang="en" />);
      });
      expect(host.querySelector("article[data-story-id]"), scenario.name).not.toBeNull();

      phase = "refresh";
      await settle(() => {
        FakeEventSource.instances.at(-1)!.emit("upsert", changePayload(2, "ev2_a", "Ignored failure"));
      });

      expect(host.querySelector("article[data-story-id]"), scenario.name).toBeNull();
      expect(host.textContent, scenario.name).toContain("News is temporarily unavailable");

      // The same failure hides rows and every review control in Chinese too.
      await unmountRoot();
      root = createRoot(host);
      rootMounted = true;
      FakeEventSource.instances = [];
      phase = "initial";
      await act(async () => {
        root.render(<TickerNewsPanel symbol="NVDA" lang="zh" />);
      });
      expect(host.querySelector("article[data-story-id]"), scenario.name).not.toBeNull();

      phase = "refresh";
      await settle(() => {
        FakeEventSource.instances.at(-1)!.emit("upsert", changePayload(2, "ev2_a", "Ignored failure"));
      });

      expect(host.querySelector("article[data-story-id]"), scenario.name).toBeNull();
      expect(host.querySelector("[data-news-mark-shown]"), scenario.name).toBeNull();
      expect(host.querySelector("[data-news-catchup]"), scenario.name).toBeNull();
      expect(host.textContent, scenario.name).toContain("新闻暂时不可用");
    }
  });

  it("background refresh restricted revokes the snapshot", async () => {
    const scenarios: Array<{ name: string; status: number; body: unknown }> = [
      { name: "401", status: 401, body: { detail: "forbidden" } },
      { name: "403", status: 403, body: { detail: "forbidden" } },
      { name: "rights detail", status: 503, body: { detail: "ticker news rights unavailable" } },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      if (index > 0) {
        await unmountRoot();
        root = createRoot(host);
        rootMounted = true;
        FakeEventSource.instances = [];
      }
      let phase: "initial" | "refresh" = "initial";
      globalThis.fetch = vi.fn(() => {
        if (phase === "initial") return response(snapshot("NVDA", [row("ev2_a", "Visible headline")]));
        return response(scenario.body, scenario.status);
      }) as unknown as typeof globalThis.fetch;

      await act(async () => {
        root.render(<FeedProbe symbol="NVDA" />);
      });
      expect(readFeed().title, scenario.name).toBe("Visible headline");

      phase = "refresh";
      await settle(() => {
        FakeEventSource.instances.at(-1)!.emit("upsert", changePayload(2, "ev2_a", "Revoked"));
      });

      expect(readFeed().loadState, scenario.name).toBe("restricted");
      expect(readFeed().hasSnapshot, scenario.name).toBe("no");
      expect(readFeed().title, scenario.name).toBe("");
      expect(readFeed().ticker, scenario.name).toBe("");
    }
  });

  it("initial snapshot for a different ticker ends unavailable", async () => {
    globalThis.fetch = vi.fn(() => response(snapshot("AAPL", [row("ev2_a", "Apple story")]))) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(readFeed().loadState).toBe("unavailable");
    expect(readFeed().hasSnapshot).toBe("no");
    expect(readFeed().title).toBe("");
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("EventSource error then open refreshes once and clears live interrupted only after success", async () => {
    const reconnect = defer();
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      if (calls === 1) return response(snapshot("NVDA", [row("ev2_a", "Before reconnect", 1)]));
      return reconnect.promise;
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    const stream = FakeEventSource.instances[0];
    expect(stream).toBeTruthy();
    const afterInitial = calls;
    expect(readFeed().live).toBe("no");

    await settle(() => {
      stream.onopen?.(new Event("open"));
    });
    expect(calls).toBe(afterInitial);

    await settle(() => {
      stream.onerror?.(new Event("error"));
    });
    expect(readFeed().live).toBe("yes");
    expect(readFeed().title).toBe("Before reconnect");
    expect(readFeed().loadState).toBe("ready");
    expect(calls).toBe(afterInitial);
    expect(FakeEventSource.instances).toHaveLength(1);

    await settle(() => {
      stream.onopen?.(new Event("open"));
    });
    expect(calls).toBe(afterInitial + 1);
    expect(readFeed().live).toBe("yes");
    expect(readFeed().title).toBe("Before reconnect");
    expect(FakeEventSource.instances).toHaveLength(1);

    await act(async () => {
      reconnect.resolve(jsonResponse(snapshot("NVDA", [row("ev2_b", "After reconnect", 4)])));
      await reconnect.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readFeed().live).toBe("no");
    expect(readFeed().title).toBe("After reconnect");
    expect(readFeed().loadState).toBe("ready");
    expect(calls).toBe(afterInitial + 1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("SSE unavailable marks live interrupted and does not reopen the stream", async () => {
    const fetchMock = vi.fn(() => response(snapshot("NVDA", [row("ev2_a", "Headline")])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    const stream = FakeEventSource.instances[0];
    const fetches = fetchMock.mock.calls.length;

    await settle(() => {
      stream.emit("unavailable", { state: "unavailable" });
    });

    expect(readFeed().live).toBe("yes");
    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().title).toBe("Headline");
    expect(stream.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(fetches);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(fetches);
    expect(stream.closed).toBe(true);
    expect(readFeed().live).toBe("yes");
  });

  it("malformed change payload is ignored", async () => {
    const fetchMock = vi.fn(() => response(snapshot("NVDA", [row("ev2_a", "Headline")])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    const stream = FakeEventSource.instances[0];
    const fetches = fetchMock.mock.calls.length;

    await settle(() => {
      stream.emitRaw("upsert", "{not json");
      stream.emit("upsert", { kind: "nope" });
      stream.emit("remove", { kind: "remove" });
    });

    expect(fetchMock.mock.calls.length).toBe(fetches);
    expect(readFeed().title).toBe("Headline");
    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().live).toBe("no");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("unmount aborts an in-flight fetch and does not update state", async () => {
    const pending = defer();
    let signal: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal | undefined;
      return pending.promise;
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    const writesAfterMount = stateWrites.length;

    await unmountRoot();
    expect(signal!.aborted).toBe(true);
    const writesAfterUnmount = stateWrites.length;

    await act(async () => {
      pending.resolve(jsonResponse(snapshot("NVDA", [row("ev2_a", "Should not apply")])));
      await pending.promise;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stateWrites.length).toBe(writesAfterUnmount);
    expect(writesAfterUnmount).toBe(writesAfterMount);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("ready then SSE restricted clears the snapshot and does not open a new EventSource", async () => {
    const fetchMock = vi.fn(() => response(snapshot("NVDA", [row("ev2_a", "Headline")])));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().hasSnapshot).toBe("yes");
    expect(readFeed().title).toBe("Headline");
    const stream = FakeEventSource.instances[0];
    expect(stream).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(1);

    await settle(() => {
      stream.emit("restricted", { state: "restricted" });
    });

    expect(readFeed().hasSnapshot).toBe("no");
    expect(readFeed().loadState).toBe("restricted");
    expect(readFeed().title).toBe("");
    expect(readFeed().ticker).toBe("");
    expect(stream.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(stream.closed).toBe(true);
    expect(readFeed().hasSnapshot).toBe("no");
    expect(readFeed().loadState).toBe("restricted");
  });

  it("a successful change refresh after a failed re-open refresh clears liveInterrupted", async () => {
    let phase: "initial" | "reopenFail" | "recover" = "initial";
    const recover = defer();
    globalThis.fetch = vi.fn(() => {
      if (phase === "initial") return response(snapshot("NVDA", [row("ev2_a", "Before break", 1)]));
      if (phase === "reopenFail") return response({ detail: "upstream missing" }, 503);
      return recover.promise;
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    const stream = FakeEventSource.instances[0];
    expect(stream).toBeTruthy();
    expect(readFeed().live).toBe("no");

    await settle(() => {
      stream.onerror?.(new Event("error"));
    });
    expect(readFeed().live).toBe("yes");
    expect(readFeed().loadState).toBe("ready");

    // The stream re-opens but its catch-up refresh fails: unavailable, note still up.
    phase = "reopenFail";
    await settle(() => {
      stream.onopen?.(new Event("open"));
    });
    expect(readFeed().loadState).toBe("unavailable");
    expect(readFeed().live).toBe("yes");

    // The still-connected stream delivers a change and that refresh succeeds.
    phase = "recover";
    await settle(() => {
      stream.emit("upsert", changePayload(3, "ev2_c", "Recovered headline"));
    });
    expect(readFeed().loadState).toBe("unavailable");

    await act(async () => {
      recover.resolve(jsonResponse(snapshot("NVDA", [row("ev2_c", "Recovered headline", 3)])));
      await recover.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().title).toBe("Recovered headline");
    expect(readFeed().live).toBe("no");
  });

  it("in-flight refresh resolved after SSE restricted does not restore rows", async () => {
    const refresh = defer();
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      if (calls === 1) return response(snapshot("NVDA", [row("ev2_a", "Initial headline", 1)]));
      return refresh.promise;
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      root.render(<FeedProbe symbol="NVDA" />);
    });
    expect(readFeed().title).toBe("Initial headline");
    expect(readFeed().loadState).toBe("ready");
    expect(readFeed().hasSnapshot).toBe("yes");
    const stream = FakeEventSource.instances[0];
    expect(stream).toBeTruthy();

    await settle(() => {
      stream.emit("upsert", changePayload(2, "ev2_b", "Incoming"));
    });
    expect(calls).toBe(2);
    expect(readFeed().title).toBe("Initial headline");
    expect(readFeed().loadState).toBe("ready");

    await settle(() => {
      stream.emit("restricted", { state: "restricted" });
    });
    expect(stream.closed).toBe(true);

    await act(async () => {
      refresh.resolve(jsonResponse(snapshot("NVDA", [row("ev2_b", "Stale republish", 2)])));
      await refresh.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readFeed().hasSnapshot).toBe("no");
    expect(readFeed().loadState).toBe("restricted");
    expect(readFeed().title).toBe("");
    expect(readFeed().ticker).toBe("");
    expect(readFeed().title).not.toContain("Stale republish");
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
