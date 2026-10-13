/** SYNTHETIC publication for tests only. Never imported by a production source reader. */
import { createHash } from "node:crypto";
import es from "@/fixtures/futures-microstructure.json";
import nq from "@/fixtures/futures-microstructure-nq.json";
import { buildFuturesLabFrames, type FuturesLabDataset } from "@/lib/futuresWorkspace";
export const fixtureNow = es.baseMs + 24 * 60000 + 1000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function sourceFixture(pair: "ES" | "NQ" = "ES") {
  const dataset = (pair === "ES" ? es : nq) as FuturesLabDataset;
  const views = [];
  for (const intervalMinutes of [1, 5]) for (const priceStepTicks of [1, 4, 8]) for (const minute of [6, 24]) {
    const cutoffMs = dataset.baseMs + minute * 60000;
    const frames = buildFuturesLabFrames(dataset, { cutoffMs, intervalMinutes, priceStepTicks,
      lens: { kind: "all" }, method: "ratio", fault: "normal" }).map(frame => {
      const input = structuredClone(dataset.frameInputs[(frame.endMs - dataset.baseMs) / 60000 - 1]);
      const json = JSON.stringify(input.source), sha256 = hash(json);
      const matrixJson = JSON.stringify(input.matrix?.payload);
      return { endMs: frame.endMs, bar: frame.bar, depth: frame.depth,
        gammaAttachment: { cashSession: "open", input: { ...input, source: undefined, matrix: undefined,
          sourceReceipt: { ...input.sourceReceipt, payloadSha256: sha256 } }, payload: { json, sha256 },
          matrix: input.matrix ? { json: matrixJson, sha256: hash(matrixJson),
            receipt: { ...input.matrix.receipt, payloadSha256: hash(matrixJson) } } : null } };
    });
    views.push({ cutoffMs, intervalMinutes, priceStepTicks, frames });
  }
  return { schema: "hub.futures_workspace_source/v1", audience: "subscriber_display", distributionEvidenceRef: "fixture:not-a-license",
    pair, contract: dataset.contract, sessionId: dataset.sessionId, sourceId: "fixture:synthetic-publisher",
    basis: "historical", availabilityBasis: "source_observed", sourceAsOfMs: fixtureNow - 1000,
    publishedAtMs: fixtureNow - 100, freshUntilMs: fixtureNow + 4000, lowTick: dataset.lowTick, highTick: dataset.highTick, views };
}
