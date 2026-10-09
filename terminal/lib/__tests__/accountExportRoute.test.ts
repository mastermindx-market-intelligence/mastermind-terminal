import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ db: null as unknown, user: null as { id: string; email: string } | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({
  from: (table: string) => (H.db as { from: (table: string) => unknown }).from(table),
  auth: { getUser: async () => ({ data: { user: H.user } }) },
})) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

import { GET } from "@/app/api/account/export/route";
import { createFixtureDb, fixtureUserId } from "@/lib/watchlistsFixtureDb";
import { verifyAccountExportIntegrity, verifyAccountExportCsvChecksum } from "@/lib/accountExportIntegrity";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const request = (format = "json") => new Request(`http://localhost/api/account/export?format=${format}`);
let sequence = 0;

beforeEach(() => {
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "0");
  const key = `export-route-integrity-${++sequence}`;
  H.db = createFixtureDb(key);
  H.user = { id: fixtureUserId(key), email: "fictional@example.test" };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("account export route integrity through the normal session client", () => {
  it("downloads verifiable JSON and CSV back-to-back with safe attachment headers", async () => {
    const json = await GET(request());
    expect(json.status).toBe(200);
    expect(json.headers.get("cache-control")).toBe("no-store");
    expect(json.headers.get("x-content-type-options")).toBe("nosniff");
    expect(json.headers.get("content-disposition")).toMatch(/attachment; filename="mastermind-terminal-data-.*\.json"/);
    const doc = await json.json();
    expect(doc.account.user_id).toBe(H.user!.id);
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(true);
    expect(doc.integrity.read_window.started_at <= doc.integrity.read_window.finished_at).toBe(true);
    const csv = await GET(request("csv"));
    expect(csv.status).toBe(200);
    // Response.text() removes the UTF-8 BOM. This receipt deliberately binds file
    // bytes, so decode the attachment bytes without that text-reader transform.
    expect(verifyAccountExportCsvChecksum(Buffer.from(await csv.arrayBuffer()).toString("utf8"), sha256)).toBe(true);
    expect((await GET(request())).status).toBe(429);
  });

  it("exports only the authenticated owner's positions when foreign rows are present", async () => {
    const db = H.db as ReturnType<typeof createFixtureDb>;
    await db.from("portfolio_positions").insert([
      { user_id: H.user!.id, ticker: "OWNED", shares: 1, entry_price: 10, status: "open" },
      { user_id: "foreign-owner", ticker: "FOREIGN", shares: 1, entry_price: 99, status: "open" },
    ]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    const doc = await response.json();
    expect(doc.portfolio_positions.map((row: { ticker: string }) => row.ticker)).toEqual(["OWNED"]);
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("FOREIGN");
  });

  it("returns no downloadable artifact for an unauthenticated user or an unsupported format", async () => {
    H.user = null;
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("xml"))).status).toBe(400);
  });

  it("does not seal an all-source outage as an empty complete account", async () => {
    H.db = { from: () => { throw new Error("fictional unavailable DB"); } };
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.json()).toEqual({ error: "export unavailable" });
  });

  it.each(["json", "csv"])("preserves the secret-content withholding guard for %s", async (format) => {
    const db = H.db as ReturnType<typeof createFixtureDb>;
    await db.from("portfolio_positions").insert({ user_id: H.user!.id, ticker: "OWNED", notes: "password=fictional-fixture-value", status: "open" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(request(format));
    expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.json()).toEqual({ error: "export_withheld" });
  });
});


