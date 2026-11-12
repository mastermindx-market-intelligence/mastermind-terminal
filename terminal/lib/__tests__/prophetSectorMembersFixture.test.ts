/**
 * prophetSectorMembersFixture.test.ts — the pure fixture query engine
 * (applyFixtureSectorMembersQuery) against the committed real captures
 * (Macro's final v1 generation, qualify-2026-11-06).
 *
 * Laws pinned here:
 *   - Search-before-paging: `q` filters the whole population BEFORE the
 *     offset/limit window, so a match that sorts past page one is still found.
 *   - Deterministic contract sort: state rank (open_plan, early_observation,
 *     resolved_plan, none, unavailable) then symbol.
 *   - `state` filters prophet.state and `page.total_matching` reflects it.
 *   - `page` echoes the query; `next_offset` is null only at the end.
 *   - Counts are whole-group invariants: q/state/paging never change them.
 *   - Malformed query answers the engine's 422 shape; the input body is never
 *     mutated (the engine is pure).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyFixtureSectorMembersQuery } from "@/lib/prophetSectorMembersFixture";

const FIXTURE_DIR = path.join(process.cwd(), "public/data/prophet_sector_members_fixture");
const load = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as Record<string, unknown>;

const industrials = (): Record<string, unknown> => load("group_us_sector_industrials.json");
const membersOf = (body: unknown): Record<string, unknown>[] =>
  (body as { members: Record<string, unknown>[] }).members;
const symbolsOf = (body: unknown): string[] => membersOf(body).map(member => String(member.symbol));
const pageOf = (body: unknown): Record<string, unknown> =>
  (body as { page: Record<string, unknown> }).page;
const stateOf = (member: Record<string, unknown>): string =>
  String((member.prophet as Record<string, unknown>).state);

const GROUP = "us_sector_industrials";

describe("fixture sector-members engine: unfiltered group read", () => {
  it("sorts by state rank then symbol and echoes the default page", () => {
    const outcome = applyFixtureSectorMembersQuery(industrials(), { group: GROUP });
    expect(outcome.status).toBe(200);
    const symbols = symbolsOf(outcome.body);
    expect(symbols).toHaveLength(83);
    // Rank order: the 7 open plans alphabetically (CARR…XYL), then early
    // observations (ADP, BA, CHRW…), resolved plans, then the 47 `none` block.
    expect(symbols.slice(0, 10)).toEqual(["CARR", "GE", "IR", "NOC", "SNA", "URI", "XYL", "ADP", "BA", "CHRW"]);
    const noneBlock = symbols.slice(7 + 11 + 18);
    expect(noneBlock).toHaveLength(47);
    expect(noneBlock).toEqual([...noneBlock].sort((a, b) => a.localeCompare(b)));
    expect(pageOf(outcome.body)).toEqual({
      offset: 0, limit: 100, total_matching: 83, next_offset: null, q: null, state: null,
    });
  });

  it("leaves the whole-group counts untouched", () => {
    const source = industrials();
    const outcome = applyFixtureSectorMembersQuery(source, { group: GROUP });
    expect((outcome.body as Record<string, unknown>).counts).toEqual(source.counts);
    expect((outcome.body as Record<string, unknown>).counts).toEqual({
      configured: 83, served: 83, accounted_unserved: 0, unaccounted: 0,
      open_plan: 7, resolved_plan: 18, early_observation: 11, none: 47, unavailable: 0,
    });
  });

  it("never mutates the supplied body", () => {
    const source = industrials();
    const before = JSON.stringify(source);
    applyFixtureSectorMembersQuery(source, { group: GROUP, q: "carrier", limit: 1 });
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("fixture sector-members engine: search before paging", () => {
  it("finds a match that sorts past page one", () => {
    // IR matches only through its name ("Ingersoll Rand") and sorts second in
    // the filtered set behind GE (open plan, earlier rank); a page-first
    // implementation with limit 1 would never see it.
    const outcome = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, q: "ge", limit: 1 });
    expect(outcome.status).toBe(200);
    expect(symbolsOf(outcome.body)).toEqual(["GE"]);
    const second = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, q: "ge", limit: 1, offset: 1 });
    expect(symbolsOf(second.body)).toEqual(["IR"]);
    // The whole "ge" set (symbol AND name matches) is 8 members across ranks.
    expect(pageOf(outcome.body)).toMatchObject({ offset: 0, limit: 1, total_matching: 8, next_offset: 1, q: "ge" });
  });

  it("matches symbols and names case-insensitively", () => {
    const bySymbol = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, q: "CARR" });
    expect(symbolsOf(bySymbol.body)).toEqual(["CARR"]);
    const byName = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, q: "United Rentals" });
    expect(symbolsOf(byName.body)).toEqual(["URI"]);
    const byNameLower = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, q: "united" });
    expect(symbolsOf(byNameLower.body)).toEqual(["URI", "UAL", "UPS"]);
  });

  it("pages the filtered set, not the raw population", () => {
    const outcome = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, q: "united", limit: 1 });
    // "united" matches URI (open_plan), UAL and UPS (resolved) — rank order puts URI first.
    expect(symbolsOf(outcome.body)).toEqual(["URI"]);
    expect(pageOf(outcome.body)).toMatchObject({ total_matching: 3, next_offset: 1 });
    const second = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, q: "united", limit: 1, offset: 1 });
    expect(symbolsOf(second.body)).toEqual(["UAL"]);
    expect(pageOf(second.body)).toMatchObject({ offset: 1, total_matching: 3, next_offset: 2 });
    const third = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, q: "united", limit: 1, offset: 2 });
    expect(symbolsOf(third.body)).toEqual(["UPS"]);
    expect(pageOf(third.body)).toMatchObject({ offset: 2, total_matching: 3, next_offset: null });
  });
});

describe("fixture sector-members engine: state filter", () => {
  it("returns only open plans and reports the filtered total", () => {
    const outcome = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, state: "open_plan" });
    expect(outcome.status).toBe(200);
    expect(symbolsOf(outcome.body)).toEqual(["CARR", "GE", "IR", "NOC", "SNA", "URI", "XYL"]);
    expect(membersOf(outcome.body).every(member => stateOf(member) === "open_plan")).toBe(true);
    expect(pageOf(outcome.body)).toMatchObject({ total_matching: 7, next_offset: null, state: "open_plan" });
  });

  it("keeps counts whole-group under a state filter", () => {
    const source = industrials();
    const outcome = applyFixtureSectorMembersQuery(source, { group: GROUP, state: "open_plan" });
    expect((outcome.body as Record<string, unknown>).counts).toEqual(source.counts);
  });
});

describe("fixture sector-members engine: paging window", () => {
  it("returns an empty page past the end with the query echoed", () => {
    const outcome = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, offset: 1000 });
    expect(outcome.status).toBe(200);
    expect(membersOf(outcome.body)).toEqual([]);
    expect(pageOf(outcome.body)).toEqual({
      offset: 1000, limit: 100, total_matching: 83, next_offset: null, q: null, state: null,
    });
  });

  it("sets next_offset when the limit is smaller than the page", () => {
    const outcome = applyFixtureSectorMembersQuery(industrials(), { group: GROUP, limit: 5 });
    expect(symbolsOf(outcome.body)).toHaveLength(5);
    expect(pageOf(outcome.body)).toMatchObject({ offset: 0, limit: 5, total_matching: 83, next_offset: 5 });
  });
});

describe("fixture sector-members engine: fail-closed admission", () => {
  it.each([
    ["unknown state word", { group: GROUP, state: "bogus" }, "malformed state"],
    ["negative offset", { group: GROUP, offset: -1 }, "malformed offset"],
    ["non-numeric offset", { group: GROUP, offset: Number.NaN }, "malformed offset"],
    ["limit above the contract maximum", { group: GROUP, limit: 201 }, "malformed limit"],
    ["group and symbol together", { group: GROUP, symbol: "CARR" }, "group and symbol are exclusive"],
    ["malformed group id", { group: "US_SECTOR" }, "malformed group id"],
  ])("answers 422 for %s", (_label, query, reason) => {
    const outcome = applyFixtureSectorMembersQuery(industrials(), query);
    expect(outcome.status).toBe(422);
    expect(outcome.body).toEqual({ code: "invalid_query", reason });
  });

  it("answers 404 unknown_group when the body is not a group capture", () => {
    const outcome = applyFixtureSectorMembersQuery(load("index.json"), { group: GROUP });
    expect(outcome.status).toBe(404);
    expect(outcome.body).toEqual({ code: "unknown_group", reason: GROUP });
  });

  it("passes index and symbol modes through unchanged", () => {
    const index = load("index.json");
    const outcome = applyFixtureSectorMembersQuery(index, {});
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual(index);
    const symbol = load("symbol_CARR.json");
    expect(applyFixtureSectorMembersQuery(symbol, { symbol: "CARR" })).toEqual({ status: 200, body: symbol });
  });
});
