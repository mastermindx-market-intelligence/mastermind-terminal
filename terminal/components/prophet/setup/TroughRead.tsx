"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { companyTroughRead, fetchProphetTroughRead, PROPHET_TROUGH_READ_ENABLED, TROUGH_READ_UNAVAILABLE, troughCounts, troughSuffix, type ProphetTroughRead, type TroughRow } from "@/lib/prophetTroughRead";
import { setupFill, TROUGH_HEADLINE_VARIANT, TROUGH_STRINGS, type TroughHeadlineVariant } from "./setupStrings";
import styles from "./troughRead.module.css";

export function troughHeadline(row: TroughRow, lang: Lang, variant: TroughHeadlineVariant = TROUGH_HEADLINE_VARIANT) {
  const s = TROUGH_STRINGS[lang];
  const washed = row.timeframes.filter(f => f.available && f.bar_end !== null && f.washed_out === true);
  // Unknown/unclosed legs are dashes, never asserted to be not washed out.
  const rest = row.timeframes.filter(f => !washed.includes(f)).map(f => f.available && f.bar_end !== null && f.washed_out !== null ? s.frames[f.tf] : "—");
  return setupFill(s.variants[variant].headline, { n: washed.length, suffix: s[troughSuffix(row)],
    list: washed.map(f => s.frames[f.tf]).join(", ") || s.none, rest: rest.join(", ") || s.none });
}

function History({ row, lang }: { row: TroughRow; lang: Lang }) {
  const s = TROUGH_STRINGS[lang];
  const h = row.own_history;
  const current = troughCounts(row).n > 0 ? h?.current_depth_pct ?? null : null;
  if (!h) return null;
  // Depth magnitudes share one linear domain; neither ranks nor synthetic dots.
  const magnitude = (v: number) => Math.abs(v);
  const max = Math.max(1, ...h.past.map(p => magnitude(p.depth_pct)), current === null ? 0 : magnitude(current));
  const left = (v: number) => `${4 + magnitude(v) / max * 92}%`;
  return <section className={styles.detailSection}>
    <h3>{s.history}</h3>
    <p>{troughCounts(row).n === 0 ? s.noDecline : h.comparison === null ? "—" : s.comparisons[h.comparison]}</p>
    <div className={styles.strip} role="img" aria-label={current === null ? s.noHistoryLegend : s.historyLegend}>
      {h.past.map((p, i) => <span key={`${p.date}-${i}`} className={styles.pastDot} style={{ left: left(p.depth_pct) }} title={`${p.date}: ${p.depth_pct}%`} />)}
      {current === null ? null : <span className={styles.ring} style={{ left: left(current) }} title={`${s.thisOne}: ${current}%`} />}
    </div>
    <div className={styles.scaleLabels}><span>{s.shallower}</span>{current === null ? null : <span>{s.thisOne}</span>}<span>{s.deeper}</span></div>
    <small>{current === null ? s.noHistoryLegend : s.historyLegend}</small>
    <table className={styles.srTable}><caption>{s.history}</caption><thead><tr><th>{s.date}</th><th>{s.depth}</th></tr></thead><tbody>
      {h.past.map((p, i) => <tr key={`${p.date}-${i}`}><td>{p.date}</td><td>{p.depth_pct}</td></tr>)}
      {current === null ? null : <tr><td>{s.thisOne}</td><td>{current}</td></tr>}
    </tbody></table>
  </section>;
}

