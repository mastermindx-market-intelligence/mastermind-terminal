import "server-only";
import type { LargeTradesEnvelope } from "./types";

export const IEX_HIST_ATTRIBUTION = "Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the IEX Historical Data Terms of Use.";
export const IEX_HIST_TERMS = "https://www.iex.io/legal/hist-data-terms";

/**
 * This consumer presently admits only the historical source whose public display
 * terms were reviewed. The incumbent publisher remains responsible for authentic
 * artifacts; structural validity or a user's sign-in does not confer vendor rights.
 * Additional sources require the existing source/entitlement review before expansion.
 */
export function isAdmittedLargeTradesSource(envelope: LargeTradesEnvelope): boolean {
  const p = envelope.provenance;
  return p.provider === "IEX" && p.dataset === "HIST DEEP+ 1.0"
    && p.venue === "IEX" && p.scope === "venue"
    && p.dataMode === "historical" && p.evidenceMode === "HISTORICAL_REPLAY"
    && p.receiptBasis === "archive_acquisition" && p.sourceSha256 !== null
    && envelope.instrument.assetClass === "equity" && envelope.instrument.quantityUnit === "shares"
    && p.attribution === IEX_HIST_ATTRIBUTION && p.termsUrl === IEX_HIST_TERMS
    && envelope.prints.every((print) => print.kind === "trade"
      ? print.sourceRecordType === "L" || print.sourceRecordType === "T"
      : print.sourceRecordType === "B");
}
