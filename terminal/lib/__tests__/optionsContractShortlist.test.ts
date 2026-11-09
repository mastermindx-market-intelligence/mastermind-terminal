import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPARE_FIELDS,
  SHORTLIST_MAX,
  addPin,
  ambiguousIdentityKeys,
  buildComparison,
  buildPin,
  contractIdentity,
  locatePin,
  removePin,
  sessionOf,
  type CompareFieldId,
  type ObservationId,
  type ShortlistPin,
  type ShortlistSource,
} from "@/lib/optionsContractShortlist";
import { CONTRACT_SHORTLIST_LEX, fillShortlistCopy } from "@/lib/optionsContractShortlistLex";
import {
  selectHotRows,
  selectOiRows,
  type ScreenerHotSource,
  type ScreenerOiSource,
} from "@/lib/optionsScreener";

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}

const OI_SRC: ShortlistSource = { family: "doi", asof: "2026-07-04T20:00:00Z", schema: "options_hub.oi_movers/v1" };
const HOT_SRC: ShortlistSource = {
  family: "hot", asof: "2026-07-05", schema: "options_hub.hot/v1", hotView: "by_premium",
};

const movers: ScreenerOiSource[] = deepFreeze([
  { root: "NVDA", right: "C", exp: "2026-07-18", strike: 150, oi: 42180, oi_prev: 28340, d_oi: 13840, mid: 1.24 },
  { root: "NVDA1", right: "C", exp: "2026-07-18", strike: 150, oi: 900, oi_prev: 400, d_oi: 500, mid: 3.1 },
  { root: "SPY", right: "P", exp: "2026-07-11", strike: 530, oi: 50000, oi_prev: 52000, d_oi: -2000, mid: null },
  { root: "QQQ", right: "C", exp: "2026-07-11", strike: 480, oi: 1000, oi_prev: 100, d_oi: 900, mid: 0.5 },
]);

const hot: ScreenerHotSource[] = deepFreeze([
  { root: "NVDA", right: "C", exp: "2026-07-18", strike: 140, premium: 28_400_000, vol: 12480, oi_prev: 8240, vol_gt_oi: true, close: 135.7 },
  { root: "SPY", right: "P", exp: "2026-07-11", strike: 545, premium: 9_000_000, vol: 40000, oi_prev: null, vol_gt_oi: null, close: 2.25 },
  { root: "NVDA", right: "C", exp: "2026-07-18", strike: 150, premium: 1_000_000, vol: 500, oi_prev: 42180, vol_gt_oi: false, close: 1.3 },
]);

function pinOf(row: unknown, src: ShortlistSource, list: readonly unknown[]): ShortlistPin {
  const b = buildPin(row, src, list);
  if (!b.ok) throw new Error(`unexpected refusal: ${b.reason}`);
  return b.pin;
}

function cell(pins: readonly ShortlistPin[], field: CompareFieldId, i: number) {
  const row = buildComparison(pins).rows.find((r) => r.field === field);
  if (!row) throw new Error(`no row ${field}`);
  return row.cells[i];
}

