// @vitest-environment jsdom
//
// B1 — Overview analysis section destinations. The financial Overview sections
// jump to their existing sibling financials tab through a real native button
// inside the section heading (platform keyboard activation, global
// :focus-visible outline), while Key facts and About stay plain semantic
// <h2> text. This suite renders the actual OverviewPage component — SecH is
// deliberately not duplicated here — against a synthetic minimal Fund, in both
// locales, and reads the shipped CSS/source to bind the no-rail heading law.
// JSDOM cannot prove the UA's native Enter/Space default; that is reported
// from source (no synthetic key handlers exist) and verified separately in a
// real browser phase.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fund } from "../fund";
import type { FinPage } from "../../components/fin/MegaPane";

const { state } = vi.hoisted(() => ({ state: { lang: "en" as "en" | "zh" } }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: state.lang }) }));
// Chart primitives are not what this suite exercises — stub them out so the
// section headers around them render without a measured-canvas environment.
vi.mock("@/components/fin/FinCharts", () => {
  const stub = () => null;
  return {
    Donut: stub,
    CapitalStructure: stub,
    LineSeries: stub,
    ComboChart: stub,
    Waterfall: stub,
    Dumbbell: stub,
    Bars: stub,
  };
});
import OverviewPage from "@/components/fin/OverviewPage";

/** Read a shipped source file by terminal-relative path, from the vitest cwd or its repo root. */
const shipped = (p: string): string => {
  const cwd = process.cwd();
  for (const full of [resolve(cwd, p), resolve(cwd, "terminal", p)]) {
    try {
      return readFileSync(full, "utf8");
    } catch {
      /* try the other base */
    }
  }
  throw new Error(`shipped source not found from ${cwd}: ${p}`);
};
const overviewSrc = shipped("components/fin/OverviewPage.tsx");
const finCss = shipped("app/fin.css");
const globalsCss = shipped("app/globals.css");

// Minimal synthetic snapshot: every other Overview body section is
// null-guarded and renders its empty state around it.
const fund = {
  schema: "mastermind.fund/v1",
  ticker: "TEST",
  profile: { description: "Synthetic test company used to surface the static About heading." },
  earnings: { q: [], fy: [] },
} as unknown as Fund;

const DEST_EN = [
  { title: "Valuation", page: "statistics" },
  { title: "Growth and Profitability", page: "statements" },
  { title: "Revenue breakdown", page: "revenue" },
  { title: "Estimates", page: "earnings" },
  { title: "Dividends", page: "dividends" },
  { title: "Financial health", page: "statistics" },
] as const;
const DEST_ZH = [
  { title: "估值", page: "statistics" },
  { title: "增长与盈利能力", page: "statements" },
  { title: "收入构成", page: "revenue" },
  { title: "预测", page: "earnings" },
  { title: "股息", page: "dividends" },
  { title: "财务健康", page: "statistics" },
] as const;
const STATIC_EN = ["Key facts", "About"] as const;
const STATIC_ZH = ["关键数据", "公司简介"] as const;

let host: HTMLDivElement, root: Root, onNavigate: ReturnType<typeof vi.fn>, fetchSpy: ReturnType<typeof vi.fn>;

async function renderOverview() {
  await act(async () => {
    root.render(<OverviewPage sym="TEST" fund={fund} name="Test Co." onNavigate={onNavigate} />);
  });
}

const headings = () => [...host.querySelectorAll("h2.fin-sec-h")] as HTMLHeadingElement[];
const headingByTitle = (title: string) =>
  headings().find((h) => h.textContent!.includes(title));

/** The interactive heading law: a native button carries the jump, the <h2> itself carries nothing. */
function expectActionHeading(title: string): HTMLButtonElement {
  const h = headingByTitle(title);
  expect(h, `missing section heading ${title}: ${host.textContent}`).toBeDefined();
  expect(h!.className).toContain("fin-rule");
  expect(h!.className).toContain("link");
  expect(h!.className).not.toContain("fin-rail");
  expect(h!.getAttribute("role")).toBeNull();
  expect(h!.getAttribute("tabindex")).toBeNull();
  expect(h!.getAttribute("onclick")).toBeNull();
  const btn = h!.querySelector("button.fin-sec-action") as HTMLButtonElement | null;
  if (!btn) throw new Error(`missing native button in ${title}`);
  expect(btn.getAttribute("type")).toBe("button");
  expect(btn.getAttribute("tabindex")).toBeNull(); // naturally focusable, no synthetic index
  expect(btn.hasAttribute("onKeyDown")).toBe(false); // native Enter/Space default only
  expect(btn.hasAttribute("onKeyUp")).toBe(false);
  const chev = btn.querySelector(".chev");
  expect(chev, `missing chevron in ${title}`).toBeDefined();
  expect(chev!.getAttribute("aria-hidden")).toBe("true");
  expect(btn.textContent).toContain(title);
  return btn;
}

