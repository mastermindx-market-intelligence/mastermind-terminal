// @vitest-environment jsdom
//
// Review MAJOR (round 2): accDetLoadErr was rendered in the glance body when
// loadErr was set. Spec 2.6 / reviewer §3.5 allow that sentence only behind
// the detail control. This mounts the real SectionAccuracy (no test double)
// and reads the rendered text before and after the toggle.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import SectionAccuracy from "@/components/settings/SectionAccuracy";
import { LEX } from "@/lib/i18n";
import { emptyAccuracyReadout, scorePersonalAccuracy, type UserClaim } from "@/lib/personalAccuracy";
import { populatedAccuracyFixture, unscorableAccuracyFixture } from "@/app/dev/settings/accuracyFixtures";
import type { AccuracyProps } from "@/components/settings/SectionAccuracy";

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
    identity: { kind: "guest" },
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

  it("EN: a load error is not in the glance body; it appears after Show the full record", () => {
    const err = LEX.accDetLoadErr[0];
    mount("en", { readout: null, loadErr: true });
    expect(container.textContent).not.toContain(err);
    expect(container.textContent).toContain(LEX.accCeiling[0]);
    const toggle = container.querySelector("[data-acc='toggle']") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.textContent).toBe(LEX.accDetailOpen[0]);
    act(() => {
      toggle.click();
    });
    expect(container.querySelector("[data-acc='detail']")?.textContent).toContain(err);
    expect(container.querySelector(".acs-body")?.textContent).toContain(err);
  });

  it("ZH: a load error is not in the glance body; it appears after 查看完整记录", () => {
    const err = LEX.accDetLoadErr[1];
    mount("zh", { readout: null, loadErr: true });
    expect(container.textContent).not.toContain(err);
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
    unscorable: interpolate(LEX.accUnscorableN[lang], { n: nUnscorable }),
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
    expect(detail.includes(`Brier ${readout.brierMean!.toFixed(3)} over ${readout.brierPairs} resolved calls.`)).toBe(true);
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

