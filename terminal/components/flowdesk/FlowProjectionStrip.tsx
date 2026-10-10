"use client";

import type { FlowProjection, FlowProjectionIntervalMinutes } from "@/lib/flowProjection";
import { pick } from "@/lib/finFormat";

type Props = {
  projection: FlowProjection;
  selectedKey: string | null;
  interval: FlowProjectionIntervalMinutes;
  lang: "en" | "zh";
  onSelect: (key: string | null) => void;
  onInterval: (minutes: FlowProjectionIntervalMinutes) => void;
};

function et(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function FlowProjectionStrip({ projection, selectedKey, interval, lang, onSelect, onInterval }: Props) {
  const zh = lang === "zh";
  return (
    <div data-flow-projection="r8-v1">
      <div className="obs-fd-preset-bar" aria-label={pick(zh, "Flow time projection", "资金流时间投影")}>
        <span className="obs-lbl">{pick(zh, "TIME", "时间投影")}</span>
        {([5, 15, 30, 60] as const).map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`obs-chip${interval === minutes ? " on" : ""}`}
            onClick={() => onInterval(minutes)}
          >
            {minutes}m
          </button>
        ))}
        <span className="obs-lbl">
          {projection.validEventCount.toLocaleString("en-US")}
          {pick(zh, " events", " 事件")}
        </span>
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
          return (
            <button
              key={bucket.key}
              type="button"
              className={`obs-chip${active ? " on" : ""}`}
              aria-pressed={active}
              onClick={() => onSelect(active ? null : bucket.key)}
            >
              {et(bucket.start)} · {bucket.eventCount}
            </button>
          );
        })}
        {selectedKey && (
          <button type="button" className="obs-chip" onClick={() => onSelect(null)}>
            {pick(zh, "Clear bucket", "清除时间桶")}
          </button>
        )}
      </div>
    </div>
  );
}
