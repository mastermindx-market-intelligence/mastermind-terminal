// @vitest-environment jsdom
//
// Round 3: loadErr prints accDetLoadErr at the glance (R2). Unread is a
// fourth glance state (R1). Unscorable glance prints call count + claim
// count (R3). This mounts the real SectionAccuracy (no test double).
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import SectionAccuracy, { accuracyGlanceState } from "@/components/settings/SectionAccuracy";
import { LEX } from "@/lib/i18n";
import { accountIdentity, GUEST_IDENTITY } from "@/lib/accountIdentity";
import { emptyAccuracyReadout, scorePersonalAccuracy, type UserClaim } from "@/lib/personalAccuracy";
import {
  overlappingUnscorableAccuracyFixture,
  populatedAccuracyFixture,
  unscorableAccuracyFixture,
} from "@/app/dev/settings/accuracyFixtures";
import type { AccuracyProps } from "@/components/settings/SectionAccuracy";

const OWNER = accountIdentity("8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22", "a@example.com");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function baseProps(lang: "en" | "zh", extra: Partial<AccuracyProps> = {}): AccuracyProps {
  return {
    t: makeT(lang),
    lang,
    identity: OWNER,
    email: "a@example.com",
    user: null,
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
    readout: emptyAccuracyReadout(),
    loadErr: false,
    ...extra,
  };
}

describe("SectionAccuracy load-error placement (review MAJOR round 2)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function mount(lang: "en" | "zh", extra: Partial<AccuracyProps> = {}) {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(SectionAccuracy, baseProps(lang, extra)));
    });
  }

  it("EN: a load error is visible in the glance before the toggle is opened", () => {
    const err = LEX.accDetLoadErr[0];
    mount("en", { readout: null, loadErr: true });
    expect(container.textContent).toContain(err);
    expect(container.querySelector("[data-acc-state='error']")?.textContent).toContain(err);
    expect(container.querySelector("[data-acc='detail']")).toBeNull();
    expect(container.textContent).not.toContain(LEX.accEmpty[0]);
    expect(container.textContent).not.toContain(LEX.accUnread[0]);
    expect(container.querySelectorAll("[data-acc-state]")).toHaveLength(1);
    const toggle = container.querySelector("[data-acc='toggle']") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.textContent).toBe(LEX.accDetailOpen[0]);
    act(() => {
      toggle.click();
    });
    expect(container.querySelector("[data-acc='detail']")?.textContent).toContain(err);
  });

  it("ZH: a load error is visible in the glance before the toggle is opened", () => {
    const err = LEX.accDetLoadErr[1];
    mount("zh", { readout: null, loadErr: true });
    expect(container.textContent).toContain(err);
    expect(container.querySelector("[data-acc-state='error']")?.textContent).toContain(err);
    expect(container.querySelector("[data-acc='detail']")).toBeNull();
    expect(container.textContent).not.toContain(LEX.accEmpty[1]);
    expect(container.textContent).not.toContain(LEX.accUnread[1]);
    const toggle = container.querySelector("[data-acc='toggle']") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    expect(container.querySelector("[data-acc='detail']")?.textContent).toContain(err);
  });

  it("EN: a healthy empty ledger still prints the frozen empty sentence, never the load-error line", () => {
    mount("en", { readout: emptyAccuracyReadout(), loadErr: false });
    expect(container.textContent).toContain(LEX.accEmpty[0]);
    expect(container.textContent).not.toContain(LEX.accDetLoadErr[0]);
  });

  it("EN: a populated detail row prints the hits sentence, not a slash fraction", () => {
    mount("en", { readout: populatedAccuracyFixture(), loadErr: false });
    const toggle = container.querySelector("[data-acc='toggle']") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    const detail = container.querySelector("[data-acc='detail']")?.textContent || "";
    expect(detail).not.toMatch(/\b7\s*\/\s*10\b/);
    expect(detail).toContain("7");
    expect(detail).toContain("10");
  });
});