describe("AC-E15-01 exact identity never collapses", () => {
  it("keeps an adjusted root (NVDA1) distinct from NVDA at the same strike", () => {
    const a = contractIdentity(movers[0]);
    const b = contractIdentity(movers[1]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.identity.key).not.toBe(b.identity.key);
    expect(a.identity.root).toBe("NVDA");
    expect(b.identity.root).toBe("NVDA1");
    expect(a.identity.adjustedRootHint).toBe(false);
    expect(b.identity.adjustedRootHint).toBe(true);
  });

  it("keeps two supplied deliverables / multipliers on one ticker+strike as two contracts", () => {
    const base = { root: "XYZ", right: "C", exp: "2026-09-18", strike: 25, oi: 1, oi_prev: 1, d_oi: 0, mid: null };
    const std = contractIdentity({ ...base, multiplier: 100 });
    const adj = contractIdentity({ ...base, multiplier: 50, deliverable: "50 XYZ + $120 cash" });
    const bare = contractIdentity(base);
    expect(std.ok && adj.ok && bare.ok).toBe(true);
    if (!std.ok || !adj.ok || !bare.ok) return;
    const keys = new Set([std.identity.key, adj.identity.key, bare.identity.key]);
    expect(keys.size).toBe(3);
    expect(adj.identity.terms).toEqual({
      multiplier: 50, deliverable: "50 XYZ + $120 cash", settlement: null, exercise_style: null,
    });
  });

  it("never normalizes the root (case/whitespace) and refuses incomplete identity", () => {
    expect(contractIdentity({ ...movers[0], root: "nvda" }).ok).toBe(true);
    const lower = contractIdentity({ ...movers[0], root: "nvda" });
    const upper = contractIdentity(movers[0]);
    if (lower.ok && upper.ok) expect(lower.identity.key).not.toBe(upper.identity.key);
    expect(contractIdentity({ ...movers[0], root: "" })).toEqual({ ok: false, reason: "root" });
    expect(contractIdentity({ ...movers[0], root: " NVDA" })).toEqual({ ok: false, reason: "root" });
    expect(contractIdentity({ ...movers[0], right: "CALL" })).toEqual({ ok: false, reason: "right" });
    expect(contractIdentity({ ...movers[0], exp: "07-18" })).toEqual({ ok: false, reason: "exp" });
    expect(contractIdentity({ ...movers[0], exp: "2026-02-30" })).toEqual({ ok: false, reason: "exp" });
    expect(contractIdentity({ ...movers[0], strike: 0 })).toEqual({ ok: false, reason: "strike" });
    expect(contractIdentity({ ...movers[0], strike: Number.NaN })).toEqual({ ok: false, reason: "strike" });
    expect(contractIdentity({ ...movers[0], multiplier: "100" })).toEqual({ ok: false, reason: "terms" });
    expect(contractIdentity({ ...movers[0], deliverable: "" })).toEqual({ ok: false, reason: "terms" });
    expect(contractIdentity(null)).toEqual({ ok: false, reason: "root" });
  });

  it("refuses to pin when one list carries the same exact identity twice", () => {
    const dupList = deepFreeze([movers[0], { ...movers[0], oi: 1, d_oi: 1 }, movers[2]]);
    expect(ambiguousIdentityKeys(dupList).size).toBe(1);
    expect(buildPin(dupList[0], OI_SRC, dupList)).toEqual({ ok: false, reason: "ambiguous" });
    expect(buildPin(dupList[2], OI_SRC, dupList).ok).toBe(true);
  });

  it("refuses a pin when the source snapshot has no as-of date", () => {
    expect(buildPin(movers[0], { family: "doi", asof: undefined }, movers)).toEqual({ ok: false, reason: "session" });
    expect(buildPin(movers[0], { family: "doi", asof: "yesterday" }, movers)).toEqual({ ok: false, reason: "session" });
    expect(sessionOf("2026-07-04T20:00:00Z")).toBe("2026-07-04");
    expect(sessionOf("2026-07-04")).toBe("2026-07-04");
  });

  it("the same contract from two lists is two pins, flagged in the comparison", () => {
    const a = pinOf(movers[0], OI_SRC, movers);
    const b = pinOf(hot[2], HOT_SRC, hot);
    expect(a.identity.key).toBe(b.identity.key);
    expect(a.pinKey).not.toBe(b.pinKey);
    expect(buildComparison([a, b]).notes.sameContractTwice).toEqual([a.identity.key]);
  });
});