/** The static heading law: semantic <h2> text only — no control, no arrow, no role. */
function expectStaticHeading(title: string) {
  const h = headingByTitle(title);
  expect(h, `missing static heading ${title}: ${host.textContent}`).toBeDefined();
  expect(h!.className).toContain("fin-sec-h");
  expect(h!.className).toContain("fin-rule");
  expect(h!.className).not.toContain("link");
  expect(h!.className).not.toContain("fin-rail");
  expect(h!.textContent).toBe(title); // no `›` arrow inside the heading name
  expect(h!.querySelector("button")).toBeNull();
  expect(h!.getAttribute("role")).toBeNull();
  expect(h!.getAttribute("tabindex")).toBeNull();
  expect(h!.getAttribute("onclick")).toBeNull();
}

async function clickAll(destinations: readonly { title: string; page: FinPage }[]) {
  for (const { title } of destinations) {
    const btn = expectActionHeading(title);
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  expect(onNavigate.mock.calls.map((c: unknown[]) => c[0])).toEqual(destinations.map((d) => d.page));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.lang = "en";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onNavigate = vi.fn();
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy); // trap: the Overview must need no request at all
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("Overview analysis section destinations (B1)", () => {
  it("jumps through a native button inside each of the six section headings and keeps Key facts/About static in English", async () => {
    await renderOverview();
    expect(headings().length).toBe(8);
    expect(host.querySelectorAll("h2.fin-sec-h button.fin-sec-action").length).toBe(6);
    for (const title of STATIC_EN) expectStaticHeading(title);
    await clickAll(DEST_EN);
    // every heading's button is keyboard-reachable in DOM order (native focus)
    for (const btn of host.querySelectorAll("h2.fin-sec-h button.fin-sec-action")) {
      (btn as HTMLButtonElement).focus();
      expect(document.activeElement).toBe(btn);
    }
  });

  it("keeps the same six destinations and static headings under Chinese labels", async () => {
    state.lang = "zh";
    await renderOverview();
    expect(headings().length).toBe(8);
    expect(host.querySelectorAll("h2.fin-sec-h button.fin-sec-action").length).toBe(6);
    for (const title of STATIC_ZH) expectStaticHeading(title);
    await clickAll(DEST_ZH);
  });

  it("binds the no-rail heading law and the inherited-button/global-focus contract in the shipped source", () => {
    // decorative brand rail is gone from the component and its stylesheet
    expect(overviewSrc).toContain("fin-sec-action");
    expect(overviewSrc).not.toMatch(/fin-rail/);
    expect(overviewSrc).not.toMatch(/--rail/);
    expect(overviewSrc).not.toMatch(/onKeyDown|onKeyUp|tabIndex/);
    expect(finCss).not.toMatch(/fin-rail/);
    // no section-header rule carries the rail variable or a ::before stripe
    // (rails on other decks — .fin-adv-title, .fin-ro-title — are their own
    // writer's scope and stay untouched here)
    expect(finCss).not.toMatch(/\.fin-sec-h[^{]*\{[^}]*--rail/);
    expect(finCss).not.toMatch(/\.fin-sec-h[^{]*::before/);
    // <h2> keeps the exact old spacing (0 top / 3px bottom), not UA heading margins
    expect(finCss).toMatch(/\.fin-sec-h\{[^}]*margin:0 0 3px/);
    // the hairline rule survives on the heading
    expect(finCss).toMatch(/\.fin-sec-h\.fin-rule\{[^}]*border-bottom:1px solid var\(--hairline\)/);
    // the button fills the header row as a 40px touch target and relies on the
    // global button reset (font/color inheritance, transparent, no border)
    expect(finCss).toMatch(/\.fin-sec-action\{[^}]*width:100%/);
    expect(finCss).toMatch(/\.fin-sec-action\{[^}]*min-height:40px/);
    expect(finCss).toMatch(/\.fin-sec-action\{[^}]*gap:7px/);
    expect(finCss).toMatch(/\.fin-sec-action\{[^}]*padding:0/);
    expect(finCss).toMatch(/\.fin-sec-action\{[^}]*text-align:left/);
    expect(globalsCss).toMatch(/^button\{font:inherit;color:inherit;background:none;border:0;cursor:pointer\}$/m);
    // the complete global focus ring is untouched — never suppressed per control
    expect(globalsCss).toMatch(/:focus-visible\{outline:2px solid var\(--brand-2\);outline-offset:2px\}/);
    expect(finCss).not.toMatch(/\.fin-sec-action[^{]*\{[^}]*outline:/);
  });
});
