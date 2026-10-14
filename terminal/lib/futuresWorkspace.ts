/** Data-only rendering seam. The owning source adapter supplies verified views. */
import type { FuturesGexFrame, FuturesGexFrameInput } from "./futuresGexFrame";
import { buildFuturesGexFrame } from "./futuresGexFrame";
import type { ExpiryLens } from "./gexLadder";

export type FuturesVolumeCell = { priceTicks: number; buy: number; sell: number; unknown: number; total: number;
  buyImbalance?: boolean; sellImbalance?: boolean };
type FuturesBarObservations = { startNs: string; endNs: string; availableAtNs: string;
  cells: FuturesVolumeCell[]; buy: number; sell: number; unknown: number; total: number; deltaKnown: number; cvdKnown: number; cvd: number | null };
export type FuturesFootprintBar = FuturesBarObservations & (
  { kind?: "executed"; openTicks: number; highTicks: number; lowTicks: number; closeTicks: number } |
  { kind: "no_captured_trades"; openTicks: null; highTicks: null; lowTicks: null; closeTicks: null }
);
export type FuturesDepthColumn = { startNs: string; endNs: string; coverage: string; coverageFraction: number;
  levels: { priceTicks: number; bidMean: number | null; askMean: number | null }[] };
export type FuturesChartFrame = { endMs: number; bar: FuturesFootprintBar; depth: FuturesDepthColumn | null; gex: FuturesGexFrame };
export type FuturesLabDataset = {
  schema: string; synthetic: boolean; baseMs: number; contract: string; pair: "ES" | "NQ"; indexRoot: "SPX" | "NDX";
  lowTick: number; highTick: number; sessionId: string; frameInputs: FuturesGexFrameInput[];
  footprints: Record<string, { bars: FuturesFootprintBar[] }>;
  depthByInterval: Record<string, { columns: FuturesDepthColumn[] }>;
  gapByInterval: Record<string, { columns: FuturesDepthColumn[] }>;
};

/** Development-only scenario wiring. NO synthetic values live in the chart renderer. */
export function buildFuturesLabFrames(dataset: FuturesLabDataset, { cutoffMs, intervalMinutes, priceStepTicks, lens, method, fault }: {
  cutoffMs: number; intervalMinutes: number; priceStepTicks: number; lens: ExpiryLens;
  method: "basis" | "ratio"; fault: string;
}): FuturesChartFrame[] {
  if (!Number.isSafeInteger(cutoffMs) || cutoffMs <= 0 || dataset.schema !== "terminal.futures_lab_fixture/v2" || dataset.synthetic !== true ||
      ![1, 5].includes(intervalMinutes) || ![1, 4, 8].includes(priceStepTicks)) return [];
  const footprint = dataset.footprints[`${intervalMinutes}:${priceStepTicks}`];
  const columns = (fault === "gap" ? dataset.gapByInterval : dataset.depthByInterval)[String(intervalMinutes)]?.columns;
  if (!footprint || !columns) return [];
  const depthByStart = new Map(columns.map(c => [c.startNs, c]));
  const cutoffNs = BigInt(cutoffMs) * BigInt(1000000);
  const bars = footprint.bars.filter(b => BigInt(b.endNs) <= cutoffNs && BigInt(b.availableAtNs) <= cutoffNs);
  return bars.map((bar, i) => {
    const endMs = Number(BigInt(bar.endNs) / BigInt(1000000));
    const inputIndex = (endMs - dataset.baseMs) / 60000 - 1;
    const original = dataset.frameInputs[inputIndex];
    if (!original || original.quotes.futuresContract !== dataset.contract || original.quotes.indexRoot !== dataset.indexRoot)
      return { endMs, bar, depth: null, gex: { status: "unavailable", reason: "invalid_input" } };
    const input = structuredClone(original);
    input.expiryLens = lens; input.policy.method = method; input.policy.decisionTimeMs = endMs;
    const last = i === bars.length - 1;
    if (last && fault === "stale") { input.quotes.indexTimestampMs -= 60000; input.quotes.futuresTimestampMs -= 60000; }
    if (last && fault === "late") input.sourceReceipt.availableAtMs = endMs + 1000;
    if (last && fault === "matrix-late" && input.matrix) input.matrix.receipt.availableAtMs = endMs + 1000;
    const column = depthByStart.get(bar.startNs) ?? null;
    return { endMs, bar, depth: column?.endNs === bar.endNs ? column : null, gex: buildFuturesGexFrame(input) };
  });
}
