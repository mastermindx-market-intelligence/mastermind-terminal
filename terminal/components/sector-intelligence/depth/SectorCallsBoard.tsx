"use client";

import { useEffect, useId, useMemo, useState, type Ref } from "react";
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
  standAsidePreview,
  traceModel,
  type ActionBoardData,
  type BoardLaneKey,
  type CallRow,
  type CallTrace,
  type LaneData,
  type SourceLaneKey,
} from "@/lib/sectorDepthCalls";
import { DepthUnavailable } from "./DepthUnavailable";
import { EmergenceMark } from "./EmergenceMark";
import styles from "./SectorCallsBoard.module.css";

/** Lane copy is keyed per board column; the count beside each title is the
 * lane's FULL qualified total (never the visible row count). R5 C01/C02. */
const COLUMN_COPY: Record<BoardLaneKey, { title: string; sub: string }> = {
  buy_now: { title: "siCallsLaneBuyNow", sub: "siCallsLaneBuyNowSub" },
  buy_soon: { title: "siCallsLaneBuySoon", sub: "siCallsLaneBuySoonSub" },
  on_the_run: { title: "siCallsLaneRun", sub: "siCallsLaneRunSub" },
  take_profits: { title: "siCallsLaneTrim", sub: "siCallsLaneTrimSub" },
  stand_aside: { title: "siCallsLaneAside", sub: "siCallsLaneAsideSub" },
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
 * source lanes into five reader columns (hold + avoid become "Stand aside",
 * rendered as two named groups inside the column). Props-only mount — no
 * fetching, no routing, no URL state. Navigation out goes through
 * `onNavigate`; when it is absent the same control renders as an exact
 * `<a href>` using the generation's href verbatim. Methodology/access footer
 * links render only when the mount supplies real hrefs — none are invented.
 * A null board is the ONLY unavailable path: a zero-total lane is a measured
 * empty state, and a lane whose rows are all withheld shows its withheld
 * line, never empty copy.
 */
export function SectorCallsBoard({
  board,
  onNavigate,
  captureRef,
  accessHref,
  methodologyHref,
}: {
  board: ActionBoardData | null;
  onNavigate?: (href: string) => void;
  captureRef?: Ref<HTMLElement>;
  /** Real href for the access/entitlements explainer; absent → no link. */
  accessHref?: string;
  /** Real href for "How calls work"; absent → no link. */
  methodologyHref?: string;
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

  const visibleRows = BOARD_LANE_ORDER.reduce(
    (sum, key) => sum + folded[key].rows.length,
    0,
  );

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
        {board.locked > 0 && (
          <p className={styles.previewBanner} data-preview="true">
            {t("siCallsPreviewBanner", {
              shown: visibleRows,
              total: totals.total,
              locked: totals.locked,
            })}
            {accessHref && (
              <>
                {" "}
                <a className={styles.bannerLink} href={accessHref}>
                  {t("siDepthLearnAccess")}
                </a>
              </>
            )}
          </p>
        )}
      </header>

      <div className={styles.columns}>
        {BOARD_LANE_ORDER.map((key) =>
          key === "stand_aside" ? (
            <StandAsideColumn
              key={key}
              lane={folded[key]}
              lanes={board.lanes}
              asOf={board.as_of}
              onNavigate={onNavigate}
            />
          ) : (
            <BoardColumn
              key={key}
              laneKey={key}
              lane={folded[key]}
              onNavigate={onNavigate}
              asOf={board.as_of}
            />
          ),
        )}
      </div>

      <footer className={styles.foot}>
        <span className={styles.asOfPill}>{t("siCallsAsOfPill", { date: board.as_of })}</span>
        {methodologyHref && (
          <a className={styles.footLink} href={methodologyHref}>
            {t("siCallsHowItWorks")}
          </a>
        )}
      </footer>
    </section>
  );
}

/** Accordion awareness: at phone widths (R5 C03) the five columns become
 * stacked cards whose full header row is the tap target; Buy now is expanded
 * by default and the others collapse. Desktop keeps every column open. */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 430px)");
    const apply = () => setPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return phone;
}

/** Phone-accordion open state: derived, not synced. Open by default on the
 * server and desktop; on the phone only the primary lane starts expanded.
 * Once the reader touches a header their choice wins over the default. */
function useAccordionOpen(isPhone: boolean, defaultOpen: boolean): [boolean, () => void] {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (!isPhone || defaultOpen);
  const toggle = () => setUserOpen((v) => (v === null ? !(!isPhone || defaultOpen) : !v));
  return [open, toggle];
}

/** One of the four plain board columns: heading with the lane's full
 * qualified count, lane sub copy, dated measured-empty copy only when the
 * FULL total is zero, preview rows with Show more/less, and the withheld
 * line when locked rows exist. A lane with total > 0 and nothing visible
 * renders the withheld line, never the empty-state copy — the qualified
 * rows exist, they are locked. */
