import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  decodeBetaEvaluation, findComparator, INCUMBENT_COMPARATOR_ID, intervalIncludesZero,
} from "../lib/prophetBetaEvaluation";
import {
  fmtCi95, fmtCount, fmtCriterionObserved, fmtPercent, fmtP, fmtRatio, fmtSignedPercent, fmtSignedPp,
} from "../lib/prophetBetaEvaluationFormat";
import { comparatorShortName, evaluationLevelLabel, getEvaluationStr } from "../lib/prophetEvaluationStrings";

/**
 * `/prophet/evaluation` — the Strategy Evaluation surface (SX05/SX12).
 *
 * Every numeric expectation is DERIVED from the committed artifact: the spec
 * decodes `public/data/prophet_beta_evaluation_fixture.json` with the
 * production decoder and formats expectations with the production formatters.
 * No figure, sign or judgement is pinned in prose here, so the suite keeps
 * telling the truth when the engine republishes a corrected artifact — the
 * only literals below are static copy and law (titles, banned vocabulary).
 *
 * The dev server's fixture seam (TERMINAL_E2E_FIXTURE=1) makes the BFF serve
 * that same file through the closed decoder gate as the live path. Evidence
 * shots land in the programme's recon directory (overridable).
 */
const SHOTS = process.env.PROPHET_EVAL_SHOTS_DIR || "/home/ubuntu2/tmp/prophet-recon/shots/D";
const PANELS = ["details", "attribution", "coverage", "portfolio"] as const;

// ── The artifact, decoded once ───────────────────────────────────────────────
const ART = decodeBetaEvaluation(
  JSON.parse(readFileSync(path.join(__dirname, "../public/data/prophet_beta_evaluation_fixture.json"), "utf8")),
);
if (!ART) throw new Error("committed fixture must decode — the surface's whole premise");

const c6row = findComparator(ART.comparators, INCUMBENT_COMPARATOR_ID);
if (!c6row || c6row.status !== "evaluated" || !c6row.vsSpy) {
  throw new Error("fixture must carry an evaluated incumbent comparator row");
}
const c6 = c6row;
const vs = c6row.vsSpy;
if (vs.totalDiff === null || vs.totalDiffCi95 === null || c6row.totalNetReturn === null) {
  throw new Error("fixture incumbent row must carry the total-window comparison");
}
const DIFF = vs.totalDiff, CI = vs.totalDiffCi95, BOOK = c6row.totalNetReturn;
const CI_SPANS_ZERO = intervalIncludesZero(CI);

const post = ART.postHocDiagnostics.books.find(entry => entry.bookId === INCUMBENT_COMPARATOR_ID)?.book ?? null;
const exName = post?.withoutTopContributor ?? null;
const topContrib = post?.topContributors[0] ?? null;
const h21 = ART.eventStudy.horizons.find(h => h.horizon === "21") ?? null;
const bridge = ART.attribution.find(entry => entry.bookId === INCUMBENT_COMPARATOR_ID)?.book ?? null;
const globalMin = ART.release.globalMinimumForL1;
const requiredDigits = (criterion: string): string => {
  const raw = globalMin.find(c => c.criterion === criterion)?.required ?? "";
  return raw.match(/\d+/)?.[0] ?? raw;
};
const ddRequired = globalMin.find(c => c.criterion === "spy_drawdown_present")?.required ?? "";

const EN = getEvaluationStr.bind(null, "en") as (key: Parameters<typeof getEvaluationStr>[1]) => string;
const chipEn = evaluationLevelLabel("en", ART.release.overallLevel);
const benchmarkName = ART.basis.benchmark;
const incumbentLabel = comparatorShortName("en", INCUMBENT_COMPARATOR_ID, INCUMBENT_COMPARATOR_ID);

// One explicit-viewport worker: the spec sets 1440/390/320 itself, so the
// desktop/tablet/mobile project matrix would only triple identical work.
test.beforeEach(({}, testInfo) => {
  testInfo.skip(testInfo.project.name !== "desktop", "explicit-viewport evidence spec");
});

