import type { MarkerSpec } from "../chart-engine/api";
import type { LiveEntryEpisode } from "./types";

export type PlainLang = "en" | "zh";

export type MarkTone =
  | "flagged"
  | "confirmed"
  | "observed"
  | "failed"
  | "expired"
  | "resolved";

export type EpisodeMark = {
  id: string;
  at: number;
  tone: MarkTone;
  text: readonly [string, string];
};

export const MARK_TEXT: Record<MarkTone, readonly [string, string]> = {
  flagged: ["Flagged", "已标记"],
  confirmed: ["Reclaim held", "收复确认"],
  observed: ["Last seen", "最近观察"],
  failed: ["Turn failed", "反转失败"],
  expired: ["Session ended", "交易日结束"],
  resolved: ["Resolved", "已结算"],
};

export const TONE_PRECEDENCE: readonly MarkTone[] = [
  "failed",
  "expired",
  "resolved",
  "confirmed",
  "flagged",
  "observed",
];

const ISO_8601_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function toneRank(tone: MarkTone): number {
  return TONE_PRECEDENCE.indexOf(tone);
}

function lastObservedTone(state: string): MarkTone {
  if (state === "INVALIDATED") return "failed";
  if (state === "EXPIRED") return "expired";
  if (state === "RESOLVED") return "resolved";
  return "observed";
}

function dedupeByAt(marks: EpisodeMark[]): EpisodeMark[] {
  const byAt = new Map<number, EpisodeMark>();
  for (const mark of marks) {
    const existing = byAt.get(mark.at);
    if (!existing || toneRank(mark.tone) < toneRank(existing.tone)) {
      byAt.set(mark.at, mark);
    }
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}

export function isoToUnixSeconds(iso: unknown): number | null {
  if (typeof iso !== "string" || !ISO_8601_OFFSET_RE.test(iso)) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export function episodeMarks(
  ep: Pick<
    LiveEntryEpisode,
    | "episode_id"
    | "state"
    | "first_armed_at"
    | "candidate_at"
    | "last_observed_at"
  >,
): EpisodeMark[] {
  const raw: EpisodeMark[] = [];
  const armedAt = isoToUnixSeconds(ep.first_armed_at);
  if (armedAt !== null) {
    raw.push({
      id: `${ep.episode_id}:flagged`,
      at: armedAt,
      tone: "flagged",
      text: MARK_TEXT.flagged,
    });
  }
  const candidateAt = isoToUnixSeconds(ep.candidate_at);
  if (candidateAt !== null) {
    raw.push({
      id: `${ep.episode_id}:confirmed`,
      at: candidateAt,
      tone: "confirmed",
      text: MARK_TEXT.confirmed,
    });
  }
  const observedAt = isoToUnixSeconds(ep.last_observed_at);
  if (observedAt !== null) {
    const priorMax = raw.reduce((max, m) => Math.max(max, m.at), -Infinity);
    if (observedAt > priorMax) {
      const tone = lastObservedTone(ep.state);
      raw.push({
        id: `${ep.episode_id}:${tone}`,
        at: observedAt,
        tone,
        text: MARK_TEXT[tone],
      });
    }
  }
  return dedupeByAt(raw);
}

function greatestBarAtOrBelow(markAt: number, barTimes: readonly number[]): number | null {
  if (barTimes.length === 0) return null;
  if (markAt < barTimes[0]) return null;
  let lo = 0;
  let hi = barTimes.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (barTimes[mid] <= markAt) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? barTimes[ans] : null;
}

export function snapToBars(
  marks: readonly EpisodeMark[],
  barTimes: readonly number[],
): EpisodeMark[] {
  if (barTimes.length === 0) return [];
  const snapped: EpisodeMark[] = [];
  for (const mark of marks) {
    const barAt = greatestBarAtOrBelow(mark.at, barTimes);
    if (barAt === null) continue;
    snapped.push({ ...mark, at: barAt });
  }
  return dedupeByAt(snapped);
}

export function toMarkerSpecs(
  marks: readonly EpisodeMark[],
  palette: Record<MarkTone, string>,
  lang: PlainLang,
): MarkerSpec[] {
  const textIdx = lang === "zh" ? 1 : 0;
  return marks.map((mark) => {
    const { tone } = mark;
    let position: MarkerSpec["position"];
    let shape: MarkerSpec["shape"];
    switch (tone) {
      case "flagged":
        position = "belowBar";
        shape = "arrowUp";
        break;
      case "confirmed":
        position = "aboveBar";
        shape = "circle";
        break;
      case "observed":
        position = "belowBar";
        shape = "circle";
        break;
      case "failed":
        position = "aboveBar";
        shape = "arrowDown";
        break;
      case "expired":
        position = "aboveBar";
        shape = "square";
        break;
      case "resolved":
        position = "aboveBar";
        shape = "square";
        break;
    }
    return {
      time: mark.at,
      position,
      shape,
      color: palette[tone],
      id: mark.id,
      text: mark.text[textIdx],
      size: 1,
    };
  });
}
