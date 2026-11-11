"use client";
import { exposureSessionReviewT } from "./exposureSessionReviewStrings";
import { useEffect, useMemo, useState } from "react";
import {
  bucketBarsBySession, buildSessionReview, type ReviewFrameInput, type ReviewFrameKind,
  type ReviewMode, type SessionReviewRow,
} from "@/lib/exposureSessionReview";
import type { Bar6 } from "@/lib/intradayShared";
import styles from "./ExposureSessionReview.module.css";

/** Prices are display-formatted only; every value is measured in exposureSessionReview.ts. */
const fmtPrice = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
const fmtSignedPct = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v * 100).toFixed(2)}%`;
const fmtNetMn = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(Math.round(v))}M`;

type Read = { root: string; bars: Bar6[]; attempt: number };
export default function ExposureSessionReview({ root, frames, pinnedLevel, lang, onOpenPriceContext }: {
  root: string; frames: readonly ReviewFrameInput[]; pinnedLevel?: number | null; lang: "en" | "zh";
  onOpenPriceContext?: (session: string) => void;
}) {
  const t = exposureSessionReviewT(lang);
  const [read, setRead] = useState<Read | null>(null);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [attempt, refresh] = useState(0);
  const [mode, setMode] = useState<ReviewMode>("dominant");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!frames.length) return;
    let current = true; const controller = new AbortController();
    fetch(`/api/intraday?sym=${encodeURIComponent(root)}&tf=10m&ext=0`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok || value?.error || value?.t !== root || value?.tf !== "10m" || !Array.isArray(value?.bars)) throw new Error("BAR_SOURCE_UNAVAILABLE");
        return value.bars as Bar6[];
      })
      .then((bars) => { if (current) setRead({ root, bars, attempt }); })
      .catch(() => { if (current) setFailedAt(attempt); });
    return () => { current = false; controller.abort(); };
  }, [root, attempt, frames.length]);
  const isCurrent = read != null && read.root === root && read.attempt === attempt;
  const status = !frames.length ? "no-frames" : isCurrent ? "ready" : failedAt === attempt ? "bars-unavailable" : "loading";
  const buckets = useMemo(() => bucketBarsBySession(read && read.root === root ? read.bars : []), [read, root]);
  const review = useMemo(() => buildSessionReview(root, frames, buckets, mode, pinnedLevel ?? null), [root, frames, buckets, mode, pinnedLevel]);
  const rows = review.rows;
  const selectedRow = rows.find((row) => row.session === selected) ?? rows.at(-1) ?? null;
  const { totals } = review;
  return <section className={styles.review} data-review-status={status}>
    {status === "no-frames" ? <p className={styles.empty}>{t("noFrames")}</p> : <>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <button type="button" className={styles.chip} aria-pressed={mode === "dominant"} onClick={() => setMode("dominant")}>{t("dominantAtFrame")}</button>
          <button type="button" className={styles.chip} aria-pressed={mode === "pinned"} disabled={pinnedLevel == null}
            title={pinnedLevel == null ? t("noPinned") : undefined} onClick={() => setMode("pinned")}>
            {pinnedLevel == null ? t("pinnedOnly").replace("{level}", "—") : t("pinnedOnly").replace("{level}", fmtPrice(pinnedLevel))}
          </button>
          <span className={styles.staticChip}>{t("touchRule")}</span>
          <span className={styles.staticChip}>{t("barsTf")}</span>
        </div>
        <div className={styles.toolbarRight}>
          <span className={styles.totals}>
            {`${totals.sessions} ${t("sessions")} · ${totals.observed} ${t("observed")} · ${totals.reconstructed} ${t("reconstructed")}`}
            {totals.aggregate > 0 ? ` · ${totals.aggregate} ${t("aggregate")}` : ""}
          </span>
          <div className={styles.counter}><span className={styles.counterLabel}>{t("observedTouches")}</span><strong>{totals.observedTouches}</strong></div>
          <div className={styles.counter}><span className={styles.counterLabel}>{t("reconstructedTouches")}</span><strong>{totals.reconstructedTouches}</strong></div>
        </div>
      </div>
      <div className={styles.layout}>
      <div className={styles.mainColumn}>
      <div className={styles.tableWrap}>
        <table className={styles.table}><thead><tr>
          <th>{t("session")}</th><th>{t("frame")}</th><th>{t("levelAtFrame")}</th><th>{t("touches")}</th>
          <th>{t("firstLast")}</th><th>{t("maxExcursion")}</th><th>{t("closeVsLevel")}</th><th>{t("sessionStrip")}</th>
        </tr></thead>
        <tbody>
          {status === "loading" ? [0, 1, 2].map((n) => <tr key={n} className={styles.skeletonRow}><td colSpan={8}><span className={styles.skeletonBar} /></td></tr>)
            : rows.map((row) => <SessionRow key={row.session} row={row} t={t} selected={selectedRow?.session === row.session} onSelect={setSelected} />)}
        </tbody></table>
      </div>
      {status === "bars-unavailable" && <div className={styles.sourceNote}>
        <span>{t("barsUnavailable")}</span>
        <button type="button" onClick={() => refresh((n) => n + 1)}>{t("retry")}</button>
      </div>}
      {status === "loading" && <p className={styles.sourceNote}>{t("loading")}</p>}
      <footer className={styles.footer}>
        <div className={styles.footerClaims}>
          <span className={styles.claimEyebrow}>{t("noHoldRate")}</span>
          <p>{t("descriptionNotSample").replace("{n}", String(totals.sessions))}</p>
          <p>{t("touchDefinition")}</p>
        </div>
        <span className={styles.levelsNote}>{t("levelsStored")}</span>
      </footer>
      </div>
      {status === "ready" && selectedRow && <Inspector row={selectedRow} index={rows.indexOf(selectedRow) + 1} count={rows.length} t={t}
        onOpenPriceContext={onOpenPriceContext} />}
      </div>
    </>}
  </section>;
}

