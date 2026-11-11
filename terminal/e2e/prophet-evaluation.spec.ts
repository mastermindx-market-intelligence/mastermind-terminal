import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  decodeBetaEvaluation, findComparator, INCUMBENT_COMPARATOR_ID, intervalIncludesZero,
  memberYardstickMarks, perPlanHorizonMarks,
} from "../lib/prophetBetaEvaluation";
import {
  fmtCi95, fmtCount, fmtCriterionObserved, fmtDate, fmtPercent, fmtP, fmtRatio,
  fmtSignedPercent, fmtSignedPp,
} from "../lib/prophetBetaEvaluationFormat";
import {
  comparatorShortName, evaluationLevelLabel, getEvaluationStr, humanizeEngineText, perPlanFigure,
} from "../lib/prophetEvaluationStrings";

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
 * shots are best-effort: with PROPHET_EVAL_SHOTS_DIR set they land there
 * (local evidence capture), otherwise in Playwright's own per-test output
 * directory under the configured test-results root — never a host path.
 *
 * Every sheet screenshot waits for the panel's entrance animation to settle
 * first: the D-set capture fault was a mid-animation frame (opacity 0.576 at
 * 66.7ms of the 200ms `pev-panel-in`), not a styling defect.
 */
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
const h21Full = h21 && h21.excessVsSpy && h21.shareBeatingSpy && h21.stockMinusSectorEtf && h21.sectorEtfMinusSpy
  ? h21 : null;
const bridge = ART.attribution.find(entry => entry.bookId === INCUMBENT_COMPARATOR_ID)?.book ?? null;
const globalMin = ART.release.globalMinimumForL1;
const requiredDigits = (criterion: string): string => {
  const raw = globalMin.find(c => c.criterion === criterion)?.required ?? "";
  return raw.match(/\d+/)?.[0] ?? raw;
};
const ddRequired = globalMin.find(c => c.criterion === "spy_drawdown_present")?.required ?? "";

// D5 correction facts (all from the artifact; the page never hard-codes them).
const cohort = ART.population?.excludedCohort ?? null;
const sensitivity = ART.sensitivity ?? null;
const variant = sensitivity?.backfillReplaysAdmittedAfterAvailability ?? null;
const superseded = sensitivity?.supersededAsRun ?? null;
const oldC6 = superseded?.rows.find(entry => entry.comparatorId === INCUMBENT_COMPARATOR_ID)?.row ?? null;
const OLD_EXCESS = oldC6?.excessTotalVsSpy ?? null;
const populationDeviation = ART.deviations.find(d => d.kind === "population_correction") ?? null;
const correctionDate = populationDeviation?.when.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
const h63 = ART.eventStudy.horizons.find(h => h.horizon === "63") ?? null;

// The 2026-11-11 correction blocks (all optional; every assertion branches on
// them so the suite keeps telling the truth on an uncorrected artifact).
const correction = ART.correction ?? null;
const correctionSuperseded = correction?.figuresSuperseded?.rows
  .find(entry => entry.comparatorId === INCUMBENT_COMPARATOR_ID)?.row ?? null;
const CORRECTION_OLD_EXCESS = correctionSuperseded?.excessTotalVsSpy ?? null;
// The figure the visible one-line carries as "old": the correction's own
// just-superseded excess when it exists, else the D5 as-run superseded excess.
const LINE_OLD_EXCESS = CORRECTION_OLD_EXCESS ?? OLD_EXCESS;
const undatedVariant = sensitivity?.excludingUndatedConversions ?? null;
const marksStress = sensitivity?.missingMarksTotalLossStress ?? null;
const offIndex = sensitivity?.offIndexPicks ?? null;
const audit = ART.independentAudit ?? null;
const top3 = post?.withoutTop3Contributors ?? null;

// The verdict's plan-by-plan companion: which forward horizons the verdict may
// cite, derived with the production selector so the spec pins no figure. When
// the artifact offers none (every interval spans zero), the sentence must be
// absent — the tests below assert both directions from this one derivation.
const perPlan = perPlanHorizonMarks(ART.eventStudy.horizons);
const perPlanUniform = perPlan.length > 0 && perPlan.every(m => m.direction === perPlan[0].direction);
// The mark figures use the production grammar (perPlanFigure): unsigned in a
// uniform-direction sentence (the direction word carries the sign), signed in
// a mixed one — and never rounded to zero beside the "larger than chance"
// clause (a second decimal when one decimal would read 0.0%).
const perPlanMarkEn = (m: { horizon: string; n: number; mean: number }): string =>
  `${perPlanFigure(m.mean, !perPlanUniform)} after ${m.horizon} sessions (${fmtCount(m.n)} plans)`;
