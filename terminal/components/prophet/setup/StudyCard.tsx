"use client";
/**
 * StudyCard — "Separate the common move from the name" (G9). The market and
 * group legs are served by the sector context over the same window; the
 * company's own leg (nameVsSector decomposition) is NOT served, so it renders
 * as a labeled missing leg instead of a fabricated number. Group breadth is
 * the served peer fact; issuer exclusion is not stated by the wire (G13).
 */
import type { Lang } from "@/lib/i18n";
import type { SectorGroupContext, SectorGroupDescriptor } from "@/lib/prophetSectorMembers";
import { makeProphetSectorT } from "../sector/prophetSectorStrings";
import { fmtSignedPct, makeSetupT, setupFill } from "./setupStrings";
import styles from "./setup.module.css";

export function StudyCard({ symbol, group, lang }: {
  symbol: string;
  group: SectorGroupDescriptor;
  lang: Lang;
}) {
  const t = makeSetupT(lang);
  const sectorT = makeProphetSectorT(lang);
  const ctx: SectorGroupContext = group.context;
  const groupName = lang === "zh" ? (group.nameZh || group.name || group.id) : (group.name || group.id);

  return (
    <section className={styles.card} data-testid="study-card" aria-labelledby="study-card-title">
      <h4 className={styles.cardTitle} id="study-card-title">{t("studyTitle")}</h4>
      <p className={styles.cardIntro}>
        {setupFill(t("studyIntro"), { group: groupName, n: ctx.windowSessions ?? "—" })}
      </p>
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span>{sectorT("contextMarketReturn")}</span>
          <b className={ctx.marketReturnPct == null ? undefined : ctx.marketReturnPct >= 0 ? styles.pos : styles.neg}>
            {fmtSignedPct(ctx.marketReturnPct)}
          </b>
        </div>
        <div className={styles.tile}>
          <span>{groupName}</span>
          <b className={ctx.groupReturnPct == null ? undefined : ctx.groupReturnPct >= 0 ? styles.pos : styles.neg}>
            {fmtSignedPct(ctx.groupReturnPct)}
          </b>
          <small>
            {sectorT("contextRelative")}{" "}
            {ctx.relativePp == null ? sectorT("contextNotStated")
              : `${ctx.relativePp > 0 ? "+" : ""}${ctx.relativePp.toFixed(1)} pp`}
          </small>
        </div>
        <div className={`${styles.tile} ${styles.tileMissing}`}>
          <span>{setupFill(t("studyNameLeg"), { symbol })}</span>
          <b>{t("studyNameMissing")}</b>
        </div>
      </div>
      {ctx.breadth !== null ? (
        <p className={styles.unavailableNote} data-testid="study-breadth">
          {setupFill(t("studyBreadth"), { above: ctx.breadth.aboveTrend, measured: ctx.breadth.measured })}
          {" "}
          {t("studyIssuerNote")}
        </p>
      ) : null}
      <p className={styles.cardFootnote}>{t("studyFootnote")}</p>
    </section>
  );
}