async function prepare(page: Page, baseURL: string | undefined, lang: "en" | "zh" = "en") {
  // The config always binds a baseURL; the guard only satisfies the fixture's optional type.
  if (baseURL) await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL }]);
  await page.addInitScript((lang: string) => {
    localStorage.setItem("mm.lang", lang);
  }, lang);
}

function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  return page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function expectNoHorizontalOverflow(page: Page) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(fits).toBe(true);
}

const PANEL_PROOF: Record<(typeof PANELS)[number], (page: Page) => Promise<void>> = {
  // Global-minimum criteria and their required/observed strings ride in the details panel.
  details: async page => {
    for (const c of globalMin.slice(0, 3)) {
      await expect(page.getByRole("dialog")).toContainText(c.required);
      if (c.observed !== null) {
        await expect(page.getByRole("dialog")).toContainText(fmtCriterionObserved(c.criterion, c.observed));
      }
    }
  },
  // The published bridge legs and their identity check (the ex-name table
  // lives on the main surface's caveats card, verified by the cold-reader test).
  attribution: async page => {
    if (!bridge) return;
    await expect(page.getByRole("dialog")).toContainText(fmtSignedPp(bridge.bridge.sectorAllocation));
    await expect(page.getByRole("dialog")).toContainText(fmtSignedPp(bridge.bridge.selectionWithinSector));
    await expect(page.getByRole("dialog")).toContainText((bridge.identityError * 100).toFixed(4));
  },
  // Hit rate and the excluded-name census.
  coverage: async page => {
    if (c6.hitRateVsSpy) {
      await expect(page.getByRole("dialog")).toContainText(fmtCount(c6.hitRateVsSpy.beatSpy));
      await expect(page.getByRole("dialog")).toContainText(fmtCount(c6.hitRateVsSpy.n));
    }
    await expect(page.getByRole("dialog")).toContainText(fmtCount(ART.coverage.evaluatedPositions));
  },
  // The model-book line plus the existing portfolio destination.
  portfolio: async page => {
    await expect(page.getByRole("dialog").getByRole("link", { name: /Portfolio|投资组合/ })).toHaveAttribute("href", "/portfolio");
  },
};

