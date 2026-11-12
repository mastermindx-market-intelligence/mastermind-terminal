import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Position } from "@/lib/portfolio";
import { createPosition } from "@/lib/portfolio";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { decodePositionRead, recordIssues, selectPortfolioRecords } from "@/lib/portfolioWorkspace";
import { isPortfolioRisk, isPortfolioRiskHistory } from "@/lib/portfolioAnalysisRead";
import { computePortfolioRisk } from "@/lib/portfolioRisk";
import { stateForResponse } from "@/lib/portfolioBrief";
import { GET } from "@/app/api/portfolio/route";
import { createFixtureDb, fixtureUserId, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const base: Position = { id: "record-a", ticker: "AAA", shares: 10, entryPrice: 100, entryCurrency: "USD",
  entryDate: "2026-01-01", notes: "First record", status: "open", createdAt: "2026-01-01T00:00:00Z" };
const read = (rows: Position[]) => ({ positions: rows, bookKey: portfolioBookKey(rows) });

describe("Portfolio response and record boundaries", () => {
  it("binds analysis to all canonical fields without depending on row order", () => {
    const other = { ...base, id: "record-b", ticker: "BBB" };
    expect(portfolioBookKey([base, other])).toBe(portfolioBookKey([other, base]));
    for (const patch of [{ shares: 0 }, { shares: null }, { entryCurrency: "HKD" }, { status: "closed" as const }, { notes: "Revised" }]) {
      expect(portfolioBookKey([{ ...base, ...patch }])).not.toBe(portfolioBookKey([base]));
    }
  });
  it("keeps repeated securities as separate, addressable records", () => {
    const second = { ...base, id: "record-b", shares: 20, notes: "Second thesis" };
    const rows = selectPortfolioRecords([base, second], {}, {}, { query: "second thesis", status: "open", filter: "all" });
    expect(rows.map(p => p.id)).toEqual(["record-b"]);
    expect(decodePositionRead(read([base, second]))?.positions).toHaveLength(2);
  });
  it("accepts a proven zero-row book and rejects malformed or duplicate rows as a whole", () => {
    expect(decodePositionRead(read([]))?.positions).toEqual([]);
    for (const rows of [[base, base], [{ ...base, shares: Infinity }], [{ ...base, status: "lost" }], [{ ...base, id: "" }]]) {
      expect(decodePositionRead({ positions: rows, bookKey: portfolioBookKey([]) })).toBeNull();
    }
    expect(decodePositionRead({ positions: [] })).toBeNull();
    expect(decodePositionRead(null)).toBeNull();
  });
  it("does not treat a recorded zero as an absent quantity", () => {
    expect(recordIssues({ ...base, shares: 0 }, { last: 100, currency: "USD" }, null)).toEqual([]);
    expect(recordIssues({ ...base, shares: null }, { last: 100, currency: "USD" }, null)).toContain("shares");
  });
  it("keeps unknown price units and mismatched currencies explicit", () => {
    expect(recordIssues(base, { last: 105 }, { last: 100, currency: "USD" })).toContain("quoteCurrency");
    expect(recordIssues(base, { last: 105, currency: "HKD" }, null)).toContain("currencyMismatch");
    expect(recordIssues({ ...base, entryCurrency: null }, { last: 105, currency: "USD" }, null)).toContain("entryCurrency");
  });
  it("validates optional risk and contains malformed successful responses", () => {
    const risk = computePortfolioRisk([base], {}, false);
    expect(isPortfolioRisk(risk)).toBe(true);
    expect(isPortfolioRisk({ ...risk, sectors: [{}] })).toBe(false);
    expect(isPortfolioRisk({ ...risk, gaps: [{ ticker: "AAA", reason: "invented_reason" }] })).toBe(false);
    expect(isPortfolioRiskHistory({ schema: "portfolio_risk_history.v1" })).toBe(false);
    for (const payload of [null, {}, { schema: "portfolio_brief.v1", sections: null }]) {
      expect(stateForResponse(200, payload)).toEqual({ kind: "unavailable" });
    }
    expect(stateForResponse(401, {})).toEqual({ kind: "hidden" });
    expect(stateForResponse(403, { tier: "free" })).toEqual({ kind: "teaser", tier: "free" });
  });
});

describe("Canonical positions fast path", () => {
  const key = "workspace-fast-read-" + Math.random().toString(36).slice(2);
  const previousFixture = process.env.TERMINAL_E2E_FIXTURE;
  beforeEach(async () => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({ get: (name: string) => name === FIXTURE_STORE_COOKIE ? { value: key } : undefined, getAll: () => [] } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousFixture === undefined) delete process.env.TERMINAL_E2E_FIXTURE; else process.env.TERMINAL_E2E_FIXTURE = previousFixture;
  });
  it("returns holdings without starting any risk artifact request, even if risk would never resolve", async () => {
    await createPosition(createFixtureDb(key), fixtureUserId(key), { ticker: "FAST", shares: 5, entryPrice: 10, entryCurrency: "USD" });
    const upstream = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", upstream);
    const response = await GET(new Request("http://terminal.test/api/portfolio?view=positions"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.positions.some((p: Position) => p.ticker === "FAST")).toBe(true);
    expect(payload.bookKey).toBe(portfolioBookKey(payload.positions));
    expect(payload).not.toHaveProperty("risk");
    expect(upstream).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("preserves the explicit owner filter in the new mode", async () => {
    const db = createFixtureDb(key);
    await db.from("portfolio_positions").insert({ user_id: "another-owner", ticker: "FOREIGN", status: "open" });
    const response = await GET(new Request("http://terminal.test/api/portfolio?view=positions"));
    expect((await response.json()).positions.some((p: Position) => p.ticker === "FOREIGN")).toBe(false);
  });
  it("preserves the authenticated boundary", async () => {
    delete process.env.TERMINAL_E2E_FIXTURE;
    const { createClient } = await import("@/lib/supabase/server");
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } } as never);
    const response = await GET(new Request("http://terminal.test/api/portfolio?view=positions"));
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("positions");
  });
});
