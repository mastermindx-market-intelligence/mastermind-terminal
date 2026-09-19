// B-F11-5 / MO-PAID-054 — propose-only thesis amendment proposals.
// Validation and copy live here so the route handlers stay a thin BFF over the
// caller's Supabase session (same pattern as terminal/app/api/theses/route.ts).

import { isUuid } from "@/lib/theses";

export const PROPOSAL_STATES = ["proposed", "accepted", "rejected", "superseded"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];
export const PATCHABLE_STATES = ["accepted", "rejected"] as const;
export type PatchableState = (typeof PATCHABLE_STATES)[number];

export const MAX_PROPOSAL_BODY = 12_000;
export const MAX_EVIDENCE_REFS = 20;

/**
 * Closed JSON key set for a K1 EvidenceRef pointer
 * (FABLE_A_K1_EVIDENCE_FOUNDATION… §6). Anything else is treated as a copied
 * fact payload and refused.
 */
export const K1_POINTER_KEYS = [
  "owner",
  "native_id",
  "schema",
  "object_class",
  "subject_key",
  "subject_key_type",
  "clock",
  "digest",
  "coverage",
  "correction_state",
  "authority_class",
  "rights_state",
] as const;

export const JUDGEMENT_KEYS = [
  "conviction",
  "confidence",
  "probability",
  "rank",
  "size",
  "target",
  "score",
] as const;

export const MESSAGES = {
  missingAmendedFrom: [
    "We couldn't save this suggestion because it doesn't say which version of your thesis it read.",
    "我们无法保存这条建议，因为它没有说明所依据的是你论点的哪个版本。",
  ],
  payloadCopy: [
    "We couldn't save this suggestion because it copies source material instead of pointing to it.",
    "我们无法保存这条建议，因为它复制了原始材料，而不是指向它。",
  ],
  judgement: [
    "We couldn't save this suggestion because it includes a score or ranking. Suggestions can only describe a change in words.",
    "我们无法保存这条建议，因为它包含评分或排序。建议只能用文字描述一项更改。",
  ],
  emptyBody: [
    "We couldn't save this suggestion because it has no text.",
    "我们无法保存这条建议，因为它没有文字。",
  ],
  invalidState: [
    "We couldn't update this suggestion because that change isn't allowed.",
    "我们无法更新这条建议，因为不允许这样的更改。",
  ],
  sendJson: [
    "We couldn't read this request. Please try again.",
    "我们无法读取这个请求，请重试。",
  ],
} as const;

export type ProposalRow = {
  proposalId: string;
  thesisId: string;
  amendedFrom: string;
  body: string;
  evidenceRefs: unknown[];
  proposedBy: "assistant";
  state: ProposalState;
  createdAt: string;
  versionNumber: number | null;
  versionRecordedAt: string | null;
};

export function isProposalState(value: unknown): value is ProposalState {
  return typeof value === "string" && (PROPOSAL_STATES as readonly string[]).includes(value);
}

export function isPatchableState(value: unknown): value is PatchableState {
  return value === "accepted" || value === "rejected";
}

export function proposalStateLabel(state: ProposalState, lang: "en" | "zh"): string {
  const zh = lang === "zh";
  if (state === "proposed") return zh ? "已建议" : "Suggested";
  if (state === "accepted") return zh ? "已接受" : "Accepted";
  if (state === "rejected") return zh ? "已拒绝" : "Declined";
  return zh ? "已被之后的选择替代" : "Replaced by a later choice";
}