test("cold reader: verdict, participation, comparison family and caveats (EN 1440)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  // A validated same-origin ?from is honoured by the back link.
  await page.goto("/prophet/evaluation?from=/today");
  await expect(page.getByTestId("pev-level-chip")).toHaveText(chipEn);
  await expect(page.locator("h1")).toHaveText(EN("pageTitle"));
  await expect(page.locator(".pev-back")).toHaveAttribute("href", "/today");

  // The honest verdict, first: window, book vs market, one claim sentence.
  await expect(page.getByTestId("pev-verdict-level")).toContainText(chipEn);
  const verdict = page.getByTestId("pev-verdict");
  await expect(verdict).toContainText(fmtCount(ART.window.sessions));
  await expect(verdict).toContainText(ART.window.firstReturnClose);
  await expect(verdict).toContainText(ART.window.lastClose);
  await expect(verdict).toContainText(requiredDigits("window_sessions"));
  await expect(verdict).toContainText(ddRequired);
  await expect(verdict).toContainText(fmtSignedPercent(ART.window.spyMaxDrawdown));
  const bookCard = page.getByTestId("pev-verdict-book");
  await expect(bookCard).toContainText(fmtSignedPercent(BOOK));
  await expect(bookCard).toContainText(fmtSignedPercent(ART.window.spyTotalReturn));
  await expect(bookCard).toContainText(fmtSignedPp(DIFF));
  await expect(bookCard).toContainText(fmtCi95(CI[0], CI[1], "pp"));
  await expect(bookCard).toContainText(EN(CI_SPANS_ZERO ? "ciIncludesZero" : "ciExcludesZero"));
  // The dominant message follows the interval, whatever its sign: when it
  // spans zero the reader is told the book is not distinguishable from the
  // market — never a win framing.
  const distinguishable = page.getByTestId("pev-verdict-distinguishable");
  const distinguishSentence = EN(CI_SPANS_ZERO ? "notDistinguishableSentence" : "intervalExcludesZeroNote")
    .replace("{sessions}", fmtCount(ART.window.sessions))
    .replace("{benchmark}", benchmarkName);
  await expect(distinguishable).toContainText(distinguishSentence);
  await expect(verdict).toContainText("not established");
  const minimum = page.getByTestId("pev-minimum");
  for (const c of globalMin) {
    await expect(minimum).toContainText(c.required);
    if (c.observed !== null) {
      await expect(minimum).toContainText(fmtCriterionObserved(c.criterion, c.observed));
    }
  }

  // Market participation: beta with its interval, invested weight, captures.
  const participation = page.getByTestId("pev-participation");
  if (c6.beta !== null) await expect(participation).toContainText(fmtRatio(c6.beta));
  if (c6.betaCi95) await expect(participation).toContainText(fmtCi95(c6.betaCi95[0], c6.betaCi95[1], "x", 2));
  if (c6.meanInvested !== null) await expect(participation).toContainText(fmtPercent(c6.meanInvested));
  if (c6.upsideCapture !== null) await expect(participation).toContainText(fmtRatio(c6.upsideCapture));
  if (c6.downsideCapture !== null) await expect(participation).toContainText(fmtRatio(c6.downsideCapture));

  // The single honest comparison: forest plot + corrected-p table.
  await expect(page.locator("svg.pev-forest")).toBeVisible();
  const table = page.getByTestId("pev-comparison-table");
  await expect(table).toContainText(incumbentLabel);
  await expect(table).toContainText(fmtSignedPp(DIFF));
  await expect(table).toContainText(fmtCi95(CI[0], CI[1], "pp"));
  await expect(page.getByTestId("pev-k-table")).toContainText(fmtP(ART.contrasts.rows[0].pHolm));

  // Material caveats in place, at full size, not buried.
  const caveats = page.getByTestId("pev-caveats");
  if (exName && topContrib) {
    await expect(caveats).toContainText(exName.droppedAsset);
    await expect(caveats).toContainText(fmtSignedPp(exName.excessTotalVsSpy));
    await expect(caveats).toContainText(fmtCi95(exName.excessTotalCi95[0], exName.excessTotalCi95[1], "pp"));
    await expect(caveats).toContainText(fmtSignedPp(topContrib.grossContribution));
  }
  if (post) await expect(caveats).toContainText(fmtPercent(post.top5ShareOfPositiveContribution));
  if (h21) {
    await expect(caveats).toContainText(fmtSignedPp(h21.excessVsSpy.mean));
    await expect(caveats).toContainText(fmtCi95(h21.excessVsSpy.ci95DateCluster[0], h21.excessVsSpy.ci95DateCluster[1], "pp"));
    await expect(caveats).toContainText(fmtPercent(h21.shareBeatingSpy.rate));
  }

  // Copy law: no alpha/outperformance/edge vocabulary anywhere on the surface.
  const surface = await page.locator(".pev").innerText();
  expect(surface).not.toMatch(/\balpha\b|outperform|beat(s)? the market|\bedge\b/i);

  await expectNoHorizontalOverflow(page);
  await shot(page, "main-1440.png");
});

test("four disclosures open by click, close with Esc and return focus (EN 1440)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.goto("/prophet/evaluation");
  for (const key of PANELS) {
    const trigger = page.getByTestId(`pev-open-${key}`);
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await PANEL_PROOF[key](page);
    await shot(page, `${key}-1440.png`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The opener receives focus back after the sheet closes.
    await expect(trigger).toBeFocused();
  }
});

