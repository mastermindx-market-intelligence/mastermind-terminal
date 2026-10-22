"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flowGetResult, type FlowOutcome } from "@/lib/flowClientCache";
import { gexSessionOf, isGexDates } from "@/lib/gexSessions";
import {
  buildReplayFrameSet, reduceReplayFrame, replayTier, selectReplaySessions,
  REPLAY_MAX_FRAMES, REPLAY_WINDOWS, type ReplayColumn, type ReplayFrame, type ReplayFrameSet,
} from "@/lib/exposureReplayFrames";
import type { ExposureLens } from "@/lib/exposureMapProjection";
import type { ExposureMapMetric } from "@/lib/exposureMap";
import { exposureReplayT, type ExposureReplayKey } from "./exposureReplayStrings";
import styles from "./ExposureReplay.module.css";

type Status = "loading" | "ready" | "no-index" | "unavailable";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RATES = [1000, 1500, 3000];

const isSource = (v: unknown): v is { asof: unknown } =>
  v != null && typeof v === "object" && !Array.isArray(v) && "asof" in v;

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
  const [y, m, d] = session.split("-");
  return `${MONTHS[Math.min(11, Math.max(0, Number(m) - 1))]} ${Number(d)}`;
};

/** The book's own observation clock, in the exchange zone, when it carries one. */
function fmtClock(frame: ReplayFrame | null): string | null {
  const stamp = frame?.clocks?.option_observed_at ?? frame?.clocks?.available_at;
  if (typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) return null;
  return new Date(stamp).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }) + " ET";
}

export default function ExposureReplay({ root, source, metric, lens, today, now = Date.now(),
  focusStrike = null, lang, onLoadSession, onSelectStrike }:
  { root: string; source: unknown; metric: ExposureMapMetric; lens: ExposureLens; today: string; now?: number;
    focusStrike?: number | null; lang: "en" | "zh"; onLoadSession?: (session: string) => void;
    onSelectStrike?: (strike: number) => void }) {
  const t = exposureReplayT(lang);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [books, setBooks] = useState<Array<{ session: string; outcome: FlowOutcome }> | null>(null);
  const [active, setActive] = useState(-1);
  const [localStrike, setLocalStrike] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [windowPct, setWindowPct] = useState(4);
  const genRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++genRef.current;
    setStatus("loading");
    setBooks(null);
    setActive(-1);
    const indexOutcome = await flowGetResult("gex_dates:" + root);
    if (gen !== genRef.current) return;
    if (indexOutcome.status !== "data" || !isGexDates(indexOutcome.data)) {
      setStatus(indexOutcome.status === "unavailable" ? "unavailable" : "no-index");
      return;
    }
    const currentSession = gexSessionOf(isSource(source) ? source.asof : null);
    const picked = selectReplaySessions(indexOutcome.data.dates, currentSession, REPLAY_MAX_FRAMES);
    if (picked.length === 0) { setStatus("no-index"); return; }
    const settled = await Promise.all(picked.map(async (session) =>
      ({ session, outcome: await flowGetResult(`gex_at:${root}:${session}`) })));
    if (gen !== genRef.current) return;
    setBooks(settled);
    setStatus("ready");
  }, [root, source, attempt]);

  useEffect(() => { void load(); }, [load]);

  const currentSession = isSource(source) ? gexSessionOf(source.asof) ?? "" : "";
  const columns = useMemo<ReplayColumn[] | null>(() => {
    if (books == null) return null;
    const stored = books.map((book) => reduceReplayFrame(book.outcome.status === "data" ? book.outcome.data : null,
      root, book.session, metric, lens, today, now));
    return [...stored, reduceReplayFrame(source, root, currentSession, metric, lens, today, now, true)];
  }, [books, root, metric, lens, today, now, source, currentSession]);

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

  // Stop on the last frame unless Loop is on.
  useEffect(() => { if (playing && !loop && activeIndex >= last) setPlaying(false); }, [playing, loop, activeIndex, last]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setActive((prev) => {
      const at = Math.min(prev < 0 ? last : prev, last);
      return at < last ? at + 1 : loop ? 0 : at;
    }), RATES[rate]);
    return () => clearInterval(id);
  }, [playing, rate, loop, last]);

  const step = useCallback((delta: number) => {
    setActive((prev) => Math.max(0, Math.min(last, (prev < 0 ? last : prev) + delta)));
  }, [last]);
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
            <button type="button" onClick={() => setAttempt((a) => a + 1)}>{t("retry")}</button>
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
            <button type="button" className={styles.play} aria-pressed={playing}
              aria-label={playing ? t("pause") : t("play")}
              onClick={() => setPlaying((p) => !p)}>{playing ? "❚❚" : "▶"}</button>
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
                  <th key={column.kind === "frame" ? column.frame.session : column.gap.session} scope="col">
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






