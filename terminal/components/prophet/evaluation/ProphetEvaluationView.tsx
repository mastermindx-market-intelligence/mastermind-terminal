"use client";
/**
 * ProphetEvaluationView — the Strategy Evaluation surface (`/prophet/evaluation`).
 *
 * READING CONTRACT (SX05, 3–4 seconds for a cold reader):
 *   1. Verdict in plain words — release level first-class (L0 today: descriptive,
 *      not validated), the book vs the market sentence, L1 minimum progress.
 *   2. Market participation (beta first) with predeclared criteria.
 *   3. ONE comparison family: horizontal interval plot + table, corrected p-values.
 *   4. Material caveats in place (single-name lead, raw picks, roster/labels).
 *   5. Disclosures (SX12) + a validated return to the Prophet board.
 *
 * Every number is read from the decoded artifact; this component only formats.
 * No alpha/outperformance/edge/recommendation language, ever.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import MobileSheet from "@/components/ui/MobileSheet";
import {
  comparatorShortName, evaluationLevelLabel, criterionLabel,
  fillTemplate, makeEvaluationT,
} from "@/lib/prophetEvaluationStrings";
import {
  fmtCi95, fmtCount, fmtCriterionObserved, fmtPercent, fmtP, fmtRatio, fmtSignedPercent, fmtSignedPp, fmtDate,
} from "@/lib/prophetBetaEvaluationFormat";
import {
  BENCHMARK_COMPARATOR_ID, INCUMBENT_COMPARATOR_ID, decodeBetaEvaluation,
  findComparator, intervalIncludesZero, orderedComparators, type BetaEvaluation,
  type ComparatorRow,
} from "@/lib/prophetBetaEvaluation";
import "./prophetEvaluation.css";
import { ForestPlot, type ForestRow } from "./evaluationCharts";
import { EVALUATION_PANELS, panelBody, type PanelKey } from "./EvaluationPanels";

type LoadStatus = "loading" | "ready" | "unavailable" | "unauthenticated" | "forbidden";

function isPanelKey(value: string | null): value is PanelKey {
  return value === "details" || value === "attribution" || value === "coverage" || value === "portfolio";
}

/** Validated same-origin return path: a leading single slash only, never a
 * protocol-relative or absolute URL. */
function safeFromParam(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/prophet";
  return raw;
}

