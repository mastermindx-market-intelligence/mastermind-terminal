import {
  INVESTIGATION_MANIFEST_SCHEMA_V2, validateInvestigationManifest,
  type InvestigationAdmission, type InvestigationManifest,
} from "./investigationContracts";

/** These adapters describe the G1 owners actually integrated by this service. */
export const INVESTIGATION_ADMISSION: InvestigationAdmission = {
  subjects: [
    { owner: "terminal.analysis_symbol", kinds: ["security"] },
    { owner: "data_os.security_master", kinds: ["security", "issuer"] },
  ],
  evidence: [{ owner: "earnings.workspace_generation", object_types: ["event_workspace"] }],
};
export type InvestigationCommand = {
  id: string;
  operation_id: string;
  expected_revision: number;
  action: "create" | "revise" | "remove" | "restore";
  manifest: InvestigationManifest;
  layout_capture?: { layout_id: string; expected_revision: number; revision_id: string };
};
export type InvestigationCommitted = {
  status: "committed";
  id: string;
  revision: number;
  lifecycle: "active" | "removed";
  manifest: InvestigationManifest;
  committed_at: string;
};
export type InvestigationFailure = { status: "invalid_payload" | "unauthenticated" | "not_found" | "version_conflict" | "idempotency_conflict" | "invalid_transition" | "reference_unavailable" | "layout_conflict" | "limit_reached" | "unavailable"; current_revision?: number };
export type InvestigationDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export type InvestigationSummary = {id:string;revision:number;lifecycle:"active"|"removed";title:string;question:string;updated_at:string};
export async function listInvestigations(db:InvestigationDb):Promise<{status:"listed";items:InvestigationSummary[]}|InvestigationFailure> {
  try {
    const {data,error}=await db.rpc("list_investigations_v2",{});
    if(error || !record(data) || data.status!=="listed" || !Array.isArray(data.items)
      || !data.items.every(r=>record(r) && isInvestigationId(r.id) && Number.isSafeInteger(r.revision) && Number(r.revision)>0 && (r.lifecycle==="active"||r.lifecycle==="removed") && typeof r.title==="string" && typeof r.question==="string" && typeof r.updated_at==="string")) return {status:"unavailable"};
    return {status:"listed",items:data.items as InvestigationSummary[]};
  } catch {return {status:"unavailable"};}
}
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const isInvestigationId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));

export function parseInvestigationCommand(raw: unknown): InvestigationCommand | null {
  if (!record(raw) || !exact(raw, ["id", "operation_id", "expected_revision", "action", "manifest", "layout_capture"])
      || !isInvestigationId(raw.id) || !isInvestigationId(raw.operation_id)
      || !Number.isSafeInteger(raw.expected_revision) || Number(raw.expected_revision) < 0 || Number(raw.expected_revision) > 2147483646
      || typeof raw.action !== "string" || !["create", "revise", "remove", "restore"].includes(raw.action)) return null;
  const checked = validateInvestigationManifest(raw.manifest, INVESTIGATION_ADMISSION);
  if (!checked.ok || checked.value.schema !== INVESTIGATION_MANIFEST_SCHEMA_V2 || checked.value.thesis_refs.length) return null;
  if (Object.hasOwn(raw, "layout_capture")) {
    const c = raw.layout_capture;
    if (!record(c) || !exact(c, ["layout_id", "expected_revision", "revision_id"])
        || !isInvestigationId(c.layout_id) || !isInvestigationId(c.revision_id)
        || !Number.isSafeInteger(c.expected_revision) || Number(c.expected_revision) < 1 || Number(c.expected_revision) > 999999999
        || checked.value.layout_refs.length !== 0) return null;
  }
  return { ...raw, manifest: checked.value } as InvestigationCommand;
}

export function isInvestigationCommitted(raw: unknown): raw is InvestigationCommitted {
  return record(raw) && raw.status === "committed" && isInvestigationId(raw.id)
    && Number.isSafeInteger(raw.revision) && Number(raw.revision) > 0
    && (raw.lifecycle === "active" || raw.lifecycle === "removed")
    && typeof raw.committed_at === "string" && Number.isFinite(Date.parse(raw.committed_at))
    && record(raw.manifest) && raw.manifest.schema===INVESTIGATION_MANIFEST_SCHEMA_V2
    && validateInvestigationManifest(raw.manifest, INVESTIGATION_ADMISSION).ok;
}
const failureCodes = new Set(["invalid_payload", "unauthenticated", "not_found", "version_conflict", "idempotency_conflict", "invalid_transition", "reference_unavailable", "layout_conflict", "limit_reached"]);
export async function applyInvestigationRevision(db: InvestigationDb, command: InvestigationCommand): Promise<InvestigationCommitted | InvestigationFailure> {
  const valid = parseInvestigationCommand(command);
  if (!valid) return { status: "invalid_payload" };
  try {
    const { data, error } = await db.rpc("apply_investigation_revision_v2", {
      p_id: valid.id, p_expected_revision: valid.expected_revision, p_action: valid.action,
      p_operation_id: valid.operation_id, p_manifest: valid.manifest, p_layout_capture: valid.layout_capture ?? null,
    });
    if (error) return { status: "unavailable" };
    if (isInvestigationCommitted(data) && data.id === valid.id) return data;
    if (record(data) && failureCodes.has(String(data.status))) {
      if (data.status === "version_conflict" && (!Number.isSafeInteger(data.current_revision) || Number(data.current_revision) < 1)) return { status: "unavailable" };
      return data as InvestigationFailure;
    }
    return { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}

/** A receipt miss is explicitly inconclusive after transport uncertainty. Never replace its key. */
export async function readInvestigationOperation(db: InvestigationDb, operationId: string): Promise<InvestigationCommitted | InvestigationFailure> {
  if (!isInvestigationId(operationId)) return { status: "invalid_payload" };
  try {
    const { data, error } = await db.rpc("read_investigation_operation_v2", { p_operation_id: operationId });
    if (error) return { status: "unavailable" };
    if (isInvestigationCommitted(data)) return data;
    return record(data) && data.status === "not_found" ? { status: "not_found" } : { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}

export async function readInvestigation(db: InvestigationDb, id: string, revision: number | null = null): Promise<Record<string, unknown> | InvestigationFailure> {
  if (!isInvestigationId(id) || (revision !== null && (!Number.isSafeInteger(revision) || revision < 1 || revision > 2147483647))) return { status: "invalid_payload" };
  try {
    const { data, error } = await db.rpc("read_investigation_v2", { p_id: id, p_revision: revision });
    if (error) return { status: "unavailable" };
    if (record(data) && data.status === "not_found") return { status: "not_found" };
    if (!record(data) || data.status !== "found" || data.id !== id || !Number.isSafeInteger(data.revision)
      || Number(data.revision)<1 || !Number.isSafeInteger(data.current_revision) || Number(data.current_revision)<Number(data.revision)
      || (data.lifecycle!=="active" && data.lifecycle!=="removed")
      || typeof data.committed_at!=="string" || !Number.isFinite(Date.parse(data.committed_at))
      || (revision !== null && data.revision !== revision) || !Array.isArray(data.layouts)
      || !validateInvestigationManifest(data.manifest, INVESTIGATION_ADMISSION).ok) return { status: "unavailable" };
    return data;
  } catch { return { status: "unavailable" }; }
}
