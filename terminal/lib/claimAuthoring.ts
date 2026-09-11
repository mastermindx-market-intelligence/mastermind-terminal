// Pure claim-authoring helpers (B-F13-6). No I/O, no fetch, no Supabase.
// The closed owner list names the future B-F13-7 resolver; it does not resolve.

import { createHash } from "node:crypto";
import { normalizeAnalysisSymbol } from "@/lib/analysisSymbol";
import { CLAIM_OWNER_LAST_CLOSE } from "./claimOwners";

export { CLAIM_OWNER_LAST_CLOSE } from "./claimOwners";

export const CLAIM_OWNERS = [
  {
    owner: CLAIM_OWNER_LAST_CLOSE.owner,
    metric: CLAIM_OWNER_LAST_CLOSE.metric,
    labelEn: "Closing price",
    labelZh: "收盘价",
  },
] as const;

export const CLAIM_COMPARATORS = [">=", "<=", ">", "<"] as const;
export type ClaimComparator = (typeof CLAIM_COMPARATORS)[number];

export const CLAIM_COMPARATOR_WORDS: Record<"en" | "zh", Record<ClaimComparator, string>> = {
  en: { ">=": "at or above", "<=": "at or below", ">": "above", "<": "below" },
  zh: { ">=": "大于等于", "<=": "小于等于", ">": "大于", "<": "小于" },
};

export const CLAIM_TEXT_MAX = 280;
export const THRESHOLD_MAX = 1_000_000;
export const RESOLVES_AT_MIN_DAYS = 1;
export const RESOLVES_AT_MAX_DAYS = 730;

export const CLAIM_RESPONSE_KEYS = [
  "claim_id",
  "subject",
  "condition",
  "resolves_at",
  "claim_text",
  "stated_probability",
  "status",
  "created_at",
] as const;

export const CLAIM_NOT_RECORDED_MESSAGE: [string, string] = [
  "We could not save this call, so we are not going to pretend we did. Nothing was saved. Try again.",
  "我们无法保存这条判断，因此不会假装已经保存。未保存任何内容，请重试。",
];

export type ClaimAuthoringError =
  | "invalid_symbol"
  | "invalid_owner"
  | "invalid_comparator"
  | "invalid_threshold"
  | "invalid_resolves_at"
  | "invalid_probability"
  | "claim_text_too_long"
  | "claim_text_empty";

export type ClaimSubject = { kind: "security"; id: string };
export type ClaimCondition = {
  metric: "close";
  comparator: ClaimComparator;
  threshold: number;
  owner: (typeof CLAIM_OWNERS)[number]["owner"];
};

export type ValidatedClaimFields = {
  subject: ClaimSubject;
  condition: ClaimCondition;
  resolves_at: string;
  claim_text: string;
  evidence: [];
  stated_probability?: number;
};

export type ClaimInsertRow = {
  claim_id: string;
  user_id: string;
  subject: ClaimSubject;
  stated_at: string;
  resolves_at: string;
  claim_text: string;
  condition: ClaimCondition;
  stated_probability: number | null;
  evidence: [];
  status: "open";
  resolution: null;
};

const COMPARATOR_SET: ReadonlySet<string> = new Set(CLAIM_COMPARATORS);
const OWNER_BY_PATH = new Map(CLAIM_OWNERS.map((row) => [row.owner, row]));

export function addUtcDays(now: Date, days: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

export function resolvesAtBounds(now = new Date()): { min: string; max: string } {
  return { min: addUtcDays(now, RESOLVES_AT_MIN_DAYS), max: addUtcDays(now, RESOLVES_AT_MAX_DAYS) };
}

export function toResolvesAtIso(ymd: string): string {
  return `${ymd}T23:59:59.999Z`;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]00:00)$/;

