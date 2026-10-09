"use client";
import { useEffect, useMemo, useState } from "react";
import { formatExposureMn, readVannaProfile } from "@/lib/optionsCompanion";
import { useOptionsSnapshot } from "./useOptionsSnapshot";
import { PinButton, SnapshotEmpty, SnapshotStamp, type PinProps } from "./MatrixCompanion";
import type { OptionsT } from "./optionsStrings";
import styles from "./OptionsCompanion.module.css";

export function VannaCompanion({ root, t, windowPct, ...pin }: PinProps & { root: string; t: OptionsT; windowPct: number }) {
  const snapshot = useOptionsSnapshot(`gex:${root}`);
  const receipt = useMemo(() => readVannaProfile(snapshot.data, root), [snapshot.data, root]);
  const data = receipt.ok ? receipt.value : null;
  const [selection, setSelection] = useState<{ strike: number; session: string } | null>(null);
  const { onPin } = pin;
  useEffect(() => { onPin(null); return () => onPin(null); }, [root, data?.session, onPin]);
  const rows = useMemo(() => {
    if (!data) return [];
    const filtered = data.rows.filter((row) => data.spot == null || Math.abs(row.strike - data.spot) / data.spot <= windowPct / 100);
    return filtered.length <= 101 ? filtered : filtered.slice().sort((a, b) => Math.abs(a.strike - (data.spot ?? 0)) - Math.abs(b.strike - (data.spot ?? 0))).slice(0, 101).sort((a, b) => b.strike - a.strike);
  }, [data, windowPct]);
  const scale = Math.max(...rows.map((row) => Math.abs(row.valueMn ?? 0)), 1e-12);
  const published = rows.filter((row) => row.valueMn != null);
  const total = published.reduce((sum, row) => sum + (row.valueMn ?? 0), 0);
  const selected = selection?.session === data?.session ? rows.find((row) => row.strike === selection?.strike) : undefined;
  if (!data) return <SnapshotEmpty issue={receipt.ok ? "unavailable" : receipt.reason} t={t} loading={snapshot.loading} refresh={snapshot.refresh} />;
  return <>
    <SnapshotStamp session={data.session} t={t} refresh={snapshot.refresh} loading={snapshot.loading} />
    {snapshot.failed && <p className={styles.warning}>{t("failed")}</p>}
    <p className={styles.viewCaption}>{t("allExpiries")} · ±{windowPct}%</p>
    <div className={styles.summary}><div><span>{t("visibleVanna")}</span><strong className={total < 0 ? styles.negative : styles.positive}>{published.length ? formatExposureMn(total) : "—"}</strong><small>{t("unitsVanna")}</small></div>
      <div className={styles.reference}><span>{t("reference")}</span><b>{data.spot?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "—"}</b></div></div>
    <div className={styles.legend}><span className={styles.positive}>● {t("positive")}</span><span className={styles.negative}>● {t("negative")}</span><span>{t("magnitude")}</span></div>
    <div className={styles.profile} aria-label={`${root} Vanna`}>
      {rows.map((row) => <button type="button" key={row.strike} aria-pressed={selected?.strike === row.strike}
        data-selected={selected?.strike === row.strike} onClick={() => { setSelection(selected?.strike === row.strike ? null : { strike: row.strike, session: data.session }); onPin(null); }}
        aria-label={`${row.strike}: ${row.valueMn == null ? t("missing") : `${formatExposureMn(row.valueMn)} ${t("unitsVanna")}`}`}>
        <span>{row.strike}</span><span className={styles.profileBar} aria-hidden="true">
          {row.valueMn != null && <i style={{ width: `${Math.abs(row.valueMn) / scale * 50}%`, left: row.valueMn >= 0 ? "50%" : undefined, right: row.valueMn < 0 ? "50%" : undefined,
            background: `var(--exposure-${row.valueMn < 0 ? "negative" : "positive"})` }} />}</span>
        <b>{row.valueMn == null ? "—" : formatExposureMn(row.valueMn)}</b>
      </button>)}
      {!rows.length && <p className={styles.empty}>{t("unavailableBody")}</p>}
    </div>
    {selected && <div className={styles.inspector}><div className={styles.inspectorTitle}><strong>{selected.strike} · {t("allExpiries")}</strong><b>{selected.valueMn == null ? "—" : formatExposureMn(selected.valueMn)}</b></div>
      <p>{t("unitsVanna")} · {data.session}</p><PinButton {...pin} root={root} strike={selected.strike} session={data.session} label={`${t("strike")} ${selected.strike} · EOD`} t={t} /></div>}
    <div className={styles.notice}>{t("vannaNote")}</div>
    <details className={styles.method}><summary>{t("basis")}</summary><p>{t("model")}</p><p>{t("estimate")}</p>{published.length !== rows.length && <p>{t("partial")}</p>}</details>
    <a className={styles.deskLink} href="/options?tab=gex">{t("expand")} ↗</a>
  </>;
}
