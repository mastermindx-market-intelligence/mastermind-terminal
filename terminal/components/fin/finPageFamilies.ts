import type { FinPage } from "./finPages";

export type FinFamily =
  | "overview"
  | "intelligence"
  | "financials"
  | "earnings"
  | "market"
  | "ownership"
  | "lab";

export const FIN_FAMILY_ORDER: readonly FinFamily[] = [
  "overview",
  "intelligence",
  "financials",
  "earnings",
  "market",
  "ownership",
  "lab",
] as const;

export const FIN_FAMILY_PAGES: Readonly<Record<FinFamily, readonly FinPage[]>> = {
  overview: ["overview"],
  intelligence: ["intelligence"],
  financials: ["statements", "statistics", "revenue", "dividends"],
  earnings: ["earnings", "forecast", "transcripts"],
  market: ["technicals", "seasonals"],
  ownership: ["insider"],
  lab: ["lab"],
} as const;

export function familyForPage(page: FinPage): FinFamily {
  for (const family of FIN_FAMILY_ORDER) {
    if (FIN_FAMILY_PAGES[family].includes(page)) return family;
  }
  // FinPage is closed and the tables above are test-covered. Keep a hard fallback
  // instead of silently creating another navigation authority if a future page is
  // added without being assigned to the Research Workspace hierarchy.
  throw new Error(`Unassigned Research Workspace page: ${page}`);
}

export function defaultPageForFamily(family: FinFamily): FinPage {
  return FIN_FAMILY_PAGES[family][0];
}
