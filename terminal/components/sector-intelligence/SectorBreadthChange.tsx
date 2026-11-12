"use client";
/** SectorBreadthChange (Paper R4 R7, accepted 2026-11-12, copy deltas 05:47Z 1–7).
 *
 * Eleven GICS sectors, each with the share of members above its own
 * 200-session average now, the 13-week like-for-like change of that share in
 * percentage points, the cross-rank of the change, an improving/deteriorating
 * word with a week count, an as-of date and a basis line. Rows sort by the
 * change. No score, no signal word, no return claim; colour is always paired
 * with a sign, an arrow and a word; no coloured edge stripe.
 *
 * States: full · too-few (below 10 like-for-like members → change and rank are
 * missing, never zero; share and member count stay) · stale (as-of week two or
 * more COMPLETED weekly closes behind the latest session) · unavailable (the
 * Brief's existing honest line, verbatim). The input arrives later on the
 * sector generation payload (L1-FO1); until then the module mounts with no
 * input and renders unavailable. No network path lives here. */
import { Fragment, useMemo, type ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorT } from "@/lib/sectorIntelligenceLex";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { nativeFill } from "./SectorNativeJobShell";
import styles from "./SectorBreadthChange.module.css";

/** Macro engine/group_breadth_history.py MIN_MEMBERS (COO addendum 2026-11-12). */
export const SECTOR_BREADTH_MIN_MEMBERS = 10;
/** A bar fills half the track at 25 pp; clamped so a wild value cannot escape. */
const BAR_FULL_PP = 25;
const COMPACT_QUERY = "(max-width: 1030px)";

export type SectorBreadthDirection = "improving" | "deteriorating" | "flat";

/** What the sector generation payload will carry per sector (L1-FO1). */
export interface SectorBreadthChangeRow {
  /** Canonical sector id (GICS wire name, e.g. "Technology"). */
  sectorId: string;
  /** Share of members above the 200-session average now, 0–100; null = not supplied. */
  shareAbove200Now: number | null;
  /** 13-week like-for-like change in percentage points (already pp; never ×100). */
  changePp: number | null;
  /** Cross-rank of the change (1 = largest increase); null = not ranked. */
  rank: number | null;
  direction: SectorBreadthDirection | null;
  /** Consecutive weeks in the current direction, including the latest. */
  runWeeks: number | null;
  /** Like-for-like member count (n_fixed_200_13w); always present from the wire. */
  membersFixed13w: number | null;
}

export interface SectorBreadthChangeInput {
  /** Data date of the ranked frame, "YYYY-MM-DD". */
  asOfDate: string;
  /** Latest market session, "YYYY-MM-DD"; staleness is measured against it. */
  latestSession: string;
  /** Meta "basis": "reconstructed_current_membership" or "dated"; an unknown
   * value hides the basis line rather than guessing at one. */
  basis: string;
  rows: SectorBreadthChangeRow[];
}

/** Completed weekly closes between two ISO dates: whole 7-day steps only, so a
 * week counts once its final session has closed (ruling: count completed weekly
 * closes, never calendar days). Invalid or reversed input reads as 0. */
export function completedWeeklyClosesBehind(asOfDate: string, latestSession: string): number {
  const asOf = new Date(`${asOfDate}T00:00:00Z`).getTime();
  const latest = new Date(`${latestSession}T00:00:00Z`).getTime();
  if (!Number.isFinite(asOf) || !Number.isFinite(latest) || latest <= asOf) return 0;
  return Math.floor((latest - asOf) / (7 * 24 * 3600 * 1000));
}

/** Board month abbreviations — a fixed table, not a locale's "Sept"-style
 * outliers, so every month renders exactly three letters. */
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "6 Nov 2026" (EN) / "2026年11月6日" (ZH) from an ISO date, UTC; unparseable input
 * is returned untouched rather than invented. */