describe("AC-E15-02/03 observation, basis and never-defaulted terms", () => {
  it("labels a midpoint and a close as reference marks with their session, never executable", () => {
    const pins = [pinOf(movers[0], OI_SRC, movers), pinOf(hot[0], HOT_SRC, hot)];
    const cmp = buildComparison(pins);
    const byField = Object.fromEntries(cmp.rows.map((r) => [r.field, r]));
    expect(byField.mid.basis).toBe("reference_mark");
    expect(byField.close.basis).toBe("reference_mark");
    expect(byField.mid.cells[0]).toEqual({ state: "value", value: 1.24, observation: "eod_mid", session: "2026-07-04" });
    expect(byField.close.cells[1]).toEqual({ state: "value", value: 135.7, observation: "eod_close", session: "2026-07-05" });
    // The executable rows stay empty even though both pins carry a mark.
    for (const f of ["bid_ask", "spread", "quote_size"] as const) {
      expect(byField[f].basis).toBe("executable_quote");
      expect(byField[f].cells).toEqual([{ state: "not_supplied" }, { state: "not_supplied" }]);
    }
  });

  it("never fills an executable row even if a row smuggles bid/ask fields", () => {
    const row = { ...movers[0], bid: 1.2, ask: 1.28, bid_size: 10, ask_size: 12 };
    const pin = pinOf(row, OI_SRC, [row]);
    const pin2 = pinOf(movers[2], OI_SRC, movers);
    expect(cell([pin, pin2], "bid_ask", 0)).toEqual({ state: "not_supplied" });
    expect(cell([pin, pin2], "quote_size", 0)).toEqual({ state: "not_supplied" });
  });

  it("unknown multiplier / deliverable / settlement / exercise style stay not_supplied (no default 100)", () => {
    const pins = [pinOf(movers[0], OI_SRC, movers), pinOf(hot[0], HOT_SRC, hot)];
    for (const f of ["multiplier", "deliverable", "settlement", "exercise_style"] as const) {
      expect(cell(pins, f, 0)).toEqual({ state: "not_supplied" });
      expect(cell(pins, f, 1)).toEqual({ state: "not_supplied" });
    }
    expect(buildComparison(pins).notes.termsUnknown).toBe(true);
  });

  it("shows a supplied term verbatim and only then", () => {
    const row = { ...movers[3], multiplier: 50, settlement: "PM" };
    const pins = [pinOf(row, OI_SRC, [row]), pinOf(movers[0], OI_SRC, movers)];
    expect(cell(pins, "multiplier", 0)).toEqual({ state: "value", value: 50, observation: "term_supplied", session: "2026-07-04" });
    expect(cell(pins, "settlement", 0)).toMatchObject({ state: "value", value: "PM" });
    expect(cell(pins, "multiplier", 1)).toEqual({ state: "not_supplied" });
  });

  it("names the open-interest report clock for both lists", () => {
    const pins = [pinOf(movers[0], OI_SRC, movers), pinOf(hot[0], HOT_SRC, hot)];
    expect(cell(pins, "oi", 0)).toMatchObject({ value: 42180, observation: "oi_report", session: "2026-07-04" });
    expect(cell(pins, "oi", 1)).toMatchObject({ value: 8240, observation: "oi_report", session: "2026-07-05" });
    expect(cell(pins, "traded_value", 1)).toMatchObject({ value: 28_400_000, observation: "premium_estimate" });
  });
});

