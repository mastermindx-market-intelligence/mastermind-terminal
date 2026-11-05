import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe,it,expect } from "vitest";
import { decodePrivateEvidence, pairPrivateEvidence } from "../tp1PrivateEvidence";

const here=new URL("./fixtures/",import.meta.url);
const IMMUTABLE_PYTHON_FIXTURES = {
 minute: {sha256:"71bed6bb49ffce62735cc50c9f16a181d69b80393e6737f7899b911985f7f2c8", bytes:2362},
 research: {sha256:"47fb5af5e6e7fb8b30c594725363d8d84d787e1879a8916362aa0b81016e9ad2", bytes:2219},
} as const;
function verified(kind:"minute"|"research",name:string){
 const bytes=readFileSync(new URL(name,here));
 const expected=IMMUTABLE_PYTHON_FIXTURES[kind];
 expect(bytes.length).toBe(expected.bytes);
 expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);
 return decodePrivateEvidence({kind,bytes,expectedLength:expected.bytes,
   expectedSha256:expected.sha256});
}
describe("actual Macro Python-generated synthetic-v0 private artifacts",()=>{
 it("preserves source native ns, original hash and private-only state",()=>{
  const m=verified("minute","tp1PrivateMinute.synthetic.v0.json");
  const r=verified("research","tp1PrivateResearch.synthetic.v0.json");
  expect(m.clocksNs.start_ns).toBe(r.clocksNs.start_ns);
  expect(m.clocksNs.decision_ns).toBe(r.clocksNs.decision_ns);
  expect(m.sourceHashes.source_manifest_sha256).toBe(r.sourceHashes.source_manifest_sha256);
  expect(m.sourceHashes.source_watermark_receipt_sha256).toBe(r.sourceHashes.source_watermark_receipt_sha256);
  expect(m.sourceHashes.quote_policy_sha256).toBe(r.sourceHashes.source_quote_condition_rules_sha256);
  expect(m.notionalUsd.buy_proxy_notional_usd).toBe("1009.0");
  expect(r.notionalUsd.sell_proxy_notional_usd).toBe("1001.0");
  expect(r.quoteRecovery?.ask.state).toBe("MEASURED_NBBO_SIZE_PROXY_NOT_ORDER_REPLENISHMENT");
  expect(m.publicDeliveryAllowed).toBe(false);
  expect(r.publicDeliveryAllowed).toBe(false);
  expect(m.sourceAuthenticated).toBe(false);
 });
 it("also pairs actual Python serializer outputs under their exact source hashes",()=>{
  const m=verified("minute","tp1PrivateMinute.synthetic.v0.json");
  const r=verified("research","tp1PrivateResearch.synthetic.v0.json");
  const p=pairPrivateEvidence(m,r);
  expect(p.pairingState).toBe("PRIVATE_COMPATIBLE_ORIGINAL_SOURCE_UNPROVEN");
  expect(p.pairedArtifactsSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(p.sourceManifestSha256).toBe("e".repeat(64));
  expect(p.sourceAuthenticated).toBe(false);
 });
  it("preserves null-policy and unknown-reason evidence from the original Python emitter",()=>{
  const bytes=readFileSync(new URL("tp1PrivateUnknown.synthetic.v0.json",here));
  const digest="02e0bab2885af1a46e399aa1b9474486c1a650a61c3927a2726d702baa6406bf";
  expect(bytes.length).toBe(2210);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
  const m=decodePrivateEvidence({kind:"minute",bytes,expectedLength:2210,expectedSha256:digest});
  expect(m.unknownReasons).toEqual({TRADE_CONDITION_POLICY_UNQUALIFIED:1});
  expect(m.sourceCounts.n_unclassified).toBe(1);
  expect(m.sourceHashes.condition_policy_sha256).toBeNull();
  expect(m.sourceHashes.exchange_policy_sha256).toBeNull();
  expect(m.sourceHashes.quote_policy_sha256).toBeNull();
  expect(m.publicDeliveryAllowed).toBe(false);
 });
 it("preserves Python-derived 100 fractional digits without changing native receipts",()=>{
  const bytes=readFileSync(new URL("tp1PrivateHighPrecision.synthetic.v0.json",here));
  const digest="c2a0d860787e1967815635a8ceda2ecd47f9c3dad6bd2a7df9f4ba9fa0552372";
  expect(bytes.length).toBe(2390);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
  const r=decodePrivateEvidence({
    kind:"research",bytes,expectedLength:2390,expectedSha256:digest,
  });
  const expected="0."+"0".repeat(99)+"1";
  expect(r.completedWindowResponseBps).toBe(expected);
  expect(r.pressureBalance).toBe(expected);
  expect(r.sourceHashes.source_manifest_sha256).toBe("e".repeat(64));
  expect(r.productionApproved).toBe(false);
  expect(r.publicDeliveryAllowed).toBe(false);
 });

});
