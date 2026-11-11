// @vitest-environment jsdom
// H1 (#1200 audit r6 MINOR 1 + seat finding H1b): VolView reads the asof chip and the read's
// age from the validated day (`volIsoDay`), the same day every other source-clock render on
// the vol surface uses. A malformed asof behaves exactly like a missing one: no chip, no
// stale age, no stale note in the comparison panel, and neither the raw string nor a
// rolled-over date (V8 parses 2026-02-30 as 2 Mar) reaches the DOM. A valid asof keeps the
// chip and the age unchanged.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { flowGetMock, fundGetMock, langRef } = vi.hoisted(() => ({
  flowGetMock: vi.fn(),
  fundGetMock: vi.fn(),
  langRef: { lang: "en" as "en" | "zh" },
}));
vi.mock("@/lib/flowClientCache", () => ({
  // VolView reads through flowGetResult: a payload is data, a null is a published absence (404).
  flowGetResult: async (key: string) => {
    const data = await flowGetMock(key);
    return data == null ? { status: "absent", httpStatus: 404 } : { status: "data", data };
  },
}));
vi.mock("@/lib/dataCache", () => ({ getJSONResult: async (url: string) => fundGetMock(url) }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: langRef.lang, setLang: () => undefined }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { VolView } from "@/components/vol/VolView";

let el: HTMLDivElement, root: Root;
beforeEach(() => {
  // The age counts ET weekdays from the asof day to the viewer's ET today, so the calendar is
  // pinned (Date only: timers stay real so settle() still yields).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00-04:00"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  flowGetMock.mockReset();
  fundGetMock.mockReset();
  fundGetMock.mockImplementation(async () => ({ status: "absent" }));
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root.unmount());
  el.remove();
  langRef.lang = "en";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function render(v: React.ReactNode) { await act(async () => root.render(v)); }
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const text = () => el.textContent ?? "";

function volPayload(asof: string | undefined) {
  return {
    schema: "options_hub.vol/v1",
    root: "SPY",
    asof,
    atm_iv: 12,
    iv_52w_hi: 22,
    iv_52w_lo: 7,
    rv20: 11,
    vrp: 1,
    term: [
      { exp: "2026-10-23", dte: 28, atm_iv: 14.6 },
      { exp: "2026-11-20", dte: 56, atm_iv: 16.1 },
    ],
    smile: [{ exp: "2026-11-20", points: [{ strike: 660, call_iv: 15.2, put_iv: 15.4 }] }],
    history: Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, iv_rank: null, atm_iv: 12 + i * 0.1, close: null })),
  };
}
async function mount(asof: string | undefined, lang: "en" | "zh") {
  langRef.lang = lang;
  flowGetMock.mockImplementation(async (key: string) => (key === "vol:SPY" ? volPayload(asof) : null));
  await render(<VolView key={`${lang}:${asof ?? "missing"}`} />);
  await settle();
  // The comparison panel is mounted, so a passing negative is not an empty page.
  expect(el.querySelector('[data-testid="vol-compare"]'), "the comparison panel").toBeTruthy();
}

const LANGS = ["en", "zh"] as const;
const CHIP = { en: "Nightly EOD · as of ", zh: "每晚收盘 · 更新于 " };
const AGE = { en: "sessions old", zh: "个交易日前" };
const STALE = { en: "this read is", zh: "本次读数已过去" };
const ROLLED = { en: "2 Mar", zh: "3月2日" };
// 2026-10-14 (Wed) to the pinned ET today 2026-10-21 (Wed) is 5 weekdays: stale (> 3). The age
// span's gap is its marginLeft, so the chip's text has no space before " · " (unchanged form).
const DATED_CHIP = {
  en: "Nightly EOD · as of 2026-10-14· 5 sessions old",
  zh: "每晚收盘 · 更新于 2026-10-14· 5 个交易日前",
};
const DATED_STALE = {
  en: "Vol as of 14 Oct · this read is 5 sessions old · both clocks stay visible",
  zh: "波动率截至 10月14日 · 本次读数已过去 5 个交易日 · 两个时钟均保留显示",
};
const chip = (lang: "en" | "zh") =>
  [...el.querySelectorAll("span")].find((s) => (s.textContent ?? "").startsWith(CHIP[lang]));
const STALE_PREFIX = { en: "Vol as of ", zh: "波动率截至 " };
const staleNote = (lang: "en" | "zh") =>
  [...el.querySelectorAll("span")].find((s) => (s.textContent ?? "").startsWith(STALE_PREFIX[lang]));

describe("VolView · H1 the asof chip and the age read the validated asof day", () => {
  for (const lang of LANGS) {
    it(`[${lang}] a valid asof keeps the chip, the age and the stale note`, async () => {
      await mount("2026-10-14T21:00:00Z", lang);
      expect(chip(lang)?.textContent).toBe(DATED_CHIP[lang]);
      expect(staleNote(lang)?.textContent).toBe(DATED_STALE[lang]);
    });

    it(`[${lang}] a missing asof renders no chip, no age and no stale note`, async () => {
      await mount(undefined, lang);
      expect(chip(lang)).toBeUndefined();
      expect(text()).not.toContain(AGE[lang]);
      expect(text()).not.toContain(STALE[lang]);
    });

    for (const bad of ["2026-02-30T21:00:00Z", "2026-13-45", "2026-10-xx"]) {
      it(`[${lang}] a malformed asof ${bad} behaves exactly like a missing one`, async () => {
        await mount(undefined, lang);
        const missingText = text();
        await mount(bad, lang);
        expect.soft(chip(lang)?.textContent, "the asof chip").toBeUndefined();
        expect.soft(text(), "the stale age").not.toContain(AGE[lang]);
        expect.soft(text(), "the panel stale note").not.toContain(STALE[lang]);
        expect.soft(text(), "the raw malformed date").not.toContain(bad.slice(0, 10));
        expect.soft(text(), "a rolled-over date").not.toContain(ROLLED[lang]);
        expect.soft(text(), "the same page as a missing asof").toBe(missingText);
      });
    }
  }
});
