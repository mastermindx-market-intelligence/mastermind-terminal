"use client";
/**
 * VolComparePanel — constant-tenor comparison over the published ATM term
 * structure (Options R1 W3B; freeze §W3B B1/B2 + 2026-10-21 axes amendment).
 *
 * One nightly observation, described honestly:
 *   - every point is labelled supplied / interpolated / unsupported; standard
 *     tenors are variance-linear in CALENDAR days between the two nearest
 *     supplied expiries, and nothing outside the supplied range is drawn;
 *   - the payload publishes no spot and no per-strike delta, so the delta axis
 *     is unsupported, skew is read in strike space only, and the quote side is
 *     rendered as "side not stated by source" (never claimed as mid);
 *   - the expected move is the DECLARED iv·√T approximation with two clocks and
 *     NO confidence level; the producer's one-day band, when supplied, is shown
 *     separately as "method not stated by source".
 *
 * Vol is non-directional: neutral accents only — an IV level is never a colour.
 * spot / events / publishedBand are accepted but NOT wired by VolView yet; the
 * panel states their absence in words instead of inventing values.
 */

import React, { useMemo, useRef } from "react";
import type { Lang } from "@/lib/i18n";
import { makeVolT } from "./volStrings";
import type { VolSmileExp, VolTermRow } from "./volTypes";
import {
  admitVolTermRows, NEUTRAL_CHIP, PanelEmpty, ProvenanceLine, volIsoDay,
} from "./volShared";
import {
  answerLine, atmProxyStrike, constantTenorPoint, eventInWindow,
  expectedMoveFromIv, skewInStrikeSpace, tradingDaysBetween, STANDARD_TENORS,
  type CurveEvent,
} from "@/lib/volTenorComparison";

const STALE_SESSIONS = 3; // same staleness tone VolView's asof chip uses
const SKEW_PCTS = [90, 95, 100, 105, 110] as const;

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZH_DOW = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** ET calendar date (YYYY-MM-DD), the same clock VolView's staleness chip runs on. */
function etToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function addDays(iso: string, n: number): string | null {
  const epoch = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(epoch)) return null;
  return new Date(epoch + n * 86400000).toISOString().slice(0, 10);
}

/** "2026-10-23" → "23 Oct" / "10月23日"; a non-day renders as an em dash, never a zero. */
function dayShort(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  const epoch = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(epoch)) return "—";
  const d = new Date(epoch);
  return lang === "zh"
    ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
    : `${d.getUTCDate()} ${EN_MONTHS[d.getUTCMonth()]}`;
}

