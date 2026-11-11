"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildReplayFrameSet, replayTier, REPLAY_WINDOWS, type ReplayColumn, type ReplayFrame, type ReplayFrameSet,
} from "@/lib/exposureReplayFrames";
import type { ExposureLens } from "@/lib/exposureMapProjection";
import type { ExposureMapMetric } from "@/lib/exposureMap";
import { exposureReplayT, type ExposureReplayKey } from "./exposureReplayStrings";
import { useReplayColumns } from "./useReplayColumns";
import styles from "./ExposureReplay.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RATES = [1000, 1500, 3000];

const lensKey = (lens: ExposureLens): string => lens.kind === "one" ? `one:${lens.exp}` : lens.kind;

/** Human text for a typed refusal — an enum value is never rendered as copy. */
const GAP_COPY: Record<string, ExposureReplayKey> = {
  unavailable: "gapUnavailable", refused: "gapRefused", identity: "gapIdentity",
  session: "gapSession", scope: "gapScope", malformed: "gapMalformed",
};

/** Signed $mn with U+2212 and tabular numerals; billions keep three digits. */
function fmtMn(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "+";
  const abs = Math.abs(value);
  return abs >= 1000 ? `${sign}${(abs / 1000).toFixed(2)}B` : `${sign}${Math.round(abs)}M`;
}

const fmtDate = (session: string) => {
  const [, m, d] = session.split("-");
  return `${MONTHS[Math.min(11, Math.max(0, Number(m) - 1))]} ${Number(d)}`;
};

/** The book's own observation clock, in the exchange zone, when it carries one. */
function fmtClock(frame: ReplayFrame | null): string | null {
  const stamp = frame?.clocks?.option_observed_at ?? frame?.clocks?.available_at;
  if (typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) return null;
  return new Date(stamp).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }) + " ET";
}