function utcYmd(value: string): string | null {
  if (YMD.test(value)) return value;
  if (!ISO_UTC_INSTANT.test(value)) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function formatThreshold(threshold: number): string {
  return String(threshold);
}

export function composeClaimText(args: {
  symbol: string;
  comparator: ClaimComparator;
  threshold: number;
  date: string;
  note?: string;
  lang: "en" | "zh";
}): string {
  const words = CLAIM_COMPARATOR_WORDS[args.lang][args.comparator];
  const level = formatThreshold(args.threshold);
  const base = args.lang === "zh"
    ? `${args.symbol} 在 ${args.date} 的收盘价${words}${level}。`
    : `${args.symbol} closing price ${words} ${level} on ${args.date}.`;
  const note = typeof args.note === "string" ? args.note.trim() : "";
  return note ? `${base} ${note}` : base;
}

export function clientClaimPayload(input: {
  symbol: string;
  owner: string;
  comparator: ClaimComparator;
  threshold: number;
  resolvesAtDate: string;
  probabilityOptIn: boolean;
  probabilityPercent: number;
  note: string;
  lang: "en" | "zh";
}): Record<string, unknown> {
  const ownerRow = OWNER_BY_PATH.get(input.owner as ClaimCondition["owner"]);
  const payload: Record<string, unknown> = {
    subject: { kind: "security", id: input.symbol },
    condition: {
      metric: ownerRow?.metric ?? CLAIM_OWNER_LAST_CLOSE.metric,
      comparator: input.comparator,
      threshold: input.threshold,
      owner: input.owner,
    },
    resolves_at: toResolvesAtIso(input.resolvesAtDate),
    claim_text: composeClaimText({
      symbol: input.symbol,
      comparator: input.comparator,
      threshold: input.threshold,
      date: input.resolvesAtDate,
      note: input.note,
      lang: input.lang,
    }),
    evidence: [],
  };
  if (input.probabilityOptIn) {
    payload.stated_probability = input.probabilityPercent / 100;
  }
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function validateClaimInput(
  body: Record<string, unknown>,
  now = new Date(),
): { ok: true; fields: ValidatedClaimFields } | { ok: false; error: ClaimAuthoringError } {
  const subjectRaw = asRecord(body.subject);
  const symbol = normalizeAnalysisSymbol(
    typeof subjectRaw?.id === "string" ? subjectRaw.id : undefined,
  );
  if (!symbol || subjectRaw?.kind !== "security") {
    return { ok: false, error: "invalid_symbol" };
  }

  const conditionRaw = asRecord(body.condition);
  const owner = typeof conditionRaw?.owner === "string" ? conditionRaw.owner : "";
  const ownerRow = OWNER_BY_PATH.get(owner as ClaimCondition["owner"]);
  if (!ownerRow) return { ok: false, error: "invalid_owner" };

  const comparator = conditionRaw?.comparator;
  if (typeof comparator !== "string" || !COMPARATOR_SET.has(comparator)) {
    return { ok: false, error: "invalid_comparator" };
  }

  const thresholdNum = typeof conditionRaw?.threshold === "number"
    ? conditionRaw.threshold
    : typeof conditionRaw?.threshold === "string"
      ? Number(conditionRaw.threshold)
      : NaN;
  if (!Number.isFinite(thresholdNum) || thresholdNum <= 0 || thresholdNum > THRESHOLD_MAX) {
    return { ok: false, error: "invalid_threshold" };
  }

  const resolvesRaw = typeof body.resolves_at === "string" ? body.resolves_at : "";
  const ymd = utcYmd(resolvesRaw);
  const bounds = resolvesAtBounds(now);
  if (!ymd || ymd < bounds.min || ymd > bounds.max) {
    return { ok: false, error: "invalid_resolves_at" };
  }
  const resolves_at = YMD.test(resolvesRaw) ? toResolvesAtIso(resolvesRaw) : resolvesRaw;

  if ("stated_probability" in body) {
    const p = body.stated_probability;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
      return { ok: false, error: "invalid_probability" };
    }
  }

  const claim_text = typeof body.claim_text === "string" ? body.claim_text : "";
  if (claim_text.length > CLAIM_TEXT_MAX) return { ok: false, error: "claim_text_too_long" };
  if (claim_text.length < 1) return { ok: false, error: "claim_text_empty" };

  const fields: ValidatedClaimFields = {
    subject: { kind: "security", id: symbol },
    condition: {
      metric: ownerRow.metric,
      comparator: comparator as ClaimComparator,
      threshold: thresholdNum,
      owner: ownerRow.owner,
    },
    resolves_at,
    claim_text,
    evidence: [],
  };
  if ("stated_probability" in body && typeof body.stated_probability === "number") {
    fields.stated_probability = body.stated_probability;
  }
  return { ok: true, fields };
}

export function hashClaimId(
  userId: string,
  subject: ClaimSubject,
  condition: ClaimCondition,
  statedAt: string,
  resolvesAt: string,
): string {
  const material = JSON.stringify([userId, subject, condition, statedAt, resolvesAt]);
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export function buildInsertRow(
  clientBody: Record<string, unknown>,
  userId: string,
  statedAt: string,
  now = new Date(),
): { ok: true; row: ClaimInsertRow } | { ok: false; error: ClaimAuthoringError } {
  const validated = validateClaimInput(clientBody, now);
  if (!validated.ok) return validated;
  const { fields } = validated;
  return {
    ok: true,
    row: {
      claim_id: hashClaimId(userId, fields.subject, fields.condition, statedAt, fields.resolves_at),
      user_id: userId,
      subject: fields.subject,
      stated_at: statedAt,
      resolves_at: fields.resolves_at,
      claim_text: fields.claim_text,
      condition: fields.condition,
      stated_probability: fields.stated_probability ?? null,
      evidence: [],
      status: "open",
      resolution: null,
    },
  };
}