export function basedOnVersionSentence(
  versionNumber: number | null,
  recordedAt: string | null,
  lang: "en" | "zh",
): string {
  // Q2 (Round-1 heal): when the version row cannot be resolved (the FK on amended_from
  // usually prevents this, but we still want an honest sentence), never invent a
  // "version 0" — say plainly that the version is gone.
  if (versionNumber === null || versionNumber === undefined) {
    return lang === "zh"
      ? "依据这条论点的一个我们已找不到的版本。"
      : "Based on a version of this thesis we couldn't find any more.";
  }
  const date = recordedAt
    ? new Date(recordedAt).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-CA")
    : lang === "zh" ? "未知日期" : "an unknown date";
  // Q3 (Round-1 heal): ZH uses the ordinal 第 so it reads as a normal Chinese sentence.
  if (lang === "zh") return `依据第 ${versionNumber} 版，日期为 ${date}`;
  return `Based on version ${versionNumber} from ${date}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function collectKeys(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    into.push(key);
    collectKeys(nested, into);
  }
}

export function findJudgementKey(value: unknown): string | null {
  const keys: string[] = [];
  collectKeys(value, keys);
  const banned = new Set<string>(JUDGEMENT_KEYS);
  for (const key of keys) {
    if (banned.has(key.toLowerCase())) return key.toLowerCase();
  }
  return null;
}

export function evidenceRefsError(value: unknown): "payload" | "judgement" | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "payload";
  if (value.length > MAX_EVIDENCE_REFS) return "payload";
  const pointer = new Set<string>(K1_POINTER_KEYS);
  for (const entry of value) {
    if (!isPlainObject(entry)) return "payload";
    const judgement = findJudgementKey(entry);
    if (judgement) return "judgement";
    for (const key of Object.keys(entry)) {
      if (!pointer.has(key)) return "payload";
    }
    for (const nested of Object.values(entry)) {
      if (nested !== null && typeof nested === "object") return "payload";
    }
  }
  return findJudgementKey(value) ? "judgement" : null;
}

export function normalizeBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n").replace(/^ +| +$/g, "");
  if (!body || body.length > MAX_PROPOSAL_BODY) return null;
  if (!/[^\s]/.test(body)) return null;
  return body;
}

export function amendedFromValue(value: unknown): string | null {
  if (!isUuid(value)) return null;
  return value.toLowerCase();
}

export function mapProposalRow(
  row: Record<string, unknown>,
  version?: { version: number; system_recorded_at: string } | null,
): ProposalRow | null {
  const proposalId = typeof row.proposal_id === "string" ? row.proposal_id : null;
  const thesisId = typeof row.thesis_id === "string" ? row.thesis_id : null;
  const amendedFrom = typeof row.amended_from === "string" ? row.amended_from : null;
  const body = typeof row.body === "string" ? row.body : null;
  const state = row.state;
  const createdAt = typeof row.created_at === "string" ? row.created_at : null;
  if (!proposalId || !thesisId || !amendedFrom || !body || !isProposalState(state) || !createdAt) {
    return null;
  }
  return {
    proposalId,
    thesisId,
    amendedFrom,
    body,
    evidenceRefs: Array.isArray(row.evidence_refs) ? row.evidence_refs : [],
    proposedBy: "assistant",
    state,
    createdAt,
    versionNumber: version?.version ?? (typeof row.version === "number" ? row.version : null),
    versionRecordedAt: version?.system_recorded_at
      ?? (typeof row.system_recorded_at === "string" ? row.system_recorded_at : null),
  };
}

export type FixtureProposal = {
  proposal_id: string;
  thesis_id: string;
  amended_from: string;
  body: string;
  evidence_refs: unknown[];
  proposed_by: "assistant";
  state: ProposalState;
  created_at: string;
  user_id: string;
};

const FIXTURE_KEY = Symbol.for("mm.e2e.thesisAmendmentProposals");
type FixtureGlobal = typeof globalThis & { [FIXTURE_KEY]?: Map<string, FixtureProposal[]> };

function fixtureMap(): Map<string, FixtureProposal[]> {
  const g = globalThis as FixtureGlobal;
  return (g[FIXTURE_KEY] ??= new Map());
}

export function fixtureProposals(storeKey: string): FixtureProposal[] {
  const map = fixtureMap();
  const rows = map.get(storeKey) ?? [];
  if (!map.has(storeKey)) map.set(storeKey, rows);
  return rows;
}

export function resetFixtureProposals(): void {
  fixtureMap().clear();
}

export function applyFixtureState(
  rows: FixtureProposal[],
  proposalId: string,
  userId: string,
  newState: PatchableState,
): { status: "ok" | "not_found" | "invalid_transition"; row?: FixtureProposal } {
  const row = rows.find((item) => item.proposal_id === proposalId && item.user_id === userId);
  if (!row) return { status: "not_found" };
  if (row.state !== "proposed") return { status: "invalid_transition" };
  if (newState === "accepted") {
    for (const other of rows) {
      if (
        other.proposal_id !== proposalId
        && other.thesis_id === row.thesis_id
        && other.amended_from === row.amended_from
        && other.state === "proposed"
      ) {
        other.state = "superseded";
      }
    }
  }
  row.state = newState;
  return { status: "ok", row };
}
