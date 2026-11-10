"use client";

import { useId, useMemo, useState, type Ref } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorDepthT } from "@/lib/sectorDepthLex";
import {
  BOARD_LANE_ORDER,
  PREVIEW_ROWS,
  boardTotals,
  columnPreview,
  foldSixToFive,
  laneMeasuredEmpty,
  sectorStat,
  traceModel,
  type ActionBoardData,
  type BoardLaneKey,
  type CallRow,
  type CallTrace,
  type LaneData,
} from "@/lib/sectorDepthCalls";
import { DepthUnavailable } from "./DepthUnavailable";
import styles from "./SectorCallsBoard.module.css";

/** Lane copy is keyed per board column; the count beside each title is the
 * lane's FULL qualified total (never the visible row count). */
const COLUMN_COPY: Record<BoardLaneKey, { title: string; sub: string; empty: string }> = {
  buy_now: { title: "siCallsLaneBuyNow", sub: "siCallsLaneBuyNowSub", empty: "siCallsEmptyBuyNow" },
  buy_soon: { title: "siCallsLaneBuySoon", sub: "siCallsLaneBuySoonSub", empty: "siCallsEmptyBuySoon" },
  on_the_run: { title: "siCallsLaneRun", sub: "siCallsLaneRunSub", empty: "siCallsEmptyRun" },
  take_profits: { title: "siCallsLaneTrim", sub: "siCallsLaneTrimSub", empty: "siCallsEmptyTrim" },
  stand_aside: { title: "siCallsLaneAside", sub: "siCallsLaneAsideSub", empty: "siCallsEmptyAside" },
};

const fmtSignedPct = (v: number): string =>
  `${v >= 0 ? "+" : "-"}${(Math.abs(v) * 100).toFixed(1)}%`;

const signOf = (v: number): "up" | "down" | undefined =>
  v > 0 ? "up" : v < 0 ? "down" : undefined;

const fmtPctOfOne = (v: number): string => `${Math.round(v * 100)}%`;

const fmtPctile = (v: number): string => `${Math.round(v * 100)}`;

const fmt1 = (v: number): string => String(Number(v.toFixed(1)));

const fmt2 = (v: number): string => v.toFixed(2);

/**
 * The native calls board: tonight's qualified action board folded from six
 * source lanes into five reader columns (hold + avoid become "Stand aside").
 * Props-only mount — no fetching, no routing, no URL state. Navigation out
 * goes through `onNavigate`; when it is absent the same control renders as an
 * exact `<a href>` using the generation's href verbatim. A null board is the
 * ONLY unavailable path: a zero-total lane is a measured empty state, and a
 * lane whose rows are all withheld shows its withheld line, never empty copy.
 */
export function SectorCallsBoard({
  board,
  onNavigate,
  captureRef,
}: {
  board: ActionBoardData | null;
  onNavigate?: (href: string) => void;
  captureRef?: Ref<HTMLElement>;
}) {
  const t = useSectorDepthT();
  const folded = useMemo(() => (board === null ? null : foldSixToFive(board.lanes)), [board]);
  const totals = useMemo(() => (board === null ? null : boardTotals(board)), [board]);

  if (board === null || folded === null || totals === null) {
    return (
      <DepthUnavailable
        field="action_board"
        owner="Macro sector generation"
        title={t("siCallsTitle")}
      />
    );
  }

  return (
    <section
      ref={captureRef}
      className={styles.root}
      aria-label={t("siCallsTitle")}
      data-depth-calls-board
    >
      <header className={styles.head}>
        <h3 className={styles.title}>{t("siCallsTitle")}</h3>
        <p className={styles.sub}>{t("siCallsSub")}</p>
        <p className={styles.meta}>
          <span>{t("siCallsBoardTotal", { total: totals.total })}</span>
          {totals.locked > 0 && <span>{t("siCallsLockedCount", { n: totals.locked })}</span>}
          <span>{t("siDepthAsOf", { date: board.as_of })}</span>
        </p>
        <p className={styles.note}>{t("siCallsThemesBeforeSectorsNote")}</p>
      </header>

      <div className={styles.columns}>
        {BOARD_LANE_ORDER.map((key) => (
          <BoardColumn key={key} laneKey={key} lane={folded[key]} onNavigate={onNavigate} />
        ))}
      </div>
    </section>
  );
}

/** One of the five board columns: heading with the lane's full qualified
 * count, lane sub copy, measured-empty copy only when the FULL total is zero,
 * preview rows with Show more/less, and the withheld line when locked rows
 * exist. A lane with total > 0 and nothing visible renders the withheld line,
 * never the empty-state copy — the qualified rows exist, they are locked. */
