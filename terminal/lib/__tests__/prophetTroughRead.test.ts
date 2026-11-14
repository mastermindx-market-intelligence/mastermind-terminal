import { afterEach, describe, expect, it, vi } from "vitest";
import { companyTroughRead, fetchProphetTroughRead, parseProphetTroughRead, TROUGH_READ_UNAVAILABLE, troughCounts, troughSuffix } from "../prophetTroughRead";
import { troughSpecimen, TROUGH_BANNED_WORDS } from "../../e2e/prophetTroughSpecimens";
import { troughHeadline } from "@/components/prophet/setup/TroughRead";
import { TROUGH_HEADLINE_VARIANT, TROUGH_RECORD_ENABLED, TROUGH_STRINGS } from "@/components/prophet/setup/setupStrings";
const getRow = () => troughSpecimen().tickers.ADP;
afterEach(() => vi.unstubAllGlobals());
describe("trough publication", () => {
  it("accepts the exact contract and retains its owner values", () => {
    expect(companyTroughRead(parseProphetTroughRead(troughSpecimen()), "adp")).toEqual(getRow());
    expect(companyTroughRead(parseProphetTroughRead(troughSpecimen()), "UNKNOWN")).toBeNull();
    expect(companyTroughRead(TROUGH_READ_UNAVAILABLE, "ADP")).toBeNull();
  });
  it.each([undefined, null, [], {}, { ...troughSpecimen(), schema: "other" }, { ...troughSpecimen(), status: "stale" }, troughSpecimen("D"), { ...troughSpecimen(), as_of: "2026-02-30" }, { ...troughSpecimen(), built_at: "not a date" }])("rejects malformed/stale whole reads %#", value => {
    expect(parseProphetTroughRead(value)).toEqual(TROUGH_READ_UNAVAILABLE);
  });
  it.each(["timeframes", "kind", "own_history", "group", "provenance"] as const)("accepts nullable field %s where permitted", key => {
    const data = troughSpecimen();
    if (key === "timeframes") data.tickers.ADP.timeframes.forEach(f => { f.washed_out = null; f.turned_up = null; f.bar_end = null; });
    else Object.assign(data.tickers.ADP, { [key]: null });
    expect(parseProphetTroughRead(data).status).toBe("ready");
  });
  it.each([
    (r: ReturnType<typeof getRow>) => { r.timeframes.reverse(); },
    (r: ReturnType<typeof getRow>) => { r.timeframes.pop(); },
    (r: ReturnType<typeof getRow>) => { r.kind = { label: "middle", position: 2 }; },
    (r: ReturnType<typeof getRow>) => { r.own_history!.past[0].depth_atrc = NaN; },
    (r: ReturnType<typeof getRow>) => { Object.assign(r.group!, { fields: {} }); },
    (r: ReturnType<typeof getRow>) => { r.timeframes[0].bar_end = "2026-11-15"; },
  ])("rejects invalid row %#", mutate => {
    const data = troughSpecimen(); mutate(data.tickers.ADP);
    expect(parseProphetTroughRead(data)).toEqual(TROUGH_READ_UNAVAILABLE);
  });
  it.each([["A", 3, 1, "turning"], ["B", 3, 0, "notTurned"], ["C", 0, 0, "notWashed"], ["E", 3, 1, "turning"]] as const)("counts %s without weights", (state, n, k, suffix) => {
    const row = troughSpecimen(state).tickers.ADP;
    expect(troughCounts(row)).toEqual({ n, k }); expect(troughSuffix(row)).toBe(suffix);
  });
  it("does not count unavailable or unclosed bars or turns on unwashed legs", () => {
    const row = getRow(); row.timeframes[1].available = false; row.timeframes[0].bar_end = null; row.timeframes[3].turned_up = true;
    expect(troughCounts(row)).toEqual({ n: 1, k: 0 }); expect(troughSuffix(row)).toBe("notTurned");
  });
  it.each(["en", "zh"] as const)("both copy variants are complete in %s", lang => {
    const row = getRow();
    for (const variant of ["count", "named"] as const) {
      expect(troughHeadline(row, lang, variant)).not.toMatch(/\{|\}/);
      expect(TROUGH_STRINGS[lang].variants[variant].record).toBeTruthy();
      expect(TROUGH_STRINGS[lang].variants[variant].method).toBeTruthy();
    }
  });
  it.each(["A", "B", "C", "D", "E"] as const)("both variants contain no banned words in state %s", state => {
    for (const lang of ["en", "zh"] as const) for (const variant of ["count", "named"] as const) {
      const copy = TROUGH_STRINGS[lang].variants[variant];
      expect(`${troughHeadline(troughSpecimen(state).tickers.ADP, lang, variant)} ${copy.method} ${copy.record}`).not.toMatch(TROUGH_BANNED_WORDS);
    }
  });
  it("defaults to named, independently hides the held record and handles all/none", () => {
    expect(TROUGH_HEADLINE_VARIANT).toBe("named"); expect(TROUGH_RECORD_ENABLED).toBe(false);
    expect(troughHeadline(getRow(), "en")).toBe(troughHeadline(getRow(), "en", "named"));
    const row = getRow(); row.timeframes.forEach(f => { f.washed_out = true; });
    expect(troughHeadline(row, "en")).toBe("Washed out on Daily, 3-day, Weekly, 2-week · turning up");
    expect(troughHeadline(troughSpecimen("C").tickers.ADP, "en")).toBe("Not washed out on any timeframe");
  });
  it("uses the 3D turn even if that leg is no longer washed out", () => {
    const row = getRow(); row.timeframes[1].washed_out = false; expect(troughSuffix(row)).toBe("turning");
  });
  it.each([
    { known_ts: null }, { known_ts: "2026-11-13T21:00:00+00:00" }, { engine_ref: null },
  ])("requires revision metadata %#", patch => expect(parseProphetTroughRead({ ...troughSpecimen(), ...patch })).toEqual(TROUGH_READ_UNAVAILABLE));
  it.each([
    (r: ReturnType<typeof getRow>) => { r.timeframes[0].turned_up = true; },
    (r: ReturnType<typeof getRow>) => { r.timeframes[0].d = NaN; },
    (r: ReturnType<typeof getRow>) => { Object.assign(r.timeframes[0].components, { K_rising: "yes" }); },
    (r: ReturnType<typeof getRow>) => { r.own_history!.n_prior = 2; },
    (r: ReturnType<typeof getRow>) => { r.own_history!.own_history_pct = 1.1; },
  ])("rejects invalid REV 1.1 fields %#", mutate => { const data = troughSpecimen(); mutate(data.tickers.ADP); expect(parseProphetTroughRead(data)).toEqual(TROUGH_READ_UNAVAILABLE); });
  it("selects exact count and named headlines", () => {
    expect(troughHeadline(getRow(), "en", "count")).toBe("Washed out on 3 of 4 timeframes · turning up");
    expect(troughHeadline(getRow(), "en", "named")).toBe("Washed out on Daily, 3-day, Weekly · not 2-week · turning up");
    expect(TROUGH_STRINGS.en.variants.named.method).toBe("More timeframes washed out means a deeper decline. It has not been shown to make the low more likely to hold.");
  });
  it.each([404, 401, 403, 500])("HTTP %s stays quietly unavailable", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
    expect(await fetchProphetTroughRead()).toEqual(TROUGH_READ_UNAVAILABLE);
  });
  it("uses only the fixed file seam, cache policy and abort signal", async () => {
    const fetch = vi.fn(async () => Response.json(troughSpecimen())); vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect((await fetchProphetTroughRead(signal)).status).toBe("ready");
    expect(fetch).toHaveBeenCalledWith("/api/prophet/trough-read", { cache: "no-store", signal });
  });
  it.each([async () => new Response("invalid"), async () => { throw new Error("offline"); }])("invalid body/transport stays unavailable %#", async fetch => {
    vi.stubGlobal("fetch", fetch); expect(await fetchProphetTroughRead()).toEqual(TROUGH_READ_UNAVAILABLE);
  });
});