function interpolate(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

function glanceSentences(lang: 0 | 1, nUnscorable = 0) {
  return {
    empty: LEX.accEmpty[lang],
    unscorable: nUnscorable === 1
      ? LEX.accUnscorable1[lang]
      : interpolate(LEX.accUnscorableN[lang], { n: nUnscorable }),
    readout: LEX.accStanceMostly[lang],
  };
}

describe("SectionAccuracy glance state machine (exactly one state sentence)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function mount(lang: "en" | "zh", extra: Partial<AccuracyProps> = {}) {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(SectionAccuracy, baseProps(lang, extra)));
    });
  }

  it("accuracyGlanceState(null) returns unread, never empty", () => {
    expect(accuracyGlanceState(null)).toBe("unread");
    expect(accuracyGlanceState(emptyAccuracyReadout())).toBe("empty");
  });

  it("null readout: only the unread copy is in the DOM", () => {
    mount("en", { readout: null, loadErr: false });
    const text = container.textContent || "";
    expect(text).toContain(LEX.accUnread[0]);
    expect(text).not.toContain(LEX.accEmpty[0]);
    expect(text).not.toContain(interpolate(LEX.accUnscorableN[0], { n: 1 }));
    expect(text).not.toContain(LEX.accStanceMostly[0]);
    expect(container.querySelectorAll("[data-acc-state]")).toHaveLength(1);
    expect(container.querySelector("[data-acc-state='unread']")).toBeTruthy();
  });

  it("no claims at all: only the empty copy is in the DOM", () => {
    mount("en", { readout: emptyAccuracyReadout(), loadErr: false });
    const text = container.textContent || "";
    const sents = glanceSentences(0, 1);
    expect(text).toContain(sents.empty);
    expect(text).not.toContain(sents.unscorable);
    expect(text).not.toContain(sents.readout);
    expect(container.querySelectorAll("[data-acc-state]")).toHaveLength(1);
    expect(container.querySelector("[data-acc-state='empty']")).toBeTruthy();
  });

  it("claims exist but none is scorable: only the unscorable copy is in the DOM", () => {
    const readout = unscorableAccuracyFixture();
    mount("en", { readout, loadErr: false });
    const text = container.textContent || "";
    const sents = glanceSentences(0, readout.unscorableCount);
    expect(text).toContain(sents.unscorable);
    expect(text).not.toContain(sents.empty);
    expect(text).not.toContain(sents.readout);
    expect(container.querySelectorAll("[data-acc-state]")).toHaveLength(1);
    expect(container.querySelector("[data-acc-state='unscorable']")).toBeTruthy();
  });

  it("at least one scorable: only the readout is in the DOM", () => {
    const readout = populatedAccuracyFixture();
    mount("en", { readout, loadErr: false });
    const text = container.textContent || "";
    const sents = glanceSentences(0, 1);
    expect(text).toContain(sents.readout);
    expect(text).not.toContain(sents.empty);
    expect(text).not.toContain(sents.unscorable);
    expect(container.querySelectorAll("[data-acc-state]")).toHaveLength(1);
    expect(container.querySelector("[data-acc-state='readout']")).toBeTruthy();
    expect(text).toContain(interpolate(LEX.accClaimCountN[0], { n: readout.claimCount }));
  });

  it("unscorable glance prints call count beside claim count when two overlapping calls collapse to one episode", () => {
    const readout = overlappingUnscorableAccuracyFixture();
    expect(readout.episodeCount).toBe(1);
    expect(readout.claimCount).toBe(2);
    expect(readout.unscorableCount).toBe(1);
    mount("en", { readout, loadErr: false });
    const text = container.textContent || "";
    expect(text).toContain(interpolate(LEX.accUnscorableN[0], { n: 2 }));
    expect(text).toContain(interpolate(LEX.accClaimCountN[0], { n: 2 }));
    expect(text).not.toContain(interpolate(LEX.accUnscorableN[0], { n: 1 }));
    expect(container.querySelectorAll("[data-acc-state]")).toHaveLength(1);
    expect(container.querySelector("[data-acc-state='unscorable']")).toBeTruthy();
  });

  it("EN unscorable glance is singular at n = 1", () => {
    const readout = unscorableAccuracyFixture();
    expect(readout.claimCount).toBe(1);
    mount("en", { readout, loadErr: false });
    const text = container.textContent || "";
    expect(text).toContain(LEX.accUnscorable1[0]);
    expect(text).not.toContain("1 calls could not be checked");
  });

  it("a non-account-owner sees the signed-out card, never Reading your record forever", () => {
    mount("en", { identity: GUEST_IDENTITY, readout: null, loadErr: false });
    const text = container.textContent || "";
    expect(text).toContain(LEX.acsSignInToOn[0]);
    expect(text).not.toContain(LEX.accUnread[0]);
    expect(container.querySelector("[data-acc-state='signed-out']")).toBeTruthy();
    expect(container.querySelector("[data-acc-state='unread']")).toBeNull();
  });

  it("EN claim-count line is singular at n = 1", () => {
    const readout = scorePersonalAccuracy([{
      claim_id: "1111111111111111",
      user_id: "11111111-1111-4111-8111-111111111111",
      subject: { kind: "security", id: "SPX" },
      stated_at: "2026-01-01T00:00:00.000Z",
      resolves_at: "2026-02-01T00:00:00.000Z",
      claim_text: "SPX finishes at or above 6000",
      condition: { metric: "last_close", comparator: ">=", threshold: 6000, owner: "quotes.last_close" },
      stated_probability: 0.7,
      evidence: [],
      status: "resolved",
      resolution: {
        outcome: 1,
        observed: 6100,
        resolved_at: "2026-02-01T00:00:00.000Z",
        resolver: "quotes.last_close",
        note: "",
      },
      supersedes: null,
    }]);
    expect(readout.claimCount).toBe(1);
    mount("en", { readout, loadErr: false });
    const text = container.textContent || "";
    expect(text).toContain(LEX.accClaimCount1[0]);
    expect(text).not.toContain("1 calls written down.");
  });
});

