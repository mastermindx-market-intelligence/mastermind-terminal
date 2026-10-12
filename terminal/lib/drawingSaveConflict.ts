import type { DrawingJournalEntry } from "@/lib/drawingPersistence";
import type { Lang } from "@/lib/i18n";

export type DrawingSaveConflictKind =
  | "revision_conflict"
  | "owner_conflict"
  | "operation_payload_mismatch"
  | "unknown";

export type DrawingSaveConflictAction = {
  kind: DrawingSaveConflictKind;
  offerReplace: boolean;
};

/** Decide recovery chrome from the 409 `code`. Unknown codes fail closed. */
export function classifyDrawingSaveConflict(code: unknown): DrawingSaveConflictAction {
  if (code === "revision_conflict") return { kind: "revision_conflict", offerReplace: true };
  if (code === "operation_payload_mismatch") return { kind: "operation_payload_mismatch", offerReplace: true };
  if (code === "owner_conflict") return { kind: "owner_conflict", offerReplace: false };
  return { kind: "unknown", offerReplace: false };
}

const COPY = {
  owner: [
    "This drawing copy belongs to a different account. It is kept on this device and was not saved to the signed-in account.",
    "这份绘图属于另一个账户。副本已保留在此设备上，并未保存到当前登录账户。",
  ],
  payload: [
    "This save does not match an earlier save of the same request. Your local drawings are kept. Choose which copy to use.",
    "这次保存与先前同一次请求的内容不一致。本地图形已保留。请选择要使用的副本。",
  ],
  unknownPossible: [
    "An earlier save from this device may already be in the cloud.",
    "此设备上更早的一次保存可能已经在云端。",
  ],
  unknown: [
    "This drawing copy could not be saved. It is kept on this device.",
    "这份绘图未能保存。副本已保留在此设备上。",
  ],
  preload: [
    "You drew before your saved drawings finished loading. Choose which copy to keep.",
    "你在已保存图形载入完成前绘制了内容。请选择要保留的副本。",
  ],
} as const;

export function drawingSaveConflictCopy(key: keyof typeof COPY, lang: Lang): string {
  const entry = COPY[key];
  return lang === "zh" ? entry[1] : entry[0];
}

export function drawingSaveIssueFromConflict(
  kind: DrawingSaveConflictKind,
  operationUnknownPossible: boolean,
): string {
  if (kind === "owner_conflict") return "owner_conflict";
  if (kind === "operation_payload_mismatch") return "payload_mismatch";
  if (kind === "unknown") return "save_rejected";
  return operationUnknownPossible ? "conflict_unknown" : "conflict";
}

export function drawingSaveIssueOffersReplace(issue: string): boolean {
  if (issue === "preload") return true;
  return !["retry", "storage", "owner_conflict", "save_rejected"].includes(issue);
}

export function drawingSaveIssueFromEntry(entry: {
  blocked?: string;
  conflictCode?: string;
  operationUnknownPossible?: boolean;
}): string | undefined {
  if (entry.conflictCode) {
    return drawingSaveIssueFromConflict(
      classifyDrawingSaveConflict(entry.conflictCode).kind,
      entry.operationUnknownPossible === true,
    );
  }
  return entry.blocked;
}

export function drawingSaveRecoveryMessage(
  issue: string,
  lang: Lang,
  t: (key: string) => string,
): string {
  if (issue === "owner_conflict") return drawingSaveConflictCopy("owner", lang);
  if (issue === "payload_mismatch") return drawingSaveConflictCopy("payload", lang);
  if (issue === "save_rejected") return drawingSaveConflictCopy("unknown", lang);
  if (issue === "preload") return drawingSaveConflictCopy("preload", lang);
  const base = t(
    issue === "storage" ? "drawingStorageUnavailable" : issue === "retry" ? "drawingSaveRetry" : "drawingSaveConflict",
  );
  if (issue === "conflict_unknown") return `${base} ${drawingSaveConflictCopy("unknownPossible", lang)}`;
  return base;
}

function conflictPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Park the local copy and return the recovery-issue id the shell should show. */
export function applyDrawingSaveConflict(entry: DrawingJournalEntry, payload: unknown): string {
  const raw = conflictPayload(payload);
  const classified = classifyDrawingSaveConflict(raw?.code);
  const unknownPossible = classified.kind === "revision_conflict" && raw?.operationUnknownPossible === true;
  entry.blocked = "conflict";
  if (classified.kind !== "unknown") entry.conflictCode = classified.kind;
  if (unknownPossible) entry.operationUnknownPossible = true;
  return drawingSaveIssueFromConflict(classified.kind, unknownPossible);
}
