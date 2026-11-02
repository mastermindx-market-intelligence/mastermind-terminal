import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureProposals, resetFixtureProposals, type FixtureProposal } from "@/lib/thesisAmendmentProposals";
import { fixtureUserId } from "@/lib/watchlistsFixtureDb";

const scope = vi.hoisted(() => ({ key: "proposal-query-owner-a" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: scope.key }) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => { throw new Error("fixture query must not use live storage"); } }));
import { resolveDb } from "@/app/api/thesis/[thesisId]/proposals/_session";

beforeEach(() => {
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
  resetFixtureProposals();
  scope.key = "proposal-query-owner-a";
  const row = (id: string, thesisId: string, createdAt: string): FixtureProposal => ({
    proposal_id: id, thesis_id: thesisId, amended_from: "original-version", body: id,
    evidence_refs: [], proposed_by: "assistant", state: "proposed", created_at: createdAt,
    user_id: fixtureUserId(scope.key),
  });
  fixtureProposals(scope.key).push(
    row("new", "thesis-a", "2026-10-13T02:00:00.000Z"),
    row("other-thesis", "thesis-b", "2026-10-13T03:00:00.000Z"),
    row("old", "thesis-a", "2026-10-13T01:00:00.000Z"),
  );
});
afterEach(() => { resetFixtureProposals(); vi.unstubAllEnvs(); });

describe("actual proposal fixture query", () => {
  it("keeps ordinary equality filters meaningful without ordering", async () => {
    const session = await resolveDb();
    expect(session).not.toBeNull();
    const result = await session!.db.from("thesis_amendment_proposals").select().eq("thesis_id", "thesis-a");
    expect((result.data as FixtureProposal[]).map(row => row.proposal_id)).toEqual(["new", "old"]);
    expect((await session!.db.from("thesis_amendment_proposals").select().eq("thesis_id", "missing")).data).toEqual([]);
  });
  it.each([true, false])("orders matching rows without treating sort metadata as a row predicate (ascending=%s)", async ascending => {
    const before = structuredClone(fixtureProposals(scope.key));
    const session = await resolveDb();
    const result = await session!.db.from("thesis_amendment_proposals").select()
      .eq("thesis_id", "thesis-a").order("created_at", { ascending });
    expect((result.data as FixtureProposal[]).map(row => row.proposal_id)).toEqual(ascending ? ["old", "new"] : ["new", "old"]);
    expect(fixtureProposals(scope.key)).toEqual(before);
  });
  it("does not expose another fixture owner's rows", async () => {
    scope.key = "proposal-query-owner-b";
    const session = await resolveDb();
    expect((await session!.db.from("thesis_amendment_proposals").select().eq("thesis_id", "thesis-a").order("created_at", { ascending: false })).data).toEqual([]);
  });
});
