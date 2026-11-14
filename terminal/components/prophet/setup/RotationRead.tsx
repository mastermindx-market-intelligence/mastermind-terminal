"use client";

import { useEffect, useId, useState } from "react";
import type { Lang } from "@/lib/i18n";
import {
  companyRotationGroups, fetchProphetRotationRead, ROTATION_READ_UNAVAILABLE,
  type ProphetRotationRead, type RotationGroup,
} from "@/lib/prophetRotationRead";
import { makeSetupT, setupFill } from "./setupStrings";
import styles from "./rotationRead.module.css";

function dateLabel(date: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function RotationRow({ row, lang }: { row: RotationGroup; lang: Lang }) {
  const t = makeSetupT(lang);
  const points = (value: number | null) => value === null ? "—" : setupFill(t("rotationPoints"), {
    value: `${value < 0 ? "−" : "+"}${new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 2 }).format(Math.abs(value))}`,
  });
  const direction = row.direction === "improving" ? `↗ ${t("rotationImproving")}`
    : row.direction === "deteriorating" ? `↘ ${t("rotationDeteriorating")}`
      : row.direction === "flat" ? `→ ${t("rotationFlat")}` : null;
  return (
    <div className={styles.row} data-testid="rotation-row">
      <div className={styles.identity}>
        <span className={styles.name}>{t(row.family === "sector" ? "rotationSector" : "rotationTheme")} · {row.name}</span>
        <span className={styles.date}>{setupFill(t("rotationAsOf"), { date: dateLabel(row.as_of, lang) })}</span>
      </div>
      <strong className={`${styles.direction} ${row.direction === "improving" ? styles.improving : row.direction === "deteriorating" ? styles.deteriorating : ""}`}>
        {direction ?? t(row.unavailable_reason === "too_few_members" ? "rotationFew" : "valueNotAvailable")}
      </strong>
      <div className={styles.measurements}>
        <p>{setupFill(t("rotationChange"), { value: points(row.chg_13w) })}</p>
        <small>{setupFill(t("rotationLongChange"), { value: points(row.chg_26w) })}</small>
      </div>
    </div>
  );
}

/** Presentation only: SI membership and direction never enter Prophet's assessment. */
export function RotationReadBlock({ read, symbol, lang }: {
  read: ProphetRotationRead; symbol: string; lang: Lang;
}) {
  const t = makeSetupT(lang);
  const [expanded, setExpanded] = useState(false);
  const moreId = useId();
  const rows = companyRotationGroups(read, symbol);
  const source = <span className={styles.source}><span aria-hidden="true" className={styles.dot} />{t("rotationSource")}</span>;
  if (read.status !== "ready" || rows === null) {
    return <section className={styles.unavailable} data-testid="rotation-read" aria-label={t("rotationTitle")}>
      <span>{t("rotationTitle")} · {t("valueNotAvailable")}</span>{source}
    </section>;
  }
  const sector = rows.filter(row => row.family === "sector");
  const themes = rows.filter(row => row.family === "theme");
  const more = themes.slice(2);
  return (
    <section className={styles.block} data-testid="rotation-read" aria-label={t("rotationTitle")}>
      <header className={styles.header}>
        <div><h2>{t("rotationTitle")}</h2><p className={styles.copy}>{lang === "en" ? read.data.copy : t("rotationCopy")}</p></div>
        <div className={styles.provenance}>
          <span>{setupFill(t("rotationWeek"), { date: dateLabel(read.data.as_of, lang) })}</span>{source}
        </div>
      </header>
      {[...sector, ...themes.slice(0, 2)].map(row => <RotationRow key={row.group_id} row={row} lang={lang} />)}
      {more.length > 0 ? <>
        <button type="button" className={styles.disclosure} aria-expanded={expanded} aria-controls={moreId}
          onClick={() => setExpanded(value => !value)}>
          {more.length === 1 ? t("rotationMoreOne") : setupFill(t("rotationMore"), { n: more.length })}
          <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </button>
        <div id={moreId} hidden={!expanded}>
          {more.map(row => <RotationRow key={row.group_id} row={row} lang={lang} />)}
        </div>
      </> : null}
    </section>
  );
}

/** Re-read on arrival, foreground return and each visible minute. A missing file
 * stays quiet and can light up in an already-open Setup without a new deploy. */
export function RotationRead({ symbol, lang }: { symbol: string; lang: Lang }) {
  const [read, setRead] = useState<ProphetRotationRead>(ROTATION_READ_UNAVAILABLE);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      const result = await fetchProphetRotationRead(controller.signal);
      if (!controller.signal.aborted) setRead(result);
      pending = false;
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    const interval = window.setInterval(onFocus, 60_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
  return <RotationReadBlock key={symbol} read={read} symbol={symbol} lang={lang} />;
}
