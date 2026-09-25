export const TERMINAL_CHART_JUMP_EVENT = "mm:chart-jump";

export type TerminalChartJumpDetail = {
  sym: string;
  ts: string;
  paneId: number;
};

export function isTerminalChartJumpDetail(value: unknown): value is TerminalChartJumpDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<TerminalChartJumpDetail>;
  return typeof detail.sym === "string"
    && detail.sym.trim().length > 0
    && typeof detail.ts === "string"
    && detail.ts.trim().length > 0
    && Number.isInteger(detail.paneId)
    && (detail.paneId as number) >= 0;
}

export function terminalChartJumpTargetsPane(
  value: unknown,
  symbol: string,
  paneId: number,
): value is TerminalChartJumpDetail {
  return isTerminalChartJumpDetail(value)
    && value.sym === symbol
    && value.paneId === paneId;
}

export function dispatchTerminalChartJump(detail: TerminalChartJumpDetail): boolean {
  if (typeof window === "undefined" || !isTerminalChartJumpDetail(detail)) return false;
  try {
    window.dispatchEvent(new CustomEvent<TerminalChartJumpDetail>(
      TERMINAL_CHART_JUMP_EVENT,
      { detail },
    ));
    return true;
  } catch {
    return false;
  }
}
