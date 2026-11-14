import {createHash} from "node:crypto";
import aaplWorkspace from "../../lib/__tests__/fixtures/aapl-event-workspace.json";

/** The incumbent AAPL specimen, wrapped in a synthetic retained-owner response.
 * These receipts exercise the real reader validation; they assert no live rights.
 */
export function retainedCompanyResearchFixture() {
 const workspace=structuredClone(aaplWorkspace);
 const bytes=Buffer.from(JSON.stringify(workspace));
 const sha256=createHash("sha256").update(bytes).digest("hex");
 const manifest=JSON.stringify({event_id:workspace.event_id,generation_id:workspace.generation_id,workspace_sha256:sha256});
 const receipt={
  schema:"earnings.retained_baseline.v1",owner:"earnings.workspace_generation",
  company_id:workspace.issuer.company_id,event_id:workspace.event_id,generation_id:workspace.generation_id,
  workspace_schema:"event_workspace.v1",manifest_schema:"event_workspace_manifest.v1",authority:"context_only",
  manifest_sha256:createHash("sha256").update(manifest).digest("hex"),manifest_bytes:Buffer.byteLength(manifest),
  workspace_sha256:sha256,workspace_bytes:bytes.length,
  fingerprint:createHash("sha256").update("synthetic-retained-fixture:"+sha256).digest("hex"),
  public_known_at:workspace.generated_at,platform_known_at:null,generation_emitted_at:workspace.generated_at,
  rights:{allowed:true,policy_version:"fixture-retained-context.v1",checked_at:workspace.generated_at},
 };
 return {ok:true,workspace,receipt,reference:{event_id:receipt.event_id,generation_id:receipt.generation_id,
  company_id:receipt.company_id,fingerprint:receipt.fingerprint}};
}