type Copy = ReturnType<typeof exposureSessionReviewT>;
const EXCURSION_SIDE = { above: "high", below: "low" } as const;
function SessionRow({ row, t, selected, onSelect }: { row: SessionReviewRow; t: Copy; selected: boolean; onSelect: (session: string) => void }) {
  const m = row.measure;
  const reason = row.missing === "no_level" ? t("noLevel") : t("noBars");
  let levelSpan: (v: number) => string = () => "50%";
  if (m?.high != null && m.low != null && m.high > m.low) { const lo = m.low, span = m.high - m.low; levelSpan = (v) => `${(((v - lo) / span) * 100).toFixed(1)}%`; }
  return <tr className={selected ? styles.selectedRow : undefined} aria-selected={selected} data-review-session={selected ? row.session : undefined}
    onClick={() => onSelect(row.session)}>
    <td className={styles.sessionCell}>{row.session}</td>
    <td><span className={row.kind === "current" ? styles.kindCurrent : row.kind === "reconstructed" || row.kind === "aggregate" ? styles.kindOutline : styles.kind}>{kindWordFor(row.kind, t)}</span></td>
    <td><span className={row.pinned ? styles.levelPinned : undefined} title={row.missing ? reason : undefined}>{row.level == null ? t("none") : fmtPrice(row.level)}{row.pinned ? ` · ${t("pinned")}` : ""}</span></td>
    <td title={row.missing ? reason : undefined}>{m ? String(m.touches) : t("none")}</td>
    <td title={row.missing ? reason : undefined}>{m?.firstTouchEt ? `${m.firstTouchEt} · ${m.lastTouchEt}` : t("none")}</td>
    <td title={row.missing ? reason : undefined}>{m ? `${fmtSignedPct(m.maxExcursionPct ?? 0)} · ${t(EXCURSION_SIDE[m.maxExcursionSide ?? "above"])} ${fmtPrice(m.maxExcursionPrice ?? 0)}` : t("none")}</td>
    <td title={row.missing ? reason : undefined}>{m?.close != null && m.closeVsLevelPct != null ? `${fmtSignedPct(m.closeVsLevelPct)} · ${fmtPrice(m.close)}` : t("none")}</td>
    <td className={styles.stripCell} title={row.missing ? reason : undefined}>{m && <span className={styles.strip} aria-hidden="true">
      <i className={row.pinned ? styles.stripLevelPinned : styles.stripLevel} style={{ left: levelSpan(row.level ?? 0) }} />
      {m.close != null && <i className={styles.stripClose} style={{ left: levelSpan(m.close) }} />}
    </span>}</td>
  </tr>;
}
function kindWordFor(kind: ReviewFrameKind, t: Copy) {
  return t(kind === "observed" ? "observed" : kind === "reconstructed" ? "reconstructed" : kind === "aggregate" ? "aggregate" : "current");
}
function Inspector({ row, index, count, t, onOpenPriceContext }: { row: SessionReviewRow; index: number; count: number; t: Copy; onOpenPriceContext?: (session: string) => void }) {
  const m = row.measure;
  const kindLine = row.kind === "current" ? `${kindWordFor(row.kind, t)} · ${t("observedPrices")}` : kindWordFor(row.kind, t);
  return <aside className={styles.inspector}>
    <span className={styles.eyebrow}>{`${t("session")} ${index} / ${count}`}</span>
    <div className={styles.inspectorHead}>
      <strong className={styles.inspectorDate}>{row.session}</strong>
      <span className={row.kind === "current" ? styles.kindCurrent : styles.kind}>{kindLine}</span>
    </div>
    <div className={styles.bigNumber}><strong>{m ? String(m.touches) : t("none")}</strong>
      <span>{`${t("touchesOf")} ${row.level == null ? t("none") : fmtPrice(row.level)} · ${row.pinned ? t("pinnedLevel") : t("dominantNode")}`}</span>
    </div>
    <dl className={styles.facts}>
      <dt>{t("level")}</dt><dd>{row.level == null ? t("none") : <span>{fmtPrice(row.level)}{row.levelNetMn != null && <b data-sign={row.levelNetMn < 0 ? "negative" : "positive"}>{` · ${fmtNetMn(row.levelNetMn)}`}</b>}</span>}</dd>
      <dt>{t("firstTouch")}</dt><dd>{m?.firstTouchEt ? `${m.firstTouchEt} ET` : t("none")}</dd>
      <dt>{t("lastTouch")}</dt><dd>{m?.lastTouchEt ? `${m.lastTouchEt} ET` : t("none")}</dd>
      <dt>{t("maxExcursion")}</dt><dd>{m ? `${fmtSignedPct(m.maxExcursionPct ?? 0)} · ${t(EXCURSION_SIDE[m.maxExcursionSide ?? "above"])} ${fmtPrice(m.maxExcursionPrice ?? 0)}` : t("none")}</dd>
      <dt>{t("closeVsLevel")}</dt><dd>{m?.close != null && m.closeVsLevelPct != null ? `${fmtSignedPct(m.closeVsLevelPct)} · ${fmtPrice(m.close)}` : t("none")}</dd>
    </dl>
    <div className={styles.measurement}>
      <span className={styles.eyebrow}>{t("measurement")}</span>
      <p>{`${kindWordFor(row.kind, t)} · ${t("barsSource")}`}</p>
      <p className={styles.caveat}>{t("caveat")}</p>
    </div>
    {onOpenPriceContext && <button type="button" className={styles.contextButton} onClick={() => onOpenPriceContext(row.session)}>
      {t("openPriceContext").replace("{date}", row.session)}
    </button>}
  </aside>;
}