describe("AC-E15-04 mismatch visible, missing stays null", () => {
  it("a null mid / null open interest / null flag stays missing, never 0 or false", () => {
    const pins = [pinOf(movers[2], OI_SRC, movers), pinOf(hot[1], HOT_SRC, hot)];
    expect(cell(pins, "mid", 0)).toEqual({ state: "missing", observation: "eod_mid", session: "2026-07-04" });
    expect(cell(pins, "oi", 1)).toEqual({ state: "missing", observation: "oi_report", session: "2026-07-05" });
    expect(cell(pins, "vol_above_oi", 1)).toEqual({ state: "missing", observation: "vol_vs_oi", session: "2026-07-05" });
    expect(cell(pins, "mid", 1)).toEqual({ state: "not_in_list" });
    expect(cell(pins, "close", 0)).toEqual({ state: "not_in_list" });
  });

  it("flags different sessions, mixed lists and a stale snapshot as not like-for-like", () => {
    const sameList = [pinOf(movers[0], OI_SRC, movers), pinOf(movers[2], OI_SRC, movers)];
    expect(buildComparison(sameList).notes).toMatchObject({
      sessionMismatch: false, listMix: false, stale: false, likeForLike: true, sessions: ["2026-07-04"],
    });

    const mixed = [pinOf(movers[0], OI_SRC, movers), pinOf(hot[0], HOT_SRC, hot)];
    expect(buildComparison(mixed).notes).toMatchObject({
      sessionMismatch: true, listMix: true, likeForLike: false, sessions: ["2026-07-04", "2026-07-05"],
    });

    const staleSrc: ShortlistSource = { ...OI_SRC, stale: true };
    const stale = [pinOf(movers[0], staleSrc, movers), pinOf(movers[2], staleSrc, movers)];
    expect(buildComparison(stale).notes).toMatchObject({ stale: true, likeForLike: false });

    const laterOi: ShortlistSource = { ...OI_SRC, asof: "2026-07-07" };
    const twoSessions = [pinOf(movers[0], OI_SRC, movers), pinOf(movers[0], laterOi, movers)];
    expect(buildComparison(twoSessions).notes).toMatchObject({ sessionMismatch: true, listMix: false, likeForLike: false });
  });

  it("is not ready with fewer than two pins", () => {
    expect(buildComparison([pinOf(movers[0], OI_SRC, movers)]).ready).toBe(false);
    expect(buildComparison([]).notes.likeForLike).toBe(false);
  });
});

describe("AC-E15-05 pin / unpin / locate never touch the screener population or order", () => {
  it("selector output is identical before and after pinning, unpinning and locating", () => {
    const filter = { root: "", group: "" };
    const beforeOi = JSON.stringify(selectOiRows(movers, filter, "mid", 1));
    const beforeHot = JSON.stringify(selectHotRows(hot, filter));

    let pins: readonly ShortlistPin[] = [];
    for (const r of selectOiRows(movers, filter, "mid", 1)) pins = addPin(pins, pinOf(r, OI_SRC, movers)).pins;
    pins = addPin(pins, pinOf(hot[0], HOT_SRC, hot)).pins;
    expect(pins.length).toBe(SHORTLIST_MAX);
    pins = removePin(pins, pins[1].pinKey);
    for (const p of pins) locatePin(p, p.family === "doi" ? movers : hot, "SPY");
    buildComparison(pins);

    expect(JSON.stringify(selectOiRows(movers, filter, "mid", 1))).toBe(beforeOi);
    expect(JSON.stringify(selectHotRows(hot, filter))).toBe(beforeHot);
    expect(Object.isFrozen(movers[0])).toBe(true);
  });

  it("addPin/removePin are non-mutating and refuse a fifth pin", () => {
    const p = movers.map((m) => pinOf(m, OI_SRC, movers));
    let pins: readonly ShortlistPin[] = deepFreeze([] as ShortlistPin[]);
    for (const x of p) pins = addPin(pins, x).pins;
    const extra = pinOf(hot[0], HOT_SRC, hot);
    const full = addPin(pins, extra);
    expect(full.result).toBe("full");
    expect(full.pins).toBe(pins);
    expect(addPin(pins, p[0]).result).toBe("exists");
    const removed = removePin(pins, p[0].pinKey);
    expect(removed).not.toBe(pins);
    expect(pins.length).toBe(4);
    expect(removePin(pins, "nope")).toBe(pins);
  });

  it("locatePin reports a filtered-out row instead of asking to change the filter", () => {
    const pin = pinOf(movers[0], OI_SRC, movers);
    expect(locatePin(pin, movers, "")).toBe("present");
    expect(locatePin(pin, movers, "SPY")).toBe("hidden_by_filter");
    expect(locatePin(pin, movers.slice(2), "")).toBe("not_in_list");
    expect(locatePin(pin, undefined, "")).toBe("not_in_list");
  });

  it("a pin keeps a frozen snapshot of its row", () => {
    const row = { ...movers[0] };
    const pin = pinOf(row, OI_SRC, [row]);
    row.mid = 99;
    expect(pin.row.mid).toBe(1.24);
    expect(Object.isFrozen(pin.row)).toBe(true);
  });
});

