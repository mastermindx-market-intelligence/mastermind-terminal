import { describe, it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ owner: "11111111-1111-4111-8111-111111111111" as string | null, filters: [] as Array<[string, unknown]> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.owner ? { id: state.owner } : null } }) }, from: (table: string) => {
  const chain: any = { select: () => chain, eq: (key: string, value: unknown) => { if (table === "alert_outbox") state.filters.push([key, value]); return chain; }, not: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: null, error: null }), then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }) }; return chain;
} }) }));
import { GET } from "../../app/api/alerts/receipts/route";
beforeEach(() => { state.owner = "11111111-1111-4111-8111-111111111111"; state.filters = []; });
describe("incumbent outbox receipt route keeps caller ownership", () => {
  it("requires authentication before any outbox read", async () => { state.owner = null; expect((await GET()).status).toBe(401); expect(state.filters).toEqual([]); });
  it("filters nullable-alert outbox receipts by the authenticated owner", async () => { const response = await GET(); expect(response.status).toBe(200); expect(state.filters).toContainEqual(["user_id", state.owner]); });
});
