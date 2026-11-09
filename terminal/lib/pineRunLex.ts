"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/** Feature-local EN/ZH tuples for a Pine script's run state: the chart legend row (ChartOverlays)
 * and the editor's diagnose console (PineEditor) while the script engine boots, after it fails, and
 * the retry. Language state stays in the shared LangProvider; keeping this copy out of the global
 * LEX leaves unrelated screen evidence untouched. `{name}` = script name. No mutable registration.
 */
export const PINE_RUN_LEX: Record<string, [string, string]> = {
  // legend row (lib/pineChartRun.ts pineRowState). Terse on purpose: it sits beside the script's
  // name in a row that must stay clear of the price scale on a 390px phone.
  pineRunning: ["Running…", "运行中…"],
  pineEngineWait: ["Waiting for engine…", "等待引擎…"],
  pineEngineFail: ["Engine failed to start", "引擎启动失败"],
  pineEngineError: ["Engine error", "引擎出错"],
  pineRunInterrupted: ["Run interrupted", "运行被中断"],
  pineRetry: ["Retry", "重试"],
  pineRetryTip: ["Run this script again", "重新运行此脚本"],
  // editor diagnose console
  peChecking: ["Checking {name}…", "正在检查 {name}…"],
  peEngineUnavailable: ["Script engine unavailable — this script has not been checked", "脚本引擎不可用——尚未检查此脚本"],
  peRetryCheck: ["Retry check", "重新检查"],
};

export type PineRunT = (key: string, vars?: Record<string, string | number>) => string;

export function usePineRunT(): PineRunT {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, vars?: Record<string, string | number>): string => {
    const pair = PINE_RUN_LEX[key];
    let text = pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key);
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
    return text;
  }, [lang, sharedT]);
}
