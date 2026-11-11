import { describe, it, expect } from "vitest";
import { WASHOUT_NOTCH, WASHOUT_MEASURED_NOTCH, retroLegendCopy,
  oracleVerdict, deskVerdict, ORACLE_STALE_DAYS, anchorSignal, signalKnownTs, SOFT_Q,
  isBlockedSignal, isOverrideCandidate, isOverrideTake, isStructureStop, sliceSignalBasis,
  washoutOverrideCopy, OVERRIDE_TAKE_QUALITY,
  isReclaimOverrideTake, isWaivedEntry, isRetroOverride, retroOverrideCopy,
  RECLAIM_OVERRIDE_TAKE_QUALITY, isBottomWatch, isStopSweepReclaim,
  markerTooltipCopy } from "../signalVerdict";

// Frozen "today" so ages are deterministic: 2026-07-14 (the NVDA/GOOGL stale-Sell incident date).
const NOW = Date.parse("2026-07-14T21:00:00Z");

type Sig = { ts: string; known_ts?: string | null; type?: string; price?: number | null; quality?: string | null; quality_reason?: string | null; scored?: boolean | null; basis?: string | null; blocked?: boolean | null; stop_level?: number | null; override_candidate?: boolean | null; override_ctx?: Record<string, unknown> | null };

function sliceOf(lastSignal: string, signals: Sig[]) {
  return { indicator: { signals, state: { last_signal: lastSignal } } };
}
function slice(lastSignal: string, ts: string, price = 100) {
  return sliceOf(lastSignal, [{ ts, type: lastSignal, price }]);
}

