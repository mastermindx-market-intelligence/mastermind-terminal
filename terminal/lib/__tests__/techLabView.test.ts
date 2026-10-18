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
  it("keeps a missing publication time unknown rather than using the current clock", () => {
    const input = techLabFixture(); input.tech.asof = ""; input.tech.events.generated_utc = "not-a-date";
    expect(buildLabModel("EL", input).publishedAt).toBeNull();
  });
  it("honors an explicit source exclusion and still refuses raw-score overrides", () => {
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
