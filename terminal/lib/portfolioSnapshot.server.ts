import { createHash } from "node:crypto";
import type { Position } from "@/lib/portfolio";

/** An ephemeral content binding for independently read analysis. It is neither
 * a mutation receipt nor a persisted version/authorization authority. */
export function portfolioBookKey(positions: readonly Position[]): string {
  const rows = positions.map(p => [p.id, p.ticker, p.shares, p.entryPrice,
    p.entryCurrency ?? null, p.entryDate, p.notes, p.status, p.createdAt]);
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en"));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
