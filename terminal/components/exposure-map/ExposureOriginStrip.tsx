"use client";
import { exposureOriginStep, type ExposureOrigin } from "@/lib/exposureOrigin";
import { exposureOriginT, fill } from "./exposureOriginStrings";
import type { ExposureOriginRoster } from "./useExposureOriginRoster";
import styles from "./ExposureOriginStrip.module.css";

export interface ExposureOriginStripProps {
  origin: ExposureOrigin;
  lang: "en" | "zh";
  roster: ExposureOriginRoster;
  onStep: (next: { company: string; index: number }) => void;
}

/** Where this Exposure view came from. The parent owns navigation: the strip only
 * renders the return link and proposes steps through onStep. */
export default function ExposureOriginStrip(props: ExposureOriginStripProps) {
  const { origin, lang, roster } = props;
  const t = exposureOriginT(lang);
  const prev = roster.state === "exact" && roster.tickers ? exposureOriginStep(origin, roster.tickers, -1) : null;
  const next = roster.state === "exact" && roster.tickers ? exposureOriginStep(origin, roster.tickers, 1) : null;
  return (
    <nav className={styles.strip} aria-label={t("originNavLabel")} data-testid="exposure-origin-strip" data-state={roster.state}>
      <span className={styles.eyebrow}>{t("fromSectorCentral")}</span>
      <span className={styles.context}>
        <strong>{roster.groupLabel ?? origin.group}</strong>
        <span>{origin.company}</span>
        {origin.index !== null && origin.count !== null ? <span>{fill(t("positionOf"), { index: origin.index + 1, count: origin.count })}</span> : null}
        {origin.asOf ? <span>{fill(t("asOf"), { date: origin.asOf })}</span> : null}
        <span className={styles.method}>{t("methodIncumbent")}{origin.benchmark ? ` · ${fill(t("benchmarkRelative"), { benchmark: origin.benchmark })}` : ""}</span>
      </span>
      <span className={styles.actions}>
        <a href={origin.returnHref} data-testid="exposure-origin-back">← {t("backToSectorCentral")}</a>
        <button type="button" data-testid="exposure-origin-prev" aria-label={t("previousCompany")} disabled={!prev}
          onClick={() => prev && props.onStep(prev)}>‹ {prev?.company ?? "—"}</button>
        <button type="button" data-testid="exposure-origin-next" aria-label={t("nextCompany")} disabled={!next}
          onClick={() => next && props.onStep(next)}>{next?.company ?? "—"} ›</button>
      </span>
      <p role="status" className={styles.note}>
        {roster.state === "loading" ? t("rosterLoading")
          : roster.state === "exact" ? t("rosterExact")
          : roster.state === "changed" ? t("rosterChanged") : t("rosterUnavailable")}
      </p>
    </nav>
  );
}
