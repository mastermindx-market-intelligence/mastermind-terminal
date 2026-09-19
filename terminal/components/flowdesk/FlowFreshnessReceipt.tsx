"use client";

import { useEffect, useMemo, useState } from "react";
import {
  artifactSourceAgeMs,
  artifactSourceAsof,
  deriveLiveFlowFreshness,
  formatFlowAge,
  formatObservedCycle,
  parseLiveFlowMetaTiming,
  usOptionsSessionState,
} from "@/lib/flowFreshness";

type FlowLang = "en" | "zh";

const LEX = {
  connected: ["Connected", "已连接"],
  timingUnavailable: ["Timing unavailable", "时间信息不可用"],
  marketClosed: ["Market closed", "市场休市"],
  lastSession: ["Last session", "上一交易时段"],
  updated: ["Updated", "更新"],
  sourceData: ["Source data", "源数据"],
  refreshCycle: ["Refresh cycle", "更新周期"],
  data: ["Data", "数据"],
  dataAgeUnavailable: ["Data age unavailable", "数据时效不可用"],
  ago: ["ago", "前"],
} as const;

function word(key: keyof typeof LEX, lang: FlowLang): string {
  return LEX[key][lang === "zh" ? 1 : 0];
}

function useRenderClock(): number | null {
  // Null on the server avoids a Date.now hydration mismatch. The first effect
  // fills it immediately; later ticks keep age labels honest while the producer
  // snapshot itself is unchanged.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return nowMs;
}

function ageCopy(age: string, lang: FlowLang): string {
  return lang === "zh" ? `${age}${word("ago", lang)}` : `${age} ${word("ago", lang)}`;
}

export function FlowFreshnessReceipt({
  meta,
  connected = false,
  lang,
  sessionDate,
  className = "",
}: {
  meta: unknown;
  connected?: boolean;
  lang: FlowLang;
  sessionDate?: string;
  className?: string;
}) {
  const nowMs = useRenderClock();
  const parsed = useMemo(() => parseLiveFlowMetaTiming(meta), [meta]);
  const freshness = nowMs === null ? null : deriveLiveFlowFreshness(meta, nowMs);
  const sessionState = nowMs === null
    ? "last_session"
    : usOptionsSessionState(sessionDate, new Date(nowMs));

  const snapshotAge = freshness ? formatFlowAge(freshness.snapshotAgeMs) : null;
  const sourceAgeMin = freshness ? formatFlowAge(freshness.sourceResponseAgeMinMs) : null;
  const sourceAgeMax = freshness ? formatFlowAge(freshness.sourceResponseAgeMaxMs) : null;
  const cycle = freshness ? formatObservedCycle(freshness.timing.observedCycleSec) : null;
  const measured = Boolean(freshness && snapshotAge && sourceAgeMin && sourceAgeMax);
  const sourceRange = sourceAgeMin === sourceAgeMax ? sourceAgeMin : `${sourceAgeMin}–${sourceAgeMax}`;

  return (
    <div
      className={`flow-freshness-receipt ${className}`.trim()}
      data-flow-freshness={measured ? "measured" : "unavailable"}
      data-flow-timing-contract={parsed?.schema ?? "unavailable"}
      data-flow-timing-authority="display_only"
      data-flow-session={sessionState}
     >
      {connected && (
        <span className="flow-freshness-item flow-freshness-connected" data-flow-transport="connected">
          <span className="flow-freshness-dot" aria-hidden="true" />
          {word("connected", lang)}
        </span>
      )}
      {sessionState === "last_session" && (
        <>
          <span className="flow-freshness-item flow-freshness-closed">{word("marketClosed", lang)}</span>
          <span className="flow-freshness-item">{word("lastSession", lang)}</span>
        </>
      )}
      {!measured ? (
        <span className="flow-freshness-item">{word("timingUnavailable", lang)}</span>
      ) : (
        <>
          <span className="flow-freshness-item">
            {word("updated", lang)} {ageCopy(snapshotAge!, lang)}
          </span>
          <span className="flow-freshness-item">
            {word("sourceData", lang)} {ageCopy(sourceRange!, lang)}
          </span>
          <span className="flow-freshness-item">
            {word("refreshCycle", lang)} {cycle ?? word("timingUnavailable", lang)}
          </span>
        </>
      )}
    </div>
  );
}

/** Source-only receipt for derived artifacts such as enrich and chain heat. */
export function ArtifactSourceReceipt({
  artifact,
  lang,
  sessionDate,
}: {
  artifact: unknown;
  lang: FlowLang;
  sessionDate?: string;
}) {
  const nowMs = useRenderClock();
  const sourceAsof = artifactSourceAsof(artifact);
  const ageMs = nowMs === null ? null : artifactSourceAgeMs(artifact, nowMs);
  const age = ageMs === null ? null : formatFlowAge(ageMs);
  const sessionState = nowMs === null
    ? "last_session"
    : usOptionsSessionState(sessionDate, new Date(nowMs));

  return (
    <span
      className="flow-artifact-source"
      data-flow-artifact-freshness={age ? "source" : "unavailable"}
      data-flow-timing-authority="display_only"
      title={sourceAsof ?? word("dataAgeUnavailable", lang)}
    >
      {age
        ? `${sessionState === "last_session" ? `${word("lastSession", lang)} · ` : ""}${word("data", lang)} ${ageCopy(age, lang)}`
        : word("dataAgeUnavailable", lang)}
    </span>
  );
}