/** "2026-10-30" → "Thu 30 Oct 2026" / "2026年10月30日 周四". */
function eventDay(iso: string, lang: Lang): string {
  const epoch = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(epoch)) return dayShort(iso, lang);
  const d = new Date(epoch);
  return lang === "zh"
    ? `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${ZH_DOW[d.getUTCDay()]}`
    : `${EN_DOW[d.getUTCDay()]} ${d.getUTCDate()} ${EN_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const fmtIv = (v: number | null): string => (v != null && Number.isFinite(v) ? `${v.toFixed(1)} %` : "—");
const fmtMoney = (v: number): string => `$${v.toFixed(2)}`;

interface TableRow {
  key: string;
  tenorDays: number;
  exp: string | null;
  iv: number | null;
  basis: "supplied" | "interpolated" | "unsupported";
  between: { lo: number; hi: number } | null;
  selected: boolean;
}

export function VolComparePanel({
  term,
  smile,
  asof,
  selectedExp,
  lang,
  sessionsOld,
  today,
  spot,
  events,
  publishedBand,
  onOpenResearch,
}: {
  term?: VolTermRow[];
  smile?: VolSmileExp[];
  asof?: string;
  selectedExp?: string | null;
  lang: Lang;
  sessionsOld?: number | null;
  today?: string;
  spot?: { value: number; asOf: string } | null;
  events?: CurveEvent[];
  publishedBand?: { pct: number; bandMult: number; horizonDays: number; asof: string } | null;
  onOpenResearch?: () => void;
}) {
  const t = makeVolT(lang);
  const rootRef = useRef<HTMLElement | null>(null);
  const asofDate = (asof ?? "").slice(0, 10);
  const todayIso = today ?? etToday();
  // AC40 Option B: the producer's clock. Interpolated tenors are calendar days after `asof`
  // (engine/options_hub.py dte = exp - asof), so their dates and the skew's calendar fallback
  // run on it. `null` when the source states no valid day: then no interpolated date is shown.
  const asofIso = volIsoDay(asofDate);

  const admission = useMemo(() => admitVolTermRows(term), [term]);
  const admitted = useMemo(() => admission.rows.filter((row) => Number.isFinite(row.v)), [admission.rows]);
  const selectedExpiry = volIsoDay(selectedExp) ? selectedExp! : null;
  const loading = term === undefined;
  const empty = !loading && admitted.length === 0;

  const ivAt = useMemo(() => new Map(admitted.map((row) => [row.exp, row.v])), [admitted]);
  const dteAt = useMemo(() => new Map(admitted.map((row) => [row.exp, row.dte])), [admitted]);

  // ── Coverage strip: the selected expiry, or the nearest supplied tenor to 30D ──
  const strip = useMemo(() => {
    if (selectedExpiry && ivAt.has(selectedExpiry)) {
      return { dte: dteAt.get(selectedExpiry)!, exp: selectedExpiry, iv: ivAt.get(selectedExpiry)!, nearest: false };
    }
    if (selectedExpiry || admitted.length === 0) return null;
    const near = admitted.reduce((a, b) => (Math.abs(b.dte - 30) < Math.abs(a.dte - 30) ? b : a));
    return { dte: near.dte, exp: near.exp, iv: near.v, nearest: true };
  }, [admitted, dteAt, ivAt, selectedExpiry]);

  // ── Term table: supplied rows + interpolated standard tenors; unsupported last ──
  const table = useMemo(() => {
    const supplied: TableRow[] = admitted.map((row) => ({
      key: `s:${row.exp}`, tenorDays: row.dte, exp: row.exp, iv: row.v,
      basis: "supplied", between: null, selected: row.exp === selectedExpiry,
    }));
    const std = STANDARD_TENORS.map((d) => constantTenorPoint(term, d));
    const interpolated: TableRow[] = std
      .filter((p) => p.basis === "interpolated" && !supplied.some((s) => s.tenorDays === p.tenorDays))
      .map((p) => ({
        key: `i:${p.tenorDays}`, tenorDays: p.tenorDays,
        exp: asofIso ? addDays(asofIso, p.tenorDays) : null, iv: p.iv, basis: "interpolated",
        between: p.between ? { lo: p.between.lo.dte, hi: p.between.hi.dte } : null, selected: false,
      }));
    const unsupported: TableRow[] = std
      .filter((p) => p.basis === "unsupported")
      .map((p) => ({
        key: `u:${p.tenorDays}`, tenorDays: p.tenorDays, exp: null, iv: null,
        basis: "unsupported", between: null, selected: false,
      }));
    return {
      main: [...supplied, ...interpolated].sort((a, b) => a.tenorDays - b.tenorDays),
      unsupported,
      suppliedCount: supplied.length,
      interpolatedCount: interpolated.length,
    };
  }, [admitted, asofIso, selectedExpiry, term]);

  const [levelLo, levelHi] = useMemo(() => {
    if (!admitted.length) return [0, 1];
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of admitted) {
      if (row.v < lo) lo = row.v;
      if (row.v > hi) hi = row.v;
    }
    return hi > lo ? [lo, hi] : [0, 1];
  }, [admitted]);

  // ── Answer line: the selected point against the 7D and 30D anchors ──────────
  const answer = useMemo(() => {
    if (!selectedExpiry || !ivAt.has(selectedExpiry)) return null;
    const sel = { tenorDays: dteAt.get(selectedExpiry)!, iv: ivAt.get(selectedExpiry)!, basis: "supplied" as const };
    const { above7, above30 } = answerLine(sel, constantTenorPoint(term, 7), constantTenorPoint(term, 30));
    const part = (diff: number | null, tenor: number) =>
      diff == null
        ? null
        : t("cmpAnswerSide")
          .replace("{v}", Math.abs(diff).toFixed(1))
          .replace("{dir}", diff >= 0 ? t("cmpDirAbove") : t("cmpDirBelow"))
          .replace("{tenor}", String(tenor));
    const a = part(above7, 7);
    const b = part(above30, 30);
    const dte = String(sel.tenorDays);
    if (a && b) return t("cmpAnswerLine").replace("{dte}", dte).replace("{a}", a).replace("{b}", b);
    if (a || b) return t("cmpAnswerLineOne").replace("{dte}", dte).replace("{a}", a ?? b!);
    return t("cmpAnswerNone");
  }, [dteAt, ivAt, selectedExpiry, t, term]);

  // ── Expected move: declared iv·√T on trading days between today and expiry ──
  const move = useMemo(() => {
    if (!selectedExpiry) return null;
    const iv = ivAt.get(selectedExpiry);
    const days = tradingDaysBetween(todayIso, selectedExpiry);
    if (iv == null || days == null) return null;
    return expectedMoveFromIv({ ivPct: iv, horizonDays: days, ivAsOf: asofDate, spot: spot ?? null });
  }, [asofDate, ivAt, selectedExpiry, spot, todayIso]);

  // ── Skew in strike space on the selected smile (or the one nearest 30D) ─────
  const skew = useMemo(() => {
    const expiries = (smile ?? []).filter((s) => volIsoDay(s?.exp));
    if (expiries.length === 0) return null;
    // One comparator, one clock: the fallback sits beside producer dte values, so it counts
    // from `asof`; it falls back to the viewer's today only when `asof` is absent, and says so.
    const clockIso = asofIso ?? todayIso;
    const calDte = (exp: string) => Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${clockIso}T00:00:00Z`)) / 86400000);
    const dteOfExp = (exp: string) => dteAt.get(exp) ?? calDte(exp);
    const onSelected = selectedExpiry != null && expiries.some((s) => s.exp === selectedExpiry);
    const chosen = onSelected
      ? expiries.find((s) => s.exp === selectedExpiry)!
      : expiries.reduce((a, b) => (Math.abs(dteOfExp(b.exp) - 30) < Math.abs(dteOfExp(a.exp) - 30) ? b : a));
    const rows = skewInStrikeSpace(chosen, atmProxyStrike(chosen), SKEW_PCTS, "auto");
    const usedCalendar = onSelected ? !dteAt.has(chosen.exp) : expiries.some((s) => !dteAt.has(s.exp));
    return { chosen, dte: dteOfExp(chosen.exp), onSelected, rows, todayFallback: asofIso == null && usedCalendar };
  }, [asofIso, dteAt, selectedExpiry, smile, todayIso]);

  // ── Events inside the curve ──────────────────────────────────────────────────
  const eventRows = useMemo(() => {
    const list = events ?? [];
    return list
      .filter((event) => volIsoDay(event?.date))
      .map((event) => {
        const insideTenors = admitted.filter((row) => eventInWindow(row.exp, [event], todayIso).length > 0);
        const minDte = insideTenors.length ? Math.min(...insideTenors.map((row) => row.dte)) : null;
        const insideSelected = selectedExpiry != null && todayIso <= event.date && event.date <= selectedExpiry;
        return { event, minDte, insideSelected };
      });
  }, [admitted, events, selectedExpiry, todayIso]);

  const stale = sessionsOld != null && Number.isFinite(sessionsOld) && sessionsOld > STALE_SESSIONS;

  const openAllExpiries = () => {
    if (onOpenResearch) {
      onOpenResearch();
      return;
    }
    // The named landing is the existing term panel's expiry selector — never a
    // second table built here.
    const card = document.querySelector('[data-testid="term-expiry-select"]')?.closest("section") ?? null;
    if (card && typeof card.scrollIntoView === "function") card.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const basisCell = (row: TableRow) => {
    if (row.basis === "supplied") return t("cmpBasisSupplied");
    if (row.basis === "interpolated" && row.between) {
      return t("cmpBasisBetween").replace("{lo}", String(row.between.lo)).replace("{hi}", String(row.between.hi));
    }
    return t("cmpUnsupportedRange");
  };

  // Supplied rows carry the exchange expiry and render exactly as before. An interpolated row
  // is dated on the producer clock: with no stated asof it shows no date plus the reason; a date
  // on or before the viewer's ET today is no longer ahead and names the read it comes from.
  const expiryCell = (row: TableRow) => {
    const selected = row.selected ? ` · ${t("cmpSelected")}` : "";
    if (row.basis !== "interpolated") return `${dayShort(row.exp, lang)}${selected}`;
    if (!row.exp || !asofIso) return `${dayShort(null, lang)} · ${t("cmpClockUnstated")}${selected}`;
    if (row.exp <= todayIso) {
      return `${dayShort(row.exp, lang)} · ${t("cmpRowPastRead").replace("{asof}", dayShort(asofIso, lang))}${selected}`;
    }
    return `${dayShort(row.exp, lang)}${selected}`;
  };

  const eventCell = (row: TableRow) => {
    if (!events || !row.exp) return "—";
    const inside = eventInWindow(row.exp, events, todayIso);
    if (inside.length === 0) return "—";
    return inside
      .map((event) => t("cmpEventInsideCell").replace("{label}", event.label).replace("{date}", dayShort(event.date, lang)))
      .join(" · ");
  };

  const skewReason = (reason: string | undefined) =>
    reason === "wing_gap" ? t("cmpSkewGap") : reason === "no_reference" ? t("cmpSkewNoRef") : t("cmpSkewWing");

  return (
    <section ref={rootRef} className="fin-card" data-testid="vol-compare" style={{ minWidth: 0 }}>
      <div className="fin-card-h" style={{ flexWrap: "wrap", rowGap: 4 }}>
        <h2 style={TITLE}>
          {strip
            ? t("cmpTitleRich").replace("{exp}", dayShort(strip.exp, lang))
            : t("cmpTitleCompare")}
        </h2>
        <span style={{ flex: 1 }} />
        <span style={NEUTRAL_CHIP}>
          {t("cmpContextExpiries").replace("{n}", String(admission.rows.length))}
        </span>
      </div>

      {/* 1 · Coverage strip */}
      <div data-testid="vol-compare-strip" style={STRIP}>
        {loading ? (
          <>
            <span style={{ ...SKEL, width: 190 }} />
            <span style={{ ...SKEL, width: 260 }} />
            <span style={{ ...SKEL, width: 230 }} />
          </>
        ) : strip ? (
          <>
            <span style={STRIP_MAIN}>
              {`${fmtIv(strip.iv)} · ${t("cmpColIv")} · ${dayShort(strip.exp, lang)} (${strip.dte}D) · ${t("cmpBasisSupplied")}`}
              {strip.nearest && ` · ${t("cmpStripNearest")}`}
            </span>
            <span style={STRIP_META}>
              {t("cmpStripBasis").replace("{date}", asofDate ? dayShort(asofDate, lang) : t("cmpClockUnstated"))}
            </span>
            <span style={STRIP_META}>{t("cmpDeltaAxis")}</span>
          </>
        ) : (
          <span style={STRIP_META}>{t("cmpNoExpiries")}</span>
        )}
        {stale && (
          <span style={STALE_NOTE}>
            {t("cmpStale").replace("{date}", asofDate ? dayShort(asofDate, lang) : "—").replace("{n}", String(sessionsOld))}
          </span>
        )}
      </div>

      {loading ? (
        /* 2 · Loading — true-geometry skeleton: the strip above + the table head only */
        <div style={TERM_WRAP}>
          <h3 style={H3}>{t("cmpTermTitle")}</h3>
          <table style={TABLE}>
            <thead>
              <tr>
                {[t("cmpColTenor"), t("cmpColExpiry"), t("cmpColIv"), t("cmpColBasis"), t("cmpColEvent"), t("cmpColLevel")].map((c) => (
                  <th key={c} style={TH}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i}>
                  {[64, 72, 56, 96, 84, 90].map((w, j) => (
                    <td key={j} style={TD}><span style={{ ...SKEL, width: w }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : empty ? (
        <PanelEmpty title={t("cmpNoExpiries")} minHeight={120} />
      ) : (
        <>
          {/* 2 · Term table */}
          <div style={TERM_WRAP}>
            <h3 style={H3}>
              {t("cmpTermTitle")}
              <span style={H3_SUB}>
                {" "}{t("cmpTermSub")
                  .replace("{n}", String(table.suppliedCount))
                  .replace("{m}", String(table.interpolatedCount))
                  .replace("{date}", asofDate ? dayShort(asofDate, lang) : t("cmpClockUnstated"))}
              </span>
            </h3>
            <div style={SCROLL_X}>
              <table style={TABLE}>
                <thead>
                  <tr>
                    <th style={TH}>{t("cmpColTenor")}</th>
                    <th style={TH}>{t("cmpColExpiry")}</th>
                    <th style={TH}>{t("cmpColIv")}</th>
                    <th style={TH}>{t("cmpColBasis")}</th>
                    <th style={TH}>{t("cmpColEvent")}</th>
                    <th style={{ ...TH, textAlign: "left" }}>
                      {t("cmpLevelLabel").replace("{lo}", String(Math.round(levelLo))).replace("{hi}", String(Math.round(levelHi)))}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.main.map((row) => (
                    <tr key={row.key}>
                      <td style={{ ...TD, fontWeight: row.selected ? 700 : 500 }}>{row.tenorDays}D</td>
                      <td style={TD}>{expiryCell(row)}</td>
                      <td style={TD_NUM}>{fmtIv(row.iv)}</td>
                      <td style={TD}>{basisCell(row)}</td>
                      <td style={TD}>{eventCell(row)}</td>
                      <td style={TD}>
                        <span style={LEVEL_TRACK} aria-hidden="true">
                          <span style={{ ...LEVEL_FILL, width: `${(Math.min(1, Math.max(0, ((row.iv ?? levelLo) - levelLo) / (levelHi - levelLo))) * 100).toFixed(1)}%` }} />
                        </span>
                      </td>
                    </tr>
                  ))}
                  {table.unsupported.map((row) => (
                    <tr key={row.key}>
                      <td style={{ ...TD, color: "var(--muted)" }}>{row.tenorDays}D</td>
                      <td style={{ ...TD, color: "var(--muted)" }}>—</td>
                      <td style={{ ...TD_NUM, color: "var(--muted)" }}>—</td>
                      <td style={{ ...TD, color: "var(--muted)" }}>{t("cmpUnsupportedRange")}</td>
                      <td style={{ ...TD, color: "var(--muted)" }}>—</td>
                      <td style={TD} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={FOOT}>
              <span>{t("cmpTermFoot")}</span>
              <button type="button" style={LINK} onClick={openAllExpiries}>
                {t("cmpTermLink").replace("{n}", String(admission.rows.length))}
              </button>
            </div>
          </div>

          {/* 3 · Answer line */}
          <div data-testid="vol-compare-answer" style={ANSWER}>
            <span style={ANSWER_MAIN}>
              {answer ?? (selectedExpiry ? t("cmpAnswerMissing") : t("cmpAnswerNone"))}
            </span>
            <span style={STRIP_META}>{t("cmpAnswerDisclaimer")}</span>
          </div>

          {/* 4 · Expected move — declared estimator, two clocks, no confidence level */}
          {move && (
            <div data-testid="vol-compare-move" style={BLOCK}>
              <h3 style={H3}>
                {t("cmpMoveTitle").replace("{exp}", dayShort(selectedExpiry, lang))}
                <span style={H3_SUB}>{" "}{t("cmpMoveSub")}</span>
              </h3>
              <div style={MOVE_GRID}>
                <div>
                  <div style={MOVE_HEAD}>
                    {move.lo != null
                      ? `±${move.pct.toFixed(1)} % · ${fmtMoney(move.lo)} – ${fmtMoney(move.hi!)}`
                      : t("cmpMovePctOnly").replace("{v}", move.pct.toFixed(1))}
                  </div>
                  {move.lo != null && (
                    <div style={{ ...STRIP_META, marginTop: 2 }}>
                      {t("cmpMoveFromSpot")
                        .replace("{spot}", fmtMoney(move.spot!))
                        .replace("{clock}", move.spotAsOf ?? t("cmpMoveSpotClockMissing"))}
                    </div>
                  )}
                  <dl style={DEFS}>
                    <dt style={DT}>{t("cmpMoveEstimatorLabel")}</dt>
                    <dd style={DD}>{t("cmpMoveEstimatorValue").replace("{iv}", move.ivPct.toFixed(1))}</dd>
                    <dt style={DT}>{t("cmpMoveHorizonLabel")}</dt>
                    <dd style={DD}>
                      {t("cmpMoveHorizonValue")
                        .replace("{n}", String(move.horizonDays))
                        .replace("{from}", dayShort(todayIso, lang))
                        .replace("{to}", dayShort(selectedExpiry, lang))}
                      {" "}<span style={DD_NOTE}>{t("cmpMoveHorizonNote")}</span>
                    </dd>
                    <dt style={DT}>{t("cmpMoveVolClockLabel")}</dt>
                    <dd style={DD}>
                      {asofDate
                        ? t("cmpMoveVolClockValue").replace("{date}", dayShort(asofDate, lang))
                        : t("cmpClockUnstated")}
                    </dd>
                    <dt style={DT}>{t("cmpMoveSpotClockLabel")}</dt>
                    <dd style={DD}>
                      {move.spotAsOf
                        ? t("cmpMoveSpotClockValue").replace("{clock}", move.spotAsOf)
                        : t("cmpMoveSpotClockMissing")}
                    </dd>
                  </dl>
                </div>
                {publishedBand != null && Number.isFinite(publishedBand.pct) && (
                  <div style={BAND_COL}>
                    <div style={BAND_HEAD}>{t("cmpBandHeading")}</div>
                    <div style={MOVE_HEAD}>
                      {t("cmpBandPct")
                        .replace("{v}", publishedBand.pct.toFixed(2))
                        .replace("{m}", Number.isFinite(publishedBand.bandMult) ? publishedBand.bandMult.toFixed(2) : "—")
                        .replace("{n}", String(publishedBand.horizonDays))}
                    </div>
                    <dl style={DEFS}>
                      <dt style={DT}>{t("cmpBandMethod")}</dt>
                      <dd style={DD}>
                        {publishedBand.asof
                          ? t("cmpBandClock").replace("{date}", dayShort(publishedBand.asof.slice(0, 10), lang))
                          : t("cmpClockUnstated")}
                      </dd>
                      <dt style={DT}>{t("cmpBandStraddle")}</dt>
                      <dd style={DD} />
                    </dl>
                  </div>
                )}
              </div>
              {move.lo != null && <div style={FOOT}>{t("cmpMoveFoot")}</div>}
            </div>
          )}

          {/* 5 · Skew in strike space — the delta axis is unsupported */}
          {skew && (
            <div data-testid="vol-compare-skew" style={BLOCK}>
              <h3 style={H3}>
                {t("cmpSkewTitle").replace("{tenor}", `${skew.dte}D`)}
                <span style={H3_SUB}>{" "}{t("cmpSkewSub")}</span>
              </h3>
              <div style={{ ...STRIP_META, marginBottom: 6 }}>
                {t("cmpSkewNote")}
                {" "}
                {skew.onSelected
                  ? t("cmpSkewOnSelected").replace("{exp}", skew.chosen.exp)
                  : t("cmpSkewOnNearest").replace("{exp}", skew.chosen.exp)}
                {skew.todayFallback && ` · ${t("cmpSkewDteFromToday")}`}
              </div>
              <div style={SCROLL_X}>
                <table style={TABLE}>
                  <thead>
                    <tr>
                      <th style={TH}>{t("cmpColStrike")}</th>
                      <th style={TH}>{t("cmpColIv")}</th>
                      <th style={TH}>{t("cmpColBasis")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skew.rows.map((row) => (
                      <tr key={row.pctOfRef}>
                        <td style={TD}>{row.pctOfRef === 100 ? t("cmpAtmRow") : `${row.pctOfRef} %`}</td>
                        <td style={TD_NUM}>{fmtIv(row.iv)}</td>
                        <td style={TD}>
                          {row.basis === "supplied"
                            ? t("cmpBasisSupplied")
                            : row.basis === "interpolated" && row.between
                              ? t("cmpBasisBetweenStrikes").replace("{lo}", String(row.between.lo)).replace("{hi}", String(row.between.hi))
                              : skewReason(row.reason)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(() => {
                const p90 = skew.rows.find((row) => row.pctOfRef === 90);
                const atm = skew.rows.find((row) => row.pctOfRef === 100);
                if (p90?.iv == null || atm?.iv == null) return null;
                return (
                  <div style={FOOT}>
                    {t("cmpSkewFoot").replace("{v}", (p90.iv - atm.iv).toFixed(1))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* 6 · Events inside the curve */}
          <div data-testid="vol-compare-events" style={BLOCK}>
            <h3 style={H3}>
              {t("cmpEventsTitle")}
              <span style={H3_SUB}>{" "}{t("cmpEventsSub")}</span>
            </h3>
            {eventRows.length === 0 ? (
              <div style={EMPTY_EVENTS}>
                <div>{t("cmpEventsNone")}</div>
                <div style={{ ...STRIP_META, marginTop: 2 }}>{t("cmpEventsNoneWhy")}</div>
              </div>
            ) : (
              <ul style={EVENT_LIST}>
                {eventRows.map(({ event, minDte, insideSelected }) => (
                  <li key={`${event.kind}:${event.date}:${event.label}`} style={EVENT_ROW}>
                    <span style={EVENT_TILE}>
                      <span style={EVENT_TILE_DAY}>{dayShort(event.date, lang)}</span>
                    </span>
                    <span>
                      <span style={EVENT_LABEL}>{`${event.label} · ${eventDay(event.date, lang)}`}</span>
                      <span style={{ ...STRIP_META, display: "block" }}>
                        {minDte != null
                          ? t("cmpEventFrom").replace("{n}", String(minDte))
                          : t("cmpEventOutside")}
                        {selectedExpiry
                          ? ` ${(insideSelected
                            ? t("cmpEventInsideSelected")
                            : t("cmpEventNotInsideSelected")).replace("{dte}", String(dteAt.get(selectedExpiry) ?? ""))}`
                          : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div style={FOOT}>{t("cmpEventsFoot")}</div>
          </div>
        </>
      )}
      <ProvenanceLine lang={lang} />
    </section>
  );
}

// ─── Styles (the neighbouring panels' vocabulary; no new CSS file) ───────────

const TITLE: React.CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  fontWeight: 700,
  color: "var(--text)",
};

const STRIP: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "4px 12px",
  padding: "8px 10px",
  marginBottom: 10,
  background: "var(--panel-2)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-md)",
};

const STRIP_MAIN: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: "var(--text)",
  fontVariantNumeric: "tabular-nums",
};

const STRIP_META: React.CSSProperties = {
  fontSize: 10.5,
  color: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
};

const STALE_NOTE: React.CSSProperties = {
  flexBasis: "100%",
  fontSize: 10.5,
  fontWeight: 600,
  color: "var(--warn)",
};

const SKEL: React.CSSProperties = {
  display: "inline-block",
  height: 10,
  borderRadius: 3,
  background: "var(--panel-3)",
};

const TERM_WRAP: React.CSSProperties = {
  marginBottom: 12,
};

const H3: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-2)",
};

const H3_SUB: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 0,
  textTransform: "none",
  color: "var(--muted)",
};

const SCROLL_X: React.CSSProperties = {
  width: "100%",
  overflowX: "auto",
};

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontVariantNumeric: "tabular-nums",
};

const TH: React.CSSProperties = {
  padding: "4px 8px 4px 0",
  textAlign: "left",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: "var(--muted)",
  borderBottom: "1px solid var(--line-2)",
  whiteSpace: "nowrap",
};

const TD: React.CSSProperties = {
  padding: "5px 8px 5px 0",
  fontSize: 11,
  color: "var(--text-2)",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
};

const TD_NUM: React.CSSProperties = {
  ...TD,
  fontWeight: 600,
  color: "var(--text)",
};

const LEVEL_TRACK: React.CSSProperties = {
  display: "block",
  width: 90,
  height: 4,
  borderRadius: 2,
  background: "var(--panel-3)",
};

const LEVEL_FILL: React.CSSProperties = {
  display: "block",
  height: 4,
  borderRadius: 2,
  background: "var(--muted)",
};

const FOOT: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: "2px 14px",
  marginTop: 6,
  fontSize: 10,
  lineHeight: 1.45,
  color: "var(--text-dim)",
};

const LINK: React.CSSProperties = {
  padding: 0,
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--brand-2)",
  whiteSpace: "nowrap",
};

const ANSWER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "9px 10px",
  marginBottom: 12,
  background: "var(--panel-2)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-md)",
};

const ANSWER_MAIN: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--text)",
};

const BLOCK: React.CSSProperties = {
  marginBottom: 12,
};

const MOVE_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
  gap: 12,
  alignItems: "start",
};

const MOVE_HEAD: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "var(--text)",
  fontVariantNumeric: "tabular-nums",
};

const BAND_HEAD: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 2,
};

const BAND_COL: React.CSSProperties = {
  borderTop: "1px solid var(--line-2)",
  paddingTop: 8,
};

const DEFS: React.CSSProperties = {
  margin: "8px 0 0",
};

const DT: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginTop: 5,
};

const DD: React.CSSProperties = {
  margin: "1px 0 0",
  fontSize: 10.5,
  lineHeight: 1.45,
  color: "var(--text-2)",
  fontVariantNumeric: "tabular-nums",
};

const DD_NOTE: React.CSSProperties = {
  color: "var(--muted)",
};

const EMPTY_EVENTS: React.CSSProperties = {
  padding: "8px 0 2px",
  fontSize: 11,
  color: "var(--text-2)",
};

const EVENT_LIST: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const EVENT_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 0",
  borderBottom: "1px solid var(--line)",
};

const EVENT_TILE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 64,
  height: 24,
  padding: "0 8px",
  background: "var(--panel-2)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-md)",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-2)",
  fontVariantNumeric: "tabular-nums",
};

const EVENT_TILE_DAY: React.CSSProperties = {
  whiteSpace: "nowrap",
};

const EVENT_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text)",
};
