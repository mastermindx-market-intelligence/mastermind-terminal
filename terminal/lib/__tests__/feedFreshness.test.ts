// The freshness-labelling law: a real-time claim requires a MEASUREMENT.
//
// The failure this guards against is not a crash — it is a badge that says "Live" because an
// env flag was set, on a feed nobody timed. Every assertion below is about what the UI is
// allowed to CLAIM given what was measured, and the bilingual pass is part of that: a zh user
// must get the same hedge, not an untranslated key or an English fallback that reads as more
// confident than the Chinese.

import { describe, it, expect } from "vitest";
import { formatLag, freshnessLabel, isLiveFeedBasis } from "@/lib/feedFreshness";
import { LEX } from "@/lib/i18n";

const NEW_KEYS = [
  "realtimeTip", "delayedTip", "freshnessUnknown", "marketClosedFeed", "usOnlyFeed",
  "unitSecShort", "unitMinShort", "unitHrShort",
  "tfSecondsGroup", "secondsUsOnlyTip", "secondBarsSession",
  // The kill-switch lane: shown on the disabled Seconds entries when HUB_REALTIME_QUOTES is off.
  // A distinct string from usOnlyFeed on purpose — "not enabled" and "US stocks only" are
  // different facts, and this guard is what keeps the second one bilingual too.
  "secondsOffFeed",
] as const;

const en = (k: string) => LEX[k]?.[0] ?? k;
const zh = (k: string) => LEX[k]?.[1] ?? k;

describe("formatLag", () => {
  it("renders a measured age at a readable scale", () => {
    expect(formatLag(3_000, en)).toBe("3s");
    expect(formatLag(45_000, en)).toBe("45s");
    expect(formatLag(15 * 60_000, en)).toBe("15m");
    expect(formatLag(3 * 3600_000, en)).toBe("3h");
  });

  it("refuses a missing or negative measurement rather than printing a flattering 0s", () => {
    // A negative age means the vendor clock led ours. Clamping it to 0 would turn "we cannot
    // tell" into the best possible reading — exactly the overclaim this module exists to stop.
    expect(formatLag(null, en)).toBeNull();
    expect(formatLag(undefined, en)).toBeNull();
    expect(formatLag(-5_000, en)).toBeNull();
    expect(formatLag(Number.NaN, en)).toBeNull();
  });

  it("localises the unit", () => {
    expect(formatLag(3_000, zh)).toBe("3秒");
    expect(formatLag(15 * 60_000, zh)).toBe("15分钟");
  });
});

describe("isLiveFeedBasis", () => {
  it("keeps both canonical real-time transports in the same live visual lane", () => {
    expect(isLiveFeedBasis("REALTIME")).toBe(true);
    expect(isLiveFeedBasis("LIVE")).toBe(true);
    expect(isLiveFeedBasis("DELAYED_15M")).toBe(false);
    expect(isLiveFeedBasis("EOD")).toBe(false);
    expect(isLiveFeedBasis(undefined)).toBe(false);
  });
});

