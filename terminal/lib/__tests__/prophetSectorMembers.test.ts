/**
 * prophetSectorMembers.test.ts — contract tests for the frozen wire decoder
 * `prophet.sector_members/v1` (CONTRACT_sector_members_v1.md, Fable CEO
 * 2026-11-10, plus amendment A1).
 *
 * The six committed fixtures are real captures (Macro's final v1 generation,
 * qualify-2026-11-06). Every admission assertion runs against those bytes;
 * mutations of them prove the closed contract refuses everything outside it.
 * Laws pinned here:
 *   - Counts are invariants: the five Prophet states must sum to `served`, and
 *     a null `configured` is legal only beside all-zero counts.
 *   - Plan presence is exact: plan on open_plan/resolved_plan, reason on
 *     none/unavailable; an early_observation may carry a superseded plan.
 *   - Closed admission everywhere except GroupContext — the contract's one
 *     `open` object (the real bytes carry `window`/`basis` there, and the
 *     decoder neither invents nor leaks them).
 *   - A group descriptor carries NO counts (counts live at group mode's top
 *     level; only index entries carry their own).
 *   - Fail-closed joins: null ref ⇒ matching compatibility status; an
 *     unfiltered empty page-one over a served population is refused.
 *   - The refusal table: 401 is sign-in; 429/network is retry; 5xx is
 *     unavailable; a 200 outside the contract is invalid.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROPHET_MEMBER_STATES, classifySectorMembersResponse, decodeProphetSectorMembers,
  fetchProphetSectorMembers, prophetMemberStateRank,
  type ProphetMemberState, type SectorMembersPayload,
} from "@/lib/prophetSectorMembers";

type IndexPayload = Extract<SectorMembersPayload, { mode: "index" }>;
type GroupPayload = Extract<SectorMembersPayload, { mode: "group" }>;
type SymbolPayload = Extract<SectorMembersPayload, { mode: "symbol" }>;

const FIXTURE_DIR = join(__dirname, "..", "..", "public", "data", "prophet_sector_members_fixture");
const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as Record<string, unknown>;
const clone = (name: string): Record<string, unknown> =>
  JSON.parse(JSON.stringify(load(name))) as Record<string, unknown>;

const FIXTURES = [
  "index.json",
  "group_defensives.json",
  "group_memory_storage.json",
  "group_us_sector_industrials.json",
  "symbol_ADP.json",
  "symbol_CARR.json",
] as const;

const rec = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const members = (value: Record<string, unknown>): Record<string, unknown>[] =>
  value.members as Record<string, unknown>[];
const prophetOf = (member: Record<string, unknown>): Record<string, unknown> =>
  member.prophet as Record<string, unknown>;
const bySymbol = (value: Record<string, unknown>, symbol: string): Record<string, unknown> =>
  members(value).find(member => member.symbol === symbol)!;
const byState = (value: Record<string, unknown>, state: string): Record<string, unknown> =>
  members(value).find(member => prophetOf(member).state === state)!;

function decodeGroup(name: string): GroupPayload {
  const payload = decodeProphetSectorMembers(load(name));
  if (!payload || payload.mode !== "group") throw new Error(`expected a group payload for ${name}`);
  return payload;
}
function decodeIndex(name: string): IndexPayload {
  const payload = decodeProphetSectorMembers(load(name));
  if (!payload || payload.mode !== "index") throw new Error(`expected an index payload for ${name}`);
  return payload;
}
function decodeSymbol(name: string): SymbolPayload {
  const payload = decodeProphetSectorMembers(load(name));
  if (!payload || payload.mode !== "symbol") throw new Error(`expected a symbol payload for ${name}`);
  return payload;
}
/** Group mode's `group` is nullable only on the fail-closed read; these
 * fixtures all carry it, so a missing descriptor is a test failure. */
function groupOf(payload: GroupPayload) {
  if (payload.group === null) throw new Error("expected a group descriptor");
  return payload.group;
}

/** A lawful plan object for presence-rule mutations (every contract key). */
const legalPlan = () => ({
  id: "ISRG-BULL-20260601", direction: "long", strategy: null, phase: null,
  opened_on: "2026-06-01", resolved_on: null, outcome: null,
});