export default function ProphetEvaluationView() {
  const { lang } = useLang();
  const t = makeEvaluationT(lang);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [data, setData] = useState<BetaEvaluation | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt(value => value + 1);
  }, []);

  const [panel, setPanel] = useState<PanelKey | null>(null);
  const pushedRef = useRef(false);
  const [fromHref, setFromHref] = useState("/prophet");

  // One read per mount/attempt; no polling, no cache. The BFF owns auth and the
  // "upstream has nothing yet" mapping; this surface owns one designed state
  // per outcome.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch("/api/prophet/beta-evaluation", {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: controller.signal, headers: { Accept: "application/json" },
    }).then(async response => {
      if (!active) return;
      if (response.status === 401) { setStatus("unauthenticated"); return; }
      if (response.status === 403) { setStatus("forbidden"); return; }
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        setStatus("unavailable"); return;
      }
      const raw: unknown = await response.json();
      if (!active) return;
      const decoded = decodeBetaEvaluation(raw);
      if (!decoded) { setStatus("unavailable"); return; }
      setData(decoded);
      setStatus("ready");
    }).catch(() => { if (active) setStatus("unavailable"); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  // Direct-URL panels (?panel=…) + Back-button close. Opening pushes history so
  // Back closes the drawer; a direct link closes by cleaning the URL instead of
  // navigating away.
  useEffect(() => {
    const readPanel = () => {
      const value = new URLSearchParams(window.location.search).get("panel");
      return isPanelKey(value) ? value : null;
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is an external system; the mount pass adopts ?panel=/?from before paint-dependent UI reads them (same pattern as ChartPane's localStorage handoff).
    setPanel(readPanel());
    const onPop = () => { pushedRef.current = false; setPanel(readPanel()); };
    window.addEventListener("popstate", onPop);
    setFromHref(safeFromParam(new URLSearchParams(window.location.search).get("from")));
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openPanel = useCallback((key: PanelKey) => {
    setPanel(key);
    pushedRef.current = true;
    const url = new URL(window.location.href);
    url.searchParams.set("panel", key);
    window.history.pushState({}, "", url);
  }, []);
  const closePanel = useCallback(() => {
    setPanel(null);
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("panel");
      window.history.replaceState({}, "", url);
    }
  }, []);

  if (status === "loading") {
    return (
      <div className="main2 pev pev-state">
        <p className="pev-loading" role="status">{t("loadingTitle")}</p>
      </div>
    );
  }
  if (status === "unauthenticated" || status === "forbidden") {
    return (
      <div className="main2 pev pev-state">
        <h1 className="pev-h1">{t(status === "unauthenticated" ? "unauthenticatedTitle" : "forbiddenTitle")}</h1>
      </div>
    );
  }
  if (status !== "ready" || !data) {
    return (
      <div className="main2 pev pev-state">
        <h1 className="pev-h1">{t("unavailableTitle")}</h1>
        <p className="pev-lede">{t("unavailableBody")}</p>
        <button type="button" className="pev-cta" onClick={retry}>{t("tryAgain")}</button>
      </div>
    );
  }

  const { release, window: win, basis, coverage } = data;
  const c6 = findComparator(data.comparators, INCUMBENT_COMPARATOR_ID);
  const benchmarkName = basis.benchmark;
  const post = data.postHocDiagnostics.books.find(entry => entry.bookId === INCUMBENT_COMPARATOR_ID) ?? null;
  const exName = post?.book.withoutTopContributor ?? null;
  const topContrib = post?.book.topContributors[0] ?? null;
  const h21 = data.eventStudy.horizons.find(h => h.horizon === "21") ?? null;
  const jobA = release.jobs.find(job => job.key === "A_market_participation") ?? null;
  const levelLabel = evaluationLevelLabel(lang, release.overallLevel);

  const forestRows: ForestRow[] = orderedComparators(data.comparators)
    .filter((row): row is ComparatorRow & { status: "evaluated"; vsSpy: NonNullable<ComparatorRow["vsSpy"]> } =>
      row.status === "evaluated" && row.vsSpy !== null && row.vsSpy.totalDiff !== null && row.vsSpy.totalDiffCi95 !== null)
    .map(row => ({
      key: row.id,
      label: comparatorShortName(lang, row.id, row.label),
      point: row.vsSpy.totalDiff as number,
      lo: (row.vsSpy.totalDiffCi95 as readonly [number, number])[0],
      hi: (row.vsSpy.totalDiffCi95 as readonly [number, number])[1],
      includesZero: intervalIncludesZero(row.vsSpy.totalDiffCi95 as readonly [number, number]),
    }));

  const verdictDiff = c6 && c6.status === "evaluated" && c6.vsSpy && c6.vsSpy.totalDiff !== null && c6.vsSpy.totalDiffCi95 !== null
    ? { diff: c6.vsSpy.totalDiff, ci: c6.vsSpy.totalDiffCi95 } : null;
  const bookTotal = c6 && c6.status === "evaluated" ? c6.totalNetReturn : null;

  return (
    <div className="main2 pev">
      <header className="pev-mast">
        <Link className="pev-back" href={fromHref}>← {t("backToProphet")}</Link>
        <p className="pev-eyebrow">{t("pageEyebrow")}</p>
        <div className="pev-title-row">
          <h1 className="pev-h1">{t("pageTitle")}</h1>
          <span className="pev-chip is-l0" data-testid="pev-level-chip">{levelLabel}</span>
        </div>
        <p className="pev-window">
          {t("windowLabel")}: {fmtDate(win.firstReturnClose)} → {fmtDate(win.lastClose)} · {fmtCount(win.sessions)} {t("sessionsUnit")} · {t("netOfCosts")}
        </p>
      </header>

      {/* ── 1. Verdict ─────────────────────────────────────────────────────── */}
      <section className="pev-card pev-verdict" data-testid="pev-verdict">
        <h2>{t("verdictTitle")}</h2>
        <p className="pev-verdict-level" data-testid="pev-verdict-level">
          {t("levelLabel")}: <b>{levelLabel}</b>
        </p>
        {(() => {
          const sessions = release.globalMinimumForL1.find(c => c.criterion === "window_sessions");
          const drawdown = release.globalMinimumForL1.find(c => c.criterion === "spy_drawdown_present");
          // The required string is the artifact's own text (">= 252"); extract its
          // digits for the sentence, falling back to the verbatim string.
          const requiredNumber = (raw: string | undefined): string => {
            const digits = raw?.match(/\d+/)?.[0];
            return digits ? fmtCount(Number(digits)) : (raw ?? "");
          };
          const values: Record<string, string> = {
            sessions: fmtCount(win.sessions), first: fmtDate(win.firstReturnClose), last: fmtDate(win.lastClose),
            minSessions: requiredNumber(sessions?.required),
            needDd: drawdown?.required ?? "", seenDd: fmtSignedPercent(win.spyMaxDrawdown),
          };
          return <p className="pev-sentence">{fillTemplate(t("verdictWindowSentence"), values)}</p>;
        })()}
        {verdictDiff && bookTotal !== null && c6?.status === "evaluated" && (
          <p className="pev-sentence" data-testid="pev-verdict-book">
            {fillTemplate(t("verdictBookSentence"), {
              book: fmtSignedPercent(bookTotal), benchmark: benchmarkName, spy: fmtSignedPercent(win.spyTotalReturn),
              diff: fmtSignedPp(verdictDiff.diff), ci: fmtCi95(verdictDiff.ci[0], verdictDiff.ci[1], "pp"),
              zero: t(intervalIncludesZero(verdictDiff.ci) ? "ciIncludesZero" : "ciExcludesZero"),
            })}
          </p>
        )}
        {verdictDiff && (
          <p
            className={`pev-sentence ${intervalIncludesZero(verdictDiff.ci) ? "pev-distinguish" : "pev-dim"}`}
            data-testid="pev-verdict-distinguishable"
          >
            {fillTemplate(
              t(intervalIncludesZero(verdictDiff.ci) ? "notDistinguishableSentence" : "intervalExcludesZeroNote"),
              { sessions: fmtCount(win.sessions), benchmark: benchmarkName },
            )}
          </p>
        )}
        <p className="pev-sentence pev-dim">{t("verdictClaimSentence")}</p>
        <div className="pev-minimum" data-testid="pev-minimum">
          <h3>{t("globalMinimumTitle")}</h3>
          <ul>
            {release.globalMinimumForL1.map(c => (
              <li key={c.criterion}>
                <span>{criterionLabel(lang, c.criterion)}</span>
                <span className="pev-num">
                  {fmtCriterionObserved(c.criterion, c.observed)}
                  {" "}
                  <span className="pev-dim">({t("requiredLabel")} {c.required})</span>
                </span>
                <span className={`pev-chip ${c.met ? "is-met" : "is-not"}`}>{c.met ? t("metLabel") : t("notMetLabel")}</span>
              </li>
            ))}
          </ul>
          {!release.globalMinimumMet && <p className="pev-dim">{t("capNote")}</p>}
        </div>
      </section>

      {/* ── 2. Market participation (beta first) ───────────────────────────── */}
      <section className="pev-card" data-testid="pev-participation">
        <h2>{t("participationTitle")}</h2>
        <p className="pev-kicker">{t("participationKicker")}</p>
        {c6?.status === "evaluated" && (
          <div className="pev-tiles">
            <div className="pev-tile">
              <span className="obs-lbl">{fillTemplate(t("betaLabel"), { benchmark: benchmarkName })}</span>
              <b>{c6.beta !== null ? fmtRatio(c6.beta) : "—"}</b>
              {c6.betaCi95 && <span className="pev-dim">{fmtCi95(c6.betaCi95[0], c6.betaCi95[1], "x", 2)}</span>}
            </div>
            <div className="pev-tile">
              <span className="obs-lbl">{t("investedLabel")}</span>
              <b>{c6.meanInvested !== null ? fmtPercent(c6.meanInvested) : "—"}</b>
            </div>
            <div className="pev-tile">
              <span className="obs-lbl">{t("upsideCaptureLabel")}</span>
              <b>{c6.upsideCapture !== null ? fmtRatio(c6.upsideCapture) : "—"}</b>
            </div>
            <div className="pev-tile">
              <span className="obs-lbl">{t("downsideCaptureLabel")}</span>
              <b>{c6.downsideCapture !== null ? fmtRatio(c6.downsideCapture) : "—"}</b>
            </div>
          </div>
        )}
        {jobA && (
          <details className="pev-criteria">
            <summary>{t("criteriaLabel")}</summary>
            <div className="pev-table-scroll">
              <table className="pev-table">
                <thead><tr><th>{t("criterionCol")}</th><th>{t("requiredLabel")}</th><th>{t("observedLabel")}</th><th aria-label={t("statusLabel")} /></tr></thead>
                <tbody>
                  {jobA.criteria.map(c => (
                    <tr key={c.criterion}>
                      <td>{criterionLabel(lang, c.criterion)}</td>
                      <td className="pev-num">{c.required}</td>
                      <td className="pev-num">{fmtCriterionObserved(c.criterion, c.observed)}</td>
                      <td className={`pev-chip ${c.met ? "is-met" : "is-not"}`}>{c.met ? t("metLabel") : t("notMetLabel")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      {/* ── 3. Comparison family ───────────────────────────────────────────── */}
      <section className="pev-card" data-testid="pev-comparison">
        <h2>{t("comparisonTitle")}</h2>
        <p className="pev-kicker">{fillTemplate(t("comparisonKicker"), { benchmark: benchmarkName })}</p>
        <ForestPlot rows={forestRows} ariaLabel={t("comparisonTitle")} />
        <p className="pev-dim">{t("tableIsAlternative")}</p>
        <div className="pev-table-scroll">
          <table className="pev-table" data-testid="pev-comparison-table">
            <thead>
              <tr>
                <th>{t("colComparator")}</th><th>{t("colTotal")}</th><th>{fillTemplate(t("colVsSpy"), { benchmark: benchmarkName })}</th>
                <th>{t("colBeta")}</th><th>{t("colCapture")}</th><th>{t("colDrawdown")}</th>
              </tr>
            </thead>
            <tbody>
              {orderedComparators(data.comparators).map(row => {
                if (row.status !== "evaluated") {
                  return (
                    <tr key={row.id} className="pev-row-unavail">
                      <td>{comparatorShortName(lang, row.id, row.label)}</td>
                      <td colSpan={5} className="pev-dim">{fillTemplate(t("rowUnavailable"), { reason: row.reason ?? "" })}</td>
                    </tr>
                  );
                }
                const vs = row.vsSpy;
                return (
                  <tr key={row.id} className={row.id === INCUMBENT_COMPARATOR_ID ? "pev-row-strong" : undefined}>
                    <td>
                      {comparatorShortName(lang, row.id, row.label)}
                      {row.id === BENCHMARK_COMPARATOR_ID && <span className="pev-dim"> · {t("referenceNote")}</span>}
                    </td>
                    <td className="pev-num">{row.totalNetReturn !== null ? fmtSignedPercent(row.totalNetReturn) : "—"}</td>
                    <td className="pev-num">
                      {vs && vs.totalDiff !== null && vs.totalDiffCi95 !== null
                        ? `${fmtSignedPp(vs.totalDiff)} ${fmtCi95(vs.totalDiffCi95[0], vs.totalDiffCi95[1], "pp")}`
                        : "—"}
                    </td>
                    <td className="pev-num">{row.beta !== null ? fmtRatio(row.beta) : "—"}</td>
                    <td className="pev-num">{row.upsideCapture !== null && row.downsideCapture !== null
                      ? `${fmtRatio(row.upsideCapture)} / ${fmtRatio(row.downsideCapture)}` : "—"}</td>
                    <td className="pev-num">{row.maxDrawdown !== null ? fmtSignedPercent(row.maxDrawdown) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h3>{t("confirmatoryTitle")}</h3>
        <div className="pev-table-scroll">
          <table className="pev-table" data-testid="pev-k-table">
            <thead>
              <tr>
                <th>{t("colContrast")}</th><th>{t("colAnnDiff")}</th><th>{t("colCi")}</th>
                <th>{t("colRawP")}</th><th>{t("colHolm")}</th><th>{t("statusLabel")}</th>
                <th>{t("block21Label")}</th><th>{t("at2xLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {data.contrasts.rows.map(k => (
                <tr key={k.id}>
                  <td>
                    {comparatorShortName(lang, k.a, k.a)} − {comparatorShortName(lang, k.b, k.b)}
                    <span className="pev-dim"> ({k.headerDefinition})</span>
                  </td>
                  <td className="pev-num">{fmtSignedPp(k.annDiff)}</td>
                  <td className="pev-num">{fmtCi95(k.annDiffCi95[0], k.annDiffCi95[1], "pp")}</td>
                  <td className="pev-num">{fmtP(k.pRaw)}</td>
                  <td className="pev-num">{fmtP(k.pHolm)}</td>
                  <td className={`pev-chip ${k.rejectH0 ? "is-met" : "is-not"}`}>{k.rejectH0 ? t("significantYes") : t("significantNo")}</td>
                  <td className="pev-num">{fmtCi95(k.block21.annDiffCi95[0], k.block21.annDiffCi95[1], "pp")} · {fmtP(k.block21.pHolm)}</td>
                  <td className="pev-num">{fmtSignedPp(k.at2xCosts.annDiff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 4. Material caveats ────────────────────────────────────────────── */}
      <section className="pev-card" data-testid="pev-caveats">
        <h2>{t("caveatsTitle")}</h2>
        <div className="pev-caveats">
          <div className="pev-caveat">
            <h3>{t("caveatSingleNameTitle")}</h3>
            {exName && topContrib && (
              <>
                <p>{fillTemplate(t("exNameBody"), {
                  asset: exName.droppedAsset, diff: fmtSignedPp(exName.excessTotalVsSpy),
                  benchmark: benchmarkName, ci: fmtCi95(exName.excessTotalCi95[0], exName.excessTotalCi95[1], "pp"),
                })}</p>
                <p className="pev-dim">{fillTemplate(t("exNameContribution"), {
                  asset: topContrib.asset, pp: fmtSignedPp(topContrib.grossContribution),
                })}</p>
                {post && (
                  <p className="pev-dim">{fillTemplate(t("top5Share"), {
                    share: fmtPercent(post.book.top5ShareOfPositiveContribution),
                  })}</p>
                )}
              </>
            )}
          </div>
          <div className="pev-caveat">
            <h3>{t("caveatRawPicksTitle")}</h3>
            {h21 && (
              <>
                <p>{fillTemplate(t("caveatRawPicksBody"), {
                  h: fmtCount(Number(h21.horizon)), mean: fmtSignedPp(h21.excessVsSpy.mean),
                  benchmark: benchmarkName, ci: fmtCi95(h21.excessVsSpy.ci95DateCluster[0], h21.excessVsSpy.ci95DateCluster[1], "pp"),
                  rate: fmtPercent(h21.shareBeatingSpy.rate),
                })}</p>
                <p className="pev-dim">{fillTemplate(t("rawPicksDecompose"), {
                  stock: fmtSignedPp(h21.stockMinusSectorEtf.mean), sector: fmtSignedPp(h21.sectorEtfMinusSpy.mean),
                  benchmark: benchmarkName,
                })}</p>
                <p className="pev-dim">{t("caveatNarrowCi")}</p>
              </>
            )}
          </div>
          <div className="pev-caveat">
            <h3>{t("caveatRosterTitle")}</h3>
            <p>{fillTemplate(t("caveatRosterBody"), {
              date: fmtDate(data.dataClocks.pitMembership.lastRecordedChange),
              n: fmtCount(coverage.memberUniverseMissingPriceFiles.length),
            })}</p>
          </div>
        </div>
      </section>

      {/* ── 5. Disclosures (SX12) ──────────────────────────────────────────── */}
      <section className="pev-card" data-testid="pev-disclosures">
        <h2>{t("disclosuresTitle")}</h2>
        <div className="pev-panel-row">
          {EVALUATION_PANELS.map(({ key, titleKey }) => (
            <button
              key={key}
              type="button"
              className="pev-panel-btn"
              data-testid={`pev-open-${key}`}
              aria-expanded={panel === key}
              aria-label={fillTemplate(t("opensPanelAria"), { name: t(titleKey) })}
              onClick={() => openPanel(key)}
            >
              {t(titleKey)}
            </button>
          ))}
        </div>
      </section>

      <footer className="pev-foot">
        <span>{t("asofPlans")}: {fmtDate(data.dataClocks.plansIndex.asof)}</span>
        <span>{t("asofPrices")}: {fmtDate(data.dataClocks.prices.lastCloseUsed)}</span>
        <span>{fillTemplate(t("asofWindow"), {
          sessions: fmtCount(win.sessions), returns: fmtCount(win.dailyReturns),
          etf: String(basis.costsBpPerSide.etf), stock: String(basis.costsBpPerSide.stock),
        })}</span>
      </footer>

      <MobileSheet
        open={panel !== null}
        onClose={closePanel}
        className="pev-panel-sheet"
        title={panel ? t(EVALUATION_PANELS.find(p => p.key === panel)!.titleKey) : undefined}
        maxHeight="92dvh"
      >
        {panel !== null && panelBody(panel, data, lang)}
      </MobileSheet>
    </div>
  );
}
