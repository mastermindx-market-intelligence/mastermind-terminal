/**
 * The fundamentals page identifiers — deliberately a LEAF module (zero imports).
 *
 * ⚠️ PERFORMANCE CONTRACT. `FIN_PAGES` is a runtime value that the chart shell needs
 * eagerly (it validates the `?pane=` deep link and drives the rail's pane buttons),
 * while `MegaPane` itself is mounted through `next/dynamic` and must stay out of the
 * /terminal first-paint bundle. Those two facts are incompatible if the constant lives
 * in MegaPane.tsx: a single value import of `FIN_PAGES` from that file is a static
 * runtime edge into MegaPane, and the bundler then pulls MegaPane's whole graph — the
 * fourteen fundamentals pages plus their statement/intelligence/transcript libraries —
 * into the eager chunk, silently cancelling the dynamic() split below it.
 *
 * That is exactly what happened before this file existed: TerminalShell's
 * `import { FIN_PAGES } from "@/components/fin/MegaPane"` dragged 34 extra modules
 * (~709 KB of source, a 698 KB-decoded chunk) onto every /terminal load.
 *
 * So: keep this module import-free, and never import a runtime value out of MegaPane
 * (or any other dynamic()-mounted heavy) from an eagerly-loaded module. Types are safe
 * — `import type` is erased and creates no edge.
 */

/** The fourteen hostable pages share one fundamentals/research tab bar. The former
 *  deep-analysis ("mastermind") page was merged into the OracleDash Research-Desk surface. */
export type FinPage =
  | "overview"
  | "statements"
  | "statistics"
  | "dividends"
  | "earnings"
  | "intelligence"
  | "transcripts"
  | "revenue"
  | "forecast"
  | "technicals"
  | "seasonals"
  | "ownership"
  | "insider"
  | "lab";

/** The pages that share the TV "Financials" tab pill bar. */
export const FIN_PAGES: readonly FinPage[] = ["overview", "intelligence", "statements", "transcripts", "statistics", "dividends", "earnings", "revenue", "seasonals", "forecast", "technicals", "ownership", "insider", "lab"];
