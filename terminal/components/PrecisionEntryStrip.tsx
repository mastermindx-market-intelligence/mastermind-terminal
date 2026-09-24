"use client";

import type { PrecisionPaneRole, PrecisionPlan } from "@/lib/precisionEntry";
import { readPrecisionIntel, type PrecisionEntryIntel } from "@/lib/precisionIntel";
import styles from "./PrecisionEntryStrip.module.css";

export const PRECISION_ENTRY_STRIP_HEIGHT = 58;

type Lang = "en" | "zh";

export interface PrecisionEntryStripProps {
  plan: PrecisionPlan;
  intel: unknown;
  lang: Lang;
}

const ROLE_COPY: Record<PrecisionPaneRole, [string, string]> = {
  execution: ["Execution", "执行"],
  trigger: ["Trigger", "触发"],
  durability: ["Durability", "持久度"],
  structure: ["Structure", "结构"],
};

const HORIZON_COPY: Record<PrecisionPlan["horizon"], [string, string]> = {
  day: ["Day", "日内"],
  swing: ["Swing", "波段"],
  position: ["Position", "持仓"],
  deep: ["Deep", "深度"],
};

function choose(lang: Lang, en: string | null | undefined, zh: string | null | undefined): string | null {
  return (lang === "zh" ? zh : en) || en || zh || null;
}

function fmtNumber(value: number, maxDecimals = 1): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: 0,
  }).format(value);
}

function fmtPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 10 ? 2 : 1,
    minimumFractionDigits: 0,
  }).format(value);
}

function compactExecutionMeta(
  entry: PrecisionEntryIntel | null,
  lang: Lang,
): string | null {
  if (!entry) return null;
  const parts: string[] = [];
  if (entry.buyZone) {
    parts.push(lang === "zh"
      ? `区间 ${fmtPrice(entry.buyZone[0])}–${fmtPrice(entry.buyZone[1])}`
      : `Zone ${fmtPrice(entry.buyZone[0])}–${fmtPrice(entry.buyZone[1])}`);
  }
  if (entry.chaseAbove != null) {
    parts.push(lang === "zh"
      ? `追高线 >${fmtPrice(entry.chaseAbove)}`
      : `Chase >${fmtPrice(entry.chaseAbove)}`);
  }
  if (entry.stop != null) {
    parts.push(lang === "zh"
      ? `失效 ${fmtPrice(entry.stop)}`
      : `Invalidation ${fmtPrice(entry.stop)}`);
  }
  return parts.length ? parts.join(" · ") : choose(lang, entry.action, entry.actionZh);
}

export default function PrecisionEntryStrip({ plan, intel, lang }: PrecisionEntryStripProps) {
  const read = readPrecisionIntel(intel);
  const entry = read?.entry ?? null;
  const confluence = read?.confluence ?? null;
  const sniper = read?.sniper ?? null;

  const executionValue = choose(lang, entry?.headline, entry?.headlineZh)
    || choose(lang, entry?.action, entry?.actionZh)
    || "—";
  const executionMeta = compactExecutionMeta(entry, lang);

  const triggerParts: string[] = [];
  if (confluence?.tier) triggerParts.push(confluence.tier);
  if (confluence?.barsToCross != null) {
    triggerParts.push(lang === "zh"
      ? `≈ ${fmtNumber(confluence.barsToCross)} 根`
      : `≈ ${fmtNumber(confluence.barsToCross)} bars`);
  }
  if (confluence?.provisional === true) triggerParts.push(lang === "zh" ? "暂定" : "Provisional");
  const triggerValue = triggerParts.join(" · ")
    || entry?.nextTrigger
    || confluence?.sub
    || "—";
  const triggerMeta = triggerParts.length ? (entry?.nextTrigger || confluence?.sub || null) : null;

  const durabilityValue = entry?.bottomConfidence != null
    ? `${Math.round(entry.bottomConfidence)}/100`
    : "—";
  const durabilityMeta = entry?.bottomConfidence != null
    ? (lang === "zh" ? "底部置信度 · 衡量持久度，非收益预测" : "Bottom confidence · durability, not return")
    : (entry?.grade ? (lang === "zh" ? `评级 ${entry.grade}` : `Grade ${entry.grade}`) : null);

  const structureParts: string[] = [];
  if (confluence?.htfS1 === true) structureParts.push(lang === "zh" ? "高周期确认" : "Higher-TF confirm");
  else if (confluence?.htfS1 === false) structureParts.push(lang === "zh" ? "高周期未确认" : "Higher-TF unconfirmed");
  if (sniper?.w2Washout === true) structureParts.push(lang === "zh" ? "2周洗盘" : "2W washout");
  if (sniper?.coiled === true) structureParts.push(lang === "zh" ? "收缩蓄势" : "Coiled");
  if (sniper?.w2StochD != null) structureParts.push(`Stoch D ${fmtNumber(sniper.w2StochD)}`);
  const structureValue = structureParts.length ? structureParts.join(" · ") : "—";
  const structureMeta = sniper?.daysSince63dLow != null
    ? (lang === "zh"
      ? `距63日低点 ${Math.round(sniper.daysSince63dLow)} 天`
      : `63d low ${Math.round(sniper.daysSince63dLow)}d ago`)
    : null;

  const valueByRole: Record<PrecisionPaneRole, string> = {
    execution: executionValue,
    trigger: triggerValue,
    durability: durabilityValue,
    structure: structureValue,
  };
  const metaByRole: Record<PrecisionPaneRole, string | null> = {
    execution: executionMeta,
    trigger: triggerMeta,
    durability: durabilityMeta,
    structure: structureMeta,
  };

  const source = plan.source === "temporal_grain"
    ? (lang === "zh" ? "自适应" : "Adaptive")
    : (lang === "zh" ? "预设" : "Preset");
  const horizon = HORIZON_COPY[plan.horizon][lang === "zh" ? 1 : 0];

  return (
    <section
      className={styles.strip}
      data-testid="precision-entry-strip"
      data-horizon={plan.horizon}
      data-source={plan.source}
      aria-label={lang === "zh" ? "精确多周期入场视图" : "Precision multi-timeframe entry view"}
    >
      <div className={styles.brand}>
        <strong>{lang === "zh" ? "精确多周期" : "PRECISION MTF"}</strong>
        <span>{horizon} · {source}{read?.asof ? ` · ${read.asof}` : ""}</span>
      </div>

      <div className={styles.cells}>
        {plan.panes.map((pane) => (
          <div className={styles.cell} data-role={pane.role} key={pane.role}>
            <div className={styles.cellHead}>
              <span>{ROLE_COPY[pane.role][lang === "zh" ? 1 : 0]}</span>
              <b>{pane.tf}</b>
            </div>
            <div className={styles.value} title={valueByRole[pane.role]}>{valueByRole[pane.role]}</div>
            {metaByRole[pane.role] && (
              <div className={styles.meta} title={metaByRole[pane.role] || undefined}>{metaByRole[pane.role]}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
