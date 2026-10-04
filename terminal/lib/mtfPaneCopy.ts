// Feature-local bilingual copy, following visualIntelligenceCopy's pattern.
// Language remains owned by lib/i18n's LangProvider / <html data-lang>.
// This module stores no preference, installs no provider, and mutates no shared lexicon.
import type { Lang } from "./i18n";

export const MTF_COPY: Record<string, readonly [string, string]> = {
  indMtfStoch: ["MTF Stochastic (HLC)", "多周期随机指标（高低收）"],
  indMtfMacd: ["MTF MACD-RSI", "多周期 MACD-RSI"],
  indMtfConfluence: ["MTF Momentum Confluence", "多周期动量共振"],
  mtfClosedBars: ["Closed bars", "已收盘 K 线"],
  mtfSelectHorizon: ["Select a timeframe in settings", "请在设置中选择周期"],
  mtfShowD: ["Show %D (dashed)", "显示 %D（虚线）"],
  mtfShowSignal: ["Show signal (dashed)", "显示信号线（虚线）"],
  mtfLineWidth: ["Line width", "线宽"],
  mtfColorD: ["D color", "日线颜色"],
  mtfColor3D: ["3D color", "三日线颜色"],
  mtfColorW: ["W color", "周线颜色"],
  mtfColor2W: ["2W color", "双周线颜色"],
  mtfColor1M: ["1M color", "月线颜色"],
};

export function mtfPaneText(key: string, lang?: Lang, fallback?: string): string {
  const copy = MTF_COPY[key];
  if (!copy) return fallback ?? key;
  const selected = lang ?? (typeof document !== "undefined"
    && document.documentElement.getAttribute("data-lang") === "zh" ? "zh" : "en");
  return copy[selected === "zh" ? 1 : 0];
}