describe("committed fixtures — the real bytes", () => {
  it("every committed fixture decodes as captured", () => {
    const refused = FIXTURES.filter(name => decodeProphetSectorMembers(load(name)) === null);
    expect(refused).toEqual([]);
  });

  it.each(FIXTURES)("%s decodes with the frozen envelope", name => {
    const decoded = decodeProphetSectorMembers(load(name));
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.capturedAt).toMatch(/^2026-11-11T04:55:4[67]Z$/);
    expect(decoded.disclosure).toEqual({
      membershipBasis: "current_roster_with_pit_first_known",
      taxonomyBasis: "current_gics_industry_not_point_in_time",
      joinKey: "us_listing_ticker",
      descriptiveOnly: true,
    });
    expect(decoded.prophetRef).toEqual({
      owner: "prophet_index", schema: "prophet.index/v1", asof: "2026-11-09",
      generatedAt: "2026-11-09T09:02:55Z",
      indexSha256: "3956748aa58e9a1d4850e3429082f2a4d795da32b1a12667f5b1ce75f3fe2e28",
      planCount: 893, openPlanCount: 364,
    });
    expect(decoded.sectorRef).toEqual({
      owner: "sector_generation", generationId: "qualify-2026-11-06",
      contentId: "973b72736c5fb9a64823a7707ea06baf113657f47b2c9962d5d692865b6c2ffa",
      sourceSession: "2026-11-06", publishedAt: "2026-11-06T23:00:00+00:00",
      memberSha256: "3e51b31bfbecb8f1b08957b52954e0e192525d68000fe3a095f86a7ac2a5edf6",
      qualification: "stale",
    });
    expect(decoded.compatibility).toEqual({
      status: "mixed_basis", sectorSession: "2026-11-06", prophetAsof: "2026-11-09",
      sessionGap: 3,
      reason: "sessions differ by 3 calendar days and an owner flags a non-accepted basis (sector qualification 'stale')",
    });
    const expectedMode = name.startsWith("group_") ? "group" : name.startsWith("symbol_") ? "symbol" : "index";
    expect(decoded.mode).toBe(expectedMode);
  });

  it("index carries every group, its counts and the de-duplicated totals", () => {
    const index = decodeIndex("index.json");
    expect(index.groups).toHaveLength(49);
    expect(index.groups[0].id).toBe("ai_agents");
    const housing = index.groups.find(group => group.id === "housing")!;
    expect(housing.counts).toEqual({
      configured: 18, served: 18, accountedUnserved: 0, unaccounted: 0,
      openPlan: 2, resolvedPlan: 5, earlyObservation: 0, none: 11, unavailable: 0,
    });
    expect(housing.nameZh).toBe("住房产业链");
    expect(index.totals).toEqual({
      configured: 702, served: 698, accountedUnserved: 4, unaccounted: 0,
      openPlan: 139, resolvedPlan: 131, earlyObservation: 122, none: 306, unavailable: 0,
    });
  });

  it("group fixtures carry the exact counts, page, unserved and open context", () => {
    const defensives = decodeGroup("group_defensives.json");
    expect(defensives.counts).toEqual({
      configured: 18, served: 17, accountedUnserved: 1, unaccounted: 0,
      openPlan: 6, resolvedPlan: 3, earlyObservation: 0, none: 8, unavailable: 0,
    });
    expect(defensives.page).toEqual({
      offset: 0, limit: 200, totalMatching: 17, nextOffset: null, q: null, state: null,
    });
    expect(defensives.unserved).toEqual([{ symbol: "KVUE", reason: "not_observed_at_effective_as_of" }]);
    const group = groupOf(defensives);
    expect(group.id).toBe("defensives");
    expect(group.kind).toBe("basket");
    expect(group.nameZh).toBe("防御板块");
    expect(group.benchmark).toBe("SPY");
    expect(group.context).toEqual({
      windowSessions: 20, groupReturnPct: 10.3947, marketReturnPct: -5.5589,
      relativePp: 15.9536, breadth: null, stateLabel: "Expansion",
      reasons: { breadth: "not_produced" },
    });

    const memory = decodeGroup("group_memory_storage.json");
    expect(memory.counts).toEqual({
      configured: 4, served: 4, accountedUnserved: 0, unaccounted: 0,
      openPlan: 0, resolvedPlan: 0, earlyObservation: 1, none: 3, unavailable: 0,
    });
    expect(groupOf(memory).context.stateLabel).toBe("Trough");
    expect(groupOf(memory).context.relativePp).toBe(-33.2628);
  });

  it("group members carry their Prophet state, plan and observation verbatim", () => {
    const memory = decodeGroup("group_memory_storage.json");
    const wdc = memory.members.find(member => member.symbol === "WDC")!;
    expect(wdc.prophet.state).toBe("early_observation");
    expect(wdc.prophet.plan).toBeNull();
    expect(wdc.prophet.observation).toEqual({ kind: "turn_watch", asof: "2026-11-06" });
    expect(wdc.memberSince).toBe("2023-05-09");
    expect(wdc.firstKnown).toBe("2026-08-13");
    expect(wdc.alsoInGroups).toEqual(["us_sector_tech"]);
    const mu = memory.members.find(member => member.symbol === "MU")!;
    expect(mu.prophet.state).toBe("none");
    expect(mu.prophet.reason).toBe("no_plan_in_index");
    expect(mu.prophet.plan).toBeNull();

    const defensives = decodeGroup("group_defensives.json");
    const clx = defensives.members.find(member => member.symbol === "CLX")!;
    expect(clx.prophet.state).toBe("open_plan");
    expect(clx.prophet.plan).toEqual({
      id: "CLX-BULL-20261016", direction: "long", strategy: null,
      phase: "triggered_pre_t1", openedOn: "2026-10-20", resolvedOn: null, outcome: null,
    });
    expect(clx.prophet.openPlanCount).toBe(1);
    expect(clx.prophet.resolvedPlanCount).toBe(1);
  });

  it("symbol mode joins the groups and echoes the member's own Prophet state", () => {
    const adp = decodeSymbol("symbol_ADP.json");
    expect(adp.symbol).toBe("ADP");
    expect(adp.prophet.state).toBe("early_observation");
    expect(adp.prophet.observation).toEqual({ kind: "turn_watch", asof: "2026-11-06" });
    expect(adp.memberOf).toHaveLength(1);
    expect(adp.memberOf[0].group.id).toBe("us_sector_industrials");
    // A1: the group descriptor carries exactly the contract keys — no counts
    // (counts live at group mode's top level; only index entries carry their own).
    expect(Object.keys(adp.memberOf[0].group))
      .toEqual(["id", "kind", "name", "nameZh", "benchmark", "context"]);
    expect(adp.memberOf[0].member.symbol).toBe("ADP");

    const carr = decodeSymbol("symbol_CARR.json");
    expect(carr.symbol).toBe("CARR");
    expect(carr.prophet.state).toBe("open_plan");
    expect(carr.prophet.plan!.id).toBe("CARR-BULL-20261016");
    expect(carr.prophet.plan!.openedOn).toBe("2026-10-20");
    expect(carr.memberOf.map(entry => entry.group.id)).toEqual(["housing", "us_sector_industrials"]);
  });
});

