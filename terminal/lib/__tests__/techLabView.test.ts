import { describe, expect, it } from "vitest";
import { buildLabModel, labDate, sortLabSetups } from "../techLabView";
import { techLabFixture } from "./fixtures/techLab";

describe("Lab evidence projection", () => {
  it("ranks supplied lift rather than raw wins, with observed-history tie breakers", () => {
    const model = buildLabModel("EL", techLabFixture());
    const active = model.setups.filter(s => s.active && !s.contextOnly && s.comparison);
    expect(sortLabSetups(active, "lift").map(s => s.id)).toEqual(["strongest", "tied", "weak"]);
    expect(sortLabSetups(active, "recent").map(s => s.id)).toEqual(["tied", "strongest", "weak"]);
    expect(sortLabSetups(active, "history").map(s => s.id)).toEqual(["weak", "strongest", "tied"]);
    expect(active.map(s => s.id)).toEqual(["weak", "strongest", "tied"]); // no input mutation
  });
  it("separates nonzero raw scores and neutral states from discrete active setups", () => {
    const m = buildLabModel("EL", techLabFixture());
    expect(m.setups.filter(s => s.active && !s.contextOnly).map(s => s.id)).toEqual(["weak", "strongest", "tied", "insufficient"]);
    for (const id of ["valuation_pctile", "insider_power_state", "neutral_range"]) expect(m.setups.find(s => s.id === id)?.contextOnly).toBe(true);
  });
  it.each(["rs_repair", "rs_deteriorate", "rs_new_high", "rs_new_low"])("keeps catalog-excluded %s out of active rankings even when a legacy event fires", id => {
    const input = techLabFixture();
    Object.assign(input.tech.events.signals, { [id]: { ...input.tech.events.signals.tied } });
    Object.assign(input.tech.profiles, { [id]: input.tech.profiles.tied });
    const setup = buildLabModel("EL", input).setups.find(s => s.id === id)!;
    expect(setup.active).toBe(true);
    expect(setup.comparison).toBe(true);
    expect(setup.contextOnly).toBe(true);
  });
  it.each([{ digits: 6, comparable: true }, { digits: 4, comparable: false }])("pins the producer's six-decimal independent rounding contract: $digits decimals", ({ digits, comparable }) => {
    const input = techLabFixture();
    const wins = 0.48004949;
    const baseline = 0.38005051;
    const rounded = (v: number) => Number(v.toFixed(digits));
    Object.assign(input.tech.profiles.strongest, {
      wr_21d: rounded(wins), base_wr: rounded(baseline), edge_wr: rounded(wins - baseline),
    });
    const setup = buildLabModel("EL", input).setups.find(s => s.id === "strongest")!;
    expect(Math.abs(setup.history.wins! - setup.history.baseline! - setup.history.lift!)).toBeGreaterThan(0);
    expect(setup.comparison).toBe(comparable);
    expect(setup.inconsistent).toBe(!comparable);
  });
  it("keeps usable comparisons before unranked conditions for each sort", () => {
    const active = buildLabModel("EL", techLabFixture()).setups.filter(s => s.active && !s.contextOnly);
    for (const sort of ["lift", "recent", "history"] as const) {
      expect(sortLabSetups(active, sort).at(-1)?.id).toBe("insufficient");
    }
  });
  it("does not promote absent, unknown or another ticker's evaluation to zero active", () => {
    expect(buildLabModel("EL", null).status).toBe("missing");
    expect(buildLabModel("EL", techLabFixture("NVDA")).status).toBe("unbound");
    const input = techLabFixture(); delete (input.tech.events as Partial<typeof input.tech.events>).ticker;
    expect(buildLabModel("EL", input).status).toBe("unbound");
    const m = buildLabModel(" el ", techLabFixture());
    expect(m.status).toBe("ready");
    expect(m.setups.find(s => s.id === "unknown")?.active).toBeNull();
  });
  it("keeps an unreported direction unknown and out of historical comparisons", () => {
    const input = techLabFixture();
    Object.assign(input.tech.events.signals.tied, { dir: undefined });
    Object.assign(input.tech.profiles.tied, { direction: undefined });
    const s = buildLabModel("EL", input).setups.find(s => s.id === "tied")!;
    expect(s.direction).toBeNull(); expect(s.active).toBe(true);
    expect(s.contextOnly).toBe(false); expect(s.comparison).toBe(false);
  });
  it("keeps genuine active conditions with zero history unranked", () => {
    const s = buildLabModel("EL", techLabFixture()).setups.find(s => s.id === "insufficient")!;
    expect(s.active).toBe(true); expect(s.comparison).toBe(false); expect(s.history.observations).toBe(0);
  });
  it.each([null, undefined, "0.7", NaN, Infinity, -0.1, 1.1])("never ranks an invalid win rate %s", value => {
    const input = techLabFixture(); Object.assign(input.tech.profiles.strongest, { wr_21d: value });
    expect(buildLabModel("EL", input).setups.find(s => s.id === "strongest")?.comparison).toBe(false);
  });
  it.each([0, -1, 1.5, Infinity, "180"])("requires a positive integer observation count %s", value => {
    const input = techLabFixture(); Object.assign(input.tech.profiles.strongest, { n_fires: value });
    expect(buildLabModel("EL", input).setups.find(s => s.id === "strongest")?.comparison).toBe(false);
  });
  it("quarantines inconsistent lift, direction and kind instead of silently repairing the source", () => {
    for (const change of [{ edge_wr: 0.5 }, { direction: 1 }, { kind: "event" }]) {
      const input = techLabFixture(); Object.assign(input.tech.profiles.strongest, change);
      const s = buildLabModel("EL", input).setups.find(s => s.id === "strongest")!;
      expect(s.inconsistent).toBe(true); expect(s.comparison).toBe(false);
    }
  });
  it("sorts unsorted trigger dates, deduplicates, and rejects invalid or post-publication dates", () => {
    const input = techLabFixture();
    input.tech.events.signals.strongest.fires = ["2026-10-12", "bad", "2026-02-30", "2026-10-12", "2026-10-11", "2099-01-01"];
    const s = buildLabModel("EL", input).setups.find(s => s.id === "strongest")!;
    expect(s.fires).toEqual(["2026-10-11", "2026-10-12"]); expect(s.latestFire).toBe("2026-10-12");
    expect(labDate("2024-02-29")).toBe("2024-02-29"); expect(labDate("2025-02-29")).toBeNull();
  });
  it("shows the last evaluated input bar separately from publication and constrains fire dates", () => {
    const input = techLabFixture();
    input.tech.events.signals.tied.fires = ["2026-10-15", "2026-10-16"];
    const model = buildLabModel("EL", input);
    expect(model.dataThrough).toBe("2026-10-15");
    expect(model.publishedAt).toBe("2026-10-16T18:42:15Z");
    expect(model.setups.find(s => s.id === "tied")?.fires).toEqual(["2026-10-15"]);
  });
  it.each([undefined, "", "bad", "2026-02-30", "2026-10-17", "2099-01-01"])(
    "does not claim a valid last market bar for missing or impossible source date %s", value => {
      const input = techLabFixture();
      Object.assign(input.tech.events, { data_through: value });
      const model = buildLabModel("EL", input);
      expect(model.status).toBe("ready");
      expect(model.dataThrough).toBeNull();
    },
  );
  it("keeps publication and the source bar unknown rather than using the current clock", () => {
    const input = techLabFixture(); input.tech.asof = ""; input.tech.events.generated_utc = "not-a-date";
    const model = buildLabModel("EL", input);
    expect(model.publishedAt).toBeNull();
    expect(model.dataThrough).toBeNull();
  });
  it("honors a future optional source exclusion and still refuses raw-score overrides", () => {
    const input = techLabFixture();
    Object.assign(input.tech.events.signals.strongest, { screener_firing: false });
    Object.assign(input.tech.events.signals.valuation_pctile, { screener_firing: true });
    const m = buildLabModel("EL", input);
    expect(m.setups.find(s => s.id === "strongest")?.contextOnly).toBe(true);
    expect(m.setups.find(s => s.id === "valuation_pctile")?.contextOnly).toBe(true);
  });
  it("handles malformed signal and profile blocks without crashing or inventing evidence", () => {
    expect(buildLabModel("EL", {tech:{events:{ticker:"EL", signals:[]}}}).status).toBe("missing");
    const m = buildLabModel("EL", {tech:{events:{ticker:"EL", signals:{bad:null}},profiles:{bad:[]}}});
    expect(m.setups[0].active).toBeNull(); expect(m.setups[0].comparison).toBe(false); expect(m.setups[0].contextOnly).toBe(true);
  });
});
