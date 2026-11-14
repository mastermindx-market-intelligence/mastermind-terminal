"use client";

import type { FlowProjection, FlowProjectionIntervalMinutes } from "@/lib/flowProjection";
import { pick } from "@/lib/finFormat";
import styles from "./FlowProjectionStrip.module.css";

type Props = {
  projection: FlowProjection;
  selectedKey: string | null;
  interval: FlowProjectionIntervalMinutes;
  lang: "en" | "zh";
  onSelect: (key: string | null) => void;
  onInterval: (minutes: FlowProjectionIntervalMinutes) => void;
};

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
});
function et(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: "—", time: "—", zone: "" };
  const parts = ET.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
    zone: part("timeZoneName"),
  };
}
function range(start: string, end: string): string {
  const a = et(start), b = et(end);
  return a.date === b.date && a.zone === b.zone
    ? `${a.date} · ${a.time}–${b.time} ${a.zone}`
    : `${a.date} ${a.time} ${a.zone} – ${b.date} ${b.time} ${b.zone}`;
}
function usd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2,
  });
}
function Metric({ name, label, value }: { name: string; label: string; value: string }) {
  return <div data-metric={name}><dt>{label}</dt><dd>{value}</dd></div>;
}

export function FlowProjectionStrip({ projection, selectedKey, interval, lang, onSelect, onInterval }: Props) {
  const zh = lang === "zh";
  // Selection and all numbers remain owned by the existing filtered projection.
  const selected = projection.buckets.find(bucket => bucket.key === selectedKey);
  const dates = new Set(projection.buckets.map(bucket => et(bucket.start).date));
  const zones = new Set(projection.buckets.map(bucket => et(bucket.start).zone));
  return (
    <div data-flow-projection="r8-v1" className={styles.strip}>
      <div className="obs-fd-preset-bar" aria-label={pick(zh, "Flow time projection", "资金流时间投影")}>
        <span className="obs-lbl">{pick(zh, "TIME", "时间投影")}</span>
        {([5, 15, 30, 60] as const).map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`obs-chip${interval === minutes ? " on" : ""}`}
            aria-pressed={interval === minutes}
            onClick={() => onInterval(minutes)}
          >
            {minutes}m
          </button>
        ))}
        <span className="obs-lbl">
          {projection.validEventCount.toLocaleString("en-US")}
          {pick(zh, " events", " 事件")}
        </span>
        {projection.invalidIdentityCount > 0 && (
          <span className="obs-lbl">
            {projection.invalidIdentityCount} {pick(zh, "invalid event ID", "事件标识无效")}
          </span>
        )}
        {projection.invalidTimestampCount > 0 && (
          <span className="obs-lbl">
            {projection.invalidTimestampCount} {pick(zh, "invalid time", "时间无效")}
          </span>
        )}
        {projection.invalidValueCount > 0 && (
          <span className="obs-lbl">
            {projection.invalidValueCount} {pick(zh, "invalid value", "数值无效")}
          </span>
        )}
      </div>
      <div className="obs-fd-preset-bar" aria-label={pick(zh, "Flow buckets", "时间桶")}>
        {projection.buckets.map((bucket) => {
          const active = bucket.key === selectedKey;
          const start = et(bucket.start);
          const label = `${range(bucket.start, bucket.end)} · ${bucket.eventCount.toLocaleString("en-US")} ${pick(zh, "event aggregates", "事件聚合")}`;
          return (
            <button
              key={bucket.key}
              type="button"
              className={`obs-chip${active ? " on" : ""}`}
              aria-label={label}
              title={label}
              aria-pressed={active}
              onClick={() => onSelect(active ? null : bucket.key)}
            >
              {dates.size > 1 ? start.date + " " : ""}{start.time}{zones.size > 1 ? " " + start.zone : ""} · {bucket.eventCount}
            </button>
          );
        })}
        {selectedKey && (
          <button type="button" className="obs-chip" onClick={() => onSelect(null)}>
            {pick(zh, "Clear bucket", "清除时间桶")}
          </button>
        )}
      </div>
      {selected && (
        <section className={styles.summary} aria-label={pick(zh, "Selected interval summary", "所选时段摘要")} data-testid="flow-bucket-summary">
          <div className={styles.heading}>
            <span>{pick(zh, "SELECTED INTERVAL", "所选时段")}</span>
            <span>{pick(zh, "Current filters", "根据当前筛选")}</span>
          </div>
          <p className={styles.range}>{range(selected.start, selected.end)}</p>
          <dl className={styles.metrics}>
            <Metric name="premium" label={pick(zh, "Gross premium", "权利金总额")} value={usd(selected.grossPremium)} />
            <Metric name="contracts" label={pick(zh, "Contract volume", "合约成交量")} value={selected.contractCount.toLocaleString("en-US")} />
            <Metric name="events" label={pick(zh, "Event aggregates", "事件聚合")} value={selected.eventCount.toLocaleString("en-US")} />
            <Metric name="prints" label={pick(zh, "Reported prints", "报告成交笔数")} value={selected.printCount.toLocaleString("en-US")} />
          </dl>
          <details className={styles.details}>
            <summary>{pick(zh, "Premium breakdown", "权利金分类")}</summary>
            <div className={styles.breakdowns}>
              <div>
                <h4>{pick(zh, "Option type", "期权类型")}</h4>
                <dl className={styles.breakdown}>
                  <Metric name="calls" label={pick(zh, "Calls", "认购")} value={usd(selected.callPremium)} />
                  <Metric name="puts" label={pick(zh, "Puts", "认沽")} value={usd(selected.putPremium)} />
                  <Metric name="unknown-right" label={pick(zh, "Unknown type", "类型未知")} value={usd(selected.unknownRightPremium)} />
                </dl>
              </div>
              <div>
                <h4>{pick(zh, "Estimated trade side", "估算成交方向")}</h4>
                <dl className={styles.breakdown}>
                  <Metric name="estimated-buy" label={pick(zh, "Estimated buy", "估算买入")} value={usd(selected.softBuyPremium)} />
                  <Metric name="estimated-sell" label={pick(zh, "Estimated sell", "估算卖出")} value={usd(selected.softSellPremium)} />
                  <Metric name="mixed" label={pick(zh, "Mixed", "混合")} value={usd(selected.mixedPremium)} />
                  <Metric name="unknown-side" label={pick(zh, "Unclassified", "未分类")} value={usd(selected.unknownSidePremium)} />
                </dl>
              </div>
            </div>
            <p className={styles.note}>
              {pick(zh, "Trade side is estimated; call/put type does not identify intent. The interval includes its start and excludes its end.",
                "成交方向为估算；认购/认沽类型不代表交易意图。时段包含开始时间，不包含结束时间。")}
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
