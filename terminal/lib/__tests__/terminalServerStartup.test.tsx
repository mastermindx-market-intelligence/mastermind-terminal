import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthSessionMissingError, createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readFirstOwnedWatchlistWithSymbols, type WatchlistDb } from "@/lib/watchlists";

const H = vi.hoisted(() => ({
  client: null as any,
  cookies: new Map<string, string>(),
  preload: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => H.client }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) =>
  H.cookies.has(key) ? { value: H.cookies.get(key) } : undefined }) }));
vi.mock("react-dom", async (original) => ({
  ...await original<typeof import("react-dom")>(), preload: H.preload,
}));
vi.mock("@/components/TerminalShell", () => ({
  default: (props: any) => <section data-testid="terminal-shell" data-user={props.userId} />,
}));
vi.mock("@/components/ProvisioningRetry", () => ({
  default: () => <button data-testid="provisioning-retry">Retry</button>,
}));
vi.mock("@/components/LocalizedCopy", () => ({
  T: ({ as: Tag = "span", k }: any) => <Tag>{k}</Tag>,
}));
import Terminal from "@/app/terminal/page";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
type List = { id: string; name: string; user_id: string; position: number };
type Member = { watchlist_id: string; symbol: string; section: string | null; position: number };
type Call = { table: string; method: string; query: URLSearchParams; body: any };
type Fault = "none" | "error" | "malformed" | "wrong-owner" | "throw";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function transport() {
  const state = {
    lists: [{ id: "owned", name: "Default", user_id: OWNER, position: 0 }] as List[],
    members: [
      { watchlist_id: "owned", symbol: "TSLA", section: "", position: 0 },
      { watchlist_id: "owned", symbol: "NVDA", section: "Equities", position: 1 },
    ] as Member[],
    embeddedFault: "none" as Fault,
    inventoryFault: false,
    inventoryMalformed: false,
    embeddedPayload: undefined as unknown,
    membershipFault: false,
    countFault: false,
    countHeaderMissing: false,
    upsertFault: false,
    hideListsAfterWrite: false,
    countOverride: null as number | null,
    calls: [] as Call[],
    pending: [] as { call: Call; release: () => void }[],
    holdReads: false,
    delay: 0,
  };
  const json = (value: unknown, status = 200, headers?: HeadersInit) =>
    new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
  const fail = () => json({ code: "PGRST200", message: "test read unavailable" }, 400);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method || "GET").toUpperCase();
    const call: Call = {
      table: url.pathname.split("/").pop()!, method, query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    state.calls.push(call);
    if (method === "GET" && state.holdReads) {
      await new Promise<void>((release) => state.pending.push({ call, release }));
    }
    if (method === "GET" && state.delay) await new Promise((done) => setTimeout(done, state.delay));
    const embedded = (call.query.get("select") || "").includes("watchlist_symbols(");
    if (method === "GET" && call.table === "watchlists") {
      if (embedded && state.embeddedFault === "throw") throw new Error("test transport failure");
      if (embedded && state.embeddedFault === "error") return fail();
      if (!embedded && state.inventoryFault) return fail();
      if (!embedded && state.inventoryMalformed) return json({ lists: [] });
      if (embedded && state.embeddedPayload !== undefined) return json(state.embeddedPayload);
      if (embedded && state.embeddedFault === "malformed") return json([{ id: "owned", name: "Default", user_id: OWNER }]);
      if (embedded && state.embeddedFault === "wrong-owner")
        return json([{ id: "shared", name: "Shared", user_id: OTHER, watchlist_symbols: [] }]);
      // This models shared-readable RLS visibility. Only the explicit owner filter excludes it.
      let lists = state.lists.filter((row) => !call.query.has("user_id") ||
        call.query.get("user_id") === "eq." + row.user_id);
      if (state.hideListsAfterWrite && state.calls.some((c) => c.method === "POST")) lists = [];
      lists = [...lists].sort((a, b) => a.position - b.position);
      if (call.query.has("limit")) lists = lists.slice(0, Number(call.query.get("limit")));
      return json(lists.map((row) => embedded ? {
        ...row, watchlist_symbols: state.members.filter((m) => m.watchlist_id === row.id)
          .sort((a, b) => a.position - b.position).map(({ symbol, section }) => ({ symbol, section })),
      } : row));
    }
    if (method === "GET" && call.table === "watchlist_symbols") {
      if (state.membershipFault) return fail();
      return json(state.members.filter((m) => call.query.get("watchlist_id") === "eq." + m.watchlist_id)
        .sort((a, b) => a.position - b.position).map(({ symbol, section }) => ({ symbol, section })));
    }
    if (method === "POST" && call.table === "watchlists") {
      if (state.upsertFault) return fail();
      let list = state.lists.find((r) => r.user_id === call.body.user_id && r.name === call.body.name);
      if (!list) { list = { ...call.body, id: "new-default" }; state.lists.push(list!); }
      return json({ id: list!.id });
    }
    if (method === "HEAD") {
      if (state.countFault) return new Response(null, { status: 400 });
      if (state.countHeaderMissing) return new Response(null, { status: 200 });
      const count = state.countOverride ?? state.members.filter((m) =>
        call.query.get("watchlist_id") === "eq." + m.watchlist_id).length;
      return new Response(null, { status: 200, headers: { "Content-Range": "0-0/" + count } });
    }
    if (method === "POST" && call.table === "watchlist_symbols") {
      for (const row of call.body) {
        if (!state.members.some((m) => m.watchlist_id === row.watchlist_id && m.symbol === row.symbol))
          state.members.push(row);
      }
      return new Response(null, { status: 201 });
    }
    throw new Error("Unexpected mocked PostgREST request");
  };
  const client = createSupabaseClient("https://startup-test.supabase.co", "test-public-key", {
    global: { fetch: fetcher },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  vi.spyOn(client.auth, "getUser").mockResolvedValue({
    data: { user: { id: OWNER, email: "owner@example.test" } as any }, error: null,
  });
  H.client = client;
  return { state, client };
}

const start = (params: Record<string, string> = {}) => Terminal({ searchParams: Promise.resolve(params) });
const props = (element: ReactElement) => element.props as any;
const preloads = () => H.preload.mock.calls.map(([url]) => url);
const writes = (state: ReturnType<typeof transport>["state"]) => state.calls.filter((c) => c.method === "POST");
const holding = (element: ReactElement) => expect(renderToStaticMarkup(element)).toContain("provisioning-retry");

beforeEach(() => {
  H.preload.mockReset();
  H.cookies.clear();
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "");
  vi.stubEnv("HUB_REALTIME_QUOTES", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Terminal server startup through the actual async page and Supabase transport", () => {
  it("waits for getUser validation before any owner query", async () => {
    const { state, client } = transport();
    const auth = deferred<any>();
    vi.mocked(client.auth.getUser).mockReturnValue(auth.promise);
    const page = start({ sym: "aapl" });
    await vi.waitFor(() => expect(client.auth.getUser).toHaveBeenCalledOnce());
    expect(state.calls).toHaveLength(0);
    expect(preloads()).toEqual(["/data/AAPL.json", "/data/AAPL.slice.json"]);
    auth.resolve({ data: { user: { id: OWNER, email: "owner@example.test" } }, error: null });
    expect(props(await page).userId).toBe(OWNER);
  });

  it("healthy account resolves deferred membership in ONE owner-filtered request", async () => {
    const { state } = transport();
    state.holdReads = true;
    let settled = false;
    const page = start().then((element) => { settled = true; return element; });
    await vi.waitFor(() => expect(state.pending).toHaveLength(1));
    expect(settled).toBe(false);
    expect(preloads()).toEqual([]);
    const query = state.calls[0].query;
    expect(query.get("user_id")).toBe("eq." + OWNER);
    expect(query.get("select")).toBe("id,name,user_id,watchlist_symbols(symbol,section)");
    expect(query.get("limit")).toBe("1");
    expect(query.get("order")).toBe("position.asc");
    expect(query.get("watchlist_symbols.order")).toBe("position.asc");
    state.pending[0].release();
    const element = await page;
    expect(state.calls).toHaveLength(1);
    expect(props(element).symbols).toEqual([
      { symbol: "TSLA", section: "" }, { symbol: "NVDA", section: "Equities" },
    ]);
    expect(props(element).userId).toBe(OWNER);
    expect(props(element).email).toBe("owner@example.test");
    expect(preloads()).toEqual(["/data/NVDA.json", "/data/NVDA.slice.json"]);
    expect(writes(state)).toEqual([]);
  });

  it("excludes an earlier shared-readable list and preserves position order and raw sections", async () => {
    const { state } = transport();
    state.lists.unshift({ id: "shared", name: "Other account", user_id: OTHER, position: -1 });
    state.members = [
      { watchlist_id: "owned", symbol: "MSFT", section: "  User label  ", position: 5 },
      { watchlist_id: "shared", symbol: "BAD", section: "Shared", position: -1 },
      { watchlist_id: "owned", symbol: "TSLA", section: null, position: 0 },
    ];
    expect(props(await start()).symbols).toEqual([
      { symbol: "TSLA", section: null }, { symbol: "MSFT", section: "  User label  " },
    ]);
    expect(preloads()).toEqual(["/data/TSLA.json", "/data/TSLA.slice.json"]);
  });

  it("keeps an empty first list despite a populated second list, with no provisioning", async () => {
    const { state } = transport();
    state.lists.push({ id: "second", name: "Second", user_id: OWNER, position: 1 });
    state.members = [{ watchlist_id: "second", symbol: "AAPL", section: "Second", position: 0 }];
    expect(props(await start()).symbols).toEqual([]);
    expect(state.calls).toHaveLength(1);
    expect(writes(state)).toEqual([]);
    expect(preloads()).toEqual(["/data/NVDA.json", "/data/NVDA.slice.json"]);
  });

  it.each(["error", "malformed", "wrong-owner", "throw"] as const)(
    "%s embedding uses owner-filtered inventory and matching membership fallback", async (fault) => {
      const { state } = transport();
      state.embeddedFault = fault;
      if (fault === "throw") vi.useFakeTimers();
      const page = start();
      if (fault === "throw") await vi.runAllTimersAsync();
      expect(props(await page).symbols).toHaveLength(2);
      if (fault !== "throw") expect(state.calls).toHaveLength(3);
      // The installed SDK retries network failures; the final two reads are the fallback.
      expect(state.calls.at(-2)!.query.get("user_id")).toBe("eq." + OWNER);
      expect(state.calls.at(-1)!.query.get("watchlist_id")).toBe("eq.owned");
      expect(writes(state)).toEqual([]);
    });

  it("failed inventory holds and cannot upsert or seed", async () => {
    const { state } = transport();
    state.embeddedFault = "error"; state.inventoryFault = true;
    holding(await start());
    expect(writes(state)).toEqual([]);
    expect(preloads()).toEqual([]);
  });

  it("malformed fallback inventory is unknown and cannot authorize provisioning", async () => {
    const { state } = transport();
    state.embeddedFault = "malformed"; state.inventoryMalformed = true;
    holding(await start());
    expect(writes(state)).toEqual([]);
  });

  it.each([
    null,
    {},
    [{ id: "owned", name: "Default", user_id: OWNER, watchlist_symbols: [{ symbol: "NVDA" }] }],
    [{ id: "owned", name: "Default", user_id: OWNER, watchlist_symbols: null }],
    [{ id: "owned", name: "Default", user_id: OWNER, watchlist_symbols: [{ symbol: 123, section: "" }] }],
    [
      { id: "owned", name: "Default", user_id: OWNER, watchlist_symbols: [] },
      { id: "extra", name: "Extra", user_id: OWNER, watchlist_symbols: [] },
    ],
  ])("malformed embedded response %# falls back without inventing empty membership", async (payload) => {
    const { state } = transport();
    state.embeddedPayload = payload;
    expect(props(await start()).symbols).toHaveLength(2);
    expect(state.calls).toHaveLength(3);
    expect(writes(state)).toEqual([]);
  });

  it("membership failure holds instead of claiming an authoritative empty list", async () => {
    const { state } = transport();
    state.embeddedFault = "error"; state.membershipFault = true;
    holding(await start());
    expect(writes(state)).toEqual([]);
    expect(preloads()).toEqual([]);
  });

  it("guest renders unchanged seed without an owner read", async () => {
    const { state, client } = transport();
    vi.mocked(client.auth.getUser).mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    const element = await start();
    expect(props(element).email).toBe("");
    expect(props(element).symbols.map((r: any) => r.symbol)).toEqual(["BTC-USD", "ETH-USD", "NVDA", "AAPL", "MSFT", "QQQ"]);
    expect(state.calls).toEqual([]);
    expect(preloads()).toEqual(["/data/NVDA.json", "/data/NVDA.slice.json"]);
  });

  it.each([
    [{ sym: "aapl" }, "AAPL"],
    [{ symbol: "msft", sym: "aapl" }, "MSFT"],
    [{ sym: "../bad" }, "NVDA"],
  ])("preserves final preload URLs for %j", async (params, symbol) => {
    transport();
    const element = await start(params);
    expect(props(element).initialSymbol).toBe(params.sym === "../bad" ? undefined : symbol);
    expect([...new Set(preloads())]).toEqual(["/data/" + symbol + ".json", "/data/" + symbol + ".slice.json"]);
  });

  it("authoritative missing list provisions with the original checked count and conflict keys", async () => {
    const { state } = transport();
    state.lists = []; state.members = [];
    const element = await start();
    const ops = state.calls.map((c) => c.method + " " + c.table);
    expect(ops).toEqual(["GET watchlists", "POST watchlists", "HEAD watchlist_symbols", "POST watchlist_symbols", "GET watchlists"]);
    expect(state.calls[1].body).toEqual({ user_id: OWNER, name: "Default", position: 0 });
    expect(state.calls[1].query.get("on_conflict")).toBe("user_id,name");
    expect(state.calls[3].query.get("on_conflict")).toBe("watchlist_id,symbol");
    expect(props(element).symbols).toHaveLength(6);
    expect(preloads()).toEqual(["/data/NVDA.json", "/data/NVDA.slice.json"]);
  });

  it("two concurrent new-account renders converge without duplicate membership", async () => {
    const { state } = transport();
    state.lists = []; state.members = [];
    const elements = await Promise.all([start(), start()]);
    for (const element of elements) expect(props(element).symbols).toHaveLength(6);
    expect(state.lists.filter((r) => r.user_id === OWNER && r.name === "Default")).toHaveLength(1);
    expect(state.members).toHaveLength(6);
    expect(new Set(state.members.map((r) => r.watchlist_id + ":" + r.symbol)).size).toBe(6);
  });

  it("failed count never seeds and the fresh read preserves any existing membership", async () => {
    const { state } = transport();
    state.lists = []; state.members = [{ watchlist_id: "new-default", symbol: "TSLA", section: "Mine", position: 0 }];
    state.countFault = true;
    expect(props(await start()).symbols).toEqual([{ symbol: "TSLA", section: "Mine" }]);
    expect(writes(state).map((c) => c.table)).toEqual(["watchlists"]);
  });

  it("a missing exact-count header never seeds from an unknown count", async () => {
    const { state } = transport();
    state.lists = []; state.countHeaderMissing = true;
    state.members = [{ watchlist_id: "new-default", symbol: "TSLA", section: "Mine", position: 0 }];
    expect(props(await start()).symbols).toEqual([{ symbol: "TSLA", section: "Mine" }]);
    expect(writes(state).map((c) => c.table)).toEqual(["watchlists"]);
  });

  it("nonempty count never seeds", async () => {
    const { state } = transport();
    state.lists = []; state.countOverride = 1;
    state.members = [{ watchlist_id: "new-default", symbol: "AAPL", section: "", position: 0 }];
    expect(props(await start()).symbols).toEqual([{ symbol: "AAPL", section: "" }]);
    expect(writes(state).map((c) => c.table)).toEqual(["watchlists"]);
  });

  it("missing list after bounded provisioning rereads reaches the existing recovery screen", async () => {
    vi.useFakeTimers();
    const { state } = transport();
    state.lists = []; state.members = []; state.upsertFault = true;
    const page = start();
    await vi.runAllTimersAsync();
    holding(await page);
    expect(state.calls.filter((c) => c.method === "GET")).toHaveLength(4);
    expect(state.calls.filter((c) => c.table === "watchlist_symbols")).toHaveLength(0);
  });

  it("fixture branch still reads its existing service/store without remote auth", async () => {
    const { state, client } = transport();
    vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
    vi.stubEnv("TERMINAL_E2E_EMAIL", "fixture@example.test");
    H.cookies.set("mm_e2e_wl", "startup-page-unit");
    const element = await start();
    expect(props(element).symbols).toHaveLength(6);
    expect(props(element).email).toBe("fixture@example.test");
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(state.calls).toEqual([]);
  });

  it("synthetic delayed transport removes one serial 800ms data hop with identical page props", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const baseline = transport();
    baseline.state.delay = 800;
    const before = Date.now();
    const legacyRows = (async () => {
      const lists = await baseline.client.from("watchlists").select("id,name,user_id")
        .eq("user_id", OWNER).order("position").limit(1);
      return await baseline.client.from("watchlist_symbols").select("symbol,section")
        .eq("watchlist_id", lists.data![0].id).order("position");
    })();
    await vi.runAllTimersAsync();
    const oldRows = (await legacyRows).data;
    const serialMs = Date.now() - before;
    const candidate = transport();
    candidate.state.delay = 800;
    const candidateStart = Date.now();
    const page = start();
    await vi.runAllTimersAsync();
    const element = await page;
    const candidateMs = Date.now() - candidateStart;
    expect(props(element).symbols).toEqual(oldRows);
    expect(serialMs).toBe(1600);
    expect(candidateMs).toBe(800);
    expect(baseline.state.calls).toHaveLength(2);
    expect(candidate.state.calls).toHaveLength(1);
    console.info("SYNTHETIC mocked PostgREST delay: serial=1600ms/2 reads; candidate async page=800ms/1 read; not a live network benchmark.");
  });
});

describe("startup reader response narrowing", () => {
  it("refuses empty owner keys without spending a read", async () => {
    const { state, client } = transport();
    expect(await readFirstOwnedWatchlistWithSymbols(client as unknown as WatchlistDb, "")).toEqual({ status: "unavailable" });
    expect(state.calls).toEqual([]);
  });
});