test("direct panel URLs open the disclosure without a click and Esc cleans the URL (EN 1440)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.goto("/prophet/evaluation?panel=attribution");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await PANEL_PROOF.attribution(page);
  await page.keyboard.press("Escape");
  // A direct link must close by cleaning the URL, never by navigating away.
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/prophet\/evaluation$/);
});

test("keyboard-only: the surface and its disclosures are reachable without a pointer (EN 1440)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.goto("/prophet/evaluation");
  await expect(page.getByTestId("pev-level-chip")).toBeVisible();
  // Tab until a disclosure trigger is active (bounded walk from the page start).
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.testid === "pev-open-coverage",
    );
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Focus is trapped inside the open dialog.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  for (let i = 0; i < 2; i++) {
    const inside = await page.evaluate(() => {
      const active = document.activeElement;
      return active != null && active.closest('[role="dialog"]') != null;
    });
    expect(inside).toBe(true);
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("pev-open-coverage")).toBeFocused();
});

test("unavailable upstream renders the designed state and recovers on retry (EN 1440)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.route("**/api/prophet/beta-evaluation*", route =>
    route.fulfill({ status: 503, json: { error: "evaluation_unavailable" } }));
  await page.goto("/prophet/evaluation");
  await expect(page.locator("h1")).toHaveText(EN("unavailableTitle"));
  await expect(page.getByRole("button", { name: EN("tryAgain") })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot(page, "unavailable-1440.png");
  // Retry against the real fixture seam restores the verdict.
  await page.unroute("**/api/prophet/beta-evaluation*");
  await page.getByRole("button", { name: EN("tryAgain") }).click();
  await expect(page.getByTestId("pev-level-chip")).toHaveText(chipEn);
});

test("the full surface reads in Chinese (ZH 1440)", async ({ page, baseURL }) => {
  await prepare(page, baseURL, "zh");
  await page.goto("/prophet/evaluation");
  const ZH = getEvaluationStr.bind(null, "zh") as (key: Parameters<typeof getEvaluationStr>[1]) => string;
  await expect(page.locator("h1")).toHaveText(ZH("pageTitle"));
  await expect(page.getByTestId("pev-level-chip")).toHaveText(evaluationLevelLabel("zh", ART.release.overallLevel));
  await expect(page.getByTestId("pev-verdict-level")).toContainText(evaluationLevelLabel("zh", ART.release.overallLevel));
  await expect(page.locator(".pev-back")).toContainText(ZH("backToProphet"));
  await expect(page.getByTestId("pev-verdict-book")).toContainText(ZH(CI_SPANS_ZERO ? "ciIncludesZero" : "ciExcludesZero"));
  await expectNoHorizontalOverflow(page);
  await shot(page, "main-zh-1440.png");
});

test("phone width 390 holds without horizontal scroll (EN)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/prophet/evaluation");
  await expect(page.getByTestId("pev-level-chip")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot(page, "main-390.png");
  for (const key of PANELS) {
    await page.getByTestId(`pev-open-${key}`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, `${key}-390.png`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.route("**/api/prophet/beta-evaluation*", route =>
    route.fulfill({ status: 503, json: { error: "evaluation_unavailable" } }));
  await page.reload();
  await expect(page.locator("h1")).toHaveText(EN("unavailableTitle"));
  await expectNoHorizontalOverflow(page);
  await shot(page, "unavailable-390.png");
});

test("narrow 320 width still fits (EN)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/prophet/evaluation");
  await expect(page.getByTestId("pev-level-chip")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot(page, "main-320.png");
  for (const key of PANELS) {
    await page.getByTestId(`pev-open-${key}`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, `${key}-320.png`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.route("**/api/prophet/beta-evaluation*", route =>
    route.fulfill({ status: 503, json: { error: "evaluation_unavailable" } }));
  await page.reload();
  await expect(page.locator("h1")).toHaveText(EN("unavailableTitle"));
  await expectNoHorizontalOverflow(page);
  await shot(page, "unavailable-320.png");
});