const perPlanLegEn = (m: { horizon: string; legMean: number | null }): string | null =>
  m.legMean === null ? null : `${perPlanFigure(m.legMean, true)} after ${m.horizon} sessions`;
const perPlanGapKey = perPlan.length === 1 ? "perPlanGapOne" : perPlan.length === 2 ? "perPlanGapBoth" : "perPlanGapAll";
// The diagnosis panel's horizons: the same qualification the verdict applies,
// derived with the production selector (today 21 and 42; 10's placebo verdict
// is not cited and 63 is unmatured, so neither may appear in the panel).
const yardsticks = ART.eventStudy.memberBenchmark
  ? memberYardstickMarks(ART.eventStudy.memberBenchmark.horizons, perPlan)
  : [];

const EN = getEvaluationStr.bind(null, "en") as (key: Parameters<typeof getEvaluationStr>[1]) => string;
const chipEn = evaluationLevelLabel("en", ART.release.overallLevel);
const benchmarkName = ART.basis.benchmark;
const incumbentLabel = comparatorShortName("en", INCUMBENT_COMPARATOR_ID, INCUMBENT_COMPARATOR_ID);

// One explicit-viewport worker: the spec sets 1440/820/390/320 itself, so the
// desktop/tablet/mobile project matrix would only multiply identical work.
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

/** Resolve a shot's destination, or null when no writable directory exists.
 *  With PROPHET_EVAL_SHOTS_DIR set, all shots land there (local evidence
 *  capture); otherwise each goes to Playwright's per-test output dir. Capture
 *  must never fail a test because a directory cannot be written. */
function shotTarget(name: string): string | null {
  const override = process.env.PROPHET_EVAL_SHOTS_DIR;
  try {
    if (override) {
      mkdirSync(override, { recursive: true });
      return path.join(override, name);
    }
    return test.info().outputPath(name);
  } catch {
    return null;
  }
}

function shot(page: Page, name: string) {
  const target = shotTarget(name);
  if (!target) return Promise.resolve();
  return page.screenshot({ path: target, fullPage: true });
}

/** The visible fold only — the cold-reader evidence shot, not the full page. */
function shotViewport(page: Page, name: string) {
  const target = shotTarget(name);
  if (!target) return Promise.resolve();
  return page.screenshot({ path: target });
}

/** Wait until every animation inside the open sheet has finished (plus one
 * paint) so captures show the settled surface, never a mid-fade frame. */