describe("SectionAccuracy detail honesty", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function mount(lang: "en" | "zh", extra: Partial<AccuracyProps> = {}) {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(SectionAccuracy, baseProps(lang, extra)));
    });
  }

  function openDetail() {
    const toggle = container.querySelector("[data-acc='toggle']") as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    return container.querySelector("[data-acc='detail']")?.textContent || "";
  }

  it("withheld Brier line prints the pair count in the glance and the detail", () => {
    const readout = populatedAccuracyFixture();
    expect(readout.brierMean).toBeNull();
    expect(readout.brierPairs).toBeGreaterThan(0);
    expect(readout.brierPairs).toBeLessThan(30);
    mount("en", { readout, loadErr: false });
    const expected = interpolate(LEX.accCalibWithheld[0], { n: readout.brierPairs });
    expect(container.textContent).toContain(expected);
    const detail = openDetail();
    expect(detail).toContain(expected);
  });

  it("never prints a bare Brier number; the denominator is the pair count", () => {
    const claims: UserClaim[] = Array.from({ length: 30 }, (_, i) => ({
      claim_id: `brier${i.toString(16).padStart(11, "0")}`.slice(0, 16),
      user_id: "11111111-1111-4111-8111-111111111111",
      subject: { kind: "security", id: `B${i}` },
      stated_at: "2026-01-01T00:00:00.000Z",
      resolves_at: "2026-02-01T00:00:00.000Z",
      claim_text: `Call ${i} finishes at or above the line.`,
      condition: { metric: "last_close", comparator: ">=", threshold: 100, owner: "quotes.last_close" },
      stated_probability: 0.5,
      evidence: [],
      status: "resolved",
      resolution: {
        outcome: 1,
        observed: 110,
        resolved_at: "2026-02-01T00:00:00.000Z",
        resolver: "quotes.last_close",
        note: "",
      },
      supersedes: null,
    }));
    const readout = scorePersonalAccuracy(claims);
    expect(readout.brierMean).not.toBeNull();
    mount("en", { readout, loadErr: false });
    const detail = openDetail();
    const expected = interpolate(LEX.accDetBrierN[0], {
      value: readout.brierMean!.toFixed(3),
      n: readout.brierPairs,
    });
    expect(detail).toContain(expected);
    expect(detail).not.toMatch(new RegExp(`>\\s*${readout.brierMean!.toFixed(3)}\\s*<`));
    expect(detail.includes(`Brier ${readout.brierMean!.toFixed(3)} over ${readout.brierPairs} resolved groups of calls.`)).toBe(true);
  });

  it("glance and detail print the same unscorable call tally on overlappingUnscorableAccuracyFixture", () => {
    const readout = overlappingUnscorableAccuracyFixture();
    expect(readout.unscorableCount).toBe(1);
    expect(readout.claimCount).toBe(2);
    mount("en", { readout, loadErr: false });
    const glance = interpolate(LEX.accUnscorableN[0], { n: 2 });
    expect(container.textContent).toContain(glance);
    openDetail();
    const dt = [...container.querySelectorAll("dt")].find(
      (el) => el.textContent === LEX.accDetUnscorable[0],
    );
    expect(dt).toBeTruthy();
    expect(dt!.nextElementSibling?.textContent).toBe("2");
  });

  it("labels name groups where the number is episodes and calls where it is claims", () => {
    const readout = overlappingUnscorableAccuracyFixture();
    expect(readout.episodeCount).not.toBe(readout.claimCount);
    mount("en", { readout, loadErr: false });
    const detail = openDetail();
    expect(detail).toContain(LEX.accDetEpisodes[0]);
    expect(detail).toContain(LEX.accDetClaims[0]);
    const episodeDt = [...container.querySelectorAll("dt")].find(
      (el) => el.textContent === LEX.accDetEpisodes[0],
    );
    const claimDt = [...container.querySelectorAll("dt")].find(
      (el) => el.textContent === LEX.accDetClaims[0],
    );
    expect(episodeDt?.nextElementSibling?.textContent).toBe(String(readout.episodeCount));
    expect(claimDt?.nextElementSibling?.textContent).toBe(String(readout.claimCount));
  });

  it("while accEarlyN renders the stance line is not printed twice", () => {
    const claims: UserClaim[] = Array.from({ length: 5 }, (_, i) => ({
      claim_id: `early${i.toString(16).padStart(11, "0")}`.slice(0, 16),
      user_id: "11111111-1111-4111-8111-111111111111",
      subject: { kind: "security", id: `E${i}` },
      stated_at: "2026-01-01T00:00:00.000Z",
      resolves_at: "2026-02-01T00:00:00.000Z",
      claim_text: `Call ${i} finishes at or above the line.`,
      condition: { metric: "last_close", comparator: ">=", threshold: 100, owner: "quotes.last_close" },
      stated_probability: 0.5,
      evidence: [],
      status: "resolved",
      resolution: {
        outcome: 1,
        observed: 110,
        resolved_at: "2026-02-01T00:00:00.000Z",
        resolver: "quotes.last_close",
        note: "",
      },
      supersedes: null,
    }));
    const readout = scorePersonalAccuracy(claims);
    expect(readout.resolvedEpisodes).toBe(5);
    expect(readout.resolvedEpisodes).toBeGreaterThan(0);
    expect(readout.resolvedEpisodes).toBeLessThan(10);
    expect(readout.stance).toBe("Too early to say");
    mount("en", { readout, loadErr: false });
    const text = container.textContent || "";
    const early = interpolate(LEX.accEarlyN[0], { n: 5 });
    expect(text).toContain(early);
    const stanceHits = (text.match(/Too early to say/g) || []).length;
    expect(stanceHits).toBe(1);
  });

  it("ZH detail rows use a full-width colon and omit the raw subject identifier", () => {
    mount("zh", { readout: populatedAccuracyFixture(), loadErr: false });
    const detail = openDetail();
    expect(detail).toContain("：");
    expect(detail).not.toMatch(/实际结果: /);
    expect(detail).not.toMatch(/核对日期: /);
    expect(detail).not.toContain("N0");
    expect(detail).not.toContain("N1");
  });

  it("imports display floors from the scorer and does not re-type them", () => {
    const src = readFileSync(
      join(__dirname, "../../components/settings/SectionAccuracy.tsx"),
      "utf8",
    );
    expect(src).toMatch(/HIT_RATE_MIN_EPISODES/);
    expect(src).toMatch(/BRIER_MIN_PAIRS/);
    expect(src).not.toMatch(/nResolved < 10/);
    expect(src).not.toMatch(/brierPairs.{0,40}< 30/);
  });
});

