"use client";
/**
 * SectorContextStrip (SX01) — market vs the selected group, in plain words.
 *
 * Laws:
 *   - Every measure nullable; a null renders its owner's reason in the strip's
 *     not-stated vocabulary, never a zero and never an invented number.
 *   - Both owners' clocks in ONE line (sector session · Prophet as-of) — one
 *     as-of stamp per panel (doctrine Law 4).
 *   - The compatibility verdict renders when the two reads do NOT cover the
 *     same session: plain words, the gap stated, no jargon. A compatible read
 *     states the shared session quietly.
 *   - The owner's own descriptive state label renders verbatim when present.
 *   - No colored container edges; status is text in semantic ink (2026-10-18).
 */
import { useLang } from "@/lib/i18n";
import type {
  SectorGroupContext, SectorGroupDescriptor, SectorMembersCompatibility,
} from "@/lib/prophetSectorMembers";
import {
  contextNullKey, makeProphetSectorT, prophetSectorFill,
} from "./prophetSectorStrings";
import styles from "./prophetSector.module.css";

function pctSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
function ppSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className={styles.contextStat}>
      <span>{label}</span>
      <b style={tone === "up" ? { color: "var(--up)" } : tone === "down" ? { color: "var(--down)" } : undefined}>{value}</b>
    </div>
  );
}

export function SectorContextStrip({ group, compatibility }: {
  group: SectorGroupDescriptor;
  compatibility: SectorMembersCompatibility;
}) {
  const { lang } = useLang();
  const t = makeProphetSectorT(lang);
  const ctx: SectorGroupContext = group.context;
  const localName = (lang === "zh" ? group.nameZh || group.name : group.name) || group.id;

  const breadth = ctx.breadth !== null
    ? `${ctx.breadth.aboveTrend}/${ctx.breadth.measured}`
    : t(contextNullKey(ctx.reasons.breadth));
  const windowLabel = ctx.windowSessions !== null
    ? prophetSectorFill(t("contextWindow"), { n: ctx.windowSessions })
    : t(contextNullKey(ctx.reasons.window_sessions));

  const sectorClock = compatibility.sectorSession ?? t("contextUnknown");
  const prophetClock = compatibility.prophetAsof ?? t("contextUnknown");

  let verdict: string;
  switch (compatibility.status) {
    case "compatible":
      verdict = prophetSectorFill(t("verdictCompatible"), { session: sectorClock });
      break;
    case "stale_sector":
      verdict = prophetSectorFill(t("verdictStaleSector"), { gap: String(compatibility.sessionGap ?? "several") });
      break;
    case "stale_prophet":
      verdict = prophetSectorFill(t("verdictStaleProphet"), { gap: String(compatibility.sessionGap ?? "several") });
      break;
    case "mixed_basis":
      verdict = prophetSectorFill(t("verdictMixedBasis"), { sector: sectorClock, prophet: prophetClock });
      break;
    case "sector_unavailable":
      verdict = t("verdictSectorDown");
      break;
    default:
      verdict = t("verdictProphetDown");
      break;
  }
  const compatible = compatibility.status === "compatible";

  return (
    <section className={styles.contextStrip} data-testid="prophet-sector-context">
      <header className={styles.contextHead}>
        <h3 className={styles.contextTitle}>{prophetSectorFill(t("contextTitle"), { group: localName })}</h3>
        <span className={styles.contextWindowLabel}>{windowLabel}</span>
      </header>
      {ctx.stateLabel ? (
        <p className={styles.contextOwnerLabel} data-testid="prophet-sector-owner-label" aria-label={t("contextOwnerLabelAria")}>
          {ctx.stateLabel}
        </p>
      ) : null}
      <div className={styles.contextStats}>
        <Stat label={t("contextGroupReturn")} value={ctx.groupReturnPct !== null ? pctSigned(ctx.groupReturnPct) : t(contextNullKey(ctx.reasons.group_return_pct))}
          tone={ctx.groupReturnPct === null ? undefined : ctx.groupReturnPct > 0 ? "up" : "down"} />
        <Stat label={t("contextMarketReturn")} value={ctx.marketReturnPct !== null ? pctSigned(ctx.marketReturnPct) : t(contextNullKey(ctx.reasons.market_return_pct))} />
        <Stat label={t("contextRelative")} value={ctx.relativePp !== null ? ppSigned(ctx.relativePp) : t(contextNullKey(ctx.reasons.relative_pp))} />
        <Stat label={t("contextBreadth")} value={breadth} />
      </div>
      <p className={styles.contextClocks} data-testid="prophet-sector-clocks">
        {prophetSectorFill(t("contextClocks"), { sector: sectorClock, prophet: prophetClock })}
      </p>
      <p className={compatible ? styles.contextVerdictQuiet : styles.contextVerdict} data-testid="prophet-sector-verdict" role={compatible ? undefined : "status"}>
        {verdict}
      </p>
    </section>
  );
}