function withOwnedTables(rows: Record<string, Record<string, unknown>[]>, failOthers = false) {
  const base = H.db as { from: (table: string) => unknown };
  const selects: Array<{ table: string; fields: string }> = [];
  H.db = { from(table: string) {
    if (!(table in rows)) { if (failOthers) throw new Error("unavailable fixture source"); return base.from(table); }
    let fields: string[] = []; let owner: unknown;
    const result = (from = 0, to = 99) => ({ data: rows[table].filter(row => row.user_id === owner).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .slice(from, to + 1).map(row => Object.fromEntries(fields.map(key => [key, row[key]]))), error: null });
    const q = { select(value: string) { selects.push({ table, fields: value }); fields = value.split(","); return q; },
      eq(column: string, value: unknown) { expect(column).toBe("user_id"); owner = value; return q; },
      order(column: string, opts: { ascending: boolean }) { expect(column).toBe("id"); expect(opts.ascending).toBe(true); return q; },
      range(from: number, to: number) { return Promise.resolve(result(from, to)); },
      limit(n: number) { return Promise.resolve(result(0, n - 1)); } };
    return q;
  } };
  return selects;
}
const ownedDrawing = () => ({ id: "drawing-owned", user_id: H.user!.id, symbol: "NVDA", kind: "__collection_v1",
  data: { revision: "actual-r4", drawings: [{ id: "geometry", points: [1, 2], future: "kept" }] }, created_at: "2026-09-01T00:00:00.000Z" });
const ownedAlert = () => ({ id: "alert-owned", user_id: H.user!.id, symbol: "NVDA", condition: { value: 120, nested: [1, 2] }, active: false, created_at: "2026-09-01T00:00:00.000Z" });

describe("normal-session owned archive route", () => {
  it("downloads owner-filtered raw drawings and inactive alert definitions with six-entry integrity", async () => {
    const drawing = ownedDrawing(); const alert = ownedAlert();
    const selects = withOwnedTables({ drawings: [drawing, { ...drawing, id: "foreign", user_id: "other" }],
      alerts: [{ ...alert, delivery_secret: "must-not-be-projected" }, { ...alert, id: "foreign", user_id: "other" }] });
    const response = await GET(request()); expect(response.status).toBe(200); const doc = await response.json();
    expect(doc.chart_drawings).toHaveLength(1); expect(doc.chart_drawings[0].data).toEqual(drawing.data);
    expect(doc.alerts).toHaveLength(1); expect(doc.alerts[0].condition).toEqual(alert.condition); expect(doc.alerts[0].active).toBe(false);
    expect(doc.chart_drawings[0].version).toBe("actual-r4"); expect(doc.alerts[0].version).toBeNull();
    expect(doc.integrity.schema).toBe("mm.terminal_account_export.integrity.v2"); expect(Object.keys(doc.integrity.collections)).toHaveLength(6);
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(true);
    expect(selects).toEqual([{ table: "drawings", fields: "id,user_id,symbol,kind,data,created_at" }, { table: "alerts", fields: "id,user_id,symbol,condition,active,created_at" }]);
    expect(JSON.stringify(doc)).not.toContain("must-not-be-projected");
    const csvResponse = await GET(request("csv")); expect(csvResponse.status).toBe(200);
    const csv = Buffer.from(await csvResponse.arrayBuffer()).toString("utf8"); expect(verifyAccountExportCsvChecksum(csv, sha256)).toBe(true);
    expect(csv).toContain("data,chart_drawings,drawing-owned,data,"); expect(csv).toContain("data,alerts,alert-owned,active,false");
  });
  it("does not return all-source 503 when the new drawing source is the only readable collection", async () => {
    withOwnedTables({ drawings: [ownedDrawing()] }, true);
    const response = await GET(request()); expect(response.status).toBe(200); const doc = await response.json();
    expect(doc.coverage.included.map((e: { key: string }) => e.key)).toEqual(["chart_drawings"]);
    expect(doc.coverage.unavailable).toHaveLength(5); expect(doc.integrity.collections.alerts.state).toBe("unavailable");
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(true);
  });
  it.each(["json", "csv"])("withholds %s when raw owned alert text contains a credential-shaped value", async format => {
    withOwnedTables({ drawings: [], alerts: [{ ...ownedAlert(), condition: { note: "password=fictional-private-content" } }] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET(request(format)); expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull(); expect(await response.json()).toEqual({ error: "export_withheld" });
  });
});
