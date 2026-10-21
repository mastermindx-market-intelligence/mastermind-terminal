/**
 * optionsLevelsStrings.ts — owner-local EN/ZH strings for the Options Levels legend's
 * statement of the published Expected Move band (Options R1 W3S).
 *
 * Pattern: each key maps to [English, 中文], read through olPlain() exactly the way
 * lib/i18n.tsx tPlain() reads the live <html data-lang> attribute, so the legend row
 * (rebuilt by ChartPanel's rebuildPaneMeta on its own paths) resolves the language at
 * build time rather than through a React closure.
 *
 * Why not LEX in lib/i18n.tsx: that shared table is byte-locked by eleven evidence
 * packets that have nothing to do with options levels; an owner-local table keeps those
 * locks truthful without a recapture of surfaces this strings module never touches
 * (the flowdeskStrings / eodStrings / volStrings precedent).
 *
 * Honesty: the band statement carries the producer's own numbers verbatim and names the
 * method as unstated when the source supplies none. No claim of edge or validation.
 */

const OL_LEX = {
  olEmBandMult: ["band ×{m}", "区间 ×{m}"],
  olEmHorizon: ["{n}d", "{n}日"],
  olEmMethodUnstated: ["method not stated by source", "来源未说明方法"],
} as const satisfies Record<string, readonly [string, string]>;

export type OptionsLevelsStringKey = keyof typeof OL_LEX;

/** Live-language read of one Options Levels legend string (mirrors i18n tPlain). */
export function olPlain(key: OptionsLevelsStringKey): string {
  const e = OL_LEX[key];
  const zh = typeof document !== "undefined" && document.documentElement.getAttribute("data-lang") === "zh";
  return zh ? e[1] : e[0];
}

/** Lang-explicit read, for callers (and tests) that already hold the language. */
export function getOptionsLevelsStr(lang: "en" | "zh", key: OptionsLevelsStringKey): string {
  return OL_LEX[key][lang === "zh" ? 1 : 0];
}
