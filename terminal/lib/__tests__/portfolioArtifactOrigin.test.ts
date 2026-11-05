import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookies } = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const APPROVED_BASE = "https://www.mastermind-x.com";
const SESSION_COOKIES = {
  "sb-testref-auth-token.0": "synthetic-session-part-zero",
  "sb-testref-auth-token.1": "synthetic-session-part-one",
};
const EXPECTED_COOKIE =
  "sb-testref-auth-token.0=synthetic-session-part-zero; sb-testref-auth-token.1=synthetic-session-part-one";
let fixtureSequence = 0;

async function loadConfiguredRoute(
  base: string | undefined,
  authCookies: Record<string, string> = SESSION_COOKIES,
) {
  // The production route captures its base at import time. Reset modules before each
  // case, then import the fixture store and route together so they share one store/cache.
  vi.stubEnv("STOCKDATA_BASE", base);
  const { createFixtureDb, fixtureUserId, FIXTURE_STORE_COOKIE } =
    await import("@/lib/watchlistsFixtureDb");
  const key = `artifact-origin-${++fixtureSequence}`;
  const values = { [FIXTURE_STORE_COOKIE]: key, theme: "dark", ...authCookies };
  const jar = new Map(
    Object.entries(values).map(([name, value]) => [name, { name, value }]),
  );
  cookies.mockResolvedValue({
    get: (name: string) => jar.get(name),
    getAll: () => Array.from(jar.values()),
  });
  await createFixtureDb(key, undefined).from("portfolio_positions").insert({
    user_id: fixtureUserId(key),
    ticker: "AAPL",
    shares: 2,
    entry_price: 100,
    entry_currency: "USD",
    entry_currency_basis: { ticker: "AAPL", price: 100 },
    status: "open",
  });
  return import("@/app/api/portfolio/route");
}

function mockArtifactFetch() {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
    new Response(
      JSON.stringify({ sector: "Technology", personality: { market_cap: 3e12 } }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GET /api/portfolio artifact credential destination", () => {
  beforeEach(() => {
    vi.resetModules();
    cookies.mockReset();
    vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["default origin", undefined],
    ["configured approved origin", APPROVED_BASE],
    ["explicit default HTTPS port", `${APPROVED_BASE}:443`],
  ])("forwards only the selected session chunks to the %s", async (_label, base) => {
    const fetchMock = mockArtifactFetch();
    const { GET } = await loadConfiguredRoute(base);
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.positions).toHaveLength(1);
    expect(body.risk.sectors).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "Information Technology" })]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${base || APPROVED_BASE}/stockdata/AAPL.json`);
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ cookie: EXPECTED_COOKIE });
    expect(init?.redirect).toBe("manual");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["external HTTPS origin", "https://artifact.example"],
    ["same hostname over HTTP", "http://www.mastermind-x.com"],
    ["nondefault port", "https://www.mastermind-x.com:8443"],
    ["hostname suffix lookalike", "https://www.mastermind-x.com.artifact.example"],
    ["hostname prefix lookalike", "https://not-www.mastermind-x.com"],
    ["username on approved origin", "https://fixture-user@www.mastermind-x.com"],
    ["password on approved origin", "https://:fixture-password@www.mastermind-x.com"],
    ["username and password", "https://fixture-user:fixture-password@www.mastermind-x.com"],
    ["approved hostname in URL userinfo", "https://www.mastermind-x.com@artifact.example"],
  ])("withholds session cookies from %s", async (_label, base) => {
    const fetchMock = mockArtifactFetch();
    const { GET } = await loadConfiguredRoute(base);
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.positions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${base}/stockdata/AAPL.json`);
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(init?.redirect).toBe("manual");
  });

  it.each([APPROVED_BASE, "https://artifact.example"])(
    "keeps an anonymous artifact request anonymous at %s",
    async (base) => {
      const fetchMock = mockArtifactFetch();
      const { GET } = await loadConfiguredRoute(base, {});
      const body = await (await GET()).json();

      expect(body.risk.coverageSource).toBe("anonymous");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("cookie")).toBe(false);
    },
  );

  it.each([APPROVED_BASE, "https://artifact.example"])(
    "returns typed unreadable after one manual redirect response from %s",
    async (base) => {
      const fetchMock = mockArtifactFetch();
      fetchMock.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "https://redirect.example/collect" },
        }),
      );
      const { GET } = await loadConfiguredRoute(base);
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.positions).toHaveLength(1);
      expect(body.risk.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ticker: "AAPL", reason: "page_unreadable" }),
        ]),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${base}/stockdata/AAPL.json`);
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("cookie")).toBe(
        base === APPROVED_BASE ? EXPECTED_COOKIE : null,
      );
    },
  );

  it("preserves typed unreadable without forwarding cookies for a malformed base", async () => {
    const fetchMock = mockArtifactFetch();
    fetchMock.mockImplementation(async (input, init) => {
      // Exercise the standard URL parser without issuing any network request.
      new Request(input, init);
      return new Response(JSON.stringify({ sector: "Energy" }), { status: 200 });
    });
    const { GET } = await loadConfiguredRoute("not a URL");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.positions).toHaveLength(1);
    expect(body.risk.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: "AAPL", reason: "page_unreadable" }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("cookie")).toBe(false);
  });
});