describe("oracleVerdict — age, dimming, provenance", () => {
  it("dates and dims a stale slice verdict (NVDA incident shape: SELL 41d old)", () => {
    const v = oracleVerdict("SELL", slice("SELL", "2026-06-03", 205.1), false, NOW);
    expect(v.raw).toBe("SELL");
    // HK-O1: a slice SELL is the ARM->CONFIRM structure break — a trailing stop on a swing-low
    // break, not the momentum cross-down. `raw` stays "SELL" (the scored lane is unchanged);
    // only the human label stopped wearing the oracle costume.
    expect(v.label).toBe("Structure stop");
    expect(v.sub).toBe("Jun 3");
    expect(v.dim).toBe(true);
    expect(v.note).toContain("@ 205.1");
    expect(v.note).toContain("timing overlay");
  });

  it("keeps a fresh signal at full strength, dated", () => {
    const v = oracleVerdict("BUY", slice("BUY", "2026-07-10"), false, NOW);
    expect(v.dim).toBe(false);
    expect(v.sub).toBe("Jul 10");
    expect(v.color).toBe("var(--buy)");
  });

  it("uses the availability date for Costco while preserving the 3D chart date", () => {
    const cost = {
      ts: "2026-07-24",
      known_ts: "2026-07-28",
      type: "BUY",
      price: 966.58,
      quality: "take",
    };
    const v = oracleVerdict(
      "BUY",
      sliceOf("BUY", [cost]),
      false,
      Date.parse("2026-07-29T21:00:00Z"),
    );
    expect(signalKnownTs(cost)).toBe("2026-07-28");
    expect(v.sub).toBe("Jul 28");
    expect(v.dim).toBe(false);
    expect(v.note).toContain("@ 966.58");
  });

  it("falls back to the chart date for legacy slices without known_ts", () => {
    expect(signalKnownTs({ ts: "2026-07-24" })).toBe("2026-07-24");
    expect(signalKnownTs({ ts: "2026-07-24", known_ts: "not-a-date" })).toBe("2026-07-24");
  });

  it("dim boundary sits at ORACLE_STALE_DAYS calendar days", () => {
    // 2026-06-23 → 21d on NOW: at the threshold, still live
    expect(oracleVerdict("BUY", slice("BUY", "2026-06-23"), false, NOW).dim).toBe(false);
    // 2026-06-22 → 22d: past it, dimmed
    expect(oracleVerdict("BUY", slice("BUY", "2026-06-22"), false, NOW).dim).toBe(true);
    expect(ORACLE_STALE_DAYS).toBe(21);
  });

  it("manifest-only verdict (no slice) renders undated and dimmed — never full-strength", () => {
    const v = oracleVerdict("SELL", null, false, NOW);
    expect(v.label).toBe("Sell");
    expect(v.sub).toBe("undated");
    expect(v.dim).toBe(true);
  });

  it("prefers the slice lane over the manifest and flags lane disagreement", () => {
    // Live incident shape: manifest inherited SELL from a dead run; slice lane says REBUY.
    const v = oracleVerdict("SELL", slice("REBUY", "2026-02-17", 187.67), false, NOW);
    expect(v.raw).toBe("REBUY");
    expect(v.dim).toBe(true); // 147d old — dated, dimmed
    expect(v.note).toContain("lanes disagree");
    expect(v.note).toContain("SELL");
  });

  it("anchors the verdict on the newest marker the engine did not refuse (pending counts)", () => {
    // A fresh pending BUY is a real, unrefused cross event — it IS the current read; the
    // old behavior hid it behind a 41d-old SELL (the stale-verdict disease this fixes).
    const v = oracleVerdict(
      "SELL",
      sliceOf("SELL", [
        { ts: "2026-06-03", type: "SELL", price: 205.1 },
        { ts: "2026-07-13", type: "BUY", price: 314.86, quality: "pending" },
      ]),
      false,
      NOW,
    );
    expect(v.raw).toBe("BUY");
    expect(v.label).toBe("Starter");
    expect(v.color).toBe("var(--signal)");
    expect(v.sub).toBe("Jul 13");
    expect(v.note).toContain("@ 314.86");
    expect(v.note).toContain("starter — awaiting confirmation");
  });

  it("a regime_blocked tail NEVER anchors as the event — a fresh one renders the amber blocked-entry caution", () => {
    // META 2026-07-15 live shape: blocked REBUY + blocked BUY after the May SELL once
    // rendered as a full-authority green "Buy · Jul 6" for a signal the engine explicitly
    // refused. Since the 600547.SS washout fix the fresh refused trigger is surfaced
    // first-class — but as an amber caution that can never read as a Buy.
    const v = oracleVerdict(
      "SELL",
      sliceOf("BUY", [
        { ts: "2026-05-04", type: "SELL", price: 612.31 },
        { ts: "2026-05-26", type: "REBUY", price: 634.7, quality: "regime_blocked" },
        { ts: "2026-07-06", type: "BUY", price: 603.12, quality: "regime_blocked", quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull" },
      ]),
      false,
      NOW,
    );
    expect(v.raw).toBe("BLOCKED_ENTRY"); // never the event type — no consumer can anchor on it
    expect(v.label).toBe("Entry trigger — regime-blocked");
    expect(v.label).not.toBe("Buy");
    expect(v.color).toBe("var(--signal)"); // amber caution rung, never green
    expect(v.soft).toBe(true);             // hollow glyph — no scored authority
    expect(v.sub).toBe("Jul 6");           // dated from the refused trigger
    expect(v.dim).toBe(false);
    expect(v.note).toContain("not an entry");
    expect(v.note).toContain("bear_block: monthly-bear & below-200 & 2W-not-bull");
    expect(v.note).toContain("@ 603.12");
    expect(v.note).toContain("last signal: Structure stop · May 4 @ 612.31");
  });

  it("a STALE regime_blocked tail keeps the old contract: never anchors, dated render from the unrefused marker", () => {
    const v = oracleVerdict(
      "SELL",
      sliceOf("BUY", [
        { ts: "2026-02-04", type: "SELL", price: 612.31 },
        { ts: "2026-04-06", type: "BUY", price: 603.12, quality: "regime_blocked" }, // 99d old at NOW
      ]),
      false,
      NOW,
    );
    expect(v.raw).toBe("SELL");
    expect(v.sub).toContain("Feb 4");
    expect(v.label).toBe("Structure stop");   // HK-O1 — the stale anchor is relabelled too
  });

  it("a fresh scored RECLAIM renders as a hollow Re-entry verdict (reclaim lane)", () => {
    // reclaim_lane promoted 2026-07-16: the marker is scored, but the glyph stays hollow
    // (the solid star is reserved for the classic confluence entries).
    const v = oracleVerdict(
      "RECLAIM",
      sliceOf("RECLAIM", [
        { ts: "2026-06-08", type: "SELL", price: 290.55 },
        { ts: "2026-07-13", type: "RECLAIM", price: 327.5, scored: true, quality: "reclaim", quality_reason: "trend reclaimed the 2026-06-08 sell level" },
      ]),
      false,
      NOW,
    );
    expect(v.label).toBe("Re-entry");
    expect(v.raw).toBe("RECLAIM");
    expect(v.color).toBe("var(--buy)");
    expect(v.soft).toBe(true);                     // hollow glyph law, scored or not
    expect(v.sub).toBe("Jul 13");
    expect(v.note).toContain("scored reclaim lane");
    expect(v.note).not.toContain("unscored");
    expect(v.note).toContain("reclaimed");
  });

  it("a legacy pre-promotion RECLAIM (scored:false) keeps the unscored annotation", () => {
    const v = oracleVerdict(
      "SELL", // the scored manifest lane still says SELL — expected, must NOT note lane disagreement
      sliceOf("RECLAIM", [
        { ts: "2026-06-08", type: "SELL", price: 290.55 },
        { ts: "2026-07-13", type: "RECLAIM", price: 327.5, scored: false, quality: "reclaim" },
      ]),
      false,
      NOW,
    );
    expect(v.label).toBe("Re-entry");
    expect(v.soft).toBe(true);
    expect(v.note).toContain("unscored");
    expect(v.note).toContain("not in the track record");
    expect(v.note).not.toContain("lanes disagree");
  });

  it("annotates engine-flagged soft signals (quality pending/block) in the tooltip", () => {
    const v = oracleVerdict(
      "BUY",
      sliceOf("BUY", [{ ts: "2026-07-13", type: "BUY", price: 314.86, quality: "pending", quality_reason: "pending confirmation" }]),
      false,
      NOW,
    );
    expect(v.label).toBe("Starter");
    expect(v.color).toBe("var(--signal)");
    expect(v.raw).toBe("BUY");             // still position-backed, never demoted to a refusal
    expect(v.soft).toBe(false);
    expect(v.blocked).toBe(false);
    expect(v.dim).toBe(false); // fresh — dimming stays age-driven; quality rides the note
    expect(v.note).toContain("starter — awaiting confirmation");
    expect(v.note).toContain("pending confirmation");
    expect(v.note).not.toContain("not an entry");
  });

  it("renders keeper block and pending with the same amber Starter authority", () => {
    for (const quality of ["block", "pending"] as const) {
      const v = oracleVerdict(
        "BUY",
        sliceOf("BUY", [{ ts: "2026-07-13", type: "BUY", price: 314.86, quality }]),
        false,
        NOW,
      );
      expect(v.label).toBe("Starter");
      expect(v.color).toBe("var(--signal)");
      expect(v.raw).toBe("BUY");
      expect(v.soft).toBe(false);
      expect(v.blocked).toBe(false);
      expect(v.note).toContain("starter —");
      expect(v.note).not.toMatch(/refused|not an entry/i);
    }
  });

  it("no verdict anywhere → em-dash, not dimmed styling noise", () => {
    const v = oracleVerdict(null, null, false, NOW);
    expect(v.label).toBe("—");
    expect(v.raw).toBeNull();
    expect(v.dim).toBe(false);
  });

  it("zh variant localizes the sub-line", () => {
    const v = oracleVerdict("SELL", slice("SELL", "2026-06-03"), true, NOW);
    expect(v.label).toBe("结构止损");        // HK-O1 — bilingual parity on the stop label
    expect(v.sub).toContain("6月");
  });
});

describe("oracleVerdict — stance-first render when the event is history", () => {
  // The five 2026-07-15 ground-truth state shapes (see docs/ORACLE_DESK_DIAGNOSIS).
  const stSlice = (state: Record<string, unknown>, signals: Sig[]) => ({ indicator: { state, signals } });

  it("AAPL shape: stale SELL + strong_bull flat state → Strong-uptrend stance, SELL demoted to a dated echo", () => {
    const v = oracleVerdict(
      "SELL",
      stSlice(
        { last_signal: "SELL", last_scored_signal: "SELL", position_hint: "flat", strong_bull: true, overbought: false, weeklyBull: true, above200: true },
        [{ ts: "2026-06-08", type: "SELL", price: 290.55 }],
      ),
      false, NOW, "UPTREND",
    );
    expect(v.stance).toBe(true);
    expect(v.label).toBe("Strong uptrend — awaiting pullback entry");
    expect(v.color).toBe("var(--up)");
    expect(v.dim).toBe(false);
    expect(v.sub).toBeNull();                              // no rendered echo — the stance IS the read
    expect(v.note).toContain("last signal: Structure stop · Jun 8"); // survives as tooltip context
    expect(v.note).toContain("not a trade signal");
  });

  it("a FRESH blocked tail takes primary over the stance; the stance demotes to tooltip context", () => {
    const v = oracleVerdict(
      "SELL",
      stSlice(
        { last_signal: "BUY", last_scored_signal: "SELL", position_hint: "flat", strong_bull: false, overbought: true, weeklyBull: true, above200: true },
        [
          { ts: "2026-05-04", type: "SELL", price: 612.31 },
          { ts: "2026-07-06", type: "BUY", price: 603.12, quality: "regime_blocked" },
        ],
      ),
      false, NOW,
    );
    expect(v.label).toBe("Entry trigger — regime-blocked");
    expect(v.color).toBe("var(--signal)");
    expect(v.soft).toBe(true);
    expect(v.note).toContain("current stance: Extended — don't chase");
    expect(v.note).toContain("not an entry");
  });

  it("a STALE blocked tail rides the stance tooltip as 'blocked — not an entry' (original contract)", () => {
    const v = oracleVerdict(
      "SELL",
      stSlice(
        { last_signal: "BUY", last_scored_signal: "SELL", position_hint: "flat", strong_bull: false, overbought: true, weeklyBull: true, above200: true },
        [
          { ts: "2026-02-04", type: "SELL", price: 612.31 },
          { ts: "2026-04-06", type: "BUY", price: 603.12, quality: "regime_blocked" }, // 99d old
        ],
      ),
      false, NOW,
    );
    expect(v.stance).toBe(true);
    expect(v.label).toBe("Extended — don't chase");
    expect(v.color).toBe("var(--warn)");              // caution: non-flipping accent
    expect(v.note).toContain("blocked — not an entry");
  });

  it("600547.SS washout shape: fresh bear_block'd BUY at the low + stale SELL + downtrend state → amber blocked-entry primary", () => {
    // The 2026-08-02 diagnosis case verbatim: the engine fired the entry trigger at the
    // washout low and vetoed it; the panel used to show only "Downtrend — stand aside".
    const v = oracleVerdict(
      "SELL",
      stSlice(
        { last_signal: "BUY", last_scored_signal: "SELL", last_scored_ts: "2026-02-05", position_hint: "flat", strong_bull: false, overbought: true, weeklyBull: false, above200: false },
        [
          { ts: "2026-02-05", type: "SELL", price: 45.55 },
          { ts: "2026-07-01", known_ts: "2026-07-03", type: "BUY", price: 25.8896, quality: "regime_blocked", quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull" },
        ],
      ),
      false, Date.parse("2026-07-15T21:00:00Z"), "DOWNTREND",
    );
    expect(v.label).toBe("Entry trigger — regime-blocked");
    expect(v.color).toBe("var(--signal)");
    expect(v.sub).toBe("Jul 3");                       // availability date, not the chart date
    expect(v.note).toContain("bear_block");
    expect(v.note).toContain("current stance: Downtrend — stand aside");
    expect(v.note).toContain("last signal: Structure stop · Feb 5 @ 45.55");
  });

  it("zh blocked-entry strings ship", () => {
    const v = oracleVerdict(
      "SELL",
      stSlice(
        { last_signal: "BUY", last_scored_signal: "SELL", position_hint: "flat", strong_bull: false, overbought: false, weeklyBull: false, above200: false },
        [
          { ts: "2026-02-05", type: "SELL", price: 45.55 },
          { ts: "2026-07-03", type: "BUY", price: 25.89, quality: "regime_blocked" },
        ],
      ),
      true, Date.parse("2026-07-15T21:00:00Z"), "DOWNTREND",
    );
    expect(v.label).toBe("买点触发 — 趋势闸拦截");
    expect(v.note).toContain("非入场信号");
    expect(v.note).toContain("当前姿态");
  });

  it("MSFT shape: flat below-200 weak state → Downtrend stance on --down", () => {
    const v = oracleVerdict(
      "SELL",
      stSlice(
        { last_signal: "SELL", last_scored_signal: "SELL", position_hint: "flat", strong_bull: false, overbought: false, weeklyBull: true, above200: false },
        [{ ts: "2026-06-08", type: "SELL", price: 403.41 }],
      ),
      false, NOW, "DOWNTREND",
    );
    expect(v.stance).toBe(true);
    expect(v.label).toBe("Downtrend — stand aside");
    expect(v.color).toBe("var(--down)");
  });

  it("long + strong_bull stale state → Hold — long bias", () => {
    const v = oracleVerdict(
      "BUY",
      stSlice(
        { last_signal: "BUY", last_scored_signal: "BUY", position_hint: "long", strong_bull: true, overbought: false, weeklyBull: true, above200: true },
        [{ ts: "2026-04-09", type: "BUY", price: 321.12 }],
      ),
      false, NOW,
    );
    expect(v.stance).toBe(true);
    expect(v.label).toBe("Hold — long bias");
    expect(v.sub).toBeNull();
    expect(v.note).toContain("last signal: Buy · Apr 9");
  });

  it("a bare {last_signal} legacy state has no regime to stand on → dated dim render, no stance", () => {
    const v = oracleVerdict("SELL", slice("SELL", "2026-06-03", 205.1), false, NOW);
    expect(v.stance).toBeUndefined();
    expect(v.dim).toBe(true);
    expect(v.label).toBe("Structure stop");   // HK-O1 — legacy slices carry no basis; the
    // slice boundary supplies it, because every SELL in that stream came from sell_confirms.
  });

  it("zh stance strings ship", () => {
    const v = oracleVerdict(
      "SELL",
      stSlice(
        { last_signal: "SELL", last_scored_signal: "SELL", position_hint: "flat", strong_bull: true, overbought: false, weeklyBull: true, above200: true },
        [{ ts: "2026-06-08", type: "SELL", price: 290.55 }],
      ),
      true, NOW, "UPTREND",
    );
    expect(v.label).toBe("强势上行 — 等回调买点");
    expect(v.note).toContain("非交易信号");
  });
});

describe("deskVerdict — entry-timing honesty mapping", () => {
  const intel = (
    lean: { dir?: string; band?: string; entry?: string; score?: number },
    asof: string | null = "2026-07-10",
    aj?: { verdict?: string },
  ) => ({
    tape: { ai_lean: lean, asof },
    cards: aj ? { ai_judgment: aj } : {},
  });

  it('band=low BEAR with a non-exit entry renders "No setup" in neutral, with the as-of date', () => {
    // Live incident shape: NVDA dir=BEAR score=9 band=low entry=bounce_wait, asof Fri 07-10.
    const v = deskVerdict(intel({ dir: "BEAR", band: "low", entry: "bounce_wait", score: 9 }), false, NOW);
    expect(v.label).toBe("No setup");
    expect(v.raw).toBe("NO_SETUP");
    expect(v.color).toBe("var(--muted)");
    expect(v.sub).toBe("as of Jul 10 · 4d");
    expect(v.note).toContain("not a short call");
    // the desk score is name_score.potential_score = dip-entry readiness — labeled honestly
    // (it is NOT conviction: MSFT scores 70 while below its 200d BECAUSE it is washed out)
    expect(v.note).toContain("dip-entry readiness 9/100");
  });

  it('band=low BEAR with a MISSING entry also renders "No setup" (upstream emits BEAR on band alone)', () => {
    const v = deskVerdict(intel({ dir: "BEAR", band: "low", score: 12 }), false, NOW);
    expect(v.label).toBe("No setup");
    expect(v.raw).toBe("NO_SETUP");
  });

  it("entry=exit / entry=topping keep the real Bearish label", () => {
    for (const entry of ["exit", "topping"]) {
      const v = deskVerdict(intel({ dir: "BEAR", band: "low", entry }), false, NOW);
      expect(v.label).toBe("Bearish");
      expect(v.color).toBe("var(--sell)");
    }
  });

  it("legacy BEAR without band/entry fields stays Bearish (no unsupported softening)", () => {
    const v = deskVerdict(intel({ dir: "BEAR" }), false, NOW);
    expect(v.label).toBe("Bearish");
    expect(v.raw).toBe("BEAR");
  });

  it("withholds an expired legacy research snapshot and retains an eligible read", () => {
    // 43 days old — would only ship if the intel cron stalled; must not render full-strength.
    const stale = deskVerdict(intel({ dir: "BEAR", band: "low", entry: "bounce_wait" }, "2026-06-01"), false, NOW);
    expect(stale.label).toBe("No current reading");
    expect(stale.dim).toBe(true);
    expect(deskVerdict(intel({ dir: "BEAR" }, "2026-07-09"), false, NOW).raw).toBeNull();
    const fresh = deskVerdict(intel({ dir: "BULL", band: "high", entry: "buy_now" }, "2026-07-13"), false, NOW);
    expect(fresh.dim).toBe(false);
  });

  it("preserves explicit direction, including a reported neutral and a zero score", () => {
    expect(deskVerdict(intel({ dir: "BULL", band: "high", entry: "buy_now" }), false, NOW).label).toBe("Bullish");
    expect(deskVerdict(intel({ dir: "NEUTRAL", score: 0 }), false, NOW)).toMatchObject({ label: "Neutral", raw: "NEUTRAL", dim: false });
    expect(deskVerdict(intel({ entry: "wait_pullback" }), false, NOW)).toMatchObject({ label: "Wait for pullback", raw: "POSTURE" });
    expect(deskVerdict(intel({ dir: "NEUTRAL", band: "", entry: "wait_pullback" }), false, NOW).label).toBe("Wait for pullback");
  });

  it.each([null, { tape: {} }, intel({ dir: "UNKNOWN" }), intel({ dir: "BULL" }, null),
    intel({ dir: "BULL" }, "2026-07-15"), intel({ dir: "BULL" }, "2026-02-30"),
    { tape: { asof: "2026-07-10", stale: true, ai_lean: { dir: "BULL" } } },
    { tape: { asof: "2026-07-10", ai_lean: { abstain: true, dir: "NEUTRAL" } } },
    { tape: { asof: "2026-07-10", ai_lean: { dir: "NEUTRAL", band: null, entry: null } } },
    intel({ dir: "NEUTRAL", band: "", entry: "buy_now" }),
    intel({ entry: "buy_now" }),
  ])("withholds a current reading for missing, unqualified or abstained data", source => {
    expect(deskVerdict(source, false, NOW)).toMatchObject({ label: "No current reading", raw: null, dim: true });
    expect(deskVerdict(source, true, NOW).label).toBe("暂无当前判断");
  });

  it("expires a saved reading on the producer's first ineligible calendar day", () => {
    const source = { tape: { asof: "2026-07-01T19:30:00Z", stale: false, ai_lean: { dir: "BULL", max_age_days: 3 } } };
    expect(deskVerdict(source, false, Date.parse("2026-07-03T23:59:59Z")).raw).toBe("BULL");
    expect(deskVerdict(source, false, Date.parse("2026-07-04T00:00:00Z"))).toMatchObject({ raw: null, dim: true });
    expect(deskVerdict({ tape: { ...source.tape, ai_lean: { dir: "BULL", max_age_days: "3" } } }, false, NOW).raw).toBeNull();
  });

  it("NEUTRAL with a known entry posture renders the posture, not a blank Neutral", () => {
    // The five 2026-07-13 Mag7 leans all read dir=NEUTRAL band=neutral — an entry-timing
    // read the old card rendered as an opinion-shaped "Neutral".
    const cases: Array<[string, string]> = [
      ["await_confluence", "Awaiting confluence"],
      ["wait_pullback", "Wait for pullback"],
      ["bounce_wait", "Bounce unconfirmed — wait"],
    ];
    for (const [entry, label] of cases) {
      const v = deskVerdict(intel({ dir: "NEUTRAL", band: "neutral", entry, score: 42 }), false, NOW);
      expect(v.label).toBe(label);
      expect(v.color).toBe("var(--signal)");
      expect(v.raw).toBe("NEUTRAL");
      expect(v.note).toContain("entry-timing read");
      expect(v.note).toContain("dip-entry readiness 42/100");
    }
    // unknown entry vocab still falls through to Neutral (no invented posture)
    expect(deskVerdict(intel({ dir: "NEUTRAL", band: "neutral", entry: "mystery" }), false, NOW).label).toBe("Neutral");
    // zh posture
    expect(deskVerdict(intel({ dir: "NEUTRAL", band: "neutral", entry: "await_confluence" }), true, NOW).label).toBe("等待共振触发");
  });

  it("flags sources-disagree when ai_judgment reads constructive under a real BEAR", () => {
    const v = deskVerdict(
      intel({ dir: "BEAR", band: "low", entry: "exit" }, "2026-07-10", { verdict: "Constructive — building a base" }),
      false,
      NOW,
    );
    expect(v.label).toBe("Bearish");
    expect(v.note).toContain("sources disagree");
  });

  it('zh "No setup" variant', () => {
    const v = deskVerdict(intel({ dir: "BEAR", band: "low", entry: "bounce_wait", score: 8 }), true, NOW);
    expect(v.label).toBe("无买点");
    expect(v.sub).toContain("数据截至");
  });
});

describe("anchorSignal — the shared scored-lane anchor rule", () => {
  const sigs: Sig[] = [
    { ts: "2026-06-01", type: "BUY", quality: "take" },
    { ts: "2026-06-20", type: "SELL", quality: "take" },
    { ts: "2026-07-01", type: "BUY", quality: "regime_blocked" },
    { ts: "2026-07-10", type: "BUY", quality: "regime_blocked" },
  ];

  it("anchors on the newest unrefused signal and reports the newest refused tail", () => {
    const { anchor, blockedTail } = anchorSignal(sigs);
    expect(anchor?.ts).toBe("2026-06-20");
    expect(blockedTail?.ts).toBe("2026-07-10");
  });

  it("maxTs bounds the scan (replay: a future signal never anchors)", () => {
    expect(anchorSignal(sigs, "2026-06-10").anchor?.ts).toBe("2026-06-01");
    // blocked markers past the bound don't surface as a tail either
    expect(anchorSignal(sigs, "2026-06-30").blockedTail).toBe(null);
  });

  it("skips undated / typeless entries and handles missing input", () => {
    expect(anchorSignal([{ ts: "2026-07-01" }, { type: "BUY" } as Sig]).anchor).toBe(null);
    expect(anchorSignal(null).anchor).toBe(null);
    expect(anchorSignal([]).blockedTail).toBe(null);
  });

  it("all-refused history yields no anchor (chip renders — / rail falls back)", () => {
    const { anchor, blockedTail } = anchorSignal(sigs.slice(2));
    expect(anchor).toBe(null);
    expect(blockedTail?.ts).toBe("2026-07-10");
  });

  it("SOFT_Q stays the engine's three soft qualities (renderSignals + oracleVerdict share it)", () => {
    expect([...SOFT_Q].sort()).toEqual(["block", "pending", "regime_blocked"]);
  });
});

// ── the fresh-anchor asymmetry (operator report 2026-08-05) ────────────────────────────────
// 601696.SS rendered "Entry trigger — regime-blocked" while 300363.SZ, in the same engine
// state (flat, entries refused by the regime gate), rendered a plain "Sell". The only
// difference was the age of the older sell: a stale anchor let the caution branch speak, a
// fresh one returned before it could. A refused entry NEWER than the anchor is now disclosed
// either way — as the primary read when the anchor is stale, on the sub-line when it is not.
describe("oracleVerdict — a live blocked entry is disclosed under a fresh anchor too", () => {
  const blocked = { ts: "2026-07-10", type: "BUY", price: 11.83, quality: "regime_blocked",
                    quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull" };

  it("rides on the sub-line when a FRESH sell anchors the card", () => {
    // sell 6d old (fresh) with a refused entry 4d later — the case that used to vanish
    const v = oracleVerdict("SELL", sliceOf("SELL", [
      { ts: "2026-07-06", type: "SELL", price: 11.88 },
      blocked,
    ]), false, NOW);
    expect(v.raw).toBe("SELL");                 // the scored truth still anchors the card
    expect(v.label).toBe("Structure stop");     // …and names the machine that produced it
    expect(v.blocked).toBe(true);
    expect(v.sub).toContain("Jul 6");           // anchor date kept
    expect(v.sub).toContain("entry blocked");   // …and the refusal rides with it
    expect(v.sub).toContain("Jul 10");
    expect(v.note).toContain("blocked by the regime gate — not an entry");
    expect(v.note).toContain("bear_block");
  });

  it("is the PRIMARY read when the anchor is stale — unchanged contract", () => {
    const v = oracleVerdict("SELL", sliceOf("SELL", [
      { ts: "2026-05-20", type: "SELL", price: 11.88 },   // 55d — stale
      blocked,
    ]), false, NOW);
    expect(v.raw).toBe("BLOCKED_ENTRY");
    expect(v.label).toBe("Entry trigger — regime-blocked");
    expect(v.blocked).toBe(true);
    expect(v.sub).toBe("Jul 10");
  });

  it("says nothing when the refusal is itself stale — no invented caution", () => {
    const v = oracleVerdict("SELL", sliceOf("SELL", [
      { ts: "2026-07-08", type: "SELL", price: 15.87 },
      { ts: "2026-05-01", type: "BUY", price: 15.76, quality: "regime_blocked" },  // older than the anchor
    ]), false, NOW);
    expect(v.raw).toBe("SELL");
    expect(v.blocked).toBeFalsy();
    expect(v.sub).toBe("Jul 8");
  });

  it("never lets a refused SELL masquerade as a blocked entry", () => {
    const v = oracleVerdict("BUY", sliceOf("BUY", [
      { ts: "2026-07-06", type: "BUY", price: 10 },
      { ts: "2026-07-10", type: "SELL", price: 11, quality: "regime_blocked" },
    ]), false, NOW);
    expect(v.blocked).toBeFalsy();
    expect(v.sub).toBe("Jul 6");
  });

  it("carries the disclosure in Chinese too", () => {
    const v = oracleVerdict("SELL", sliceOf("SELL", [
      { ts: "2026-07-06", type: "SELL", price: 11.88 },
      blocked,
    ]), true, NOW);
    expect(v.blocked).toBe(true);
    expect(v.sub).toContain("入场被拦截");
    expect(v.note).toContain("被趋势闸拦截");
  });
});

// ── HK-O1: truth in labeling ────────────────────────────────────────────────────
// Receipt: Macro Dashboard research/prophet_us_audit/HK_ORACLE_FORENSIC_2026-08-08.md.
// The emitter says WHAT a marker is (basis / blocked); these readers are what stops the
// three surfaces (chart glyph, rail card, signal history) from labelling it three ways.
describe("HK-O1 — a structure stop is labelled as one", () => {
  it("isStructureStop is STRICT on basis so the client-Pine fallback keeps its momentum SELL", () => {
    expect(isStructureStop({ type: "SELL", basis: "structure_stop" })).toBe(true);
    // ChartPanel.oracleSignals emits a genuinely momentum-sourced SELL with no basis —
    // guessing "stop" from a bare marker would relabel a real momentum cross.
    expect(isStructureStop({ type: "SELL" })).toBe(false);
    expect(isStructureStop({ type: "BUY", basis: "structure_stop" })).toBe(false);
    expect(isStructureStop(null)).toBe(false);
  });

  it("sliceSignalBasis supplies the legacy default only at the slice boundary, SELL-only", () => {
    expect(sliceSignalBasis({ type: "SELL", basis: "structure_stop" })).toBe("structure_stop");
    // pre-2026-08-08 slices carry no basis; every SELL there came from v2 sell_confirms too
    expect(sliceSignalBasis({ type: "SELL" })).toBe("structure_stop");
    // basis is SELL-only — a default on an entry would be a claim nobody made
    expect(sliceSignalBasis({ type: "BUY" })).toBeUndefined();
    expect(sliceSignalBasis({ type: "RECLAIM" })).toBeUndefined();
  });

  it("names the swing-low mechanic (and the level) in the note, EN and zh", () => {
    const sig: Sig = { ts: "2026-07-22", type: "SELL", price: 440.6, basis: "structure_stop", stop_level: 456.2 };
    const en = oracleVerdict("SELL", sliceOf("SELL", [sig]), false, Date.parse("2026-07-24T00:00:00Z"));
    expect(en.label).toBe("Structure stop");
    expect(en.raw).toBe("SELL");                       // the scored lane is untouched
    expect(en.note).toContain("trailing stop");
    expect(en.note).toContain("swing low at 456.2");
    expect(en.note).toContain("not a momentum exit");
    const zh = oracleVerdict("SELL", sliceOf("SELL", [sig]), true, Date.parse("2026-07-24T00:00:00Z"));
    expect(zh.label).toBe("结构止损");
    expect(zh.note).toContain("跟踪止损");
    expect(zh.note).toContain("前低 456.2");
    expect(zh.note).toContain("非动量离场");
  });

  it("0700.HK 2026-07-24 shape: the pill no longer reads as an oracle-momentum call", () => {
    // The operator's complaint: a red "GOLDEN ORACLE · SELL" while the 3D RSI-MACD read bull.
    const v = oracleVerdict("SELL", sliceOf("SELL", [
      { ts: "2026-07-22", type: "SELL", price: 440.6, basis: "structure_stop", stop_level: 456.2 },
    ]), false, Date.parse("2026-07-24T00:00:00Z"));
    expect(v.label).not.toBe("Sell");
    expect(v.label).toBe("Structure stop");
  });

  it("carries the basis from state.last_scored_basis when the anchor is gone", () => {
    // manifest-only / signal-less slice: the state block still records WHY the lane is flat
    const v = oracleVerdict("SELL", {
      indicator: { signals: [], state: { last_signal: "SELL", last_scored_signal: "SELL", last_scored_basis: "structure_stop" } },
    }, false, NOW);
    expect(v.label).toBe("Structure stop");
  });
});

describe("HK-O1 — a refused entry never wears buy geometry", () => {
  const blockedFlagOnly: Sig = { ts: "2026-07-09", type: "BUY", price: 110.7, blocked: true };
  const blockedLegacy: Sig = { ts: "2026-07-09", type: "BUY", price: 110.7, quality: "regime_blocked" };

  it("isBlockedSignal reads the flag OR the legacy quality string", () => {
    expect(isBlockedSignal(blockedFlagOnly)).toBe(true);   // 2026-08-08+ slices
    expect(isBlockedSignal(blockedLegacy)).toBe(true);     // pre-2026-08-08 slices
    expect(isBlockedSignal({ quality: "take" })).toBe(false);
    expect(isBlockedSignal({})).toBe(false);   // an ordinary entry carries neither key
    expect(isBlockedSignal(null)).toBe(false);
  });

  it("the type field is UNCHANGED — the flag, not the type, is the render key", () => {
    // additive-only: every pre-existing reader still sees a BUY here
    expect(blockedFlagOnly.type).toBe("BUY");
  });

  it("anchorSignal refuses a blocked marker on the FLAG alone (no quality string present)", () => {
    // 9988.HK: the Jul-9 entry the operator chased was regime-vetoed. It must never anchor.
    const { anchor, blockedTail } = anchorSignal([
      { ts: "2026-05-27", type: "SELL", quality: null },
      blockedFlagOnly,
    ]);
    expect(anchor?.type).toBe("SELL");
    expect(blockedTail?.ts).toBe("2026-07-09");
  });

  it("a blocked BUY never renders a Buy verdict — it renders the refusal", () => {
    const v = oracleVerdict("BUY", sliceOf("BUY", [blockedFlagOnly]), false, Date.parse("2026-07-13T00:00:00Z"));
    expect(v.raw).toBe("BLOCKED_ENTRY");
    expect(v.blocked).toBe(true);
    expect(v.label).toBe("Entry trigger — regime-blocked");
    expect(v.color).not.toBe("var(--buy)");
  });
});

describe("HK-O1 — the two `extended`s stay apart", () => {
  it("the 'Extended — don't chase' caution rides overbought, never the strong_bull alias", () => {
    const st = (o: Record<string, unknown>) => ({ indicator: { signals: [], state: { last_signal: "SELL", ...o } } });
    // strong_bull true (so `extended` is true) but NOT overbought → must NOT read "don't chase"
    const strong = oracleVerdict("SELL", st({ position_hint: "flat", strong_bull: true, extended: true, overbought: false, above200: true, weeklyBull: true }), false, NOW);
    expect(strong.stance).toBe(true);
    expect(strong.label).not.toContain("don't chase");
    // overbought true → the caution fires, on its own field
    const hot = oracleVerdict("SELL", st({ position_hint: "flat", strong_bull: false, extended: false, overbought: true, above200: true, weeklyBull: true }), false, NOW);
    expect(hot.label).toBe("Extended — don't chase");
    expect(oracleVerdict("SELL", st({ position_hint: "flat", strong_bull: false, extended: false, overbought: true, above200: true, weeklyBull: true }), true, NOW).label)
      .toBe("过热 — 勿追高");
  });
});

// ── washout override candidate (ratified 2026-08-10, 25% notch) ────────────────────────────
// Receipts: Macro Dashboard research/BLOCKED_ENTRY_RATIFICATION_PACKET_2026-08-10.md §2/§4 +
// research/BLOCKED_ENTRY_CONDITIONAL_PREREG.md §5/§7. Production-feed re-grade reproduced the
// premium. DISPLAY TIER ONLY — the entry mask is unchanged, and every assertion below is about
// how a refusal LOOKS, never about what the engine did.
describe("washout override candidate — the display class on a refusal", () => {
  const NOW2 = Date.parse("2026-08-10T21:00:00Z");
  const stSlice = (state: Record<string, unknown>, signals: Sig[]) => ({ indicator: { state, signals } });
  const CTX = {
    group_id: "uranium_miners", peer_dd: -0.388, basis: "basket",
    thresholds_hit: [20, 25, 30], as_of: "2026-08-10",
    name: "Uranium miners", name_zh: "铀矿商",
  };
  const uecState = {
    last_signal: "BUY", last_scored_signal: "SELL", last_scored_ts: "2026-05-12",
    position_hint: "flat", strong_bull: false, overbought: false, weeklyBull: false, above200: false,
  };
  const fire = (over: Partial<Sig> = {}): Sig => ({
    ts: "2026-08-03", known_ts: "2026-08-03", type: "BUY", price: 10.5,
    quality: "regime_blocked", blocked: true,
    quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull",
    override_candidate: true, override_ctx: CTX, ...over,
  });
  const verdict = (over: Partial<Sig> = {}, zh = false) => oracleVerdict(
    "SELL",
    stSlice(uecState, [{ ts: "2026-05-12", type: "SELL", price: 14.2 }, fire(over)]),
    zh, NOW2, "DOWNTREND",
  );

  it("keeps the amber blocked-entry card and adds ONE disclosure line (UEC 2026-08-03 shape)", () => {
    const v = verdict();
    expect(v.label).toBe("Entry trigger — regime-blocked");   // the card is unchanged
    expect(v.color).toBe("var(--signal)");
    expect(v.blocked).toBe(true);
    expect(v.overrideCandidate).toBe(true);
    expect(v.line2).toBe("Washout override candidate — Uranium miners −38% from highs");
  });

  it("the Tier-2 hover carries the plain-word numbers AND leads with 'still refused'", () => {
    const note = verdict().note ?? "";
    expect(note).toContain("still a refused entry");
    expect(note).toContain("not a green light");
    expectMeasuredLine(note, "averaged +22% per trade vs +3% otherwise");
    expectMeasuredLine(note, "2019-2026, stop always honored");
    expect(note).toContain("most still stop out — the stop is the protection");
  });

  it("zh ships the whole disclosure, not an English-shaped translation", () => {
    const v = verdict({}, true);
    expect(v.label).toBe("买点触发 — 趋势闸拦截");
    expect(v.line2).toBe("深度洗盘例外候选 — 铀矿商板块距高点 −38%");
    const note = v.note ?? "";
    expect(note).toContain("仍是被拦截的入场");
    expectMeasuredLine(note, "每笔平均 +22%");
    expect(note).toContain("止损才是保护");
    // no untranslated English clause left behind IN THE NEW COPY (the engine's own
    // `quality_reason` string rides the note in both languages — pre-existing contract)
    for (const cell of washoutOverrideCopy(CTX, true)!.notes) expect(cell).not.toMatch(/[a-z]{4,}/);
    expect(washoutOverrideCopy(CTX, true)!.line).not.toMatch(/[a-z]{4,}/);
  });

  it("a plain regime_blocked fire renders EXACTLY as before — no line, no flag", () => {
    const v = verdict({ override_candidate: undefined, override_ctx: undefined });
    expect(v.label).toBe("Entry trigger — regime-blocked");
    expect(v.line2).toBeNull();
    expect(v.overrideCandidate).toBe(false);
    expect(v.note).not.toContain("washout");
    expect(v.note).not.toContain("+22%");
  });

  it("a keeper `block` is a DIFFERENT refusal and can never reach this class", () => {
    // HL 2026-06-16/06-25 shape: keeper block ("counter-trend, no 200-reclaim/hold"), outside
    // the studied cohort even though silver_miners qualifies at every threshold. The emitter
    // is what enforces this; the client must not resurrect it from quality/ctx alone.
    expect(isOverrideCandidate({ quality: "block", override_ctx: CTX } as never)).toBe(false);
    expect(isBlockedSignal({ quality: "block" })).toBe(false);
    const v = oracleVerdict("SELL", stSlice(uecState, [
      { ts: "2026-06-16", known_ts: "2026-06-16", type: "BUY", price: 6.1,
        quality: "block", quality_reason: "counter-trend, no 200-reclaim/hold" },
    ]), false, NOW2, "DOWNTREND");
    expect(v.overrideCandidate).toBeFalsy();
    expect(v.line2).toBeFalsy();
  });

  it("the flag alone is the key — a truthy-but-not-true value does not promote", () => {
    expect(isOverrideCandidate({ override_candidate: 1 } as never)).toBe(false);
    expect(isOverrideCandidate(null)).toBe(false);
    expect(isOverrideCandidate({})).toBe(false);
    expect(isOverrideCandidate({ override_candidate: true })).toBe(true);
  });

  it("degrades to the honest short form when the artifact shipped no basket name", () => {
    expect(washoutOverrideCopy({ peer_dd: -0.31 }, false)!.line)
      .toBe("Washout override candidate — peer group −31% from highs");
    expect(washoutOverrideCopy({ name: "Silver miners" }, false)!.line)
      .toBe("Washout override candidate — Silver miners");
    expect(washoutOverrideCopy({}, false)!.line).toBe("Washout override candidate");
    // zh falls back to the EN basket name rather than printing a raw slug
    expect(washoutOverrideCopy({ name: "Silver miners", peer_dd: -0.4 }, true)!.line)
      .toBe("深度洗盘例外候选 — Silver miners板块距高点 −40%");
  });

  it("the drawdown figure truncates toward zero — never overstates the washout", () => {
    expect(washoutOverrideCopy({ peer_dd: -0.388 }, false)!.line).toContain("−38%");
    expect(washoutOverrideCopy({ peer_dd: -0.2599 }, false)!.line).toContain("−25%");
    expect(washoutOverrideCopy({ peer_dd: 0.388 }, false)!.line).toContain("−38%");  // sign-agnostic
    expect(washoutOverrideCopy({ peer_dd: 0 }, false)!.line).toBe("Washout override candidate");
    expect(washoutOverrideCopy({ peer_dd: Number.NaN }, false)!.line).toBe("Washout override candidate");
  });

  it("carries no banned vocabulary in either language", () => {
    // Same list the washout-turn surface is held to (lib/__tests__/washoutTurn.test.ts):
    // no authority words, no refutation language, no trade verbs on a glance surface.
    const BANNED = [
      "validated", "证伪", "falsifier", "falsif", "refuted", "refut",
      "buy now", "act now", "buy", "sell", "target",
    ];
    for (const zh of [false, true]) {
      const copy = washoutOverrideCopy(CTX, zh)!;
      for (const cell of [copy.line, ...copy.notes]) {
        const low = cell.toLowerCase();
        for (const bad of BANNED) expect(low, `${cell} contains ${bad}`).not.toContain(bad);
      }
    }
  });
});

// ── washout override ENTRY (signal era gc_v2_wo1) ──────────────────────────────────────────
// Receipts: Macro Dashboard research/BLOCKED_ENTRY_CONDITIONAL_PREREG.md §5 (RATIFIED at the
// 25% notch, GATE B PASSED) + research/BLOCKED_ENTRY_RATIFICATION_PACKET_2026-08-10.md §2/§4.
// The other side of the mechanism above: since the era fence a qualifying bear_block-vetoed
// fire is TAKEN, and arrives with quality:"override_take". Every assertion here is about the
// difference between an entry and a decorated refusal — the two must never render alike.
describe("washout override entry — the taken class", () => {
  const NOW3 = Date.parse("2026-08-10T21:00:00Z");
  const stSlice = (state: Record<string, unknown>, signals: Sig[]) => ({ indicator: { state, signals } });
  const CTX = {
    group_id: "uranium_miners", peer_dd: -0.388, basis: "basket",
    thresholds_hit: [20, 25, 30], as_of: "2026-08-10",
    name: "Uranium miners", name_zh: "铀矿商",
  };
  const state = {
    last_signal: "BUY", last_scored_signal: "BUY", last_scored_ts: "2026-08-03",
    position_hint: "long", strong_bull: false, overbought: false, weeklyBull: false, above200: false,
  };
  const taken = (over: Partial<Sig> = {}): Sig => ({
    ts: "2026-08-03", known_ts: "2026-08-03", type: "BUY", price: 10.5,
    quality: OVERRIDE_TAKE_QUALITY,
    quality_reason: "washout override: uranium_miners −38.8% ≤ −25% (era gc_v2_wo1)",
    override_ctx: CTX, ...over,
  });
  const verdict = (over: Partial<Sig> = {}, zh = false) => oracleVerdict(
    "BUY", stSlice(state, [{ ts: "2026-05-12", type: "SELL", price: 14.2 }, taken(over)]),
    zh, NOW3, "DOWNTREND",
  );

  it("renders as an ORDINARY entry — the mask took it, so the card says what it took", () => {
    const v = verdict();
    expect(v.label).toBe("Buy");              // the existing entry verdict language
    expect(v.color).toBe("var(--buy)");
    expect(v.raw).toBe("BUY");
    expect(v.blocked).toBeFalsy();            // it is not a refusal
    expect(v.soft).toBe(false);               // and not a subordinate marker
    expect(v.stance).toBeFalsy();
    expect(v.dim).toBe(false);
  });

  it("carries the washout disclosure on the SAME line the refused class uses", () => {
    const v = verdict();
    expect(v.overrideTake).toBe(true);
    expect(v.overrideCandidate).toBeFalsy();  // the two classes are mutually exclusive
    expect(v.line2).toBe("Washout override entry — Uranium miners −38% from highs");
  });

  it("the hover leads with what was overridden, then the numbers and the stop", () => {
    const note = verdict().note ?? "";
    expect(note).toContain("the regime gate would refuse this");
    expect(note).toContain("the deep group washout is the one reason it stands");
    expectMeasuredLine(note, "averaged +22% per trade vs +3% otherwise");
    expect(note).toContain("most still stop out — the stop is the protection");
    // it never claims the refusal is still standing — that is the OTHER class's lead
    expect(note).not.toContain("still a refused entry");
  });

  it("zh ships the whole disclosure, not an English-shaped translation", () => {
    const v = verdict({}, true);
    expect(v.label).toBe("买入");
    expect(v.line2).toBe("深度洗盘例外入场 — 铀矿商板块距高点 −38%");
    const note = v.note ?? "";
    expect(note).toContain("趋势闸本会拦截");
    expectMeasuredLine(note, "每笔平均 +22%");
    expect(note).toContain("止损才是保护");
    const copy = washoutOverrideCopy(CTX, true, true)!;
    for (const cell of copy.notes) expect(cell).not.toMatch(/[a-z]{4,}/);
    expect(copy.line).not.toMatch(/[a-z]{4,}/);
  });

  it("anchors the verdict and is never softened", () => {
    // the refused class can NEVER anchor (isBlockedSignal); this one always can
    expect(isBlockedSignal(taken())).toBe(false);
    expect(SOFT_Q.has(OVERRIDE_TAKE_QUALITY)).toBe(false);
    const { anchor, blockedTail } = anchorSignal([{ ts: "2026-05-12", type: "SELL" }, taken()]);
    expect(anchor?.quality).toBe(OVERRIDE_TAKE_QUALITY);
    expect(blockedTail).toBeNull();
  });

  it("is strict on the emitter's string — the client re-derives nothing", () => {
    expect(isOverrideTake(taken())).toBe(true);
    expect(isOverrideTake({ quality: "OVERRIDE_TAKE" })).toBe(true);   // case-insensitive
    expect(isOverrideTake({ quality: "take" })).toBe(false);
    expect(isOverrideTake({ quality: "regime_blocked", override_ctx: CTX } as never)).toBe(false);
    expect(isOverrideTake({ override_candidate: true } as never)).toBe(false);
    expect(isOverrideTake(null)).toBe(false);
    expect(isOverrideTake({})).toBe(false);
    // and a taken fire is not a candidate — one mechanism, two states, never both at once
    expect(isOverrideCandidate(taken())).toBe(false);
  });

  it("an ordinary keeper `take` gains no disclosure line", () => {
    const v = verdict({ quality: "take", quality_reason: "held confirmation", override_ctx: null });
    expect(v.label).toBe("Buy");
    expect(v.overrideTake).toBe(false);
    expect(v.line2).toBeNull();
    expect(v.note).not.toContain("washout");
  });

  it("the candidate copy is untouched — the default is still the refusal shape", () => {
    expect(washoutOverrideCopy(CTX, false)!.line)
      .toBe("Washout override candidate — Uranium miners −38% from highs");
    expect(washoutOverrideCopy(CTX, false, false)!.notes[0]).toContain("still a refused entry");
    expect(washoutOverrideCopy(CTX, false, true)!.notes[0]).toContain("would refuse this");
    // the two shapes share their evidence — only the lead clause differs
    expect(washoutOverrideCopy(CTX, false, true)!.notes.slice(1))
      .toEqual(washoutOverrideCopy(CTX, false, false)!.notes.slice(1));
  });

  it("degrades to the honest short form when the artifact shipped no basket name", () => {
    expect(washoutOverrideCopy({ peer_dd: -0.31 }, false, true)!.line)
      .toBe("Washout override entry — peer group −31% from highs");
    expect(washoutOverrideCopy({}, false, true)!.line).toBe("Washout override entry");
    expect(washoutOverrideCopy({ name: "Silver miners", peer_dd: -0.4 }, true, true)!.line)
      .toBe("深度洗盘例外入场 — Silver miners板块距高点 −40%");
  });

  it("carries no banned vocabulary in either language", () => {
    const BANNED = [
      "validated", "证伪", "falsifier", "falsif", "refuted", "refut",
      "buy now", "act now", "buy", "sell", "target",
    ];
    for (const zh of [false, true]) {
      const copy = washoutOverrideCopy(CTX, zh, true)!;
      for (const cell of [copy.line, ...copy.notes]) {
        const low = cell.toLowerCase();
        for (const bad of BANNED) expect(low, `${cell} contains ${bad}`).not.toContain(bad);
      }
    }
  });
});

/** The published per-trade figures are a MEASUREMENT AT A NOTCH (blocked-entry packet
 *  §2/§3.5, cut at 25%), not a property of the rule. The live notch is an operator dial.
 *  While the two differ the copy must stay silent rather than attach a 25%-notch result to
 *  whatever notch is live — so these assertions follow the same rule the copy does, and the
 *  test below pins the rule itself so silence can never become the accident nobody noticed. */
function expectMeasuredLine(note: string | null | undefined, fragment: string) {
  if (WASHOUT_NOTCH === WASHOUT_MEASURED_NOTCH) expect(note).toContain(fragment);
  else expect(note).not.toContain(fragment);
}

it("the measured per-trade figures print only at the notch they were measured at", () => {
  const notes = washoutOverrideCopy(
    { group_id: "g", peer_dd: -0.4, name: "G" }, false, true,
  )!.notes.join(" · ");
  // the notch the figures were RE-GRADED at for this build (receipt: macro repo
  // research/blocked_entry_study/regrade_receipts.json, gate_table["20"].B_PROD)
  expect(WASHOUT_MEASURED_NOTCH).toBe(20);
  if (WASHOUT_NOTCH === WASHOUT_MEASURED_NOTCH) expect(notes).toContain("+22%");
  else expect(notes).not.toContain("+22%");
  // whatever the dial, the qualitative protection line always survives
  expect(notes).toContain("most still stop out");
});

// ── shared fixtures for the two new classes (era gc_v2_wo2 + the retro projection) ─────────
const WO2_NOW = Date.parse("2026-08-10T21:00:00Z");
const WO2_CTX = {
  group_id: "uranium_miners", peer_dd: -0.388, basis: "basket",
  thresholds_hit: [20, 25, 30], as_of: "2026-08-10",
  name: "Uranium miners", name_zh: "铀矿商",
};
/** The ZH RECLAIM copy is mid-correction («回补» reads as short-covering, not the 200-day
 *  reclaim), so its wording is asserted STRUCTURALLY — the head is distinct from both washout
 *  heads, the lead names the keeper's two legs, and neither carries stray Latin — while the EN
 *  strings, which are final, stay pinned verbatim. What must not drift is the SHAPE of the
 *  disclosure; the exact Chinese noun for "the 200-day reclaim" is a copy edit, not a contract.
 *  Matches "200 日线" and "200日线" alike, because the spacing is part of that same edit. */
const ZH_RECLAIM_LEG = /200\s*日线/;
/** the retro mark writes ONLY its two display fields — everything else is the refusal it was
 *  (`tier`/`score` ride along so the fixture can assert they stayed null, which is the shape
 *  of "the recipe never graded this fire") */
type RetroSig = Sig & {
  tier?: string | null;
  score?: number | null;
  retro_override?: boolean | null;
  retro_ctx?: { group_id?: string | null; name?: string | null; name_zh?: string | null } | null;
};
const wo2Slice = (state: Record<string, unknown>, signals: RetroSig[]) => ({ indicator: { state, signals } });

// ── the RECLAIM WAIVER: the keeper's waived entry (signal era gc_v2_wo2, Arm T) ────────────
// Receipts: Macro Dashboard research/BLOCKED_ENTRY_CONDITIONAL_PREREG.md §5 (the reclaim leg)
// + signal_layer/washout_override.RECLAIM_OVERRIDE_TAKE_QUALITY.
//
// WHY THIS BLOCK EXISTS. A second waived class is the exact shape of bug that ships silently:
// every surface already knew how to render ONE waived entry, so a sibling string that nobody
// taught them about renders as a plain grey nothing — no disclosure line, no amber, a real
// entry the reader is never told fired against a refusal. The properties pinned here are the
// two that keep the classes honest in opposite directions: `isWaivedEntry` must cover BOTH
// (so the render key never has to know which), and the two strings must stay DISTINCT (so the
// two forward ledgers can never grade each other's trades). Everything else — anchoring, the
// absence from SOFT_Q, the ordinary entry label — is the claim that a waived entry is an
// ENTRY, which is the thing a reader is entitled to see without hovering.
describe("reclaim waiver — the keeper's waived entry is a real entry, and its own rule", () => {
  const state = {
    last_signal: "BUY", last_scored_signal: "BUY", last_scored_ts: "2026-08-03",
    position_hint: "long", strong_bull: false, overbought: false, weeklyBull: false, above200: false,
  };
  const waived = (over: Partial<Sig> = {}): Sig => ({
    ts: "2026-08-03", known_ts: "2026-08-03", type: "BUY", price: 10.5,
    quality: RECLAIM_OVERRIDE_TAKE_QUALITY, tier: "quality", score: 71,
    quality_reason: "reclaim waived: uranium_miners −38.8% ≤ −25% (era gc_v2_wo2)",
    override_ctx: WO2_CTX, ...over,
  } as Sig);
  const verdict = (over: Partial<Sig> = {}, zh = false) => oracleVerdict(
    "BUY", wo2Slice(state, [{ ts: "2026-05-12", type: "SELL", price: 14.2 }, waived(over)]),
    zh, WO2_NOW, "DOWNTREND",
  );

  it("is STRICT on its own emitter string — the sibling take class is not this class", () => {
    expect(isReclaimOverrideTake(waived())).toBe(true);
    expect(isReclaimOverrideTake({ quality: "RECLAIM_OVERRIDE_TAKE" })).toBe(true);  // case-insensitive
    // the sibling: same behaviour on every surface, DIFFERENT rule and different ledger
    expect(isReclaimOverrideTake({ quality: OVERRIDE_TAKE_QUALITY })).toBe(false);
    expect(isReclaimOverrideTake({ quality: "block" })).toBe(false);
    expect(isReclaimOverrideTake({ quality: "regime_blocked" })).toBe(false);
    expect(isReclaimOverrideTake({ quality: "reclaim" })).toBe(false);   // the RECLAIM lane ≠ the waiver
    expect(isReclaimOverrideTake({})).toBe(false);
    expect(isReclaimOverrideTake(null)).toBe(false);
    // and the strings themselves must never collapse into one another
    expect(RECLAIM_OVERRIDE_TAKE_QUALITY).toBe("reclaim_override_take");
    expect(RECLAIM_OVERRIDE_TAKE_QUALITY).not.toBe(OVERRIDE_TAKE_QUALITY);
  });

  it("isWaivedEntry is the RENDER key — true for both take classes, false for every refusal", () => {
    // A surface asking "do I draw the amber outline / the disclosure line?" must never have to
    // know WHICH leg was waived; only the one line of copy that names the leg does.
    expect(isWaivedEntry({ quality: OVERRIDE_TAKE_QUALITY })).toBe(true);
    expect(isWaivedEntry(waived())).toBe(true);
    for (const q of ["block", "pending", "regime_blocked", "take", "reclaim", "block_repair"])
      expect(isWaivedEntry({ quality: q }), `${q} is not a waived entry`).toBe(false);
    expect(isWaivedEntry({ override_candidate: true } as never)).toBe(false);   // a decorated refusal
    expect(isWaivedEntry({})).toBe(false);
    expect(isWaivedEntry(null)).toBe(false);
  });

  it("SOFT_Q holds NEITHER take class — softening a waived entry would demote a real entry", () => {
    // SOFT_Q is the shared softening set (ChartPanel.renderSignals + oracleVerdict read the
    // SAME set). A take class landing in it would render the engine's own entry as a
    // subordinate marker — which is exactly the mistake the classes exist to avoid.
    expect([...SOFT_Q].sort()).toEqual(["block", "pending", "regime_blocked"]);
    expect(SOFT_Q.has(OVERRIDE_TAKE_QUALITY)).toBe(false);
    expect(SOFT_Q.has(RECLAIM_OVERRIDE_TAKE_QUALITY)).toBe(false);
  });

  it("anchors the card as an ORDINARY entry — Buy, green, dated, never a refusal", () => {
    const v = verdict();
    expect(v.label).toBe("Buy");
    expect(v.color).toBe("var(--buy)");
    expect(v.raw).toBe("BUY");
    expect(v.overrideTake).toBe(true);
    expect(v.overrideCandidate).toBeFalsy();
    expect(v.blocked).toBeFalsy();
    expect(v.soft).toBe(false);
    expect(v.stance).toBeFalsy();
    expect(v.dim).toBe(false);
    // it really is unrefused at the anchor rule, not merely labelled that way
    expect(isBlockedSignal(waived())).toBe(false);
    expect(anchorSignal([{ ts: "2026-05-12", type: "SELL" }, waived()]).anchor?.quality)
      .toBe(RECLAIM_OVERRIDE_TAKE_QUALITY);
  });

  it("the disclosure line names the WAIVED LEG — 'Reclaim waived', not the regime gate", () => {
    const v = verdict();
    expect(v.line2!.startsWith("Reclaim waived — ")).toBe(true);
    expect(v.line2).toBe("Reclaim waived — entry — Uranium miners −38% from highs");
    // the sibling's head must not appear: two rules, two disclosures
    expect(v.line2).not.toContain("Washout override entry");
  });

  it("the hover leads with the keeper's own mechanic: it HELD the next bar, it never reclaimed the 200-day", () => {
    const note = verdict().note ?? "";
    expect(note).toContain("the keeper would refuse this");
    expect(note).toContain("it held the next bar but never reclaimed the 200-day");
    expect(note).toContain("the deep group washout is the one reason it stands");
    expectMeasuredLine(note, "averaged +22% per trade vs +3% otherwise");
    expect(note).toContain("most still stop out — the stop is the protection");
    // neither of the other two leads may ride along — one fire, one story
    expect(note).not.toContain("the regime gate would refuse this");
    expect(note).not.toContain("still a refused entry");
  });

  it("zh ships the whole disclosure as a real translation, not an English-shaped one", () => {
    const v = verdict({}, true);
    expect(v.label).toBe("买入");
    expect(v.color).toBe("var(--buy)");
    // the "where" half is shared with its siblings and is pinned; the head is structural
    // (see ZH_RECLAIM_LEG) — it must simply not be either washout head
    expect(v.line2!.endsWith(" — 铀矿商板块距高点 −38%")).toBe(true);
    expect(v.line2).not.toContain("深度洗盘例外");
    expect(v.line2).not.toBe(washoutOverrideCopy(WO2_CTX, true, "entry")!.line);
    const note = v.note ?? "";
    expect(note).toContain("次根K线");              // the hold leg PASSED — that is the point
    expect(note).toContain("只差收复");              // …and the reclaim leg is the one waived
    expect(note).toMatch(ZH_RECLAIM_LEG);
    expect(note).toContain("同类深度洗盘是放行的唯一理由");
    expect(note).toContain("止损才是保护");
    expect(note).not.toContain("趋势闸本会拦截");   // that is the sibling's lead
    // no untranslated English clause left behind in the NEW copy
    const copy = washoutOverrideCopy(WO2_CTX, true, "reclaim")!;
    for (const cell of copy.notes) expect(cell).not.toMatch(/[a-z]{4,}/);
    expect(copy.line).not.toMatch(/[a-z]{4,}/);
  });

  it("carries no banned vocabulary in either language", () => {
    const BANNED = [
      "validated", "证伪", "falsifier", "falsif", "refuted", "refut",
      "buy now", "act now", "buy", "sell", "target",
    ];
    for (const zh of [false, true]) {
      const copy = washoutOverrideCopy(WO2_CTX, zh, "reclaim")!;
      for (const cell of [copy.line, ...copy.notes]) {
        const low = cell.toLowerCase();
        for (const bad of BANNED) expect(low, `${cell} contains ${bad}`).not.toContain(bad);
      }
    }
  });
});

// ── washoutOverrideCopy: THREE kinds, ONE voice ────────────────────────────────────────────
// WHY THIS BLOCK EXISTS. The three shapes share one function precisely so their EVIDENCE can
// never drift apart — the measured figures and the stop-out warning are the same facts about
// the same mechanism no matter which leg was relieved. What must differ is the lead clause and
// the head, because those are the only things a reader can use to tell a refusal from an entry
// and one waiver from the other. So the property is two-sided and both sides are load-bearing:
// heads and leads all-distinct, tails all-identical. A regression in either direction is a
// disclosure that lies — either three classes wearing one story, or one mechanism telling
// three different stories about the same evidence.
describe("washoutOverrideCopy — three lead clauses, one shared body of evidence", () => {
  const KINDS = ["candidate", "entry", "reclaim"] as const;

  it("the boolean legacy signature still selects the original two shapes", () => {
    // `taken` predates the kind union; ChartPanel/oracleVerdict callers still pass booleans.
    expect(washoutOverrideCopy(WO2_CTX, false, false)!.line)
      .toBe(washoutOverrideCopy(WO2_CTX, false, "candidate")!.line);
    expect(washoutOverrideCopy(WO2_CTX, false, true)!.line)
      .toBe(washoutOverrideCopy(WO2_CTX, false, "entry")!.line);
    expect(washoutOverrideCopy(WO2_CTX, false)!.line)          // default = the refusal shape
      .toBe(washoutOverrideCopy(WO2_CTX, false, "candidate")!.line);
  });

  for (const zh of [false, true]) {
    const lang = zh ? "zh" : "en";

    it(`[${lang}] the three heads are distinct and name what happened`, () => {
      const lines = KINDS.map((k) => washoutOverrideCopy(WO2_CTX, zh, k)!.line);
      expect(new Set(lines).size).toBe(3);
      const [candidate, entry, reclaim] = lines;
      expect(candidate).toContain(zh ? "深度洗盘例外候选" : "Washout override candidate");
      expect(entry).toContain(zh ? "深度洗盘例外入场" : "Washout override entry");
      // the reclaim head names a DIFFERENT mechanism, so it may not borrow the washout head
      // (EN pinned; ZH structural — the noun is mid-correction, see ZH_RECLAIM_LEG)
      if (zh) expect(reclaim).not.toContain("深度洗盘例外");
      else expect(reclaim).toContain("Reclaim waived");
      // the entry heads must not be prefixes of one another — "Washout override" alone would
      // read identically on a truncated glance surface
      expect(entry.startsWith(reclaim)).toBe(false);
      expect(reclaim.startsWith(entry)).toBe(false);
    });

    it(`[${lang}] the three lead clauses are distinct and each names its own refusal`, () => {
      const leads = KINDS.map((k) => washoutOverrideCopy(WO2_CTX, zh, k)!.notes[0]);
      expect(new Set(leads).size).toBe(3);
      const [candidate, entry, reclaim] = leads;
      expect(candidate).toContain(zh ? "仍是被拦截的入场" : "still a refused entry");
      expect(entry).toContain(zh ? "趋势闸本会拦截" : "the regime gate would refuse this");
      // the reclaim lead is identified by the keeper mechanic it names, not by its verb
      expect(reclaim).toContain(zh ? "次根K线" : "the keeper would refuse this");
      // only the reclaim shape may name the keeper's two legs — that IS its distinguishing fact
      const leg = zh ? ZH_RECLAIM_LEG : /200-day/;
      expect(reclaim).toMatch(leg);
      expect(candidate).not.toMatch(leg);
      expect(entry).not.toMatch(leg);
    });

    it(`[${lang}] the evidence behind the lead is IDENTICAL across all three`, () => {
      // notes[0] is the lead; everything after it is the measurement + the stop-out warning,
      // which are properties of the mechanism, not of which leg was relieved.
      const tails = KINDS.map((k) => washoutOverrideCopy(WO2_CTX, zh, k)!.notes.slice(1));
      expect(tails[1]).toEqual(tails[0]);
      expect(tails[2]).toEqual(tails[0]);
      // and the tail is never empty — a disclosure with no stop-out warning is not compliant
      expect(tails[0].join(" · ")).toContain(zh ? "止损才是保护" : "most still stop out");
    });
  }

  it("every kind degrades the same honest way when the artifact shipped no basket name", () => {
    for (const kind of KINDS) {
      const full = washoutOverrideCopy(WO2_CTX, false, kind)!.line;
      const bare = washoutOverrideCopy({}, false, kind)!.line;
      expect(full.startsWith(bare)).toBe(true);       // the head survives; only the "where" drops
      // no dangling separator: a shorter line beats one that prints an empty slot.
      // (the reclaim head carries an em-dash of its own — only a TRAILING one is the bug)
      expect(bare.trimEnd().endsWith("—")).toBe(false);
      expect(washoutOverrideCopy({ peer_dd: -0.31 }, false, kind)!.line)
        .toBe(`${bare} — peer group −31% from highs`);
    }
  });
});

// ── the RETRO PROJECTION: a counterfactual that must never read as a call ──────────────────
// Receipts: signal_layer/washout_override.mark_retro (writes retro_override/retro_ctx and
// NOTHING else — no quality, no tier, no blocked, no ledger parameter).
//
// WHY THIS BLOCK EXISTS. This is the only class on the chart the engine did NOT act on, so its
// entire correctness is a negative: it must not accrue, must not anchor, must not be mistaken
// for an entry, and must not be describable in words that imply the product made the call. The
// emitter guarantees the first by having no ledger to write to; these tests guarantee the rest
// on the client. The strictness assertions matter more here than anywhere else in this file —
// a truthy-but-not-true `retro_override` promoting a refusal to a counterfactual would paint a
// track record nobody earned, and the reader has no way to detect it.
describe("retro projection — a counterfactual, never a call", () => {
  const RETRO_CTX = { group_id: "uranium_miners", name: "Uranium miners", name_zh: "铀矿商" };
  const retroFire = (over: Partial<RetroSig> = {}): RetroSig => ({
    ts: "2026-06-10", known_ts: "2026-06-10", type: "BUY", price: 8.4,
    // the refusal it still is: mark_retro writes NOTHING to these fields
    quality: "regime_blocked", blocked: true, tier: null, score: null,
    quality_reason: "bear_block: monthly-bear & below-200 & 2W-not-bull",
    retro_override: true, retro_ctx: RETRO_CTX, ...over,
  } as RetroSig);

  it("isRetroOverride is STRICT on the boolean — a truthy value never promotes a refusal", () => {
    expect(isRetroOverride(retroFire())).toBe(true);
    expect(isRetroOverride({ retro_override: "true" })).toBe(false);
    expect(isRetroOverride({ retro_override: 1 })).toBe(false);
    expect(isRetroOverride({ retro_override: undefined })).toBe(false);
    expect(isRetroOverride({ retro_override: false })).toBe(false);
    expect(isRetroOverride({})).toBe(false);
    expect(isRetroOverride(null)).toBe(false);
    // the point-in-time class is a DIFFERENT answer to the same question — history's own
    // numbers outrank a projection, and mark_retro skips a stamped fire for exactly that reason
    expect(isRetroOverride({ override_candidate: true } as never)).toBe(false);
  });

  it("EN and ZH lead with the counterfactual mood, at glance tier", () => {
    const en = retroOverrideCopy(RETRO_CTX, false);
    expect(en.line.startsWith("Would have entered under today's rule")).toBe(true);
    expect(en.line).toBe("Would have entered under today's rule — Uranium miners");
    const zh = retroOverrideCopy(RETRO_CTX, true);
    expect(zh.line.startsWith("按当前规则本会入场")).toBe(true);
    expect(zh.line).toBe("按当前规则本会入场 — 铀矿商");
  });

  it("the notes say plainly that the system refused it live and that it is not in the record", () => {
    const en = retroOverrideCopy(RETRO_CTX, false).notes.join(" · ");
    expect(en).toContain("the system refused this live");
    expect(en).toContain("not a call we made");
    expect(en).toContain("not in the track record");
    // no hedging vocabulary that could be read as an endorsement
    expect(en.toLowerCase()).not.toContain("would have profited");
    expect(en.toLowerCase()).not.toContain("missed");
  });

  it("zh is a real translation, not an English-shaped one", () => {
    const zh = retroOverrideCopy(RETRO_CTX, true);
    const notes = zh.notes.join(" · ");
    expect(notes).toContain("当时系统并未入场");        // the plain fact, said in Chinese
    expect(notes).toContain("这不是当时的判断");
    expect(notes).toContain("不计入战绩");              // …and it is not in the track record
    for (const cell of [zh.line, ...zh.notes]) expect(cell).not.toMatch(/[a-z]{4,}/);
    // zh falls back to the EN basket name rather than printing a raw slug, like its siblings
    expect(retroOverrideCopy({ group_id: "uranium_miners", name: "Uranium miners" }, true).line)
      .toBe("按当前规则本会入场 — Uranium miners");
    // …and to the slug only when there is no name at all — an honest short form, never blank
    expect(retroOverrideCopy({ group_id: "uranium_miners" }, false).line)
      .toBe("Would have entered under today's rule — uranium_miners");
    expect(retroOverrideCopy(null, false).line).toBe("Would have entered under today's rule");
  });

  it("carries no banned vocabulary in either language", () => {
    const BANNED = [
      "validated", "证伪", "falsifier", "falsif", "refuted", "refut",
      "buy now", "act now", "buy", "sell", "target",
    ];
    for (const zh of [false, true]) {
      const copy = retroOverrideCopy(RETRO_CTX, zh);
      for (const cell of [copy.line, ...copy.notes]) {
        const low = cell.toLowerCase();
        for (const bad of BANNED) expect(low, `${cell} contains ${bad}`).not.toContain(bad);
      }
    }
  });

  // ── THE HARD BOUNDARY ──────────────────────────────────────────────────────────────────
  // Everything above is about how the counterfactual is WORDED. This is about what it can
  // DO — and the answer is nothing. A retro mark is still the refusal it always was.
  it("a retro fire is NOT a waived entry — the mark changes how it reads, never what it is", () => {
    const sig = retroFire();
    expect(isWaivedEntry(sig)).toBe(false);
    expect(isOverrideTake(sig)).toBe(false);
    expect(isReclaimOverrideTake(sig)).toBe(false);
    expect(isOverrideCandidate(sig)).toBe(false);
    expect(isBlockedSignal(sig)).toBe(true);      // it is, and stays, a refusal
    expect(sig.quality).toBe("regime_blocked");   // mark_retro wrote no quality at all
    expect(sig.tier).toBeNull();
    expect(sig.score).toBeNull();
  });

  it("anchorSignal still REFUSES to anchor it — a counterfactual can never become the read", () => {
    const { anchor, blockedTail } = anchorSignal([
      { ts: "2026-05-12", type: "SELL", price: 14.2 },
      retroFire(),
    ]);
    expect(anchor?.type).toBe("SELL");            // the refusal is skipped, as always
    expect(blockedTail?.ts).toBe("2026-06-10");   // …and surfaces only as the refused tail
  });

  it("a retro fire alone never produces a Buy verdict — it renders the refusal it is", () => {
    const v = oracleVerdict("BUY", wo2Slice(
      { last_signal: "BUY", last_scored_signal: "SELL", position_hint: "flat",
        strong_bull: false, overbought: false, weeklyBull: false, above200: false },
      [{ ts: "2026-05-12", type: "SELL", price: 14.2 }, retroFire({ ts: "2026-08-03", known_ts: "2026-08-03" })],
    ), false, WO2_NOW, "DOWNTREND");
    expect(v.label).toBe("Entry trigger — regime-blocked");
    expect(v.label).not.toBe("Buy");
    expect(v.raw).toBe("BLOCKED_ENTRY");
    expect(v.color).not.toBe("var(--buy)");
    expect(v.blocked).toBe(true);
    expect(v.overrideTake).toBeFalsy();
    // and the counterfactual copy does NOT leak into the scored-lane card — the retro
    // disclosure belongs to the marked-history surfaces, which is why `Verdict.retro` is
    // documented as never reaching this field through the scored lane.
    expect(v.retro).toBeFalsy();
    expect(v.note).not.toContain("Would have entered");
    expect(v.line2).toBeNull();
  });
});

// ── THE RETRO LEGEND — the disclosure of record ────────────────────────────────────────────
// This block exists because of a specific, documented trade: the retro marker is drawn
// identically to a live waived entry, and the marker tooltip that was meant to carry the
// difference cannot render (the signal layer is `pointer-events:none`, measured). The legend
// is therefore the ONLY surface that tells a reader some of those stars are counterfactuals.
// Every assertion here is guarding that one job.
describe("retro legend — the only surface that separates a counterfactual from a call", () => {
  it("resolves the row label instead of merely repeating it", () => {
    // a disclosure that says "(retro)" without saying what retro MEANS is a label, not a
    // disclosure — so the legend must quote the suffix AND explain it in the same breath
    const en = retroLegendCopy(false);
    expect(en).toContain("(retro)");
    expect(en).toContain("re-marked under the current rule");
    expect(en).toContain("refused");
    expect(en).toContain("not a call we made");
  });

  it("says the same thing in Chinese, in Chinese — not an English sentence in translation", () => {
    const zh = retroLegendCopy(true);
    expect(zh).toContain("（事后重标）");
    expect(zh).toContain("按当前规则");
    expect(zh).toContain("当时被系统拒绝");
    expect(zh).not.toMatch(/[A-Za-z]{4,}/);          // no untranslated English left in it
    expect(zh).not.toBe(retroLegendCopy(false));
  });

  it("carries no study name, no era slug and no refutation language", () => {
    for (const copy of [retroLegendCopy(false), retroLegendCopy(true)]) {
      for (const banned of ["gc_v2", "wo1", "wo2", "washout_override", "regime_blocked",
        "validated", "falsifier", "refuted", "证伪", "Arm T", "prereg"]) {
        expect(copy).not.toContain(banned);
      }
    }
  });

  it("never claims the entry happened — the whole point of the line", () => {
    // "would have" / counterfactual mood only. If this line ever reads as a completed action
    // the product is claiming a trade it did not make.
    const en = retroLegendCopy(false).toLowerCase();
    expect(en).not.toMatch(/\bwe (entered|bought)\b/);
    expect(en).not.toMatch(/\bentry taken\b/);
  });
});

// ── bottom-entry lanes — authority and source separation ─────────────────────────────────
// These cases pin the product boundary, not just wording. A visible early opportunity is useful
// only if it cannot quietly inherit the authority of either a scored Oracle buy or a Prophet plan.
describe("bottom-entry UI contracts — useful early, honest about authority", () => {
  const NOW_BOTTOM = Date.parse("2026-08-10T21:00:00Z");

  it("anchors BOTTOM_WATCH as an amber soft watch, never a blocked or scored Buy", () => {
    const bottom = {
      ts: "2026-07-23", known_ts: "2026-07-27", type: "BOTTOM_WATCH",
      price: 7.69, quality: "self_washout", scored: false, stop_level: 6.92,
    };
    const { anchor, blockedTail } = anchorSignal([
      { ts: "2026-06-01", type: "SELL", price: 8.4 },
      bottom,
    ]);

    expect(isBottomWatch(bottom)).toBe(true);
    expect(isBlockedSignal(bottom)).toBe(false);
    expect(anchor).toBe(bottom);
    expect(blockedTail).toBeNull();

    const v = oracleVerdict("SELL", sliceOf("SELL", [
      { ts: "2026-06-01", type: "SELL", price: 8.4 },
      bottom,
    ]), false, NOW_BOTTOM, "DOWNTREND");
    expect(v.raw).toBe("BOTTOM_WATCH");
    expect(v.label).toBe("Bottom watch");
    expect(v.label).not.toMatch(/buy/i);
    expect(v.color).toBe("var(--signal)");
    expect(v.color).not.toBe("var(--buy)");
    expect(v.soft).toBe(true);
    expect(v.blocked).toBe(false);
    expect(v.note).toContain("not in the confirmed-buy track record");
    expect(v.note).not.toContain("data lanes disagree");
  });

  it("labels the fast stop-sweep path as an unscored liquidity reclaim", () => {
    const reclaim = {
      ts: "2026-08-03", type: "RECLAIM", quality: "stop_sweep_reclaim",
      price: 14.43, scored: false, prior_stop_level: 14.29, stop_level: 13.74,
    };
    expect(isStopSweepReclaim(reclaim)).toBe(true);

    const v = oracleVerdict("SELL", sliceOf("SELL", [reclaim]), false, NOW_BOTTOM);
    expect(v.raw).toBe("RECLAIM");
    expect(v.label).toBe("Liquidity reclaim");
    expect(v.soft).toBe(true);
    expect(v.note).toContain("unscored re-entry signal");
    expect(v.note).toContain("not in the track record");

    const tip = markerTooltipCopy({
      t: reclaim.ts, type: reclaim.type, quality: reclaim.quality, scored: reclaim.scored,
      priorStopLevel: reclaim.prior_stop_level, stopLevel: reclaim.stop_level,
    }, false);
    expect(tip).toContain("liquidity reclaim");
    expect(tip).toContain("unscored re-entry watch");
    expect(tip).not.toContain("scored reclaim lane");
  });

  it("calls a keeper block a starter, not a refused entry", () => {
    const tip = markerTooltipCopy({
      t: "2026-06-25", type: "BUY", quality: "block",
      reason: "counter-trend, no 200-reclaim/hold",
    }, false);
    expect(tip).toContain("starter — confirmation filter failed");
    expect(tip).not.toMatch(/blocked|refused|not an entry/i);
  });

  it("calls a Prophet marker a candidate receipt and explicitly not a plan", () => {
    const tip = markerTooltipCopy({
      t: "2026-07-24", type: "PROPHET", source: "prophet_board",
      definition: "us_prophet_v2", rank: 14, returnPct: 20.9, authority: "candidate",
    }, false);
    expect(tip).toContain("Prophet candidate receipt");
    expect(tip).toContain("not a trade plan");
    expect(tip).toContain("rank #14");
    expect(tip).not.toContain("Golden Oracle");
  });

  it("keeps an opportunity sibling out of the Oracle verdict anchor", () => {
    const payload = {
      indicator: {
        state: { last_signal: "BUY" },
        signals: [{ ts: "2026-08-01", type: "BUY", price: 93.47, quality: "take" }],
      },
      opportunities: {
        events: [{
          id: "NEM-us_prophet_v2-2026-08-09", surfaced_at: "2026-08-09",
          system: "prophet_board", definition: "us_prophet_v2", authority: "candidate",
        }],
      },
    };
    const v = oracleVerdict("BUY", payload, false, NOW_BOTTOM);
    expect(v.raw).toBe("BUY");
    expect(v.label).toBe("Buy");
    expect(v.sub).toBe("Aug 1");
    expect(v.note).not.toMatch(/Prophet|candidate|trade plan/i);
  });
});
