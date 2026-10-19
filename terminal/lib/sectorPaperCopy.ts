import { LEX, type Lang } from "@/lib/i18n";

/** Uses the existing Sector language prop and shared LEX; owns no language state. */
export function sectorPaperText(lang: Lang, key: string, ...values: Array<string | number>): string {
  const copy = LEX[key]?.[lang === "zh" ? 1 : 0] ?? key;
  return copy.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}