/** Presentation stays inert unless the same default-off rollout flag is enabled. */
export function TroughReadBlock({ read, symbol, lang }: { read: ProphetTroughRead; symbol: string; lang: Lang }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const openRef = useRef<HTMLButtonElement>(null);
  if (!PROPHET_TROUGH_READ_ENABLED) return null;
  const s = TROUGH_STRINGS[lang];
  const copy = s.variants[TROUGH_HEADLINE_VARIANT];
  const row = companyTroughRead(read, symbol);
  if (!row) return <section className={styles.block} data-testid="trough-read" aria-label={s.title}>
    <h2>{s.title} · {s.unavailable}</h2><p>{s.unavailableBody}</p><small>{copy.record}</small>
  </section>;
  const { n, k } = troughCounts(row);
  const groupLine = setupFill(s.group, { name: row.group?.name ?? "—", state: row.group?.state ? s.states[row.group.state] : "—" });
  const close = () => { setExpanded(false); openRef.current?.focus(); };
  return <section className={`${styles.block} ${expanded ? styles.expanded : ""}`} data-testid="trough-read" aria-label={s.title}>
    <div className={styles.summary}>
      <h2>{s.title}</h2>
      <p className={styles.headline} data-testid="trough-headline">{troughHeadline(row, lang)}</p>
      <p>{setupFill(s.kind, { kind: row.kind ? s.kinds[row.kind.label] : "—" })}</p>
      <p>{groupLine}</p>
      <small>{copy.record}</small>
      <button ref={openRef} className={styles.control} type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(v => !v)}>{s.open}</button>
    </div>
    <div id={id} hidden={!expanded} className={styles.disclosure} data-testid="trough-disclosure">
      <aside className={styles.method}>
        <header className={styles.methodHeader}><h3>{s.how}</h3><button className={styles.control} type="button" onClick={close} aria-expanded={expanded} aria-controls={id}>{s.hide}</button></header>
        {s.definitions.map(line => <p key={line}>{line}</p>)}
        <p>{copy.method}</p>
        {copy.method !== s.variants.count.method ? <p>{s.variants.count.method}</p> : null}
        <h3>{s.groupStates}</h3><p>{s.stateList}</p><p>{s.groupMeaning}</p>
        <p className={styles.boxed}>{s.boxed}</p>
      </aside>
      <div className={styles.measurements}>
        <p className={styles.count}>{setupFill(s.turnedCount, { k, n })}</p>
        <div>{row.timeframes.map(f => {
          const available = f.available && f.bar_end !== null;
          return <div key={f.tf} className={styles.frame} data-testid="trough-frame">
            <strong>{s.frames[f.tf]}</strong>
            <span>{!available || f.washed_out === null ? "—" : f.washed_out ? s.washed : s.notWashedRow}</span>
            <span>{!available || f.washed_out !== true || f.turned_up === null ? "—" : f.turned_up ? s.turned : s.falling}</span>
          </div>;
        })}</div>
        <History row={row} lang={lang} />
        {row.kind ? <section className={styles.detailSection}>
          <h3>{s.kindTitle}</h3>
          <div className={styles.kindScale} role="meter" aria-label={s.kindTitle} aria-valuemin={0} aria-valuemax={1} aria-valuenow={row.kind.position} aria-valuetext={s.kinds[row.kind.label]}>
            <span style={{ left: `${2 + row.kind.position * 96}%` }} />
          </div>
          <div className={styles.scaleLabels}><span>{s.steady}</span><span>{s.cyclical}</span></div><p>{s.kindBody}</p>
        </section> : null}
        <section className={styles.detailSection}>
          <h3>{setupFill(s.groupTitle, { name: row.group?.name ?? "—" })}</h3>
          <span className={styles.source}><i aria-hidden="true" />{s.source}</span>
          <p>{groupLine}</p><p>{s.groupFields}</p>
          {row.provenance ? <p>{s.provenance[row.provenance]}</p> : null}
        </section>
      </div>
    </div>
  </section>;
}

function TroughReadConsumer({ symbol, lang }: { symbol: string; lang: Lang }) {
  const [read, setRead] = useState<ProphetTroughRead>(TROUGH_READ_UNAVAILABLE);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      const result = await fetchProphetTroughRead(controller.signal);
      if (!controller.signal.aborted) setRead(result);
      pending = false;
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    const interval = window.setInterval(onFocus, 60_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, []);
  return <TroughReadBlock key={symbol} read={read} symbol={symbol} lang={lang} />;
}

export function TroughRead(props: { symbol: string; lang: Lang }) {
  return PROPHET_TROUGH_READ_ENABLED ? <TroughReadConsumer {...props} /> : null;
}