describe("counts invariant — the five states must sum to served", () => {
  it("refuses a group whose states over-count served", () => {
    const mutated = clone("group_defensives.json");
    rec(mutated.counts).open_plan = 7; // 7+3+0+8+0 = 18 ≠ served 17
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses a group whose states under-count served", () => {
    const mutated = clone("group_memory_storage.json");
    rec(mutated.counts).none = 2; // 0+0+1+2+0 = 3 ≠ served 4
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("holds for the index totals and every group in it", () => {
    const totals = clone("index.json");
    rec(rec(totals).totals).resolved_plan = 132; // 139+132+122+306 = 699 ≠ served 698
    expect(decodeProphetSectorMembers(totals)).toBeNull();
    const groupOnly = clone("index.json");
    const groups = rec(groupOnly).groups as Record<string, unknown>[];
    const housing = groups.find(group => group.id === "housing")!;
    rec(housing.counts).none = 12; // 2+5+0+12 = 19 ≠ served 18
    expect(decodeProphetSectorMembers(groupOnly)).toBeNull();
  });

  it("refuses a null configured beside nonzero counts", () => {
    const mutated = clone("group_memory_storage.json");
    rec(mutated.counts).configured = null;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses a negative or non-integer count", () => {
    const negative = clone("group_memory_storage.json");
    rec(negative.counts).served = -1;
    expect(decodeProphetSectorMembers(negative)).toBeNull();
    const fractional = clone("group_memory_storage.json");
    rec(fractional.counts).none = 2.5;
    expect(decodeProphetSectorMembers(fractional)).toBeNull();
  });
});

describe("plan presence rules — one story per member, never two", () => {
  it("refuses a plan on a none member", () => {
    const mutated = clone("group_memory_storage.json");
    prophetOf(bySymbol(mutated, "MU")).plan = legalPlan();
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses a plan on an unavailable member", () => {
    const mutated = clone("group_memory_storage.json");
    const mu = prophetOf(bySymbol(mutated, "MU"));
    mu.state = "unavailable";
    mu.reason = "sector_unavailable";
    mu.plan = legalPlan();
    rec(mutated.counts).none = 2;
    rec(mutated.counts).unavailable = 1;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses open_plan without its plan object", () => {
    const mutated = clone("group_defensives.json");
    prophetOf(bySymbol(mutated, "CLX")).plan = null;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses resolved_plan without its plan object", () => {
    const mutated = clone("group_us_sector_industrials.json");
    prophetOf(byState(mutated, "resolved_plan")).plan = null;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("admits an early_observation that also carries a superseded plan", () => {
    const mutated = clone("group_memory_storage.json");
    prophetOf(bySymbol(mutated, "WDC")).plan = legalPlan();
    const decoded = decodeGroup("group_memory_storage.json");
    expect(decoded.members.find(member => member.symbol === "WDC")!.prophet.plan).toBeNull();
    const superseded = decodeProphetSectorMembers(mutated);
    expect(superseded).not.toBeNull();
    if (!superseded || superseded.mode !== "group") return;
    const wdc = superseded.members.find(member => member.symbol === "WDC")!;
    expect(wdc.prophet.state).toBe("early_observation");
    expect(wdc.prophet.plan!.id).toBe("ISRG-BULL-20260601");
    expect(wdc.prophet.observation!.kind).toBe("turn_watch");
  });
});

describe("reason is REQUIRED for none and unavailable", () => {
  it("refuses a none member whose reason is removed or null", () => {
    const removed = clone("group_memory_storage.json");
    delete prophetOf(bySymbol(removed, "MU")).reason;
    expect(decodeProphetSectorMembers(removed)).toBeNull();
    const nulled = clone("group_memory_storage.json");
    prophetOf(bySymbol(nulled, "MU")).reason = null;
    expect(decodeProphetSectorMembers(nulled)).toBeNull();
  });

  it("refuses an unavailable member whose reason is removed", () => {
    const mutated = clone("group_memory_storage.json");
    const mu = prophetOf(bySymbol(mutated, "MU"));
    mu.state = "unavailable";
    delete mu.reason;
    rec(mutated.counts).none = 2;
    rec(mutated.counts).unavailable = 1;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });
});

describe("closed admission — only GroupContext is open", () => {
  it("refuses a rogue key on the top-level envelope", () => {
    const mutated = clone("group_memory_storage.json");
    mutated.extra = 1;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("tolerates a rogue key INSIDE group.context (the contract's one open object)", () => {
    const mutated = clone("group_memory_storage.json");
    const context = rec(rec(mutated.group).context);
    context.owner_extension = "carried by the owner";
    const decoded = decodeProphetSectorMembers(mutated);
    expect(decoded).not.toBeNull();
    if (!decoded || decoded.mode !== "group" || decoded.group === null) return;
    expect(decoded.group.context.stateLabel).toBe("Trough");
    expect(decoded.group.context).not.toHaveProperty("owner_extension");
    // The real bytes' extra GroupContext keys are read through, not leaked.
    expect(decoded.group.context).not.toHaveProperty("window");
    expect(decoded.group.context).not.toHaveProperty("basis");
  });

  it("refuses a rogue key on a member's prophet record", () => {
    const mutated = clone("group_memory_storage.json");
    prophetOf(bySymbol(mutated, "MU")).confidence = 0.9;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses a rogue key on a member record and on a plan record", () => {
    const memberKey = clone("group_memory_storage.json");
    bySymbol(memberKey, "MU").note = "extra";
    expect(decodeProphetSectorMembers(memberKey)).toBeNull();
    const planKey = clone("group_defensives.json");
    rec(prophetOf(bySymbol(planKey, "CLX")).plan).score = 1;
    expect(decodeProphetSectorMembers(planKey)).toBeNull();
  });

  it("refuses counts on a group-mode descriptor (counts live at the top level)", () => {
    const mutated = clone("group_memory_storage.json");
    rec(mutated.group).counts = JSON.parse(JSON.stringify(mutated.counts)) as Record<string, unknown>;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses a rogue key on index groups, totals, page, unserved and disclosure", () => {
    const groupKey = clone("index.json");
    rec((rec(groupKey).groups as Record<string, unknown>[])[0]).rank = 1;
    expect(decodeProphetSectorMembers(groupKey)).toBeNull();
    const totalsKey = clone("index.json");
    rec(rec(totalsKey).totals).extra = 0;
    expect(decodeProphetSectorMembers(totalsKey)).toBeNull();
    const pageKey = clone("group_memory_storage.json");
    rec(rec(pageKey).page).cursor = "x";
    expect(decodeProphetSectorMembers(pageKey)).toBeNull();
    const unservedKey = clone("group_defensives.json");
    (rec(unservedKey).unserved as Record<string, unknown>[])[0].group_id = "defensives";
    expect(decodeProphetSectorMembers(unservedKey)).toBeNull();
    const disclosureKey = clone("group_memory_storage.json");
    rec(rec(disclosureKey).disclosure).extra = true;
    expect(decodeProphetSectorMembers(disclosureKey)).toBeNull();
  });

  it("refuses an index group missing its counts", () => {
    const mutated = clone("index.json");
    delete (rec(mutated).groups as Record<string, unknown>[])[0].counts;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses a schema other than the frozen one", () => {
    const mutated = clone("group_memory_storage.json");
    mutated.schema = "prophet.sector_members/v2";
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });
});

describe("duplicate symbols are refused, never guessed", () => {
  it("refuses a members list that repeats a symbol", () => {
    const mutated = clone("group_memory_storage.json");
    const list = members(mutated);
    list.push(JSON.parse(JSON.stringify(list[0])) as Record<string, unknown>);
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });
});

describe("wire grammar — spelled-out values are validated strictly", () => {
  const cases: [string, string, (value: Record<string, unknown>) => void][] = [
    ["bad group id (space and bang)", "group_memory_storage.json",
      (v: Record<string, unknown>) => { rec(v.group).id = "US SECTOR!"; }],
    ["uppercase group id", "group_memory_storage.json",
      (v: Record<string, unknown>) => { rec(v.group).id = "Memory_Storage"; }],
    ["lowercase symbol", "group_memory_storage.json",
      (v: Record<string, unknown>) => { members(v)[0].symbol = "wdc"; }],
    ["symbol with a slash", "group_memory_storage.json",
      (v: Record<string, unknown>) => { members(v)[0].symbol = "BTC/USD"; }],
    ["symbol leading with a digit", "group_memory_storage.json",
      (v: Record<string, unknown>) => { members(v)[0].symbol = "1ABC"; }],
    ["captured_at month 13", "group_memory_storage.json",
      (v: Record<string, unknown>) => { v.captured_at = "2026-13-07T06:02:11Z"; }],
    ["captured_at year 0000", "group_memory_storage.json",
      (v: Record<string, unknown>) => { v.captured_at = "0000-11-07T06:02:11Z"; }],
    ["index sha256 with uppercase hex", "group_memory_storage.json",
      (v: Record<string, unknown>) => {
        rec(v.prophet_ref).index_sha256 = "3956748AA58E9A1D4850E3429082F2A4D795DA32B1A12667F5B1CE75F3FE2E28";
      }],
    ["index sha256 with 63 chars", "group_memory_storage.json",
      (v: Record<string, unknown>) => {
        rec(v.prophet_ref).index_sha256 = "3956748aa58e9a1d4850e3429082f2a4d795da32b1a12667f5b1ce75f3fe2e2";
      }],
    ["member name over the 200-char budget", "group_memory_storage.json",
      (v: Record<string, unknown>) => { members(v)[0].name = "x".repeat(2048); }],
    ["day that is not on the calendar", "group_memory_storage.json",
      (v: Record<string, unknown>) => { members(v)[0].member_since = "2026-02-30"; }],
    ["unknown prophet state", "group_memory_storage.json",
      (v: Record<string, unknown>) => { prophetOf(members(v)[0]).state = "watching"; }],
    ["unknown compatibility status", "group_memory_storage.json",
      (v: Record<string, unknown>) => { rec(v.compatibility).status = "mostly_fine"; }],
    ["descriptive_only false", "group_memory_storage.json",
      (v: Record<string, unknown>) => { rec(v.disclosure).descriptive_only = false; }],
    ["sector owner other than sector_generation", "group_memory_storage.json",
      (v: Record<string, unknown>) => { rec(v.sector_ref).owner = "someone_else"; }],
    ["negative session gap beyond the alphabet", "group_memory_storage.json",
      (v: Record<string, unknown>) => { rec(v.compatibility).session_gap = 4000; }],
  ];
  it.each(cases)("refuses %s", (_name, fixture, mutate) => {
    const mutated = clone(fixture);
    mutate(mutated);
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("admits punctuation the grammar does allow (dots in a US listing ticker)", () => {
    const mutated = clone("group_memory_storage.json");
    members(mutated)[0].symbol = "BRK.B";
    const decoded = decodeProphetSectorMembers(mutated);
    expect(decoded).not.toBeNull();
    if (!decoded || decoded.mode !== "group") return;
    expect(decoded.members[0].symbol).toBe("BRK.B");
  });
});

describe("fail-closed joins", () => {
  it("refuses an unfiltered empty page-one over a served population", () => {
    const mutated = clone("group_defensives.json");
    mutated.members = [];
    rec(mutated.page).total_matching = 0;
    rec(mutated.page).next_offset = null;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("admits a q-filtered empty members page with total_matching 0", () => {
    const mutated = clone("group_defensives.json");
    mutated.members = [];
    rec(mutated.page).q = "zzzz";
    rec(mutated.page).total_matching = 0;
    rec(mutated.page).next_offset = null;
    const decoded = decodeProphetSectorMembers(mutated);
    expect(decoded).not.toBeNull();
    if (!decoded || decoded.mode !== "group") return;
    expect(decoded.members).toEqual([]);
    expect(decoded.page.q).toBe("zzzz");
    expect(decoded.counts.served).toBe(17);
  });

  it("refuses members beyond the page limit", () => {
    const mutated = clone("group_memory_storage.json");
    rec(mutated.page).limit = 2;
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });

  it("refuses a null sector ref without the sector_unavailable status, and vice versa", () => {
    const nullRef = clone("group_memory_storage.json");
    nullRef.sector_ref = null;
    expect(decodeProphetSectorMembers(nullRef)).toBeNull();
    const statusOnly = clone("group_memory_storage.json");
    rec(statusOnly.compatibility).status = "sector_unavailable";
    expect(decodeProphetSectorMembers(statusOnly)).toBeNull();
  });

  it("refuses a null prophet ref without prophet_unavailable, and a status without the null ref", () => {
    const nullRef = clone("group_memory_storage.json");
    nullRef.prophet_ref = null;
    expect(decodeProphetSectorMembers(nullRef)).toBeNull();
    const statusOnly = clone("group_memory_storage.json");
    rec(statusOnly.compatibility).status = "prophet_unavailable";
    expect(decodeProphetSectorMembers(statusOnly)).toBeNull();
  });

  it("admits the fail-closed read: null sector ref under sector_unavailable", () => {
    const mutated = clone("group_memory_storage.json");
    mutated.sector_ref = null;
    const compatibility = rec(mutated.compatibility);
    compatibility.status = "sector_unavailable";
    compatibility.sector_session = null;
    compatibility.session_gap = null;
    const decoded = decodeProphetSectorMembers(mutated);
    expect(decoded).not.toBeNull();
    if (!decoded || decoded.mode !== "group") return;
    expect(decoded.sectorRef).toBeNull();
    expect(decoded.compatibility.status).toBe("sector_unavailable");
  });

  it("refuses a symbol payload whose member_of entry names a different symbol", () => {
    const mutated = clone("symbol_ADP.json");
    const entry = (rec(mutated).member_of as Record<string, unknown>[])[0];
    rec(entry.member).symbol = "XXXX";
    expect(decodeProphetSectorMembers(mutated)).toBeNull();
  });
});

describe("classifySectorMembersResponse — the refusal table", () => {
  const fixture = load("group_memory_storage.json");

  it("200 + contract body is ok; anything else on 200 is invalid", () => {
    const read = classifySectorMembersResponse(200, fixture);
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.payload.mode).toBe("group");
    expect(classifySectorMembersResponse(200, { schema: "other" })).toEqual({ status: "invalid" });
    expect(classifySectorMembersResponse(200, null)).toEqual({ status: "invalid" });
  });

  it("maps the auth and request statuses", () => {
    expect(classifySectorMembersResponse(401, null)).toEqual({ status: "signed_out" });
    expect(classifySectorMembersResponse(403, null)).toEqual({ status: "denied" });
    expect(classifySectorMembersResponse(404, { code: "unknown_group" }))
      .toEqual({ status: "not_found", code: "unknown_group" });
    expect(classifySectorMembersResponse(404, null)).toEqual({ status: "not_found", code: null });
    expect(classifySectorMembersResponse(422, null)).toEqual({ status: "invalid_request" });
  });

  it("maps 429 and 5xx to transient/unavailable, never sign-in", () => {
    expect(classifySectorMembersResponse(429, null)).toEqual({ status: "retry", retryAfterSec: null });
    expect(classifySectorMembersResponse(429, null, 30)).toEqual({ status: "retry", retryAfterSec: 30 });
    for (const status of [500, 502, 503]) {
      expect(classifySectorMembersResponse(status, null)).toEqual({ status: "unavailable" });
    }
  });
});

describe("fetchProphetSectorMembers — transport", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a network TypeError reads as retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(fetchProphetSectorMembers({ group: "housing" })).resolves.toEqual({ status: "retry", retryAfterSec: null });
  });

  it("carries the BFF Retry-After into the retry classification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429, headers: { "Content-Type": "application/json", "Retry-After": "30" },
    })));
    await expect(fetchProphetSectorMembers({ group: "housing" })).resolves.toEqual({ status: "retry", retryAfterSec: 30 });
  });

  it("a caller abort propagates instead of becoming retry", async () => {
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => { throw abort; }));
    await expect(fetchProphetSectorMembers({ group: "housing" })).rejects.toBe(abort);
  });

  it("forwards only the contract query parameters", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify(load("group_memory_storage.json")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const read = await fetchProphetSectorMembers({
      group: "memory_storage", offset: 0, limit: 50, q: null, state: null,
    });
    expect(read.status).toBe("ok");
    const called = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    const params = new URL(called, "https://terminal.test").searchParams;
    expect(params.get("group")).toBe("memory_storage");
    expect(params.get("limit")).toBe("50");
    expect(params.has("q")).toBe(false);
    expect(params.has("state")).toBe(false);
  });

  it("relays a non-contract 200 body as invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(fetchProphetSectorMembers({ group: "housing" })).resolves.toEqual({ status: "invalid" });
  });
});

describe("prophetMemberStateRank — the contract's sort order", () => {
  it("orders open_plan < early_observation < resolved_plan < none", () => {
    const order: ProphetMemberState[] = ["open_plan", "early_observation", "resolved_plan", "none"];
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(prophetMemberStateRank(order[i])).toBeLessThan(prophetMemberStateRank(order[i + 1]));
    }
  });

  it("exposes exactly the five contract states in rank order", () => {
    expect([...PROPHET_MEMBER_STATES])
      .toEqual(["open_plan", "early_observation", "resolved_plan", "none", "unavailable"]);
    expect(PROPHET_MEMBER_STATES.map(state => prophetMemberStateRank(state)))
      .toEqual([0, 1, 2, 3, 4]);
  });
});
