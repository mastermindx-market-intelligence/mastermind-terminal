/**
 * sectorPopulation.test.ts — contract tests for the population member-list
 * decoder (Sector Intelligence, lane 3; COO order 2, 2026-11-10).
 *
 * The fixture is the pinned lane-1 wire sample (byte-identical capture,
 * sha256 dbb09959…, committed as sector_population.captured.v11_page1.json):
 * every admission assertion runs against the REAL owner shape, and mutations
 * of it prove the closed contract refuses everything outside it.
 *
 * Laws pinned here:
 *   - `industry` (GICS) and `sub_industry` admit as two SEPARATE current-basis
 *     fields with their own unavailable reasons — never merged.
 *   - A `group_index` entry carries no `refused_by_owner` at wire head
 *     595fe6b7: refusal derives from the three-part test, and an explicit
 *     flag wins when present.
 *   - Counts are counts: served of configured, owner-explained unserved,
 *     unaccounted, removed — `complete` is carried as a boolean, never as a
 *     claim the population is fully shown.
 *   - The refusal table: 401 is the ONLY sign-in state; 503/429/5xx are retry;
 *     409 CURSOR_RESET (and 400 REQUEST_INVALID on a sent cursor, until lane
 *     1's grammar fix) restart page one; 404 ORIGINAL_UNAVAILABLE is the
 *     retained-capture-unavailable state.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyPopulationResponse, groupIndexRefused, sectorPopulationPage, fetchSectorPopulation,
} from "../sectorPopulation";

const fixturePath = join(__dirname, "fixtures", "sector_population.captured.v11_page1.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
const clone = () => JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;

describe("sectorPopulationPage — the pinned wire sample admits", () => {
  it("admits the real capture and normalizes its identity and counts", () => {
    const page = sectorPopulationPage(fixture);
    expect(page).not.toBeNull();
    expect(page!.ownerRef.generationId).toBe("real-g1");
    expect(page!.ownerRef.retainedResolverRefDurability).toBe("process_lifetime_only");
    expect(page!.counts.configuredCurrent).toBe(1020);
    expect(page!.counts.served).toBe(1015);
    expect(page!.counts.accountedUnserved).toBe(5);
    expect(page!.counts.unaccounted).toBe(0);
    // complete is CARRIED (here true at capture level), never a completeness claim.
    expect(page!.counts.complete).toBe(true);
    expect(page!.counts.groups).toBe(49);
    expect(page!.counts.removedMembers?.status).toBe("available");
    expect(page!.counts.removedMembers?.status === "available" && page!.counts.removedMembers.n).toBe(26);
    expect(page!.unservedMatching).not.toBeNull();
    expect(page!.unservedMatching!.length).toBe(5);
  });

  it("keeps industry and sub-industry as two separate current-basis fields", () => {
    const page = sectorPopulationPage(fixture)!;
    const row = page!.rows[0];
    expect(row.symbol).toBe("MHK");
    expect(row.industry).toEqual({ status: "available", label: "Household Durables" });
    expect(row.subIndustry).toEqual({ status: "unavailable", reason: "not_in_current_classification" });
    expect(row.membership).toEqual({ status: "listed", effectiveOn: "2023-05-09" });
    expect(row.inHandoffMemberSet).toBe(true);
    // The wire carries also_in_groups as a COUNT of other baskets — a member list
    // there would be a shape change, not something to render as ids.
    expect(row.alsoInGroups).toBe(0);
  });

  it("derives group_index refusal by the three-part test, with the explicit flag winning", () => {
    const page = sectorPopulationPage(fixture)!;
    // The real sample: no refused entries — every index row admits as not refused.
    expect(page.groupIndex!.length).toBeGreaterThan(3);
    expect(page.groupIndex!.every(entry => !entry.refusedByOwner)).toBe(true);
    // Three-part test: name null AND zero listed AND unserved == configured.
    expect(groupIndexRefused({ name: null, membersListed: 0, configuredCurrent: 18, unserved: 18 })).toBe(true);
    expect(groupIndexRefused({ name: null, membersListed: 0, configuredCurrent: 18, unserved: 3 })).toBe(false);
    expect(groupIndexRefused({ name: "Housing Chain", membersListed: 0, configuredCurrent: 18, unserved: 18 })).toBe(false);
    expect(groupIndexRefused({ name: null, membersListed: 0, configuredCurrent: 18, unserved: 18, refusedByOwner: false })).toBe(false);
    // Mutated entry without the wire field: derived refusal true.
    const mutated = clone();
    const page2 = (mutated.page as Record<string, unknown>);
    (page2.group_index as Array<Record<string, unknown>>)[0] =
      { group_id: "housing", name: null, n_members_listed: 0, n_configured_current: 18, n_unserved: 18 };
    const read = sectorPopulationPage(mutated);
    expect(read).not.toBeNull();
    expect(read!.groupIndex![0].refusedByOwner).toBe(true);
    expect(read!.groupIndex![0].refusedExplicit).toBe(false);
  });

  it("carries closed unserved reasons and refuses unknown ones", () => {
    const page = sectorPopulationPage(fixture)!;
    expect(page.unservedMatching!.map(entry => entry.reason)).toEqual(
      ["not_observed_at_effective_as_of", "not_observed_at_effective_as_of",
        "not_observed_at_effective_as_of", "not_observed_at_effective_as_of",
        "not_observed_at_effective_as_of"]);
    const mutated = clone();
    const page2 = (mutated.page as Record<string, unknown>);
    (page2.unserved_matching as Array<Record<string, unknown>>)[0].reason = "empty_price_tape";
    expect(sectorPopulationPage(mutated)).toBeNull();
  });
});

describe("sectorPopulationPage — closed admission refuses mutations", () => {
  it.each([
    ["root schema", (value: Record<string, unknown>) => { value.schema = "sector_population.read/v2"; }],
    ["root extra key", (value: Record<string, unknown>) => { value.extra = 1; }],
    ["audience not entitled", (value: Record<string, unknown>) => { value.audience = "preview"; }],
    ["missing page key", (value: Record<string, unknown>) => { delete (value.page as Record<string, unknown>).context_ref; }],
    ["capture owner contract", (value: Record<string, unknown>) => {
      const capture = (value.page as Record<string, unknown>).capture as Record<string, unknown>;
      const owner = capture.owner_ref as Record<string, unknown>;
      owner.contract = "something.else/v1";
    }],
    ["owner content id not a digest", (value: Record<string, unknown>) => {
      const capture = (value.page as Record<string, unknown>).capture as Record<string, unknown>;
      (capture.owner_ref as Record<string, unknown>).content_id = "zz";
    }],
    ["unknown durability", (value: Record<string, unknown>) => {
      const capture = (value.page as Record<string, unknown>).capture as Record<string, unknown>;
      (capture.owner_ref as Record<string, unknown>).retained_resolver_ref_durability = "maybe";
    }],
    ["row extra key", (value: Record<string, unknown>) => {
      const rows = (value.page as Record<string, unknown>).rows as Array<Record<string, unknown>>;
      rows[0].point_in_time_industry = "no";
    }],
    ["row symbol lowercase", (value: Record<string, unknown>) => {
      const rows = (value.page as Record<string, unknown>).rows as Array<Record<string, unknown>>;
      rows[0].symbol = "mhk";
    }],
    ["row also_in_groups as an id list", (value: Record<string, unknown>) => {
      const rows = (value.page as Record<string, unknown>).rows as Array<Record<string, unknown>>;
      rows[0].also_in_groups = ["defensives"];
    }],
    ["group_index extra key", (value: Record<string, unknown>) => {
      const index = (value.page as Record<string, unknown>).group_index as Array<Record<string, unknown>>;
      index[0].extra = true;
    }],
    ["limit above the wire maximum", (value: Record<string, unknown>) => {
      (value.page as Record<string, unknown>).limit = 201;
    }],
  ])("refuses %s", (_name, mutate) => {
    const mutated = clone();
    mutate(mutated);
    expect(sectorPopulationPage(mutated)).toBeNull();
  });
});

describe("classifyPopulationResponse — the refusal table", () => {
  it("401 is the only sign-in state; retry never prompts sign-in", () => {
    expect(classifyPopulationResponse(401, { code: "AUTHENTICATION_REQUIRED" })).toEqual({ status: "signed_out" });
    expect(classifyPopulationResponse(503, { code: "SERVICE_UNAVAILABLE" }).status).toBe("retry");
    expect(classifyPopulationResponse(503, { code: "TOO_LARGE" }).status).toBe("retry");
    expect(classifyPopulationResponse(429, { code: "RATE_LIMITED" }).status).toBe("retry");
    expect(classifyPopulationResponse(502, null).status).toBe("retry");
  });
  it("cursor and original states", () => {
    expect(classifyPopulationResponse(409, { code: "CURSOR_RESET", reason: "capture_changed" }))
      .toEqual({ status: "cursor_reset", reason: "capture_changed" });
    // 400 on a server-given cursor is a reset until lane 1's grammar fix.
    expect(classifyPopulationResponse(400, { code: "REQUEST_INVALID" }, { sentCursor: true }))
      .toEqual({ status: "cursor_reset", reason: "request_invalid_on_cursor" });
    expect(classifyPopulationResponse(400, { code: "REQUEST_INVALID" }).status).toBe("invalid_request");
    expect(classifyPopulationResponse(404, { code: "ORIGINAL_UNAVAILABLE" }))
      .toEqual({ status: "original_unavailable", reason: null });
    expect(classifyPopulationResponse(403, { code: "FORBIDDEN" }).status).toBe("denied");
  });
  it("200 admits only the real page shape", () => {
    expect(classifyPopulationResponse(200, fixture).status).toBe("ok");
    expect(classifyPopulationResponse(200, { schema: "other" }).status).toBe("invalid");
  });
});

describe("fetchSectorPopulation — client transport", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("never sends audience; forwards the closed set only", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const read = await fetchSectorPopulation({ group: "housing", limit: 50 });
    expect(read.status).toBe("ok");
    const called = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(called).toContain("source=population");
    expect(called).toContain("group=housing");
    expect(called).toContain("limit=50");
    expect(called).not.toContain("audience");
  });
  it("a 503 owner refusal reads as retry, never sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ schema: "sector_generation.error/v1", code: "SERVICE_UNAVAILABLE", reason: "identity_not_verified" }),
      { status: 503 })));
    const read = await fetchSectorPopulation({ cursor: "tok" });
    expect(read).toEqual({ status: "retry", code: "SERVICE_UNAVAILABLE" });
  });
  it("a caller abort propagates instead of painting a failure state", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      throw new DOMException("aborted", "AbortError");
    }));
    await expect(fetchSectorPopulation({ signal: controller.signal })).rejects.toBeInstanceOf(DOMException);
  });
});
