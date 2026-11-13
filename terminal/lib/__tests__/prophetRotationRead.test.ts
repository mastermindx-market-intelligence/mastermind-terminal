import { afterEach, describe, expect, it, vi } from "vitest";
import {
  companyRotationGroups, fetchProphetRotationRead, parseProphetRotationRead,
  PROPHET_ROTATION_READ_URL, ROTATION_READ_COPY, ROTATION_READ_UNAVAILABLE,
} from "../prophetRotationRead";

function fixture() {
  const row = {
    group_id: "technology", family: "sector", name: "Technology", parent: null,
    as_of: "2026-11-06", status: "ok", unavailable_reason: null,
    n_members: 50, n_counted: 48, pct_above_200: 70, chg_13w: 12, chg_26w: -4,
    direction: "improving", run_weeks: 3, rank_13w: 2, n_ranked: 11,
  };
  return {
    schema: "si.rotation_read/v1", as_of: "2026-11-06", built_at: "2026-11-07T01:00:00Z",
    status: "ok", basis: "current_roster", copy: ROTATION_READ_COPY,
    groups: [row, ...["chips", "ai", "cloud"].map((id, index) => ({ ...row,
      group_id: id, family: "theme", name: id, parent: "technology",
      direction: ["flat", "deteriorating", "improving"][index],
    }))],
    companies: { NVDA: { sector: "technology", themes: ["chips", "ai", "cloud"] } },
  };
}
function envelope(data: unknown) {
  return { data, receipt: { status: "ready", stale: false } };
}
afterEach(() => vi.unstubAllGlobals());

describe("SI ruling 57 rotation read", () => {
  it("pins the mandatory description verbatim", () => {
    expect(ROTATION_READ_COPY).toBe("Breadth change inside the group on today's roster. Description only; not a forecast.");
  });
  it("defaults to quiet unavailable", () => {
    expect(ROTATION_READ_UNAVAILABLE).toEqual({ status: "unavailable" });
    expect(parseProphetRotationRead(undefined)).toEqual(ROTATION_READ_UNAVAILABLE);
  });
  it("reads mixed directions without computing or reordering them", () => {
    const read = parseProphetRotationRead(fixture());
    expect(read.status).toBe("ready");
    expect(companyRotationGroups(read, "nvda")?.map(row => row.direction))
      .toEqual(["improving", "flat", "deteriorating", "improving"]);
    expect(companyRotationGroups(read, "UNKNOWN")).toBeNull();
  });
  it("supports a deteriorating sector and no themes", () => {
    const data = fixture();
    data.groups[0].direction = "deteriorating";
    data.groups[0].chg_13w = -18;
    data.companies.NVDA.themes = [];
    expect(companyRotationGroups(parseProphetRotationRead(data), "NVDA"))
      .toEqual([data.groups[0]]);
  });
  it.each([undefined, "Unrelated owner prose", ["Unrelated owner prose", ROTATION_READ_COPY]])
    ("preserves or restores the mandatory line for copy %j", copy => {
      const read = parseProphetRotationRead({ ...fixture(), copy });
      expect(read.status === "ready" && read.data.copy).toBe(ROTATION_READ_COPY);
    });
  it.each(["stale", "unavailable", "unknown"])("rejects whole-read status %s", status => {
    expect(parseProphetRotationRead({ ...fixture(), status })).toEqual(ROTATION_READ_UNAVAILABLE);
  });
  it.each([
    { schema: "si.rotation_read/v2" }, { basis: "historical_roster" },
    { as_of: "2026-02-30" }, { built_at: "not-a-date" }, { groups: null }, { companies: [] },
  ])("rejects malformed envelope %j", patch => {
    expect(parseProphetRotationRead({ ...fixture(), ...patch })).toEqual(ROTATION_READ_UNAVAILABLE);
  });
  it.each(["too_few_members", "stale", "no_history"])("retains null-only unavailable row: %s", reason => {
    const data = fixture();
    Object.assign(data.groups[0], { status: "unavailable", unavailable_reason: reason,
      n_members: null, n_counted: null, pct_above_200: null, chg_13w: null, chg_26w: null,
      direction: null, run_weeks: null, rank_13w: null, n_ranked: null });
    expect(parseProphetRotationRead(data).status).toBe("ready");
    Object.assign(data.groups[0], { chg_13w: 0 });
    expect(parseProphetRotationRead(data)).toEqual(ROTATION_READ_UNAVAILABLE);
  });
  it.each([
    { chg_13w: NaN }, { chg_26w: Infinity }, { pct_above_200: 101 }, { n_counted: 51 },
    { direction: null }, { n_members: "50" }, { rank_13w: 12 }, { as_of: "2026-11-13" },
  ])("rejects invalid row %j", patch => {
    const data = fixture(); Object.assign(data.groups[0], patch);
    expect(parseProphetRotationRead(data)).toEqual(ROTATION_READ_UNAVAILABLE);
  });
  it("rejects duplicate identities and broken family membership", () => {
    const data = fixture(); data.groups.push(data.groups[0]);
    expect(parseProphetRotationRead(data)).toEqual(ROTATION_READ_UNAVAILABLE);
    const bad = fixture(); bad.companies.NVDA.sector = "chips";
    expect(parseProphetRotationRead(bad)).toEqual(ROTATION_READ_UNAVAILABLE);
    const missing = fixture(); missing.companies.NVDA.themes = ["missing"];
    expect(parseProphetRotationRead(missing)).toEqual(ROTATION_READ_UNAVAILABLE);
  });
});

describe("fixed SI gateway client", () => {
  it("uses only the fixed same-origin URL and gateway envelope", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(envelope(fixture())));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    expect((await fetchProphetRotationRead(controller.signal)).status).toBe("ready");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(PROPHET_ROTATION_READ_URL,
      { cache: "no-store", signal: controller.signal });
    expect(PROPHET_ROTATION_READ_URL).toBe("/api/sector-intelligence?source=rotation_read");
  });
  it.each([400, 401, 403, 404, 429, 500, 502])("treats non-2xx %s as unavailable without reading its body", async status => {
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json }));
    expect(await fetchProphetRotationRead()).toEqual(ROTATION_READ_UNAVAILABLE);
    expect(json).not.toHaveBeenCalled();
  });
  it("collapses transport and invalid JSON failures to unavailable", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchProphetRotationRead()).toEqual(ROTATION_READ_UNAVAILABLE);
    expect(await fetchProphetRotationRead()).toEqual(ROTATION_READ_UNAVAILABLE);
  });
  it.each([
    { data: fixture(), receipt: { status: "access", stale: false } },
    { data: fixture(), receipt: { status: "ready", stale: true } },
    fixture(), envelope(null), envelope({ ...fixture(), status: "stale" }),
  ])("rejects unqualified gateway answers", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    expect(await fetchProphetRotationRead()).toEqual(ROTATION_READ_UNAVAILABLE);
  });
});
