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

export function leaderHistoryLabel(lang: "en" | "zh", sessions: number): string {
  if (lang === "zh") return `${sessions} 个历史会话`;
  return `${sessions} session${sessions === 1 ? "" : "s"} of history`;
}

export function leaderDirectionCaveat(lang: "en" | "zh"): string {
  return lang === "zh"
    ? "此快照中，幅度比方向更可靠。"
    : "Magnitude is more reliable than direction in this snapshot.";
}

export function leaderCoverageFootnote(lang: "en" | "zh", tapeNames: number): string {
  return lang === "zh"
    ? `Tape 签名覆盖 ${tapeNames} 个标的。仅供展示，不构成投资建议。`
    : `Tape-signed coverage: ${tapeNames} names. Display only — not investment advice.`;
}