function fmtDate(iso: string, lang: "en" | "zh"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  if (lang === "zh") {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(d);
  }
  return `${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Template filler for copy whose placeholders carry their own ink: the lexicon
 * keeps the sentence whole, while the date inside it renders in its own span
 * (B5 — as-of date in ink, stale data-through date in amber). An unknown
 * placeholder is left untouched, exactly like nativeFill. */
function fillNodes(template: string, values: Record<string, ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0, key = 0, m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) out.push(template.slice(last, m.index));
    out.push(Object.hasOwn(values, m[1])
      ? <Fragment key={key++}>{values[m[1]]}</Fragment>
      : m[0]);
    last = re.lastIndex;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

/** One decimal, U+2212 minus, explicit plus on positives; 0 keeps no sign. */
function fmtPp(v: number): string {
  if (v === 0) return "0.0";
  return v < 0 ? `−${Math.abs(v).toFixed(1)}` : `+${v.toFixed(1)}`;
}

interface DerivedRow extends SectorBreadthChangeRow {
  /** Producer's rank kept only when the change survived the gate. */
  rankShown: number | null;
}

/** Hostile-input proofing plus the too-few gate: below MIN_MEMBERS like-for-like
 * members the change, rank and direction are missing — never zero — while the
 * share and the member count stay (delta 7). */
function deriveRows(input: SectorBreadthChangeInput | null | undefined): DerivedRow[] {
  if (!input || !Array.isArray(input.rows)) return [];
  return input.rows
    .filter((r): r is SectorBreadthChangeRow => !!r && typeof r.sectorId === "string")
    .map(r => {
      const members = num(r.membersFixed13w);
      const change = num(r.changePp);
      const gate = members !== null && members < SECTOR_BREADTH_MIN_MEMBERS;
      const changeShown = gate ? null : change;
      const direction = changeShown === null ? null : r.direction ?? null;
      const rank = num(r.rank);
      return {
        sectorId: r.sectorId,
        shareAbove200Now: num(r.shareAbove200Now),
        changePp: changeShown,
        rank: rank !== null && Number.isInteger(rank) && rank > 0 ? rank : null,
        direction: direction === "improving" || direction === "deteriorating" || direction === "flat" ? direction : null,
        runWeeks: direction === null ? null : (() => { const w = num(r.runWeeks); return w !== null && w >= 1 ? Math.round(w) : null; })(),
        membersFixed13w: members,
        rankShown: rank !== null && Number.isInteger(rank) && rank > 0 ? rank : null,
      };
    });
}

function barWidth(changePp: number): string {
  return `${Math.min(Math.abs(changePp), BAR_FULL_PP) / BAR_FULL_PP * 50}%`;
}

const ArrowRight = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
</svg>;
const Clock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
  <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
</svg>;
const DirArrow = ({ up }: { up: boolean }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d={up ? "M12 19V5m-6 6 6-6 6 6" : "M12 5v14m-6-6 6 6 6-6"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
</svg>;

export default function SectorBreadthChange({ input, nameOf, onViewDataStatus }: {
  input?: SectorBreadthChangeInput | null;
  /** Localizes a sector id; undefined falls back to the raw id, never an invented name. */
  nameOf?: (sectorId: string) => string | undefined;
  onViewDataStatus?: () => void;
}) {
  const t = useSectorT(), { lang } = useLang();
  const compact = useMediaQuery(COMPACT_QUERY);
  const derived = useMemo(() => deriveRows(input), [input]);
  const localName = (sectorId: string) => (nameOf ? nameOf(sectorId) : undefined) ?? sectorId;

  const root = `${styles.module}${compact ? ` ${styles.moduleCompact}` : ""}`;
  if (derived.length === 0) {
    // Unavailable: the Brief's honest line, verbatim (delta 1 dropped the
    // returns sentence; nothing about returns is claimed or implied here).
    return <section className={root} data-testid="sector-breadth-change" data-state="unavailable">
      <div className={`${styles.head}${compact ? ` ${styles.compactHead}` : ""}`}>
        <div className={styles.headCopy}>
          <h2 className={styles.title}>{t("siBreadthTitle")}</h2>
          <p className={`${styles.sub}${compact ? ` ${styles.compactSub}` : ""}`}>{t(compact ? "siBreadthSubCompact" : "siBreadthSub")}</p>
        </div>
        {compact && <div className={styles.headSide}>
          <p className={styles.asOf}>{t("siBreadthNoAsOf")}</p>
        </div>}
      </div>
      <div className={styles.unavailable}>
        <p className={styles.unavailableLine} data-testid="sector-breadth-unavailable">{t("siNativeBreadthMissing")}</p>
        <p className={styles.unavailableSub}>{t("siBreadthUnavailableSub")}</p>
        {onViewDataStatus && <button type="button" className={styles.unavailableLink} onClick={onViewDataStatus}>
          {t("siBreadthViewStatus")} <ArrowRight />
        </button>}
      </div>
    </section>;
  }

  // Sorted by the change (ranked first, descending; too-few rows below, input order).
  const ranked = derived.filter(r => r.changePp !== null).sort((a, b) => (b.changePp as number) - (a.changePp as number));
  const unranked = derived.filter(r => r.changePp === null);
  const ordered = [...ranked, ...unranked];
  const improving = ranked.filter(r => (r.changePp as number) > 0).length;
  const deteriorating = ranked.filter(r => (r.changePp as number) < 0).length;
  const missing = unranked.length;
  const up = ranked[0] ?? null, down = ranked.length > 0 ? ranked[ranked.length - 1] : null;
  const weeksBehind = completedWeeklyClosesBehind(input!.asOfDate, input!.latestSession);
  const stale = weeksBehind >= 2;
  const state = `${stale ? "stale" : ""}${stale && missing > 0 ? "+" : ""}${missing > 0 ? "too-few" : ""}` || "full";
  const asOfText = fmtDate(input!.asOfDate, lang);
  const latestText = fmtDate(input!.latestSession, lang);
  // B5: the as-of date itself takes ink; only a stale data-through date is amber.
  const asOfLine = stale
    ? fillNodes(t("siBreadthStaleAsOf"), {
      latest: <span className={styles.asOfDate}>{latestText}</span>,
      data: <span className={styles.asOfStale}>{asOfText}</span>,
    })
    : fillNodes(t("siBreadthAsOf"), { date: <span className={styles.asOfDate}>{asOfText}</span> });
  const basisLine = input!.basis === "reconstructed_current_membership" ? t("siBreadthBasisReconstructed")
    : input!.basis === "dated" ? t("siBreadthBasisDated") : null;
  const dirWord = (d: SectorBreadthDirection | null) =>
    d === "improving" ? t("siBreadthImproving") : d === "deteriorating" ? t("siBreadthDeteriorating") : d === "flat" ? t("siBreadthUnchanged") : null;
  const dirTone = (d: SectorBreadthDirection | null) =>
    d === "improving" ? styles.up : d === "deteriorating" ? styles.down : "";
  const weeksText = (w: number) => ` · ${w} ${t(w === 1 ? "siBreadthWeek" : "siBreadthWeeks")}`;
  const countLine = missing > 0
    ? nativeFill(t(compact ? "siBreadthCountMissingCompact" : "siBreadthCountMissing"),
      { ranked: String(ranked.length), total: String(derived.length), missing: String(missing) })
    : nativeFill(t(compact ? "siBreadthCountFullCompact" : "siBreadthCountFull"),
      { ranked: String(ranked.length), total: String(derived.length) });
  const measuredLink = onViewDataStatus && <button type="button" className={styles.measured} onClick={onViewDataStatus}>
    {t("siBreadthMeasured")} <ArrowRight />
  </button>;

  const shareNow = (r: DerivedRow) => r.shareAbove200Now === null ? null
    : `${r.shareAbove200Now.toFixed(1)}%`;

  return <section className={root} data-testid="sector-breadth-change" data-state={state}>
    <div className={`${styles.head}${compact ? ` ${styles.compactHead}` : ""}`}>
      <div className={styles.headCopy}>
        <h2 className={styles.title}>{t("siBreadthTitle")}</h2>
        <p className={`${styles.sub}${compact ? ` ${styles.compactSub}` : ""}`}>{t(compact ? "siBreadthSubCompact" : "siBreadthSub")}</p>
      </div>
      {/* B1: at 1440 the measured link sits right-aligned under the as-of line,
          so both live in the one right-hand column. The 390 layout keeps the
          link in the footer (two-column head there would crowd the copy). */}
      {compact ? <div className={`${styles.headSide} ${styles.compactHeadSide}`}>
        <p className={`${styles.asOf} ${styles.compactAsOf}`}>{asOfLine}</p>
      </div> : <div className={styles.headSide}>
        <p className={styles.asOf}>{asOfLine}</p>
        {measuredLink}
      </div>}
    </div>

    {stale && <div className={`${styles.notice}${compact ? ` ${styles.noticeCompact}` : ""}`} data-testid="sector-breadth-stale">
      <span className={styles.noticeIcon}><Clock /></span>
      {compact
        ? <div className={styles.noticeCopyCompact}>
          <p className={`${styles.noticeHead} ${styles.noticeHeadCompact}`}>
            {nativeFill(t("siBreadthStaleHead"), { weeks: String(weeksBehind) })}</p>
          <p className={`${styles.noticeSub} ${styles.noticeSubCompact}`}>{t("siBreadthStaleSub")}</p>
        </div>
        : <>
          <p className={styles.noticeHead}>{nativeFill(t("siBreadthStaleHead"), { weeks: String(weeksBehind) })}</p>
          <p className={styles.noticeSub}>{t("siBreadthStaleSub")}</p>
        </>}
    </div>}

    <div className={`${compact ? styles.answerCompact : styles.answer}`}>
      <p className={`${styles.answerHead}${compact ? ` ${styles.answerHeadCompact}` : ""}`}>
        {missing > 0
          ? nativeFill(t("siBreadthAnswerMissing"), { improving: String(improving), deteriorating: String(deteriorating), missing: String(missing) })
          : nativeFill(t(compact ? "siBreadthAnswerFullCompact" : "siBreadthAnswerFull"),
            { improving: String(improving), deteriorating: String(deteriorating) })}
      </p>
      {ranked.length > 1 && up && down && <p className={`${styles.answerSub}${compact ? ` ${styles.answerSubCompact}` : ""}`}>
        {t("siBreadthLargestIncrease")} <span className={styles.answerSector}>{localName(up.sectorId)}</span>{" "}
        {/* B2: both widths carry the pp unit, exactly as the boards draw it. */}
        <span className={`${styles.num} ${styles.up}`}>{fmtPp(up.changePp as number)} pp</span>
        {" · "}{t("siBreadthLargestDecrease")} <span className={styles.answerSector}>{localName(down.sectorId)}</span>{" "}
        <span className={`${styles.num} ${styles.down}`}>{fmtPp(down.changePp as number)} pp</span>
      </p>}
    </div>

    {compact ? <div className={`${styles.rowsCompact}${stale ? ` ${styles.tableStale}` : ""}`} role="table" aria-label={t("siBreadthTitle")}>
      {ordered.map(r => {
        const word = dirWord(r.direction), tone = dirTone(r.direction);
        const share = shareNow(r);
        return <div key={r.sectorId} className={`${styles.rowCompact}${r.changePp === null ? ` ${styles.rowNotRankedCompact}` : ""}`}
          role="row" data-testid="sector-breadth-row" data-sector={r.sectorId} data-ranked={r.changePp !== null}>
          <div className={styles.rowLine1}>
            <span className={`${styles.rankCompact} ${styles.num}`}>{r.rankShown ?? "—"}</span>
            <span className={styles.sectorCompact}>{localName(r.sectorId)}</span>
            <span className={`${styles.valueCompact} ${styles.num} ${r.changePp === null ? styles.valueMissing : r.changePp > 0 ? styles.up : r.changePp < 0 ? styles.down : ""}`}>
              {r.changePp === null ? "—" : `${fmtPp(r.changePp)} pp`}
            </span>
          </div>
          {r.changePp === null
            // E1/E2: the missing change dashes the bar slot at both widths, and
            // the row draws NO axis stroke — the stroke through the dash read as
            // "+". The dash itself is the only thing in the slot.
            ? <div className={styles.barWrapCompact}>
              <div className={styles.barMissingCompact} data-testid="sector-breadth-bar-missing">
                <span className={`${styles.barMissingDash} ${styles.num}`}>—</span>
              </div>
            </div>
            : <div className={styles.barWrapCompact}>
              <div className={styles.barTrackCompact}>
                <span className={styles.barAxisCompact} />
                {r.changePp > 0
                  ? <span className={styles.barPosCompact} style={{ width: barWidth(r.changePp) }} />
                  : <span className={styles.barNegCompact} style={{ width: barWidth(r.changePp) }} />}
              </div>
            </div>}
          <div className={styles.rowLine3}>
            {/* W2 (ruling 33): the share follows its own field. A missing
                pct_above_200 renders the missing-value treatment ("—"), a
                different case from the like-for-like gate, which keeps the
                share and removes only the change and rank. */}
            <span className={styles.shareNowCompact} data-testid="sector-breadth-share">
              {share !== null
                ? <><span className={`${styles.shareNowValue} ${styles.num}`}>{share}</span>{" "}{t(stale ? "siBreadthAbove" : "siBreadthAboveNow")}</>
                : <span className={`${styles.shareNowMissing} ${styles.num}`}>—</span>}
            </span>
            {r.changePp === null
              ? <span className={styles.notRankedCopyCompact}>
                {nativeFill(t("siBreadthNotRanked"), { members: String(r.membersFixed13w ?? 0), needed: String(SECTOR_BREADTH_MIN_MEMBERS) })}
              </span>
              : word && <span className={`${styles.directionCompact} ${tone}`}>
                {`${r.direction === "improving" ? "↑ " : r.direction === "deteriorating" ? "↓ " : ""}${word}${r.runWeeks !== null ? weeksText(r.runWeeks) : ""}`}
              </span>}
          </div>
        </div>;
      })}
    </div> : <div className={`${styles.table}${stale ? ` ${styles.tableStale}` : ""}`} role="table" aria-label={t("siBreadthTitle")}>
      <div className={styles.thead} role="row">
        <span className={`${styles.th} ${styles.thRank}`} role="columnheader">{t("siBreadthColRank")}</span>
        <span className={`${styles.th} ${styles.thSector}`} role="columnheader">{t("siBreadthColSector")}</span>
        <span className={`${styles.th} ${styles.thChange}`} role="columnheader">
          <span>{t("siBreadthColChange")}</span><span className={styles.num}>{t("siBreadthColChangeUnit")}</span>
        </span>
        {/* B6: while stale the values are not current, so the header drops "now". */}
        <span className={`${styles.th} ${styles.thLevel}`} role="columnheader">{t(stale ? "siBreadthColLevelStale" : "siBreadthColLevel")}</span>
        <span className={`${styles.th} ${styles.thDirection}`} role="columnheader">{t("siBreadthColDirection")}</span>
        <span className={`${styles.th} ${styles.thMembers}`} role="columnheader">{t("siBreadthColMembers")}</span>
      </div>
      {ordered.map(r => {
        const word = dirWord(r.direction), tone = dirTone(r.direction);
        const share = shareNow(r);
        return <div key={r.sectorId} className={`${styles.row}${r.changePp === null ? ` ${styles.rowNotRanked}` : ""}`}
          role="row" data-testid="sector-breadth-row" data-sector={r.sectorId} data-ranked={r.changePp !== null}>
          <span className={`${styles.rank} ${styles.num}`} role="cell">{r.rankShown ?? "—"}</span>
          <span className={styles.sector} role="cell">{localName(r.sectorId)}</span>
          {r.changePp === null
            // B7/E1: the pp column prints its own dash, and the bar slot carries
            // a dash centred where the zero axis would be — with no axis stroke.
            ? <span className={styles.changeCell} role="cell" data-testid="sector-breadth-change-cell">
              <span className={styles.barTrack} data-testid="sector-breadth-bar-missing">
                <span className={`${styles.barMissingWide} ${styles.barMissingDash} ${styles.num}`}>—</span>
              </span>
              <span className={`${styles.value} ${styles.num} ${styles.valueMissing}`} data-testid="sector-breadth-change-value">—</span>
            </span>
            : <span className={styles.changeCell} role="cell" data-testid="sector-breadth-change-cell">
              <span className={styles.barTrack}>
                <span className={styles.barAxis} />
                {r.changePp > 0
                  ? <span className={styles.barPos} style={{ width: barWidth(r.changePp) }} />
                  : <span className={styles.barNeg} style={{ width: barWidth(r.changePp) }} />}
              </span>
              <span className={`${styles.value} ${styles.num} ${r.changePp > 0 ? styles.up : r.changePp < 0 ? styles.down : ""}`} data-testid="sector-breadth-change-value">
                {fmtPp(r.changePp)}
              </span>
            </span>}
          <span className={styles.level} role="cell" data-testid="sector-breadth-share">
            {share === null ? <span className={styles.levelMissing}>—</span> : <>
              <span className={`${styles.levelPct} ${styles.num}`}>{share}</span>
              <span className={styles.levelTrack}>
                <span className={styles.levelFill} style={{ width: `${Math.max(0, Math.min(r.shareAbove200Now as number, 100))}%` }} />
              </span>
            </>}
          </span>
          <span className={styles.direction} role="cell">
            {r.changePp === null
              ? <span className={styles.notRankedCopy}>
                {nativeFill(t("siBreadthNotRanked"), { members: String(r.membersFixed13w ?? 0), needed: String(SECTOR_BREADTH_MIN_MEMBERS) })}
              </span>
              : <>
                {r.direction === "improving" && <span className={styles.up}><DirArrow up /></span>}
                {r.direction === "deteriorating" && <span className={styles.down}><DirArrow up={false} /></span>}
                {word && <span className={`${styles.dirWord} ${tone}`}>{word}</span>}
                {r.runWeeks !== null && <span className={`${styles.dirWeeks} ${styles.num}`}>{weeksText(r.runWeeks)}</span>}
              </>}
          </span>
          <span className={`${styles.members} ${styles.num} ${r.changePp === null ? styles.membersNotRanked : ""}`} role="cell">
            {r.membersFixed13w ?? "—"}
          </span>
        </div>;
      })}
    </div>}

    <div className={`${styles.footer}${compact ? ` ${styles.footerCompact}` : ""}`}>
      <div className={styles.footerCopy}>
        {basisLine && <p className={styles.basis}>{basisLine}</p>}
        <p className={styles.method}>{compact
          ? nativeFill(t("siBreadthMethodCompact"), { count: countLine })
          : t("siBreadthMethod")}</p>
        {compact && measuredLink && <div className={styles.footerMeasured}>{measuredLink}</div>}
      </div>
      {!compact && <p className={styles.count}>{countLine}</p>}
    </div>
  </section>;
}