async function settleSheets(page: Page) {
  await page.evaluate(() => {
    const anims = Array.from(document.querySelectorAll<HTMLElement>(".msheet"))
      .flatMap(el => el.getAnimations({ subtree: true }));
    return Promise.all(anims.map(animation => animation.finished.catch(() => undefined)));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

async function expectNoHorizontalOverflow(page: Page) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(fits).toBe(true);
}

// ── Copy law sweep: no raw internal identifier survives on the page ─────────
const SNAKE_TOKEN = /(?<![A-Za-z0-9_/])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![A-Za-z0-9_])/;
const COMPARATOR_TOKEN = /(?<![A-Za-z0-9_])[KCX]\d[A-Za-z0-9_]{0,63}(?![A-Za-z0-9_])/;
/** File references and repo paths stay byte-intact by design; strip them
 * before sweeping. */
const stripPaths = (text: string): string => text.replace(/[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+/g, " ");

function expectNoRawIds(text: string, where: string) {
  const clean = stripPaths(text);
  expect(clean.match(SNAKE_TOKEN), `${where}: raw snake_case identifier visible`).toBeNull();
  expect(clean.match(COMPARATOR_TOKEN), `${where}: raw comparator/contrast id visible`).toBeNull();
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
    // The method line reads as reader language, never the raw engine slug.
    await expect(page.getByRole("dialog")).toContainText("Daily accounting split using sector ETFs");
    await expect(page.getByRole("dialog")).not.toContainText("daily_arithmetic");
  },
  // Hit rate, the excluded-name census, the outage cohort and the horizons.
  coverage: async page => {
    const dialog = page.getByRole("dialog");
    if (c6.hitRateVsSpy) {
      await expect(dialog).toContainText(fmtCount(c6.hitRateVsSpy.beatSpy));
      await expect(dialog).toContainText(fmtCount(c6.hitRateVsSpy.n));
    }
    await expect(dialog).toContainText(fmtCount(ART.coverage.evaluatedPositions));
    if (cohort) {
      // The cohort line reads at census level; the split is one level down.
      await expect(dialog).toContainText(`${fmtCount(cohort.eraPlansExcluded)} plans excluded`);
      await dialog.getByTestId("pev-cohort").locator("summary").click();
      if (cohort.ofWhichReplayedReceiptedBake !== null) {
        await expect(dialog).toContainText(`${fmtCount(cohort.ofWhichReplayedReceiptedBake)} replays`);
      }
      if (cohort.ofWhichSyntheticBoardReconstructions !== null) {
        await expect(dialog).toContainText(
          `${fmtCount(cohort.ofWhichSyntheticBoardReconstructions)} synthetic-board reconstructions`,
        );
      }
    }
    // Fixed-horizon marks: every live-published plan, 63 rendered as unmatured.
    if (ART.eventStudy.excludedBackfilledPlans !== null) {
      await expect(dialog).toContainText(fmtCount(ART.eventStudy.excludedBackfilledPlans));
    }
    if (h63 && h63.status === "unmatured") {
      await expect(dialog.getByTestId("pev-horizons")).toContainText(EN("horizonUnmatured"));
    }
  },
  // The model-book line plus the existing portfolio destination.
  portfolio: async page => {
    await expect(page.getByRole("dialog").getByRole("link", { name: /Portfolio|投资组合/ })).toHaveAttribute("href", "/portfolio");
  },
};

/** Dialog innerText minus the declared raw-identifier home (`.pev-source-raw`). */
async function dialogSweepText(page: Page): Promise<string> {
  const dialog = page.getByRole("dialog");
  let text = await dialog.innerText();
  for (const raw of await dialog.locator(".pev-source-raw").allInnerTexts()) {
    text = text.split(raw).join(" ");
  }
  return text;
}

test("cold reader: verdict, correction, participation, comparison and caveats (EN 1440)", async ({ page, baseURL }) => {
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
  // The plan-by-plan companion follows the book-level sentences in the same
  // verdict area — same glance, different measurement. Only matured horizons
  // whose own excess interval excludes zero may be cited (today: 21 and 42;
  // 10 spans zero and 63 is unmatured, so neither may appear).
  const perPlanSentence = page.getByTestId("pev-verdict-perplan");
  if (perPlan.length > 0) {
    await expect(perPlanSentence).toBeVisible();
    // Ordering carries the distinction: per-plan AFTER the distinguishable
    // sentence, never above it.
    await expect(
      page.locator('[data-testid="pev-verdict-distinguishable"] ~ [data-testid="pev-verdict-perplan"]'),
    ).toBeVisible();
    if (perPlanUniform) {
      await expect(perPlanSentence).toContainText(
        EN(perPlan[0].direction === "behind" ? "perPlanBehind" : "perPlanAhead"),
      );
    }
    for (const m of perPlan) {
      await expect(perPlanSentence).toContainText(perPlanMarkEn(m));
      const leg = perPlanLegEn(m);
      if (leg !== null) await expect(perPlanSentence).toContainText(leg);
    }
    await expect(perPlanSentence).toContainText(EN(perPlanGapKey));
    for (const h of ART.eventStudy.horizons) {
      if (!perPlan.some(m => m.horizon === h.horizon)) {
        await expect(perPlanSentence).not.toContainText(`after ${h.horizon} sessions`);
      }
    }
  } else {
    await expect(perPlanSentence).toHaveCount(0);
  }
  await expect(verdict).toContainText("not established");
  const minimum = page.getByTestId("pev-minimum");
  for (const c of globalMin) {
    await expect(minimum).toContainText(c.required);
    if (c.observed !== null) {
      await expect(minimum).toContainText(fmtCriterionObserved(c.criterion, c.observed));
    }
  }

  // The correction is visible near the headline WITHOUT opening anything:
  // with the D6 correction block the visible line IS the contract's short
  // line (date + old → new vs benchmark); on an uncorrected artifact it is
  // the generic What-changed summary. Either way, never a headline.
  const whatChanged = page.getByTestId("pev-what-changed-summary");
  await expect(whatChanged).toBeVisible();
  if (correction) {
    await expect(whatChanged).toContainText(fmtDate(correction.date));
    if (LINE_OLD_EXCESS !== null) {
      await expect(whatChanged).toContainText(fmtSignedPp(LINE_OLD_EXCESS));
      await expect(whatChanged).toContainText(fmtSignedPp(DIFF));
    }
    await expect(whatChanged).toContainText(benchmarkName);
  } else {
    await expect(whatChanged).toContainText(EN("whatChangedTitle"));
    if (correctionDate) await expect(whatChanged).toContainText(fmtDate(correctionDate));
    if (OLD_EXCESS !== null) {
      await expect(whatChanged).toContainText(fmtSignedPp(OLD_EXCESS));
      await expect(whatChanged).toContainText(fmtSignedPp(DIFF));
    }
  }

  // The diagnosis panel sits directly after the verdict, before the evidence
  // panels: yardstick gap, picks vs that yardstick, placebo band — per cited
  // horizon, every figure derived. No skill claim is asserted or implied; the
  // panel reports the artifact's own inside/outside statement.
  const diagnosis = page.getByTestId("pev-diagnosis");
  if (yardsticks.length > 0) {
    await expect(diagnosis).toBeVisible();
    await expect(diagnosis).toContainText(EN("diagnosisTitle"));
    await expect(page.locator("svg.pev-range")).toBeVisible();
    for (const m of yardsticks) {
      const block = page.getByTestId(`pev-diagnosis-h${m.horizon}`);
      await expect(block).toContainText(fmtSignedPp(m.yardstick.mean));
      await expect(block).toContainText(fmtSignedPp(m.picks.mean));
      await expect(block).toContainText(fmtSignedPp(m.frozen.mean));
      await expect(block).toContainText(fmtCount(m.placebo.draws));
      await expect(block).toContainText(EN(m.placebo.observedOutsidePlaceboRange
        ? (m.frozen.mean < m.placebo.lo ? "placeboBelow" : "placeboAbove")
        : "placeboWithin"));
    }
    // A horizon the verdict does not cite never appears in the panel.
    for (const h of ART.eventStudy.horizons) {
      if (!yardsticks.some(m => m.horizon === h.horizon)) {
        await expect(diagnosis).not.toContainText(`${h.horizon} sessions later`);
      }
    }
    await expectNoHorizontalOverflow(page);
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
  // The raw header definition ("C6 - C1") no longer renders; insignificant
  // comparisons read "value not shown", and the note states the law.
  await expect(page.getByTestId("pev-k-table")).not.toContainText(ART.contrasts.rows[0].headerDefinition);
  const notShownCount = ART.contrasts.rows.filter(k => !k.rejectH0).length;
  if (notShownCount > 0) {
    await expect(page.getByTestId("pev-k-table")).toContainText(EN("notShownChip"));
    await expect(page.getByTestId("pev-notshown-note")).toContainText("not shown");
  }

  // Material caveats in place, at full size, not buried.
  const caveats = page.getByTestId("pev-caveats");
  if (exName && topContrib) {
    await expect(caveats).toContainText(exName.droppedAsset);
    await expect(caveats).toContainText(fmtSignedPp(exName.excessTotalVsSpy));
    await expect(caveats).toContainText(fmtCi95(exName.excessTotalCi95[0], exName.excessTotalCi95[1], "pp"));
    await expect(caveats).toContainText(fmtSignedPp(topContrib.grossContribution));
  }
  if (post) await expect(caveats).toContainText(fmtPercent(post.top5ShareOfPositiveContribution));
  if (top3) {
    // The RUN-D concentration check: the three largest contributors named,
    // the book without them derived.
    await expect(caveats).toContainText(top3.droppedAssets.join(", "));
    await expect(caveats).toContainText(fmtSignedPp(top3.excessTotalVsSpy));
    await expect(caveats).toContainText(fmtCi95(top3.excessTotalCi95[0], top3.excessTotalCi95[1], "pp"));
  }
  if (h21Full) {
    await expect(caveats).toContainText(fmtSignedPp(h21Full.excessVsSpy!.mean));
    await expect(caveats).toContainText(
      fmtCi95(h21Full.excessVsSpy!.ci95DateCluster[0], h21Full.excessVsSpy!.ci95DateCluster[1], "pp"),
    );
    await expect(caveats).toContainText(fmtPercent(h21Full.shareBeatingSpy!.rate));
  }

  // Copy law: no alpha/outperformance/edge vocabulary anywhere on the surface.
  const surface = await page.locator(".pev").innerText();
  expect(surface).not.toMatch(/\balpha\b|outperform|beat(s)? the market|\bedge\b/i);

  await expectNoHorizontalOverflow(page);
  await shot(page, "main-1440.png");
  await shotViewport(page, "first-viewport-1440.png");
  // The diagnosis panel at full desktop width — the same evidence the
  // tablet/phone widths capture for their viewports.
  if (yardsticks.length > 0) {
    await page.getByTestId("pev-diagnosis").scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await shot(page, "diagnosis-1440.png");
  }

  // The ?from seam is same-app by construction: a protocol-relative host (or
  // any foreign URL) never reaches the href — the link falls back to /prophet.
  await page.goto("/prophet/evaluation?from=//evil.example");
  await expect(page.locator(".pev-back")).toHaveAttribute("href", "/prophet");
});

test("what changed: the D5 correction disclosure and its two sensitivity blocks (EN 1440)", async ({ page, baseURL }) => {
  test.skip(!sensitivity || OLD_EXCESS === null || !cohort || !correctionDate,
    "fixture without a superseded population has nothing to disclose");
  await prepare(page, baseURL);
  await page.goto("/prophet/evaluation");
  const disclosure = page.getByTestId("pev-what-changed");
  await page.getByTestId("pev-what-changed-summary").click();

  // With the D6 correction block, the correction's own statement comes first:
  // what changed (engine words), superseded figures BESIDE corrected figures,
  // the engine's reason, the verdict-unchanged ruling, what it supersedes.
  if (correction) {
    const cblock = disclosure.getByTestId("pev-correction");
    await expect(cblock).toContainText(humanizeEngineText(correction.whatChanged).slice(0, 60));
    if (correctionSuperseded) {
      await expect(cblock).toContainText(fmtSignedPercent(correctionSuperseded.totalNetReturn));
      await expect(cblock).toContainText(fmtSignedPp(correctionSuperseded.excessTotalVsSpy));
      await expect(cblock).toContainText(fmtSignedPp(DIFF));
      // Costs render as magnitudes: the superseded row stores a negative drag,
      // the current comparator a positive magnitude — same quantity, two wire
      // conventions (see the view's correctionPairLine).
      await expect(cblock).toContainText(fmtPercent(Math.abs(correctionSuperseded.costsPaidTotal)));
    }
    if (correction.figuresSuperseded?.verdictUnchanged) {
      await expect(cblock).toContainText(EN("correctionVerdictUnchanged").split("{reason}")[0]);
    }
    await expect(cblock).toContainText(correction.supersedes);
    await expectNoHorizontalOverflow(page);
    await shot(page, "correction-1440.png");
  }
  // The D5 population sentence follows with its own old figure and cohort.
  const d5Sentence = disclosure.locator("p.pev-sentence", { hasText: fmtCount(cohort!.eraPlansExcluded) });
  await expect(d5Sentence).toContainText(fmtDate(correctionDate!));
  await expect(d5Sentence).toContainText(fmtSignedPp(OLD_EXCESS!));
  await expect(d5Sentence).toContainText(fmtSignedPp(DIFF));
  await expect(disclosure).toContainText(EN("whatChangedPopulationNote"));

  // The engine's own correction record, one level down, humanized.
  if (populationDeviation) {
    const source = disclosure.locator(".pev-what-source");
    await source.locator("summary").click();
    await expect(source).toContainText(humanizeEngineText(populationDeviation.what).slice(0, 60));
  }
  await expectNoHorizontalOverflow(page);
  await shot(page, "what-changed-1440.png");

  // Both sensitivity blocks exist, are CLOSED by default, and never
  // headline-styled: each carries the engine's own label when opened.
  const variantBlock = page.getByTestId("pev-sensitivity-variant");
  const supersededBlock = page.getByTestId("pev-sensitivity-superseded");
  await expect(variantBlock).not.toHaveAttribute("open", "");
  await expect(supersededBlock).not.toHaveAttribute("open", "");

  await variantBlock.locator("summary").click();
  await expect(variantBlock).toContainText(EN("sensitivityChip"));
  await expect(variantBlock).toContainText(sensitivity!.label);
  if (variant) {
    await expect(variantBlock).toContainText(fmtSignedPp(variant.excessTotalVsSpy!));
    await expect(variantBlock).toContainText(humanizeEngineText(variant.definition).slice(0, 40));
  }
  await shot(page, "sensitivity-variant-1440.png");

  await supersededBlock.locator("summary").click();
  await expect(supersededBlock).toContainText(EN("supersededChip"));
  await expect(supersededBlock).toContainText(sensitivity!.label);
  await expect(supersededBlock).toContainText(EN("supersededSameEngineNote"));
  // The earlier headline figure, retained but marked superseded.
  await expect(supersededBlock).toContainText(fmtSignedPp(OLD_EXCESS!));
  await expect(supersededBlock).toContainText(fmtSignedPercent(oldC6!.totalNetReturn!));
  if (superseded && superseded.contrasts.length > 0) {
    await expect(supersededBlock).toContainText("comparison 1");
  }
  await expectNoHorizontalOverflow(page);
  await shot(page, "sensitivity-superseded-1440.png");

  // The D6-era protocol sensitivities: closed by default, same dim law, each
  // carrying the engine's own definition and its variant row.
  if (undatedVariant) {
    const undatedBlock = page.getByTestId("pev-sensitivity-undated");
    await expect(undatedBlock).not.toHaveAttribute("open", "");
    await undatedBlock.locator("summary").click();
    await expect(undatedBlock).toContainText(humanizeEngineText(undatedVariant.definition).slice(0, 40));
    await expect(undatedBlock).toContainText(fmtSignedPp(undatedVariant.excessTotalVsSpy!));
    if (ART.population?.undatedConversions) {
      await expect(undatedBlock).toContainText(fmtCount(ART.population.undatedConversions.count));
    }
    await expectNoHorizontalOverflow(page);
    await shot(page, "sensitivity-undated-1440.png");
  }
  if (marksStress) {
    const marksBlock = page.getByTestId("pev-sensitivity-marks");
    await expect(marksBlock).not.toHaveAttribute("open", "");
    await marksBlock.locator("summary").click();
    await expect(marksBlock).toContainText(humanizeEngineText(marksStress.definition).slice(0, 40));
    await expect(marksBlock).toContainText(fmtSignedPp(marksStress.excessTotalVsSpy!));
    for (const gp of marksStress.gappedPositions) {
      await expect(marksBlock).toContainText(gp.asset);
    }
    await expectNoHorizontalOverflow(page);
    await shot(page, "sensitivity-marks-1440.png");
  }
});

test("diagnosis disclosures: off-index sensitivity and the independent audit (EN 1440)", async ({ page, baseURL }) => {
  test.skip(!offIndex && !audit, "fixture without after-the-fact material");
  await prepare(page, baseURL);
  await page.goto("/prophet/evaluation");
  const diagnosis = page.getByTestId("pev-diagnosis");
  if (offIndex) {
    const block = diagnosis.getByTestId("pev-off-index");
    await expect(block).not.toHaveAttribute("open", "");
    await block.locator("summary").click();
    // The after-the-fact label rides with it every time it renders.
    await expect(block).toContainText(EN("afterTheFactChip"));
    await expect(block).toContainText(humanizeEngineText(offIndex.label).slice(0, 40));
    await expect(block).toContainText(fmtCount(offIndex.publishedPlansOffIndex));
    await expect(block).toContainText(fmtCount(offIndex.publishedPlansTotal));
    for (const h of offIndex.horizons) {
      await expect(block).toContainText(fmtSignedPp(h.allPlans.mean));
      await expect(block).toContainText(fmtSignedPp(h.offIndexPicks.mean));
      await expect(block).toContainText(fmtSignedPp(h.sp1500MemberPicks.mean));
      await expect(block).toContainText(fmtSignedPp(h.contributionToMeanGap));
    }
    await expectNoHorizontalOverflow(page);
    await shot(page, "off-index-1440.png");
  }
  if (audit) {
    const block = diagnosis.getByTestId("pev-audit");
    await expect(block).not.toHaveAttribute("open", "");
    await block.locator("summary").click();
    await expect(block).toContainText(EN("afterTheFactChip"));
    for (const run of audit.runs) {
      await expect(block).toContainText(run.name);
    }
    await expect(block).toContainText(audit.adjudication);
    await expectNoHorizontalOverflow(page);
    await shot(page, "audit-1440.png");
  }
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
    // Capture the SETTLED panel (entrance animation finished), never a frame
    // mid-fade — the D-set see-through attribution shot was exactly that.
    await settleSheets(page);
    await shot(page, `${key}-1440.png`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The opener receives focus back after the sheet closes.
    await expect(trigger).toBeFocused();
  }
});

test("raw identifiers never survive on the reading surface (EN 1440)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.goto("/prophet/evaluation");
  expectNoRawIds(await page.locator(".pev").innerText(), "main surface");

  // Every disclosure, open, with the What-changed + cohort disclosures open
  // too — the declared raw home (.pev-source-raw) is excluded by design.
  await page.getByTestId("pev-what-changed-summary").click();
  await page.getByTestId("pev-sensitivity-variant").locator("summary").click();
  await page.getByTestId("pev-sensitivity-superseded").locator("summary").click();
  for (const id of ["pev-sensitivity-undated", "pev-sensitivity-marks", "pev-off-index", "pev-audit"]) {
    const block = page.getByTestId(id);
    if (await block.count()) await block.locator("summary").click();
  }
  expectNoRawIds(await page.locator(".pev").innerText(), "main surface with disclosures open");

  for (const key of PANELS) {
    await page.getByTestId(`pev-open-${key}`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (key === "coverage") {
      await dialog.getByTestId("pev-cohort").locator("summary").click();
      const undated = dialog.getByTestId("pev-undated");
      if (await undated.count()) await undated.locator("summary").click();
    }
    await settleSheets(page);
    expectNoRawIds(await dialogSweepText(page), `${key} panel`);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
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
  // The correction disclosure reads in Chinese too: with the correction block
  // the visible short line is the ZH correction sentence; without it, the
  // generic What-changed summary.
  const zhSummary = page.getByTestId("pev-what-changed-summary");
  if (correction) {
    await expect(zhSummary).toContainText(fmtDate(correction.date));
    await expect(zhSummary).toContainText(benchmarkName);
    if (LINE_OLD_EXCESS !== null) await expect(zhSummary).toContainText(fmtSignedPp(LINE_OLD_EXCESS));
  } else {
    await expect(zhSummary).toContainText(ZH("whatChangedTitle"));
  }
  await expectNoHorizontalOverflow(page);
  await shot(page, "main-zh-1440.png");
});

test("tablet 820×1180 holds with the correction disclosure open (EN)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/prophet/evaluation");
  await expect(page.getByTestId("pev-level-chip")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shotViewport(page, "first-viewport-820.png");
  await shot(page, "main-820.png");
  await page.getByTestId("pev-what-changed-summary").click();
  await expectNoHorizontalOverflow(page);
  await shot(page, "what-changed-820.png");
  await page.getByTestId("pev-sensitivity-superseded").locator("summary").click();
  await expectNoHorizontalOverflow(page);
  await shot(page, "sensitivity-superseded-820.png");
  // The diagnosis panel and its disclosures hold at tablet width.
  if (yardsticks.length > 0) {
    await page.getByTestId("pev-diagnosis").scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await shot(page, "diagnosis-820.png");
  }
  for (const id of ["pev-off-index", "pev-audit"]) {
    const block = page.getByTestId(id);
    if (await block.count()) {
      await block.locator("summary").click();
      await expectNoHorizontalOverflow(page);
      await block.locator("summary").click();
    }
  }
  for (const key of PANELS) {
    await page.getByTestId(`pev-open-${key}`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await settleSheets(page);
    await shot(page, `${key}-820.png`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
});

test("phone width 390: the cold reader learns the correction in one screen (EN)", async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/prophet/evaluation");
  await expect(page.getByTestId("pev-level-chip")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot(page, "main-390.png");
  // The first screen must tell a cold reader the result is not distinguishable
  // from the market AND that it was corrected — both without opening anything.
  const firstScreen = await page.evaluate(() => {
    const fold = window.innerHeight;
    return Array.from(document.querySelectorAll<HTMLElement>(".pev [data-testid], .pev .pev-sentence, .pev .pev-verdict-level, .pev summary"))
      .filter(el => el.getBoundingClientRect().top < fold)
      .map(el => el.innerText)
      .join("\n");
  });
  expect(firstScreen).toContain(
    CI_SPANS_ZERO ? "not distinguishable from simply holding" : "does not include zero",
  );
  await expect(page.getByTestId("pev-what-changed-summary")).toBeVisible();
  if (correction) {
    // The contract's short line: corrected on <date>, old → new, visible in
    // the first screen without opening anything.
    expect(firstScreen).toContain(fmtDate(correction.date));
    if (LINE_OLD_EXCESS !== null) expect(firstScreen).toContain(fmtSignedPp(LINE_OLD_EXCESS));
    // And GEOMETRICALLY inside the first viewport — clearly, not straddling
    // the bottom edge: the whole line ends at least a touch target above
    // the fold (top-above-fold alone can still clip its second line).
    const line = await page.getByTestId("pev-what-changed-summary").boundingBox();
    const fold390 = await page.evaluate(() => window.innerHeight);
    expect(
      line && line.y + line.height,
      "correction line must sit clearly inside the 390 first viewport",
    ).toBeLessThanOrEqual(fold390 - 44);
  } else {
    expect(firstScreen).toContain(EN("whatChangedTitle"));
    if (OLD_EXCESS !== null) expect(firstScreen).toContain(fmtSignedPp(OLD_EXCESS));
  }
  // Evidence shot of the actual first viewport — taken before anything below
  // scrolls the page, unlike the full-page `shot()` crops.
  await shotViewport(page, "first-viewport-390.png");

  // The plan-by-plan verdict companion carries the same artifact figures at
  // phone width and never breaks the 390px layout.
  const perPlan390 = page.getByTestId("pev-verdict-perplan");
  if (perPlan.length > 0) {
    await expect(perPlan390).toBeVisible();
    for (const m of perPlan) {
      await expect(perPlan390).toContainText(perPlanMarkEn(m));
      const leg = perPlanLegEn(m);
      if (leg !== null) await expect(perPlan390).toContainText(leg);
    }
    await perPlan390.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
  } else {
    await expect(perPlan390).toHaveCount(0);
  }

  await page.getByTestId("pev-what-changed-summary").click();
  await expectNoHorizontalOverflow(page);
  await shot(page, "what-changed-390.png");
  await page.getByTestId("pev-sensitivity-superseded").locator("summary").click();
  await expectNoHorizontalOverflow(page);
  await shot(page, "sensitivity-superseded-390.png");
  await page.getByTestId("pev-what-changed-summary").click();

  // The diagnosis panel and its after-the-fact disclosures hold at phone
  // width: the range chart and both horizon blocks, no horizontal scroll.
  if (yardsticks.length > 0) {
    const diagnosis390 = page.getByTestId("pev-diagnosis");
    await diagnosis390.scrollIntoViewIfNeeded();
    await expect(page.locator("svg.pev-range")).toBeVisible();
    for (const m of yardsticks) {
      await expect(page.getByTestId(`pev-diagnosis-h${m.horizon}`)).toContainText(fmtSignedPp(m.frozen.mean));
    }
    await expectNoHorizontalOverflow(page);
    await shot(page, "diagnosis-390.png");
    for (const id of ["pev-off-index", "pev-audit"]) {
      const block = diagnosis390.getByTestId(id);
      if (await block.count()) {
        await block.locator("summary").click();
        await expectNoHorizontalOverflow(page);
        await block.locator("summary").click();
      }
    }
  }

  for (const key of PANELS) {
    await page.getByTestId(`pev-open-${key}`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    if (key === "coverage") {
      const dialog = page.getByRole("dialog");
      if (cohort) await dialog.getByTestId("pev-cohort").locator("summary").click();
      await settleSheets(page);
      if (h63 && h63.status === "unmatured") {
        await expect(dialog.getByTestId("pev-horizons")).toContainText(EN("horizonUnmatured"));
      }
      await shot(page, `${key}-390.png`);
    } else {
      await settleSheets(page);
      await shot(page, `${key}-390.png`);
    }
    await expectNoHorizontalOverflow(page);
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
  await shotViewport(page, "first-viewport-320.png");
  await shot(page, "main-320.png");
  await page.getByTestId("pev-what-changed-summary").click();
  await expectNoHorizontalOverflow(page);
  await shot(page, "what-changed-320.png");
  await page.getByTestId("pev-sensitivity-variant").locator("summary").click();
  await expectNoHorizontalOverflow(page);
  await shot(page, "sensitivity-variant-320.png");
  await page.getByTestId("pev-sensitivity-superseded").locator("summary").click();
  await expectNoHorizontalOverflow(page);
  await shot(page, "sensitivity-superseded-320.png");
  for (const id of ["pev-sensitivity-undated", "pev-sensitivity-marks"]) {
    const block = page.getByTestId(id);
    if (await block.count()) {
      await block.locator("summary").click();
      await expectNoHorizontalOverflow(page);
      await block.locator("summary").click();
    }
  }
  await page.getByTestId("pev-what-changed-summary").click();

  // The diagnosis panel at the narrow contract width: the range chart, both
  // horizon text rows, and the off-index/audit disclosures must all fit
  // 320 px with zero horizontal overflow (the CEO's explicit contract).
  if (yardsticks.length > 0 || offIndex || audit) {
    const diagnosis320 = page.getByTestId("pev-diagnosis");
    await diagnosis320.scrollIntoViewIfNeeded();
    if (yardsticks.length > 0) {
      await expect(page.locator("svg.pev-range")).toBeVisible();
      for (const m of yardsticks) {
        await expect(page.getByTestId(`pev-diagnosis-h${m.horizon}`)).toContainText(fmtSignedPp(m.frozen.mean));
      }
    }
    await expectNoHorizontalOverflow(page);
    await shot(page, "diagnosis-320.png");
    for (const id of ["pev-off-index", "pev-audit"]) {
      const block = diagnosis320.getByTestId(id);
      if (await block.count()) {
        await block.locator("summary").click();
        await expectNoHorizontalOverflow(page);
        await block.locator("summary").click();
      }
    }
  }
  for (const key of PANELS) {
    await page.getByTestId(`pev-open-${key}`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await settleSheets(page);
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