describe("freshnessLabel", () => {
  it("REALTIME with a measured lag → the live badge, and the tip carries the number", () => {
    const r = freshnessLabel({ basis: "REALTIME", lagMs: 3_400 }, en);
    expect(r.cls).toBe("livebadge live");
    expect(r.label).toBe(en("live"));
    expect(r.tip).toContain("3s");
    expect(r.tip).toContain(en("realtimeTip"));
  });

  it("REALTIME with NO measurement does not get to claim a measurement", () => {
    // The badge still shows the live lane (the hub only stamps REALTIME after grading itself),
    // but the hover must say the age is unknown rather than assert a number it does not have.
    const r = freshnessLabel({ basis: "REALTIME", lagMs: null }, en);
    expect(r.tip).toBe(en("freshnessUnknown"));
    expect(r.tip).not.toMatch(/\d/);
  });

  it("DELAYED prints the measured lag instead of an adjective the app chose", () => {
    const r = freshnessLabel({ basis: "DELAYED_15M", lagMs: 15 * 60_000 + 4_000 }, en);
    expect(r.cls).toBe("livebadge delayed");
    expect(r.label).toBe(en("delayed15m"));
    expect(r.tip).toContain("15m");
  });

  it("EOD and unknown bases make no freshness claim at all", () => {
    for (const basis of ["EOD", undefined, null, "SOMETHING_ELSE"]) {
      const r = freshnessLabel({ basis: basis as never, lagMs: 1_000 }, en);
      expect(r.cls).toBe("livebadge");
      expect(r.label).toBe(en("historical"));
      expect(r.tip).toBe(en("marketClosedFeed"));
    }
  });

  it("a CLOSED market reads as last-session, never as 'delayed'", () => {
    // Saturday 2026-08-08 is exactly the state this shipped in. "15-min delayed" there describes
    // a lag that does not exist and implies waiting would refresh it. Nothing is being delayed —
    // the tape is shut.
    const r = freshnessLabel({ basis: "DELAYED_15M", lagMs: null, marketSession: "overnight" }, en);
    expect(r.cls).toBe("livebadge");
    expect(r.label).toBe(en("historical"));
    expect(r.tip).toBe(en("marketClosedFeed"));
    expect(r.tip).not.toContain("15");
    // …and the same in Chinese.
    expect(freshnessLabel({ basis: "DELAYED_15M", marketSession: "overnight" }, zh).tip).toBe(zh("marketClosedFeed"));
  });

  it("a MEASUREMENT outside session hours still wins over the closed wording", () => {
    // If the feed actually timed a print, show the number — the closed-market wording is a
    // fallback for having nothing measured, not a rule that suppresses evidence.
    const r = freshnessLabel({ basis: "DELAYED_15M", lagMs: 42_000, marketSession: "overnight" }, en);
    expect(r.tip).toContain("42s");
  });

  it("does NOT apply the closed wording during a session", () => {
    for (const s of ["pre", "rth", "post"]) {
      const r = freshnessLabel({ basis: "DELAYED_15M", lagMs: null, marketSession: s }, en);
      expect(r.label, s).toBe(en("delayed15m"));
    }
  });

  it("derives the age from asOfMs at RENDER time, not from the serve-time lagMs", () => {
    // TerminalShell's quoteEq bail-out deliberately retains a quote object across polls that
    // changed nothing. If the badge read the stopwatch value baked into that object, a quiet
    // symbol would keep advertising the age it had when it was first received — a measurement
    // that silently stops being true. Deriving from the print instant fixes that by construction.
    const printedAt = 1_786_000_000_000;
    const r = freshnessLabel(
      { basis: "REALTIME", lagMs: 2_000, asOfMs: printedAt }, en, printedAt + 47_000);
    expect(r.tip).toContain("47s");
    expect(r.tip).not.toContain("2s");
  });

  it("falls back to lagMs when the print instant is absent", () => {
    const r = freshnessLabel({ basis: "REALTIME", lagMs: 9_000 }, en, 1_786_000_000_000);
    expect(r.tip).toContain("9s");
  });

  it("never leaks a raw lexicon key into any lane", () => {
    for (const basis of ["REALTIME", "LIVE", "DELAYED_15M", "EOD"]) {
      for (const t of [en, zh]) {
        const r = freshnessLabel({ basis: basis as never, lagMs: 2_000 }, t);
        expect(r.label).not.toMatch(/^[a-z][A-Za-z0-9]*$/);
        expect(r.tip.length).toBeGreaterThan(1);
      }
    }
  });
});

describe("bilingual coverage for every string this feature adds", () => {
  it("has an EN and a ZH entry for each new key", () => {
    for (const k of NEW_KEYS) {
      expect(LEX[k], `missing lexicon entry: ${k}`).toBeDefined();
      expect(LEX[k][0], `missing EN: ${k}`).toBeTruthy();
      expect(LEX[k][1], `missing ZH: ${k}`).toBeTruthy();
    }
  });

  it("the ZH entry is a real translation, not a copy of the English", () => {
    // `unitSecShort` etc. would be a legitimate exception if zh reused the latin abbreviation —
    // it does not (秒/分钟/小时), so every new key can be held to this.
    for (const k of NEW_KEYS) {
      expect(LEX[k][1], `zh == en for ${k}`).not.toBe(LEX[k][0]);
    }
  });

  it("carries the US-stocks-only boundary in both languages", () => {
    // The plan entitles US equities only. If this copy ever goes missing the UI starts implying
    // coverage (index/FX/crypto) that the vendor does not sell us.
    expect(en("usOnlyFeed")).toMatch(/US/);
    expect(zh("usOnlyFeed")).toMatch(/美股/);
    expect(zh("secondsUsOnlyTip")).toMatch(/美股/);
  });
});