function BoardColumn({
  laneKey,
  lane,
  onNavigate,
  asOf,
}: {
  laneKey: BoardLaneKey;
  lane: LaneData;
  onNavigate?: (href: string) => void;
  /** The board's own as-of date, used verbatim in the dated empty copy. */
  asOf: string;
}) {
  const t = useSectorDepthT();
  const isPhone = useIsPhone();
  const [expanded, setExpanded] = useState(false);
  const [open, toggleOpen] = useAccordionOpen(isPhone, laneKey === "buy_now");
  const copy = COLUMN_COPY[laneKey];
  const { shown, hidden } = columnPreview(laneKey, lane.rows, expanded);
  const measuredEmpty = laneMeasuredEmpty(lane);

  return (
    <section
      className={styles.column}
      aria-label={t(copy.title)}
      data-lane={laneKey}
      data-empty={measuredEmpty ? "true" : undefined}
      data-open={isPhone ? (open ? "true" : "false") : undefined}
    >
      <button
        type="button"
        className={styles.colHead}
        aria-expanded={isPhone ? open : undefined}
        onClick={() => isPhone && toggleOpen()}
      >
        <span className={styles.colTitle}>{t(copy.title)}</span>
        <span className={styles.count} data-count>{lane.total}</span>
        <span className={styles.chevron} aria-hidden="true">{isPhone ? (open ? "⌃" : "⌄") : ""}</span>
      </button>
      {(open || !isPhone) && (
        <>
          <p className={styles.colSub}>{t(copy.sub)}</p>

          {measuredEmpty ? (
            <p className={styles.empty}>
              {t("siCallsEmptyDated", { date: asOf })}
            </p>
          ) : shown.length > 0 ? (
            <ul className={styles.cards}>
              {shown.map((row, i) => (
                <CallRowCard
                  key={`${row.kind}:${row.ticker}`}
                  row={row}
                  onNavigate={onNavigate}
                  order={i + 1}
                  of={lane.total}
                />
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
        </>
      )}
    </section>
  );
}

/** The Stand-aside column (R5 C01/C02): hold and avoid keep their identity as
 * two named groups under the folded column. Each group header carries its OWN
 * full qualified total; the incumbent preview budget is spent on the merged
 * source order (hold first, avoid takes what is left), so Hold's expansion
 * never re-collapses Avoid. Withheld counts stay per group. */
function StandAsideColumn({
  lane,
  lanes,
  asOf,
  onNavigate,
}: {
  lane: LaneData;
  lanes: Record<SourceLaneKey, LaneData>;
  asOf: string;
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  const isPhone = useIsPhone();
  const [holdExpanded, setHoldExpanded] = useState(false);
  const [avoidExpanded, setAvoidExpanded] = useState(false);
  const [open, toggleOpen] = useAccordionOpen(isPhone, false);
  const copy = COLUMN_COPY.stand_aside;
  const preview = standAsidePreview(lanes, holdExpanded, avoidExpanded);
  const measuredEmpty = laneMeasuredEmpty(lane);
  const { hold, avoid } = { hold: lanes.hold, avoid: lanes.avoid };

  return (
    <section
      className={styles.column}
      aria-label={t(copy.title)}
      data-lane="stand_aside"
      data-empty={measuredEmpty ? "true" : undefined}
      data-open={isPhone ? (open ? "true" : "false") : undefined}
    >
      <button
        type="button"
        className={styles.colHead}
        aria-expanded={isPhone ? open : undefined}
        onClick={() => isPhone && toggleOpen()}
      >
        <span className={styles.colTitle}>{t(copy.title)}</span>
        <span className={styles.count} data-count>{lane.total}</span>
        <span className={styles.chevron} aria-hidden="true">{isPhone ? (open ? "⌃" : "⌄") : ""}</span>
      </button>
      {(open || !isPhone) && (
        <>
          <p className={styles.colSub}>{t(copy.sub)}</p>

          {measuredEmpty ? (
            <p className={styles.empty}>{t("siCallsEmptyDated", { date: asOf })}</p>
          ) : (
            <div className={styles.groups}>
              <LaneGroup
                groupKey="siCallsGroupHold"
                lane={hold}
                slice={preview.hold}
                expanded={holdExpanded}
                onExpand={() => setHoldExpanded(true)}
                onCollapse={() => setHoldExpanded(false)}
                onNavigate={onNavigate}
              />
              <LaneGroup
                groupKey="siCallsGroupAvoid"
                lane={avoid}
                slice={preview.avoid}
                expanded={avoidExpanded}
                onExpand={() => setAvoidExpanded(true)}
                onCollapse={() => setAvoidExpanded(false)}
                onNavigate={onNavigate}
              />
            </div>
          )}

          {lane.locked > 0 && (
            <p className={styles.withheld}>
              {t("siCallsGroupWithheld", {
                n: lane.locked,
                h: hold.locked,
                a: avoid.locked,
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** One named group inside Stand-aside: header with the group's OWN full
 * total, its preview rows, and the group-scoped Show all / Show less link. */
function LaneGroup({
  groupKey,
  lane,
  slice,
  expanded,
  onExpand,
  onCollapse,
  onNavigate,
}: {
  groupKey: string;
  lane: LaneData;
  slice: { shown: CallRow[]; hidden: number };
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  const label = t(groupKey);
  if (lane.total === 0) return null;
  return (
    <div className={styles.group} data-group={groupKey}>
      <p className={styles.groupHead}>
        <span className={styles.groupLabel}>{label}</span>
        <span className={styles.groupCount} data-count>{lane.total}</span>
      </p>
      {slice.shown.length > 0 && (
        <ul className={styles.cards}>
          {slice.shown.map((row, i) => (
            <CallRowCard
              key={`${row.kind}:${row.ticker}`}
              row={row}
              onNavigate={onNavigate}
              order={i + 1}
              of={lane.total}
            />
          ))}
        </ul>
      )}
      {slice.hidden > 0 && (
        <button type="button" className={styles.toggle} onClick={onExpand}>
          {t("siCallsShowAllIn", { n: lane.total, group: label })}
        </button>
      )}
      {expanded && slice.hidden > 0 && (
        <button type="button" className={styles.toggle} onClick={onCollapse}>
          {t("siCallsShowLess")}
        </button>
      )}
    </div>
  );
}

/** One qualified row (R5 C01 anatomy): bold name first, then the identity
 * line (kind · score for themes / the owner's stat sentence for sectors —
 * never a synthesized score), then the theme's 20d-vs-market metric. Row
 * content law: theme rows show score + performance; sector rows show
 * stat_en/stat_zh only. The evidence sentence and the deep trace metrics
 * live behind the per-row Trace disclosure (C04). */
function CallRowCard({
  row,
  onNavigate,
  order,
  of,
}: {
  row: CallRow;
  onNavigate?: (href: string) => void;
  /** 1-based publish order within the lane's visible slice. */
  order: number;
  /** The lane's full qualified total (publish-order denominator). */
  of: number;
}) {
  const t = useSectorDepthT();
  const { lang } = useLang();
  const [traceOpen, setTraceOpen] = useState(false);
  const traceId = useId();

  const name = lang === "zh" && row.name_zh ? row.name_zh : row.name;
  const why = lang === "zh" && row.reco_why_zh ? row.reco_why_zh : row.reco_why_en;
  const stat = sectorStat(row, lang);
  const trace: CallTrace = useMemo(() => traceModel(row), [row]);
  const band = lang === "zh" ? trace.rolloverBandZh : trace.rolloverBand;
  const perfSign = signOf(trace.perf20dRel);

  return (
    <li className={styles.card} data-kind={row.kind}>
      <p className={styles.name}>{name}</p>
      <p className={styles.metaLine}>
        <span className={styles.kind}>
          {t(row.kind === "theme" ? "siCallsThemeKind" : "siCallsSectorKind")}
        </span>
        {row.kind === "theme" ? (
          <>
            <span className={styles.dot} aria-hidden="true">·</span>
            <span className={styles.score}>{t("siCallsScoreLabel", { score: row.score })}</span>
            <span className={styles.dot} aria-hidden="true">·</span>
            <span className={styles.perf} data-sign={perfSign} title={t("siCalls20dVsMarket")}>
              {fmtSignedPct(trace.perf20dRel)}
            </span>
          </>
        ) : (
          stat && (
            <>
              <span className={styles.dot} aria-hidden="true">·</span>
              <span className={styles.stat}>{stat}</span>
            </>
          )
        )}
      </p>
      {/* Owner-carried independent-emergence state (v1.1 R6-09): renders only
          when the owner engine flagged the row — never derived from score/RS,
          never moving the row between lanes or changing its qualification. */}
      <EmergenceMark
        emerging={row.emerging}
        href={row.emergence_href}
        onNavigate={onNavigate}
      />
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
          <p className={styles.traceWhy}>
            {t("siCallsTraceWhy", { n: order, m: of })}
          </p>
          <p className={styles.traceQuote}>
            <span className={styles.whyLabel}>{t("siCallsWhy")}</span>
            <q className={styles.quote}>{why}</q>
          </p>
          <div className={styles.traceGrid}>
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
        </div>
      )}
    </li>
  );
}