function BoardColumn({
  laneKey,
  lane,
  onNavigate,
}: {
  laneKey: BoardLaneKey;
  lane: LaneData;
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  const [expanded, setExpanded] = useState(false);
  const copy = COLUMN_COPY[laneKey];
  const { shown, hidden } = columnPreview(laneKey, lane.rows, expanded);
  const measuredEmpty = laneMeasuredEmpty(lane);

  return (
    <section
      className={styles.column}
      aria-label={t(copy.title)}
      data-lane={laneKey}
      data-empty={measuredEmpty ? "true" : undefined}
    >
      <header className={styles.colHead}>
        <h4 className={styles.colTitle}>{t(copy.title)}</h4>
        <span className={styles.count} data-count>{lane.total}</span>
      </header>
      <p className={styles.colSub}>{t(copy.sub)}</p>

      {measuredEmpty ? (
        <p className={styles.empty}>{t(copy.empty)}</p>
      ) : shown.length > 0 ? (
        <ul className={styles.cards}>
          {shown.map((row) => (
            <CallRowCard key={`${row.kind}:${row.ticker}`} row={row} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : null}

      {hidden > 0 && (
        <button type="button" className={styles.toggle} onClick={() => setExpanded(true)}>
          {t("siCallsShowMore", { n: hidden })}
        </button>
      )}
      {expanded && lane.rows.length > PREVIEW_ROWS && (
        <button type="button" className={styles.toggle} onClick={() => setExpanded(false)}>
          {t("siCallsShowLess")}
        </button>
      )}

      {lane.locked > 0 && (
        <p className={styles.withheld}>{t("siCallsMoreWithheld", { n: lane.locked })}</p>
      )}
    </section>
  );
}

/** One qualified row. Row-content law (R5): THEME rows show score + 20d
 * performance; SECTOR rows show the owner's stat sentence only — never a
 * score, and never a synthesized one. Both kinds carry the why-line, the
 * per-row Trace disclosure and the detail destination (exact href, used
 * verbatim). */
function CallRowCard({
  row,
  onNavigate,
}: {
  row: CallRow;
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  const { lang } = useLang();
  const [traceOpen, setTraceOpen] = useState(false);
  const traceId = useId();

  const name = lang === "zh" && row.name_zh ? row.name_zh : row.name;
  const reco = lang === "zh" && row.label_zh ? row.label_zh : row.label;
  const why = lang === "zh" && row.reco_why_zh ? row.reco_why_zh : row.reco_why_en;
  const stat = sectorStat(row, lang);
  const trace: CallTrace = useMemo(() => traceModel(row), [row]);
  const band = lang === "zh" ? trace.rolloverBandZh : trace.rolloverBand;
  const perfSign = signOf(trace.perf20dRel);

  return (
    <li className={styles.card} data-kind={row.kind}>
      <div className={styles.cardTop}>
        <span className={styles.kind}>
          {t(row.kind === "theme" ? "siCallsThemeKind" : "siCallsSectorKind")}
        </span>
        <span className={styles.reco}>{reco}</span>
        {row.kind === "theme" ? (
          <>
            <span className={styles.score}>{t("siCallsScoreLabel", { score: row.score })}</span>
            <span
              className={styles.perf}
              data-sign={perfSign}
              title={t("siCalls20dVsMarket")}
            >
              {fmtSignedPct(trace.perf20dRel)}
            </span>
          </>
        ) : (
          stat && <span className={styles.stat}>{stat}</span>
        )}
      </div>
      <p className={styles.name}>{name}</p>
      <p className={styles.why}>
        <span className={styles.whyLabel}>{t("siCallsWhy")}</span>
        {why}
      </p>
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.traceBtn}
          aria-expanded={traceOpen}
          aria-controls={traceId}
          onClick={() => setTraceOpen((open) => !open)}
        >
          {t(traceOpen ? "siCallsTraceHide" : "siCallsTrace")}
        </button>
        {onNavigate ? (
          <button type="button" className={styles.detailBtn} onClick={() => onNavigate(row.href)}>
            {t("siCallsDetail")}
          </button>
        ) : (
          <a className={styles.detailBtn} href={row.href}>
            {t("siCallsDetail")}
          </a>
        )}
      </div>
      {traceOpen && (
        <div id={traceId} className={styles.trace}>
          {row.kind === "theme" && (
            <div className={styles.traceCell}>
              <span className={styles.traceLabel}>{t("siCallsScoreLabel", { score: trace.score })}</span>
            </div>
          )}
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCalls20dVsMarket")}</span>
            <span className={styles.traceValue} data-sign={perfSign}>
              {fmtSignedPct(trace.perf20dRel)}
            </span>
          </div>
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCallsRolloverBand", { band })}</span>
          </div>
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCallsFlipDistance", { n: fmt1(trace.flipDistance) })}</span>
          </div>
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCallsSignalGrade")}</span>
            <span className={styles.traceValue}>{trace.signalGrade}</span>
          </div>
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCallsBreadth")}</span>
            <span className={styles.traceValue}>{fmtPctOfOne(trace.breadthPct50)}</span>
          </div>
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCallsRsPctile")}</span>
            <span className={styles.traceValue}>{fmtPctile(trace.rsPctile)}</span>
          </div>
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCallsAllocRank")}</span>
            <span className={styles.traceValue}>{trace.allocRank}</span>
          </div>
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCallsBookWt")}</span>
            <span className={styles.traceValue}>
              {trace.bookWt === null ? "—" : fmtPctOfOne(trace.bookWt)}
            </span>
          </div>
          <div className={styles.traceCell}>
            <span className={styles.traceLabel}>{t("siCallsDurability")}</span>
            <span className={styles.traceValue}>{fmt2(trace.durability)}</span>
          </div>
          <div className={`${styles.traceCell} ${styles.traceCellWide}`}>
            <span className={styles.traceLabel}>{t("siCallsMembers")}</span>
            <span className={styles.traceValue}>{trace.topMembers.join(" · ")}</span>
          </div>
        </div>
      )}
    </li>
  );
}
