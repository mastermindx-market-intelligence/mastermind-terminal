"use client";

import type { PrecisionHorizon } from "@/lib/precisionEntry";
import type { PrecisionEntryReadout, PrecisionLocation } from "@/lib/precisionEntryReadout";
import styles from "./PrecisionEntryStrip.module.css";

type Lang = "en" | "zh";

type PrecisionEntryStripProps = {
  readout: PrecisionEntryReadout;
  horizon: PrecisionHorizon;
  lang?: Lang;
};

const COPY = {
  en: {
    region: "Precision Entry context",
    precision: "Precision",
    day: "Day",
    swing: "Swing",
    position: "Position",
    deep: "Deep",
    posture: "Posture",
    bottom: "Bottom durability",
    trigger: "Trigger",
    htf: "Higher frame",
    htfYes: "Confirmed",
    htfNo: "Not confirmed",
    w2: "2W context",
    washout: "Washout",
    noWashout: "No washout",
    coiled: "Coiled",
    notCoiled: "Not coiled",
    stoch: "Stoch D",
    location: "Location",
    inside_buy_zone: "In buy zone",
    below_buy_zone: "Below buy zone",
    above_buy_zone: "Above buy zone",
    above_chase: "Above chase line",
    unknown: "Unavailable",
    bars: "bars",
    crossing: "Crossing",
    stale: "Stale",
    partial: "Partial data",
    unavailable: "Intel unavailable",
    asof: "as of",
  },
  zh: {
    region: "精准入场背景",
    precision: "精准",
    day: "日内",
    swing: "波段",
    position: "持仓",
    deep: "深度",
    posture: "状态",
    bottom: "底部耐久度",
    trigger: "触发",
    htf: "高周期",
    htfYes: "已确认",
    htfNo: "未确认",
    w2: "2周背景",
    washout: "超跌",
    noWashout: "非超跌",
    coiled: "收缩",
    notCoiled: "未收缩",
    stoch: "随机指标 D",
    location: "位置",
    inside_buy_zone: "买入区内",
    below_buy_zone: "买入区下方",
    above_buy_zone: "买入区上方",
    above_chase: "追入线上方",
    unknown: "不可用",
    bars: "根K线",
    crossing: "正在交叉",
    stale: "数据较旧",
    partial: "数据不完整",
    unavailable: "智能数据不可用",
    asof: "截至",
  },
} as const;

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function locationLabel(location: PrecisionLocation, lang: Lang): string {
  return COPY[lang][location];
}

function triggerDetail(readout: PrecisionEntryReadout, lang: Lang): string | null {
  const c = COPY[lang];
  const bits: string[] = [];
  if (readout.trigger.next) bits.push(readout.trigger.next);
  if (finite(readout.trigger.barsToCross)) {
    bits.push(
      readout.trigger.barsToCross <= 0
        ? c.crossing
        : `~${formatNumber(readout.trigger.barsToCross)} ${c.bars}`,
    );
  } else if (readout.trigger.tier) {
    bits.push(readout.trigger.tier);
  }
  return bits.length ? bits.join(" · ") : null;
}

function w2Detail(readout: PrecisionEntryReadout, lang: Lang): string | null {
  const c = COPY[lang];
  const bits: string[] = [];
  if (readout.structure.w2Washout !== null) {
    bits.push(readout.structure.w2Washout ? c.washout : c.noWashout);
  }
  if (finite(readout.structure.w2StochD)) {
    bits.push(`${c.stoch} ${formatNumber(readout.structure.w2StochD)}`);
  }
  if (readout.structure.coiled !== null) {
    bits.push(readout.structure.coiled ? c.coiled : c.notCoiled);
  }
  return bits.length ? bits.join(" · ") : null;
}

function freshnessDetail(readout: PrecisionEntryReadout, lang: Lang): {
  text: string;
  kind: "stale" | "partial" | "unavailable";
} | null {
  const c = COPY[lang];
  if (readout.availability === "unavailable") {
    return { text: c.unavailable, kind: "unavailable" };
  }
  if (readout.freshness === "stale") {
    const date = readout.asof.intel;
    return { text: date ? `${c.stale} · ${c.asof} ${date}` : c.stale, kind: "stale" };
  }
  if (readout.availability === "partial") {
    return { text: c.partial, kind: "partial" };
  }
  return null;
}

function Cell({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className={styles.cell} data-testid={testId}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}

/**
 * Compact, display-only cross-timeframe context.
 *
 * It renders the canonical facts already carried by intel/v1. It never derives a
 * trading verdict, ranking, timeframe, confidence score, or TOI occurrence phase.
 */
export default function PrecisionEntryStrip({
  readout,
  horizon,
  lang = "en",
}: PrecisionEntryStripProps) {
  const c = COPY[lang];
  const trigger = triggerDetail(readout, lang);
  const w2 = w2Detail(readout, lang);
  const freshness = freshnessDetail(readout, lang);
  const posture = lang === "zh"
    ? readout.posture.headlineZh || readout.posture.headline
    : readout.posture.headline || readout.posture.headlineZh;

  return (
    <div
      className={styles.strip}
      role="region"
      aria-label={c.region}
      data-testid="precision-entry-strip"
      data-precision-horizon={horizon}
      data-precision-availability={readout.availability}
      data-precision-freshness={readout.freshness}
    >
      <div className={styles.identity}>
        <span className={styles.precision}>{c.precision}</span>
        <span className={styles.horizon}>{c[horizon]}</span>
      </div>

      {posture && <Cell label={c.posture} value={posture} testId="precision-posture" />}

      {finite(readout.bottomConfidence) && (
        <Cell
          label={c.bottom}
          value={formatNumber(readout.bottomConfidence, 0)}
          testId="precision-bottom-confidence"
        />
      )}

      {trigger && <Cell label={c.trigger} value={trigger} testId="precision-trigger" />}

      {readout.trigger.htfS1 !== null && (
        <Cell
          label={c.htf}
          value={readout.trigger.htfS1 ? c.htfYes : c.htfNo}
          testId="precision-htf"
        />
      )}

      {w2 && <Cell label={c.w2} value={w2} testId="precision-w2" />}

      {readout.geometry.location !== "unknown" && (
        <Cell
          label={c.location}
          value={locationLabel(readout.geometry.location, lang)}
          testId="precision-location"
        />
      )}

      {freshness && (
        <div
          className={`${styles.state} ${styles[freshness.kind]}`}
          data-testid="precision-data-state"
          data-state={freshness.kind}
        >
          {freshness.text}
        </div>
      )}
    </div>
  );
}
