import { describe, it, expect } from "vitest";
import {
  dteFrom,
  dteLabel,
  dteLabelFor,
  dteRaw,
  expDatePart,
  expLabel,
  isZeroDte,
} from "@/lib/dte";
import { dteFrom as dteFromReexport } from "@/lib/expiryTermStructure";

// The GEX desk's snapshot day. Every assertion below is anchored to it, never to the
// wall clock — that is the whole point of B7.
const ASOF = "2026-07-10T20:15:00Z";

describe("expDatePart — tolerates every expiry key shape on the desk", () => {
  it("passes a plain date through", () => {
    expect(expDatePart("2026-07-17")).toBe("2026-07-17");
  });
  it("strips the matrix store's ' HH:MM:SS' suffix", () => {
    expect(expDatePart("2026-07-17 00:00:00")).toBe("2026-07-17");
  });
  it("strips an ISO time suffix", () => {
    expect(expDatePart("2026-07-17T20:00:00Z")).toBe("2026-07-17");
  });
  it("is null-safe", () => {
    expect(expDatePart(null)).toBe("");
    expect(expDatePart(undefined)).toBe("");
  });
});

describe("dteRaw — signed distance from the snapshot's session day", () => {
  it("counts whole days forward", () => {
    expect(dteRaw("2026-07-17", ASOF)).toBe(7);
    expect(dteRaw("2026-12-18", ASOF)).toBe(161);
  });
  it("is 0 on the session day itself", () => {
    expect(dteRaw("2026-07-10", ASOF)).toBe(0);
  });
  it("goes NEGATIVE for an already-expired row (the clamp used to hide this)", () => {
    expect(dteRaw("2026-07-09", ASOF)).toBe(-1);
    expect(dteRaw("2026-06-30", ASOF)).toBe(-10);
  });
  it("is deterministic across DST-ish boundaries (UTC midnight anchoring)", () => {
    expect(dteRaw("2026-11-02", "2026-10-30T20:15:00Z")).toBe(3);
    expect(dteRaw("2026-03-09", "2026-03-06T20:15:00Z")).toBe(3);
  });
  it("returns 0 rather than NaN for unparseable inputs", () => {
    expect(dteRaw("not-a-date", ASOF)).toBe(0);
    expect(dteRaw("2026-07-17", "garbage")).toBe(0);
  });
});

describe("dteFrom — display form, clamped at 0", () => {
  it("matches dteRaw for future expiries", () => {
    expect(dteFrom("2026-07-17", ASOF)).toBe(7);
  });
  it("clamps a past expiry to 0 (unchanged from the convention it replaces)", () => {
    expect(dteFrom("2026-07-09", ASOF)).toBe(0);
  });
  it("keeps the exact behaviour lib/expiryTermStructure.ts published (re-export identity)", () => {
    expect(dteFromReexport).toBe(dteFrom);
    expect(dteFromReexport("2026-07-11", "2026-07-05T16:05:00Z")).toBe(6);
    expect(dteFromReexport("2026-09-19", "2026-07-05T16:05:00Z")).toBe(76);
  });
});

describe("isZeroDte — the 0DTE chip's actual question", () => {
  it("is true only on the snapshot's own session day", () => {
    expect(isZeroDte("2026-07-10", ASOF)).toBe(true);
  });
  it("is FALSE for an expired row — the bug the clamped form caused", () => {
    // dteFrom clamps -1 → 0, which is why a stale payload used to grow a phantom 0DTE
    // chip (and, before as-of anchoring, EVERY past expiry did).
    expect(dteFrom("2026-07-09", ASOF)).toBe(0);
    expect(isZeroDte("2026-07-09", ASOF)).toBe(false);
  });
  it("is false for a future expiry", () => {
    expect(isZeroDte("2026-07-13", ASOF)).toBe(false);
  });
  it("matches on the date part regardless of key shape", () => {
    expect(isZeroDte("2026-07-10 00:00:00", ASOF)).toBe(true);
  });
});

describe("labels", () => {
  it("dteLabel", () => {
    expect(dteLabel(0)).toBe("0DTE");
    expect(dteLabel(-3)).toBe("0DTE");
    expect(dteLabel(7)).toBe("7d");
  });
  it("dteLabelFor reads straight off an expiry key", () => {
    expect(dteLabelFor("2026-07-10", ASOF)).toBe("0DTE");
    expect(dteLabelFor("2026-08-21", ASOF)).toBe("42d");
  });
  it("expLabel is MM-DD and language-neutral", () => {
    expect(expLabel("2026-07-17")).toBe("07-17");
    expect(expLabel("2026-07-17 00:00:00")).toBe("07-17");
    expect(expLabel("odd")).toBe("odd");
  });
});


describe("isZeroDte — missing or malformed dates are not same-session evidence", () => {
  it.each([
    ["not-a-date", ASOF],
    ["2026-07-10", "garbage"],
    ["2026-02-30", "2026-03-02"],
    ["2026-03-02", "2026-02-30"],
    ["", ASOF],
  ])("rejects expiry %s with source day %s", (expiry, asOf) => {
    expect(isZeroDte(expiry as string, asOf)).toBe(false);
  });

  it("does not infer a missing snapshot day from the wall clock", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(isZeroDte(today, null)).toBe(false);
    expect(isZeroDte(today, undefined)).toBe(false);
  });

  it("keeps source date-part semantics rather than converting timestamp offsets", () => {
    expect(isZeroDte("2026-07-10 00:00:00", "2026-07-10T23:30:00-07:00")).toBe(true);
    expect(isZeroDte("2026-07-11", "2026-07-10T23:30:00-07:00")).toBe(false);
  });

  it("does not change the existing numeric display fallback", () => {
    expect(dteRaw("not-a-date", ASOF)).toBe(0);
    expect(dteFrom("2026-07-10", "garbage")).toBe(0);
  });
});
