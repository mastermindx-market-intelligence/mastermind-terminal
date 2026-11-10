/**
 * sectorPopulation.test.ts — contract tests for the population member-list
 * decoder (Sector Intelligence, lane 3; COO order 2, 2026-11-10).
 *
 * The fixture is the pinned lane-1 wire sample, committed as
 * sector_population.captured.v11_page1.json (sha256 2f03e6e0… after the
 * N7 token fabrication — the cursor/context_ref tokens are MADE-UP values of
 * the captured sample's own shape and length class, never real signatures):
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

  it("carries the industry label's zh twin when the wire has it (r2 N-B)", () => {
    const mutated = clone();
    const rows = (mutated.page as Record<string, unknown>).rows as Array<Record<string, unknown>>;
    (rows[0].industry as Record<string, unknown>).label_zh = "耐用消费品";
    const read = sectorPopulationPage(mutated)!;
    expect(read.rows[0].industry).toEqual({ status: "available", label: "Household Durables", labelZh: "耐用消费品" });
    // An absent twin stays absent — the decoder never invents one.
    expect(read.rows[1].industry.status === "available" ? read.rows[1].industry.labelZh : "n/a").toBeUndefined();
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

describe("sectorPopulationPage — wire v1.1 follow-up (COO 14:10Z, LANE1_WIRE_V11)", () => {
  const page = (value: Record<string, unknown>) => value.page as Record<string, unknown>;
  const pop = (value: Record<string, unknown>) =>
    (page(value).capture as Record<string, unknown>).population as Record<string, unknown>;
  const gi = (value: Record<string, unknown>) =>
    page(value).group_index as Array<Record<string, unknown>>;
  const groups = (value: Record<string, unknown>) =>
    page(value).groups as Array<Record<string, unknown>>;
  const rows = (value: Record<string, unknown>) =>
    page(value).rows as Array<Record<string, unknown>>;
  const legalRefusal = () => ({ status: "refused", coverage: "below_floor", observed_n: 3,
    configured_n: 18, min_members: 5, min_coverage: 0.8, effective_as_of: "2026-11-06" });
  const refuseHousing = (value: Record<string, unknown>) => {
    const group = groups(value)[0];
    group.refused_by_owner = true; group.n_members_listed = 0;
    group.unserved = [{ symbol: "MHK", reason: "group_refused_by_owner_observation" }];
    group.owner_observation_refusal = legalRefusal();
  };

  it("group_index carries refused_by_owner explicitly; the flag wins both ways", () => {
    const explicitTrue = clone();
    gi(explicitTrue)[0].refused_by_owner = true;
    const readTrue = sectorPopulationPage(explicitTrue)!;
    expect(readTrue.groupIndex![0].refusedByOwner).toBe(true);
    expect(readTrue.groupIndex![0].refusedExplicit).toBe(true);
    // Explicit false beats the three-part test on a refusal-looking entry.
    const explicitFalse = clone();
    const entry = gi(explicitFalse)[0];
    entry.name = null; entry.n_members_listed = 0; entry.n_unserved = entry.n_configured_current;
    entry.refused_by_owner = false;
    const readFalse = sectorPopulationPage(explicitFalse)!;
    expect(readFalse.groupIndex![0].refusedByOwner).toBe(false);
    expect(readFalse.groupIndex![0].refusedExplicit).toBe(true);
  });

  it("null configured_current and complete mean UNKNOWN — carried as null, never zero/true", () => {
    const mutated = clone();
    pop(mutated).configured_current = null;
    pop(mutated).complete = null;
    const read = sectorPopulationPage(mutated)!;
    expect(read).not.toBeNull();
    expect(read.counts.configuredCurrent).toBeNull();
    expect(read.counts.complete).toBeNull();
  });

  it("admits unaccounted_by_owner unserved entries (an owner-dropped basket)", () => {
    const mutated = clone();
    (pop(mutated).unserved_members as Array<Record<string, unknown>>)
      .push({ group_id: "silver_miners", symbol: "GATO", reason: "unaccounted_by_owner" });
    const read = sectorPopulationPage(mutated)!;
    expect(read.counts.unservedMembers.at(-1))
      .toEqual({ groupId: "silver_miners", symbol: "GATO", reason: "unaccounted_by_owner" });
  });

  it("a refused group descriptor carries 2-key unserved and the 7-key owner refusal", () => {
    const mutated = clone();
    refuseHousing(mutated);
    const read = sectorPopulationPage(mutated)!;
    expect(read).not.toBeNull();
    expect(read.groups[0].refusedByOwner).toBe(true);
    expect(read.groups[0].unservedMembers)
      .toEqual([{ symbol: "MHK", reason: "group_refused_by_owner_observation" }]);
    // The capture-level 3-key shape is NOT the group shape (the group is implicit).
    const wrongShape = clone();
    groups(wrongShape)[0].unserved = [{ group_id: "housing", symbol: "MHK", reason: "group_refused_by_owner_observation" }];
    expect(sectorPopulationPage(wrongShape)).toBeNull();
  });

  it("refusal strings are bounded to 160 chars — over-long is absent, never shortened", () => {
    const atLimit = clone();
    refuseHousing(atLimit);
    (groups(atLimit)[0].owner_observation_refusal as Record<string, unknown>).status = "x".repeat(160);
    expect(sectorPopulationPage(atLimit)).not.toBeNull();
    const overLong = clone();
    refuseHousing(overLong);
    (groups(overLong)[0].owner_observation_refusal as Record<string, unknown>).status = "x".repeat(161);
    expect(sectorPopulationPage(overLong)).toBeNull();
    const empty = clone();
    refuseHousing(empty);
    (groups(empty)[0].owner_observation_refusal as Record<string, unknown>).status = "";
    expect(sectorPopulationPage(empty)).toBeNull();
    const extraKey = clone();
    refuseHousing(extraKey);
    (groups(extraKey)[0].owner_observation_refusal as Record<string, unknown>).extra = true;
    expect(sectorPopulationPage(extraKey)).toBeNull();
  });

  it("in_handoff_member_set may be null (not stated)", () => {
    const mutated = clone();
    rows(mutated)[0].in_handoff_member_set = null;
    const read = sectorPopulationPage(mutated)!;
    expect(read.rows[0].inHandoffMemberSet).toBeNull();
  });

  it("page.complete is the page-end fact — a bool, never null", () => {
    const mutated = clone();
    page(mutated).complete = null;
    expect(sectorPopulationPage(mutated)).toBeNull();
  });
});

describe("sectorPopulationPage — group_index name_zh admission (COO 19:15Z item 6)", () => {
  const page = (value: Record<string, unknown>) => value.page as Record<string, unknown>;
  const gi = (value: Record<string, unknown>) =>
    page(value).group_index as Array<Record<string, unknown>>;

  it("absent keeps today's behaviour exactly: the entry admits with a null zh name", () => {
    const read = sectorPopulationPage(clone())!;
    expect(read.groupIndex![0].nameZh).toBeNull();
  });

  it("null is a stated absent: the page admits and the zh name stays null", () => {
    const mutated = clone();
    gi(mutated)[0].name_zh = null;
    const read = sectorPopulationPage(mutated)!;
    expect(read.groupIndex![0].nameZh).toBeNull();
  });

  it("a valid zh string is carried for the Chinese picker label", () => {
    const mutated = clone();
    gi(mutated)[0].name_zh = "住房产业链";
    const read = sectorPopulationPage(mutated)!;
    expect(read.groupIndex![0].nameZh).toBe("住房产业链");
  });

  it("an empty string refuses the page", () => {
    const mutated = clone();
    gi(mutated)[0].name_zh = "";
    expect(sectorPopulationPage(mutated)).toBeNull();
  });

  it("a 161-character string refuses the page (160 is the bound)", () => {
    const mutated = clone();
    gi(mutated)[0].name_zh = "宅".repeat(160);
    expect(sectorPopulationPage(mutated)).not.toBeNull();
    const over = clone();
    gi(over)[0].name_zh = "宅".repeat(161);
    expect(sectorPopulationPage(over)).toBeNull();
  });

  it("a non-string zh value refuses the page", () => {
    const mutated = clone();
    gi(mutated)[0].name_zh = 42;
    expect(sectorPopulationPage(mutated)).toBeNull();
  });

  it("prototype-named extra keys on a group_index entry are still refused", () => {
    // JSON.parse creates an OWN "__proto__" key (assignment would set the
    // prototype instead) — the closed-key rule must refuse it as an unknown key.
    const proto = clone();
    gi(proto)[0] = JSON.parse(
      JSON.stringify({ ...gi(proto)[0], }).replace(/^\{/, '{"__proto__":1,'),) as Record<string, unknown>;
    expect(sectorPopulationPage(proto)).toBeNull();
    const ctor = clone();
    (gi(ctor)[0] as Record<string, unknown>)["constructor"] = "no";
    expect(sectorPopulationPage(ctor)).toBeNull();
  });
});

describe("sectorPopulationPage — internal consistency (review S2)", () => {
  const page = (value: Record<string, unknown>) => value.page as Record<string, unknown>;
  const pop = (value: Record<string, unknown>) =>
    (page(value).capture as Record<string, unknown>).population as Record<string, unknown>;

  it("page.complete true ⇔ next_cursor null — both broken directions refused", () => {
    const endWithCursor = clone();
    page(endWithCursor).complete = true; // cursor still present
    expect(sectorPopulationPage(endWithCursor)).toBeNull();
    const cursorlessMiddle = clone();
    page(cursorlessMiddle).next_cursor = null; // page claims more to come
    expect(sectorPopulationPage(cursorlessMiddle)).toBeNull();
    // The real sample is the legal pairing: complete false WITH a cursor.
    expect(sectorPopulationPage(clone())).not.toBeNull();
  });

  it("served may never exceed a stated configured roster", () => {
    const mutated = clone();
    pop(mutated).served = 5000; // configured stays 1020
    expect(sectorPopulationPage(mutated)).toBeNull();
    // The real sample's own pairing (1015 served of 1020) stays admissible.
    expect(sectorPopulationPage(clone())).not.toBeNull();
  });

  it("population.complete true forbids unaccounted members", () => {
    const mutated = clone();
    pop(mutated).unaccounted = 3; // complete stays true in the sample
    expect(sectorPopulationPage(mutated)).toBeNull();
  });

  it("a page never shows more rows than the filter's own total_matching", () => {
    const mutated = clone();
    page(mutated).total_matching = 0; // two rows are on the page
    expect(sectorPopulationPage(mutated)).toBeNull();
  });
});

describe("sectorPopulationPage — lane 1 point-in-time facts (COO 19:15Z item 5, Macro #10965 §2b)", () => {
  const page = (value: Record<string, unknown>) => value.page as Record<string, unknown>;
  const capture = (value: Record<string, unknown>) => page(value).capture as Record<string, unknown>;
  const identity = (value: Record<string, unknown>) => capture(value).identity as Record<string, unknown>;
  const population = (value: Record<string, unknown>) => capture(value).population as Record<string, unknown>;

  const snapshotFact = () => ({
    status: "available", source: "baskets_membership_pit", as_of: "2026-11-06", suite: "baskets",
    groups: {
      housing: { status: "available", snapshot_date: "2026-11-05", members_sha: "a".repeat(64), member_count: 18, equals_current_roster: true },
      precious: { status: "unavailable", reason: "unknown_basket" },
    },
  });
  const firstKnownFact = () => ({
    status: "available", source: "baskets_membership_pit", as_of: "2026-11-06",
    basis: "lower_bound_from_stored_snapshots", basis_note: "first snapshot 2025-01-15; earlier knowledge not recorded",
    store_first: "2025-01-15", store_last: "2026-11-05", absent_pair_reason: "no_stored_snapshot",
    groups: { housing: { MHK: "2025-06-02", FBIN: null } },
  });

  it("today's wire (facts absent or placeholder) keeps the page: no snapshot, no clock, placeholder first-known/taxonomy", () => {
    const read = sectorPopulationPage(clone())!;
    expect(read.membershipSnapshot).toEqual({ carried: false });
    expect(read.rosterClock).toBeNull();
    // The v1.1 placeholders are carried-but-unavailable, never silently read.
    expect(read.firstKnown).toEqual({ carried: true, status: "unavailable" });
    expect(read.taxonomyRevision).toEqual({ currentNotPointInTime: false });
  });

  it("an available membership_snapshot reads entries, preserving per-group unavailable", () => {
    const mutated = clone();
    identity(mutated).membership_snapshot = snapshotFact();
    const read = sectorPopulationPage(mutated)!;
    expect(read.membershipSnapshot).toEqual({ carried: true, status: "available", asOf: "2026-11-06",
      groups: {
        housing: { status: "available", snapshotDate: "2026-11-05", membersSha: "a".repeat(64), memberCount: 18, equalsCurrentRoster: true },
        precious: { status: "unavailable" },
      } });
  });

  it("roster_clock rides capture.population without refusing the page; agree reads agree", () => {
    const mutated = clone();
    population(mutated).roster_clock = { status: "agree", roster_as_of: "2026-11-06", capture_effective_as_of: "2026-11-06" };
    const read = sectorPopulationPage(mutated)!;
    expect(read.rosterClock).toEqual({ status: "agree" });
  });

  it("every non-agree roster_clock reads not_agree — mismatch forms, unavailable forms, malformed — never a refusal", () => {
    const clocks: unknown[] = [
      { status: "mismatch", reason: "roster_as_of_mismatch", roster_as_of: "2026-11-07", capture_effective_as_of: "2026-11-06" },
      { status: "mismatch", reason: "capture_effective_as_of_not_single", roster_as_of: "2026-11-06", capture_effective_as_of: ["2026-11-06", "2026-11-07"] },
      { status: "unavailable", reason: "capture_effective_as_of_malformed", roster_as_of: "2026-11-06" },
      { status: "unavailable", reason: "capture_effective_as_of_unavailable", roster_as_of: "2026-11-06" },
      { status: "unavailable", reason: "roster_block_malformed", roster_as_of: "2026-11-06" },
      { status: "unavailable", reason: "roster_block_absent", roster_as_of: "2026-11-06" },
      { status: "agree", roster_as_of: "2026-11-06", capture_effective_as_of: [] }, // agree with a broken field
      42, "agree", [], true,
    ];
    for (const clock of clocks) {
      const mutated = clone();
      population(mutated).roster_clock = clock;
      expect(sectorPopulationPage(mutated), `clock ${JSON.stringify(clock)}`).not.toBeNull();
      expect(sectorPopulationPage(mutated)!.rosterClock).toEqual({ status: "not_agree" });
    }
  });

  it("a members_sha outside null|64-hex degrades the WHOLE snapshot fact (S3 mirror)", () => {
    for (const sha of ["zz", 42, true, { digest: "a".repeat(64) }]) {
      const mutated = clone();
      const fact = snapshotFact();
      (fact.groups.housing as Record<string, unknown>).members_sha = sha;
      identity(mutated).membership_snapshot = fact;
      expect(sectorPopulationPage(mutated)!.membershipSnapshot, `sha ${JSON.stringify(sha)}`)
        .toEqual({ carried: true, status: "unavailable" });
    }
  });

  it("entry-level faults degrade the entry, never the page nor the whole fact", () => {
    const faults: unknown[] = [
      "2026-02-30", "2026-13-01", "not-a-date", 42, "",
    ];
    for (const date of faults) {
      const mutated = clone();
      const fact = snapshotFact();
      (fact.groups.housing as Record<string, unknown>).snapshot_date = date;
      identity(mutated).membership_snapshot = fact;
      const read = sectorPopulationPage(mutated)!.membershipSnapshot;
      expect(read, `date ${JSON.stringify(date)}`).toEqual({ carried: true, status: "available",
        asOf: "2026-11-06", groups: { housing: { status: "unavailable" }, precious: { status: "unavailable" } } });
    }
    for (const over of [["member_count", -1], ["member_count", "3"], ["member_count", 1.5],
      ["equals_current_roster", "yes"], ["equals_current_roster", 1], ["status", "queued"]] as const) {
      const mutated = clone();
      const fact = snapshotFact();
      (fact.groups.housing as Record<string, unknown>)[over[0]] = over[1];
      identity(mutated).membership_snapshot = fact;
      const read = sectorPopulationPage(mutated)!.membershipSnapshot;
      expect(read, `${over[0]}=${JSON.stringify(over[1])}`).toEqual({ carried: true, status: "available",
        asOf: "2026-11-06", groups: { housing: { status: "unavailable" }, precious: { status: "unavailable" } } });
    }
    const notAnObject = clone();
    const fact = snapshotFact();
    (fact.groups as Record<string, unknown>).housing = 42;
    identity(notAnObject).membership_snapshot = fact;
    expect(sectorPopulationPage(notAnObject)!.membershipSnapshot).toEqual({ carried: true, status: "available",
      asOf: "2026-11-06", groups: { housing: { status: "unavailable" }, precious: { status: "unavailable" } } });
  });

  it("top-level snapshot faults degrade the whole fact; an unknown group key degrades it too", () => {
    const facts: Record<string, unknown>[] = [
      { ...snapshotFact(), as_of: "2026-02-30" },
      { ...snapshotFact(), suite: "wrong" },
      { ...snapshotFact(), groups: [] },
      { ...snapshotFact(), groups: 42 },
      { ...snapshotFact(), status: 42 },
      { ...snapshotFact(), source: "" },
    ];
    for (const fact of facts) {
      const mutated = clone();
      identity(mutated).membership_snapshot = fact;
      expect(sectorPopulationPage(mutated)!.membershipSnapshot, JSON.stringify(fact.status))
        .toEqual({ carried: true, status: "unavailable" });
    }
    const badKey = clone();
    const keyed = snapshotFact();
    // Deep-clone the planted copy: bounded() refuses any object reachable twice.
    (keyed.groups as Record<string, unknown>)["NOT_A_GROUP_ID"] = JSON.parse(JSON.stringify(keyed.groups.housing));
    identity(badKey).membership_snapshot = keyed;
    expect(sectorPopulationPage(badKey)!.membershipSnapshot).toEqual({ carried: true, status: "unavailable" });
    for (const whole of [42, "available", [], true]) {
      const mutated = clone();
      identity(mutated).membership_snapshot = whole;
      expect(sectorPopulationPage(mutated)!.membershipSnapshot).toEqual({ carried: true, status: "unavailable" });
    }
  });

  it("a present-but-unavailable snapshot (listed, new and unknown reasons) reads unavailable, never a refusal", () => {
    for (const reason of ["not_produced", "carried_block_undated", "block_too_large", "carried_fact_malformed",
      "membership_unreadable", "mystery_reason", 42] as unknown[]) {
      const mutated = clone();
      identity(mutated).membership_snapshot = { status: "unavailable", reason };
      expect(sectorPopulationPage(mutated)!.membershipSnapshot, `reason ${JSON.stringify(reason)}`)
        .toEqual({ carried: true, status: "unavailable" });
    }
    // No reason key at all — still carried-unavailable, never a refusal.
    const mutated = clone();
    identity(mutated).membership_snapshot = { status: "unavailable" };
    expect(sectorPopulationPage(mutated)!.membershipSnapshot).toEqual({ carried: true, status: "unavailable" });
  });

  it("an available membership_first_known reads pairs and preserves the null pair", () => {
    const mutated = clone();
    identity(mutated).membership_first_known = firstKnownFact();
    expect(sectorPopulationPage(mutated)!.firstKnown).toEqual({ carried: true, status: "available",
      groups: { housing: { MHK: "2025-06-02", FBIN: null } } });
  });

  it("first_known faults degrade the whole fact — basis, absent-pair reason, store dates, pair dates, keys", () => {
    const facts: Record<string, unknown>[] = [
      { ...firstKnownFact(), basis: "exact_join_dates" },
      { ...firstKnownFact(), absent_pair_reason: "not_a_member" },
      { ...firstKnownFact(), store_first: "2026-02-30" },
      { ...firstKnownFact(), store_last: 42 },
      { ...firstKnownFact(), groups: [] },
      { ...firstKnownFact(), groups: 42 },
    ];
    for (const fact of facts) {
      const mutated = clone();
      identity(mutated).membership_first_known = fact;
      expect(sectorPopulationPage(mutated)!.firstKnown, `basis ${String(fact.basis)}`)
        .toEqual({ carried: true, status: "unavailable" });
    }
    // Hostile pair values and keys: impossible calendars, wrong types, bad symbol keys.
    const pairFaults: Record<string, unknown>[] = [
      { ...firstKnownFact(), groups: { housing: { MHK: "2026-02-30" } } },
      { ...firstKnownFact(), groups: { housing: { MHK: "2026-13-01" } } },
      { ...firstKnownFact(), groups: { housing: { MHK: 42 } } },
      { ...firstKnownFact(), groups: { housing: { mhk: "2025-06-02" } } },
      { ...firstKnownFact(), groups: { HOUSING: { MHK: "2025-06-02" } } },
    ];
    for (const fact of pairFaults) {
      const mutated = clone();
      identity(mutated).membership_first_known = fact;
      expect(sectorPopulationPage(mutated)!.firstKnown).toEqual({ carried: true, status: "unavailable" });
    }
    for (const reason of ["not_produced", "carried_block_undated", "no_stored_snapshots", "no_stored_snapshots_at_or_before_as_of",
      "block_too_large", "membership_unreadable", "mystery", 42] as unknown[]) {
      const mutated = clone();
      identity(mutated).membership_first_known = { status: "unavailable", reason };
      expect(sectorPopulationPage(mutated)!.firstKnown, `reason ${JSON.stringify(reason)}`)
        .toEqual({ carried: true, status: "unavailable" });
    }
    const noReason = clone();
    identity(noReason).membership_first_known = { status: "unavailable" };
    expect(sectorPopulationPage(noReason)!.firstKnown).toEqual({ carried: true, status: "unavailable" });
  });

  it("taxonomy_revision: the current_not_point_in_time stamp reads true; every other shape reads false", () => {
    const stamp = { status: "unavailable", reason: "no_point_in_time_classification_source",
      labels_basis: "current_not_point_in_time", labels: ["industry", "sub_industry"] };
    const mutated = clone();
    identity(mutated).taxonomy_revision = stamp;
    expect(sectorPopulationPage(mutated)!.taxonomyRevision).toEqual({ currentNotPointInTime: true });
    const others: unknown[] = [
      { status: "unavailable", reason: "not_produced" },                      // today's placeholder
      { ...stamp, labels_basis: "point_in_time" },
      { ...stamp, labels: "industry" },
      { ...stamp, status: "available" },
      42, "x", [], true,
    ];
    for (const other of others) {
      const page2 = clone();
      identity(page2).taxonomy_revision = other;
      expect(sectorPopulationPage(page2)!.taxonomyRevision).toEqual({ currentNotPointInTime: false });
    }
  });

  it("prototype-named extra keys on identity never disturb the facts; a __proto__ key refuses the page", () => {
    const mutated = clone();
    const ident = identity(mutated);
    ident.constructor = "not-a-fact" as unknown as never;
    ident.toString = "also-text" as unknown as never;
    ident.membership_snapshot = snapshotFact();
    ident.membership_first_known = firstKnownFact();
    const read = sectorPopulationPage(mutated)!;
    expect(read.membershipSnapshot).toMatchObject({ status: "available" });
    expect(read.firstKnown).toMatchObject({ status: "available" });
    // bounded()'s prototype-pollution law: a literal "__proto__" key anywhere in
    // the document refuses the page — the wire can never legitimately carry one.
    const poisoned = clone();
    Object.defineProperty(identity(poisoned), "__proto__", { value: "x", enumerable: true, writable: true });
    identity(poisoned).membership_snapshot = snapshotFact();
    expect(sectorPopulationPage(poisoned)).toBeNull();
  });

  it("removed_members gains carried_block_undated (and any string reason) without refusing the page", () => {
    for (const reason of ["carried_block_undated", "not_produced", "mystery_reason"]) {
      const mutated = clone();
      population(mutated).removed_members = { status: "unavailable", reason };
      const read = sectorPopulationPage(mutated)!;
      expect(read.counts.removedMembers).toEqual({ status: "unavailable", reason });
    }
  });

  it("roster_clock non-agree together with null configured_current/complete still admits (extended null cases)", () => {
    const mutated = clone();
    population(mutated).configured_current = null;
    population(mutated).complete = null;
    population(mutated).roster_clock = { status: "unavailable", reason: "roster_block_malformed", roster_as_of: "2026-11-06" };
    const read = sectorPopulationPage(mutated)!;
    expect(read.counts.configuredCurrent).toBeNull();
    expect(read.rosterClock).toEqual({ status: "not_agree" });
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
    // N2: the base URL already carries source — never a duplicate parameter.
    const parsed = new URL(called, "https://terminal.test");
    expect(parsed.searchParams.getAll("source")).toEqual(["population"]);
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
