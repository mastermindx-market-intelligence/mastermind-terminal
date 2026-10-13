/** Synthetic browser inputs through the real math/validator. Tests intercept HTTP; no API bypass. */
import es from "../../fixtures/futures-microstructure.json";
import nq from "../../fixtures/futures-microstructure-nq.json";
import { buildFuturesLabFrames, type FuturesLabDataset } from "../../lib/futuresWorkspace";
import { parseFuturesPublishedView } from "../../lib/futuresTransport";
import { requestExpiryLens, type FuturesRequest } from "../../lib/futuresRequest";
export function browserFuturesFixture(request: FuturesRequest) {
  const dataset = (request.pair === "NQ" ? nq : es) as FuturesLabDataset;
  const nowMs = Date.now(), last = dataset.baseMs + 24 * 60000;
  const possible = [dataset.baseMs + 6 * 60000, last];
  const cutoffMs = request.cutoffMs === null ? last : possible.filter(t => t <= request.cutoffMs!).at(-1);
  if (cutoffMs === undefined) throw Error("fixture_no_cutoff");
  const candidate = { schema: "terminal.futures_published_view/v1", request,
    contract: dataset.contract, sessionId: dataset.sessionId, basis: "historical", availabilityBasis: "vendor_capture_retrospective",
    sourceId: "fixture:synthetic-browser-test-not-market-data", sourceAsOfMs: last,
    publishedAtMs: nowMs - 1, cutoffMs, freshUntilMs: last + 5000,
    lowTick: dataset.lowTick, highTick: dataset.highTick, replayCutoffsMs: possible,
    frames: buildFuturesLabFrames(dataset, { cutoffMs, intervalMinutes: request.intervalMinutes,
      priceStepTicks: request.priceStepTicks, method: request.method, lens: requestExpiryLens(request), fault: "normal" }) };
  const parsed = parseFuturesPublishedView(candidate, request, nowMs);
  if (!parsed) throw Error("synthetic_browser_fixture_invalid");
  return parsed;
}