export default function ExposureReplay({ root, source, metric, lens, today, now,
  focusStrike = null, lang, onLoadSession, onSelectStrike }:
  { root: string; source: unknown; metric: ExposureMapMetric; lens: ExposureLens; today: string; now?: number;
    focusStrike?: number | null; lang: "en" | "zh"; onLoadSession?: (session: string) => void;
    onSelectStrike?: (strike: number) => void }) {
  const t = exposureReplayT(lang);
  // One clock for the whole slice; the desk may pin its own.
  const [fallbackNow] = useState(() => Date.now());
  const nowMs = now ?? fallbackNow;
  const { status, columns, retry } = useReplayColumns({ root, source, metric, lens, today, now: nowMs });
  // The chosen frame is keyed to the column set it was chosen in: a new read starts on the last frame.
  const [activeChoice, setActiveChoice] = useState<{ columns: ReplayColumn[] | null; index: number }>({ columns: null, index: -1 });
  const active = activeChoice.columns === columns ? activeChoice.index : -1;
  const setActive = useCallback((next: number | ((prev: number) => number)) =>
    setActiveChoice((prev) => ({ columns, index: typeof next === "function" ? next(prev.columns === columns ? prev.index : -1) : next })),
  [columns]);
  const [localStrike, setLocalStrike] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [windowPct, setWindowPct] = useState(4);

  const set = useMemo<ReplayFrameSet | null>(() => {
    if (!columns) return null;
    const live = columns[columns.length - 1];
    return buildReplayFrameSet(columns, { root, metric, lens: lensKey(lens), windowPct,
      referenceSpot: live.kind === "frame" ? live.frame.spot : null });
  }, [columns, root, metric, lens, windowPct]);

  const last = (set?.columns.length ?? 1) - 1;
  const activeIndex = Math.min(active < 0 ? last : active, last);
  const activeColumn = set?.columns[activeIndex];
  const activeFrame = activeColumn?.kind === "frame" ? activeColumn.frame : null;
  const effFocus = focusStrike ?? localStrike;
  const selected = effFocus != null && set?.strikes.includes(effFocus) ? effFocus : activeFrame?.dominant ?? null;

  // Playing stays a wish: without Loop the run ends on the last frame by derivation.
  const playingActive = playing && (loop || activeIndex < last);
  useEffect(() => {
    if (!playingActive) return;
    const id = setInterval(() => setActive((prev) => {
      const at = Math.min(prev < 0 ? last : prev, last);
      return at < last ? at + 1 : loop ? 0 : at;
    }), RATES[rate]);
    return () => clearInterval(id);
  }, [playingActive, rate, loop, last, setActive]);

  const step = (delta: number) => {
    setActive((prev) => Math.max(0, Math.min(last, (prev < 0 ? last : prev) + delta)));
  };
  const onScrubKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(last); }
  };

  if (status !== "ready" || !set) {
    return (
      <div className={styles.root} data-replay-status={status} data-replay-frame={-1}>
        <div className={styles.replay}>
          {status === "loading" ? <div className={styles.empty} role="status">
            <span>{t("loading")}</span>
            {[0, 1, 2].map((n) => <div key={n} className={styles.skeletonRow} />)}
          </div> : null}
          {status === "no-index" ? <div className={styles.empty}><span>{t("noIndex")}</span></div> : null}
          {status === "unavailable" ? <div className={styles.empty}>
            <span>{t("unavailable")}</span>
            <button type="button" onClick={retry}>{t("retry")}</button>
          </div> : null}
        </div>
      </div>
    );
  }

  const pickFrame = (k: number, strike: number) => { setActive(k); setLocalStrike(strike); onSelectStrike?.(strike); };
  const kindWord = (column: ReplayColumn) => column.kind === "gap" ? t("missing")
    : column.frame.current ? t("current") : t(column.frame.kind);
  const stamp = (column: ReplayColumn) => column.kind === "gap" ? fmtDate(column.gap.session)
    : fmtDate(column.frame.session);
  const clockText = fmtClock(activeFrame);

  return (
    <div className={styles.root} data-replay-status="ready" data-replay-frame={activeIndex}>
      <div className={styles.replay}>
        <div className={styles.toolbar}>
          <span className={styles.transport}>
            <button type="button" aria-label={t("first")} onClick={() => setActive(0)}>⏮</button>
            <button type="button" aria-label={t("previous")} onClick={() => step(-1)}>◀</button>
            <button type="button" className={styles.play} aria-pressed={playingActive}
              aria-label={playingActive ? t("pause") : t("play")}
              onClick={() => setPlaying((p) => !p)}>{playingActive ? "❚❚" : "▶"}</button>
            <button type="button" aria-label={t("next")} onClick={() => step(1)}>▶</button>
            <button type="button" aria-label={t("last")} onClick={() => setActive(last)}>⏭</button>
          </span>
          <span className={styles.ident}>
            <span className={styles.eyebrow}>{t("frame")} {activeIndex + 1} / {set.columns.length}</span>
            <span className={styles.frameLine}>
              <i className={styles.kindDot} data-kind={activeColumn?.kind === "frame" ? activeColumn.frame.kind : "gap"}
                data-current={activeColumn?.kind === "frame" ? String(activeColumn.frame.current) : "false"} />
              <span className={styles.monoStamp} data-current={activeColumn?.kind === "frame" ? String(activeColumn.frame.current) : "false"}>
                {activeColumn ? `${stamp(activeColumn)} · ${kindWord(activeColumn)}${clockText ? ` · ${clockText}` : ""}` : "—"}
              </span>
            </span>
          </span>
          <span className={styles.chips}>
            <button type="button" className={styles.chip} onClick={() => setRate((r) => (r + 1) % RATES.length)}>
              {RATES[rate] / 1000}{t("perFrame")}
            </button>
            <button type="button" className={styles.chip} aria-pressed={loop}
              onClick={() => setLoop((l) => !l)}>{t("loop")}</button>
            <label className={styles.chip}>
              ±<select value={windowPct} onChange={(e) => setWindowPct(Number(e.target.value))}>
                {REPLAY_WINDOWS.map((w) => <option key={w} value={w}>{w}%</option>)}
              </select>{t("window")}
            </label>
          </span>
        </div>
        <div className={styles.scrubWrap}>
          <input type="range" className={styles.scrubber} min={0} max={last} step={1} value={activeIndex}
            aria-label={`${t("frame")} ${activeIndex + 1} / ${set.columns.length}`}
            aria-valuetext={activeColumn ? `${stamp(activeColumn)} · ${kindWord(activeColumn)}` : undefined}
            onChange={(e) => setActive(Number(e.target.value))} onKeyDown={onScrubKey} />
          <span className={styles.ticks} aria-hidden="true">
            {set.columns.map((_, k) => <i key={k} />)}
          </span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.strike} scope="col" aria-label={t("strikeNets")} />
                {set.columns.map((column, k) => (
                  <th key={column.kind === "frame" ? column.frame.session : column.gap.session} scope="col"
                    title={column.kind === "gap" ? t(GAP_COPY[column.gap.reason] ?? "gapUnavailable") : undefined}>
                    <span className={styles.headDate} data-current={k === last ? "true" : undefined}>{stamp(column)}</span>
                    <span className={styles.headKind}>{kindWord(column)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {set.strikes.map((strike) => (
                <tr key={strike} className={strike === selected ? styles.rowSelected : undefined}>
                  <td className={styles.strike}>{strike}</td>
                  {set.columns.map((column, k) => {
                    if (column.kind === "gap") {
                      return (
                        <td key={`gap:${column.gap.session}`} className={styles.cell} data-sign="unknown"
                          title={t(GAP_COPY[column.gap.reason] ?? "gapUnavailable")}>—</td>
                      );
                    }
                    const frame = column.frame;
                    const value = frame.values.get(strike);
                    if (value == null) {
                      return (
                        <td key={frame.session} className={styles.cell} data-sign="unknown" title={t("unknownCell")}>—</td>
                      );
                    }
                    const isActive = k === activeIndex;
                    const classes = [styles.cell, isActive ? styles.cellActive : "",
                      frame.dominant === strike ? styles.cellDominant : "",
                      isActive && strike === selected ? styles.cellSelected : ""].filter(Boolean).join(" ");
                    return (
                      <td key={frame.session} className={classes} data-sign={value === 0 ? "zero" : value > 0 ? "positive" : "negative"}
                        data-tier={replayTier(value, set.maxAbsMn)} title={`${fmtMn(value)} $mn`}
                        onClick={() => pickFrame(k, strike)}>
                        {fmtMn(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.footer}>
          <span className={styles.legend}><i className={styles.legendBox} aria-hidden="true" />{t("dominantAtFrame")}</span>
          <span className={styles.leaderPath}>
            {t("leaderPath")}{" "}
            {set.leaderPath.map((strike) => (strike == null ? "—" : String(strike))).join(" → ")}
          </span>
          <span className={styles.honesty}>{t("noInterpolation")}</span>
        </div>
      </div>
      <Inspector set={set} activeIndex={activeIndex} selected={selected} clockText={clockText} t={t}
        onLoadSession={onLoadSession} onJump={() => { setPlaying(false); setActive(last); }} />
    </div>
  );
}

function Inspector({ set, activeIndex, selected, clockText, t, onLoadSession, onJump }: {
  set: ReplayFrameSet; activeIndex: number; selected: number | null; clockText: string | null;
  t: (key: ExposureReplayKey) => string; onLoadSession?: (session: string) => void; onJump: () => void }) {
  const column = set.columns[activeIndex];
  const frame = column?.kind === "frame" ? column.frame : null;
  const next = set.columns[activeIndex + 1];
  const prov = set.provenance[activeIndex];
  const runnerValue = frame?.runnerUp != null ? frame.values.get(frame.runnerUp) ?? null : null;
  const stampText = column ? (column.kind === "gap" ? fmtDate(column.gap.session) : fmtDate(column.frame.session)) : "—";
  const kindText = column ? (column.kind === "gap" ? t("missing") : column.frame.current ? t("current") : t(column.frame.kind)) : "—";
  const relation = frame == null || selected == null ? ""
    : selected === frame.dominant ? ` · ${t("dominant")}` : selected === frame.runnerUp ? ` · ${t("runnerUp")}` : "";
  const provRelation = prov == null ? "" : prov.relation === "leader_held" ? t("leaderHeld")
    : prov.relation === "runner_up_to_leader" ? t("runnerUpToLeader") : t("newLeader");
  return (
    <aside className={styles.inspector}>
      <div>
        <span className={styles.eyebrow}>{t("frame")} {activeIndex + 1} / {set.columns.length}</span>
        <p className={styles.monoStamp}>{column ? `${stampText} · ${kindText}${clockText ? ` · ${clockText}` : ""}` : "—"}</p>
      </div>
      <div>
        <h3 data-sign={frame != null && selected != null && (frame.values.get(selected) ?? 0) > 0 ? "positive"
          : frame != null && selected != null && (frame.values.get(selected) ?? 0) < 0 ? "negative" : undefined}>
          {selected ?? "—"}</h3>
        <p className={styles.valueLine}>
          {frame && selected != null ? `${fmtMn(frame.values.get(selected) ?? null)} $mn${relation}` : "—"}
        </p>
      </div>
      <dl className={styles.dl}>
        <dt>{t("frameKind")}</dt><dd>{kindText}</dd>
        <dt>{t("runnerUp")}</dt>
        <dd>{frame?.runnerUp == null ? "—" : `${frame.runnerUp} · ${fmtMn(runnerValue)} · ${(frame.runnerUpRatio ?? 0).toFixed(2)}×`}
          {frame?.contested ? <span className={styles.pill}>{t("contested")}</span> : null}</dd>
        <dt>{t("nextFrame")}</dt>
        <dd>{next ? `${next.kind === "gap" ? fmtDate(next.gap.session) : fmtDate(next.frame.session)} · ${next.kind === "gap" ? t("missing") : next.frame.current ? t("current") : t(next.frame.kind)}` : "—"}</dd>
        <dt>{t("contractsMatched")}</dt>
        <dd>{frame?.coverage ? `${frame.coverage.qualified ?? "—"} / ${frame.coverage.expected ?? "—"}` : t("notSupplied")}</dd>
        <dt>{t("clocks")}</dt>
        <dd>{frame?.clocks && Object.keys(frame.clocks).length > 0
          ? Object.entries(frame.clocks).map(([key, value]) => `${key} ${value ?? "—"}`).join("; ") : "—"}</dd>
      </dl>
      <div>
        <span className={styles.eyebrow}>{t("frameProvenance")}</span>
        <p className={styles.valueLine}>
          {!prov || !next ? "—"
            : `${fmtMn(prov.changeMn)} at ${prov.strike} ${t("into")} ${next.kind === "gap" ? fmtDate(next.gap.session) : fmtDate(next.frame.session)} · ${provRelation}`}
        </p>
      </div>
      <p className={styles.caveat}>{t("caveat")}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onJump}>{t("jumpToCurrent")}</button>
        {onLoadSession && frame ? (
          <button type="button" className={styles.ghost} onClick={() => onLoadSession(frame.session)}>{t("openSessionBook")}</button>
        ) : null}
      </div>
    </aside>
  );
}






