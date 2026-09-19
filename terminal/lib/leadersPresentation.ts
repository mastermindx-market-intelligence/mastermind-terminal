export const LEADERS_PREVIEW_ROWS = 12;

export function visibleLeaderRows<T>(rows: readonly T[], expanded: boolean): T[] {
  return expanded ? [...rows] : rows.slice(0, LEADERS_PREVIEW_ROWS);
}

export function leaderCountLabel(
  lang: "en" | "zh",
  shown: number,
  boardTotal: number,
  universeTotal: number,
): string {
  return lang === "zh"
    ? `显示 ${shown} / ${boardTotal} · ${universeTotal} 标的范围`
    : `Showing ${shown} of ${boardTotal} · ${universeTotal}-name universe`;
}

export function leaderEmptyLabel(lang: "en" | "zh"): string {
  return lang === "zh" ? "此快照中暂无满足条件的标的" : "No qualifying names in this snapshot";
}

export function leaderMissingRecurrenceLabel(lang: "en" | "zh", stale: boolean): string {
  if (stale) return lang === "zh" ? "历史" : "historical";
  return lang === "zh" ? "累积中" : "accruing";
}

export function leaderCoverageFootnote(lang: "en" | "zh", tapeNames: number): string {
  return lang === "zh"
    ? `方向为近似值。Tape 签名覆盖 ${tapeNames} 个标的。仅供展示，不构成投资建议。`
    : `Direction is approximate. Tape-signed coverage: ${tapeNames} names. Display only — not investment advice.`;
}
