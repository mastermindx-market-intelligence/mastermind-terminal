import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe,it,expect } from "vitest";
import { decodePrivateEvidence } from "../tp1PrivateEvidence";

const here=new URL("./fixtures/",import.meta.url);
function verified(kind:"minute"|"research",name:string){
 const bytes=readFileSync(new URL(name,here));
 return decodePrivateEvidence({kind,bytes,expectedLength:bytes.length,
 expectedSha256:createHash("sha256").update(bytes).digest("hex")});
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
});
