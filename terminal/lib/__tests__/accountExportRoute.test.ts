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