describe("AC-E15-06 works on the shipped screener fixture with no new data", () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, "../../public/data/screener_fixture.json"), "utf8")) as {
    oi: { asof: string; schema?: string; movers: ScreenerOiSource[] };
    hot: { asof: string; schema?: string; by_premium: ScreenerHotSource[]; by_volume: ScreenerHotSource[] };
  };

  it("every fixture contract binds to an exact identity and nothing is ambiguous", () => {
    for (const list of [fixture.oi.movers, fixture.hot.by_premium, fixture.hot.by_volume]) {
      expect(ambiguousIdentityKeys(list).size).toBe(0);
      for (const row of list) expect(contractIdentity(row).ok).toBe(true);
    }
  });

  it("compares two real fixture contracts with sessions named and no terms invented", () => {
    const a = pinOf(fixture.oi.movers[0], { family: "doi", asof: fixture.oi.asof }, fixture.oi.movers);
    const b = pinOf(fixture.hot.by_premium[0], { family: "hot", asof: fixture.hot.asof, hotView: "by_premium" }, fixture.hot.by_premium);
    const cmp = buildComparison([a, b]);
    expect(cmp.ready).toBe(true);
    expect(cmp.notes.sessions).toEqual([fixture.oi.asof.slice(0, 10), fixture.hot.asof.slice(0, 10)]);
    for (const r of cmp.rows) {
      for (const c of r.cells) {
        if (r.basis === "executable_quote" || r.basis === "contract_term") expect(c).toEqual({ state: "not_supplied" });
        if (c.state === "value" || c.state === "missing") expect(c.session).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe("copy contract", () => {
  const OBS: ObservationId[] = [
    "eod_mid", "eod_close", "oi_report", "oi_report_prior", "oi_report_change",
    "session_volume", "premium_estimate", "vol_vs_oi", "term_supplied",
  ];

  it("has EN+ZH copy for every field, basis and observation", () => {
    for (const { field, basis } of COMPARE_FIELDS) {
      expect(CONTRACT_SHORTLIST_LEX[`e15F_${field}`]?.every(Boolean)).toBe(true);
      expect(CONTRACT_SHORTLIST_LEX[`e15B_${basis}`]?.every(Boolean)).toBe(true);
    }
    for (const o of OBS) expect(CONTRACT_SHORTLIST_LEX[`e15O_${o}`]?.every(Boolean)).toBe(true);
  });

  it("calls a reference mark not executable, in both languages", () => {
    const [en, zh] = CONTRACT_SHORTLIST_LEX.e15B_reference_mark;
    expect(en).toMatch(/not executable/i);
    expect(zh).toContain("不可成交");
    const [noQuoteEn] = CONTRACT_SHORTLIST_LEX.e15C_no_quote;
    expect(noQuoteEn).toMatch(/no live quote/i);
    const [noTermEn, noTermZh] = CONTRACT_SHORTLIST_LEX.e15C_no_term;
    expect(noTermEn).toMatch(/not assumed standard/i);
    expect(noTermZh).toContain("不假定为标准");
  });

  it("never uses the open-interest / days-to-expiry abbreviations in visible copy", () => {
    for (const [en, zh] of Object.values(CONTRACT_SHORTLIST_LEX)) {
      expect(en).not.toMatch(/\b(OI|DTE)\b/);
      expect(zh).not.toMatch(/\b(OI|DTE)\b/);
    }
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fillShortlistCopy("{n} of {max}", { n: 2, max: 4 })).toBe("2 of 4");
    expect(fillShortlistCopy("as of {d}", {})).toBe("as of {d}");
  });
});
