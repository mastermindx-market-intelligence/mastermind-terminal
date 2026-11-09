"use client";
import { useCallback } from "react";
import { useLang, type Lang } from "./i18n";
/** Feature-local EN/ZH copy for multiple study instances (E06). Language state remains the shared
 * LangProvider; keeping this copy out of the global LEX preserves unrelated screen evidence.
 * Placeholders are `{name}` and are filled by `studyInstancesText`. No mutable registration/store.
 */
export const STUDY_INSTANCES_LEX: Record<string, [string, string]> = {
  sinstAddAnother: ["Add another {label}", "再添加一个{label}"],
  sinstCount: ["{count} of {max} on this chart · each keeps its own settings", "本图表已有 {count}/{max} 个 · 各自保留独立设置"],
  sinstLimit: ["Limit reached · {max} {label} per chart", "已达上限 · 每个图表最多 {max} 个{label}"],
};

export type StudyInstancesKey = keyof typeof STUDY_INSTANCES_LEX;

/** Pure lookup + `{placeholder}` fill; an unknown key returns the key (never throws). */
export function studyInstancesText(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const pair = STUDY_INSTANCES_LEX[key];
  const template = pair ? pair[lang === "zh" ? 1 : 0] : key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

export function useStudyInstancesT() {
  const { lang } = useLang();
  return useCallback((key: string, vars?: Record<string, string | number>) => studyInstancesText(lang, key, vars), [lang]);
}
