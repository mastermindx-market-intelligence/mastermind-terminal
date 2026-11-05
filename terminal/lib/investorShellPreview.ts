/** Presentation eligibility only. Identity and entitlements keep their existing owners. */
export function isInvestorShellPreviewEnabled(value: unknown): boolean {
  return value === "1";
}

/** The initial private preview deliberately admits two exact non-chart routes only. */
export function isInvestorShellPreviewPath(pathname: string): boolean {
  return pathname === "/analysis" || pathname === "/discover";
}

/** Existing public Macro dashboard destination; presentation-only cross-product handoff. */
export const MACRO_OVERVIEW_HREF = "https://www.mastermind-x.com/macro.html";
