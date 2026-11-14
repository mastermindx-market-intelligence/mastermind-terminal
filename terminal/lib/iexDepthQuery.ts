import { isWorkspaceMarket } from "@/lib/sharedShellMarket";

/** Page selection only. Market context never selects an IEX source or grants access. */
export function parseIexDepthQuery(query: URLSearchParams): { symbol: string } | null {
  if ([...query.keys()].some(key => key !== "symbol" && key !== "workspaceMarket")) return null;
  if (query.getAll("symbol").length > 1 || query.getAll("workspaceMarket").length > 1) return null;
  if (query.has("workspaceMarket") && !isWorkspaceMarket(query.get("workspaceMarket"))) return null;
  const symbol = query.get("symbol") ?? "NVDA";
  return /^[A-Z0-9][A-Z0-9.\-]{0,7}$/.test(symbol) ? { symbol } : null;
}
