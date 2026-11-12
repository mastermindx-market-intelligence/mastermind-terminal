/** Local-only real-artifact canary; no network, publication or credentials. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseIexDepthEnvelope, iexExecutionProfile } from "../lib/iexDepthReplay";

const directory = process.argv[2];
const symbols = process.argv.slice(3);
if (!directory || !symbols.length || symbols.length > 20 || symbols.some(s => !/^[A-Z0-9][A-Z0-9.\-]{0,7}$/.test(s)))
  throw new Error("Use: verify-iex-depth <private-output-dir> SYMBOL...");
const reports = symbols.map(symbol => {
  const filename = path.join(directory, symbol + ".json");
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > 8*1024*1024) throw new Error("artifact_size_or_type");
  const bytes = fs.readFileSync(filename);
  const data = parseIexDepthEnvelope(JSON.parse(bytes.toString("utf8")), symbol);
  if (!data) throw new Error("invalid_iex_depth_envelope:"+symbol);
  const points = data.depthReplay.samples;
  const last = points[points.length-1];
  const profile = iexExecutionProfile(data,last);
  const through = data.prints.filter(p => p.session === last.session && BigInt(p.sourceSequence) <= BigInt(last.sourceSequence) && BigInt(p.eventNs) <= BigInt(last.marketNs));
  const breaks = through.filter(p => p.kind === "cancel");
  const directSum = breaks.length ? null : through.reduce((n,p) => n+p.quantity,0);
  if (directSum !== null && directSum !== profile.volume) throw new Error("native_scalar_volume_disagreement:"+symbol);
  const samples = [points[0],points[Math.floor(points.length/2)],last].map(point => ({
    marketNs:point.marketNs, availableNs:point.availableNs, sourceSequence:point.sourceSequence,
    status:point.status, bidLevels:point.bids.length, askLevels:point.asks.length,
    executedShares:iexExecutionProfile(data,point).volume,
  }));
  return { symbol, bytes:bytes.length, artifactSha256:createHash("sha256").update(bytes).digest("hex"),
    sourceSha256:data.provenance.sourceSha256, sampleCount:points.length,
    observedSnapshots:points.filter(p=>p.status==="observed").length, samples,
    replayVolume:profile.volume, scalarTradeVolume:directSum, observedTradeBreaks:breaks.length,
    incompleteCorrectionHistory:true, scope:"IEX venue only", mode:"historical", priceScale:data.instrument.priceScale };
});
console.log(JSON.stringify({status:"PRIVATE_ARTIFACT_CONSUMER_PASS",reports},null,2));
