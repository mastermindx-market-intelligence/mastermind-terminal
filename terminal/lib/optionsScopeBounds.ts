import { dteRaw, isoSession } from "@/lib/dte";

/** Machine-readable reasons a strike or days-to-expiry bound cannot be applied. */
export type BoundsIssue = "from_missing" | "to_missing" | "from_not_number" | "to_not_number" | "not_positive"
  | "inverted" | "dte_not_whole" | "dte_negative" | "dte_inverted" | "session_invalid" | "no_strikes" | "no_expiries";

export interface ScopeBoundsInput {
  from: string;
  to: string;
  dteMin: string;
  dteMax: string;
}

export interface ScopeBounds {
  from: number;
  to: number;
  dteMin: number;
  dteMax: number | null;
}

type StrikeParse =
  | { kind: "missing" }
  | { kind: "not_number" }
  | { kind: "not_positive" }
  | { kind: "ok"; value: number };

type DteParse =
  | { kind: "not_whole" }
  | { kind: "negative" }
  | { kind: "ok"; value: number | null };

const STRIKE_TEXT = /^\d+(\.\d+)?$/;
const DTE_TEXT = /^-?\d+$/;

function parseStrike(text: string): StrikeParse {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "missing" };
  if (!STRIKE_TEXT.test(trimmed)) return { kind: "not_number" };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { kind: "not_number" };
  if (value <= 0) return { kind: "not_positive" };
  return { kind: "ok", value };
}

function parseDte(text: string, empty: number | null): DteParse {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "ok", value: empty };
  if (!DTE_TEXT.test(trimmed)) return { kind: "not_whole" };
  const value = Number(trimmed);
  if (!Number.isInteger(value)) return { kind: "not_whole" };
  if (value < 0) return { kind: "negative" };
  return { kind: "ok", value: value === 0 ? 0 : value };
}

/**
 * Validate exact strike bounds and a days-to-expiry range against the source session.
 * Issue codes stay in declaration order. An expiry before that session is never selected.
 * The session and every expiry must be a real calendar date before any expiry is selected.
 */
export function parseScopeBounds(
  input: ScopeBoundsInput,
  ctx: { session: string; strikes: readonly number[]; expiries: readonly string[] },
): { ok: true; value: ScopeBounds; strikes: number[]; expiries: string[] } | { ok: false; issues: BoundsIssue[] } {
  const from = parseStrike(input.from);
  const to = parseStrike(input.to);
  const dteMin = parseDte(input.dteMin, 0);
  const dteMax = parseDte(input.dteMax, null);
  const issues: BoundsIssue[] = [];
  if (from.kind === "missing") issues.push("from_missing");
  if (to.kind === "missing") issues.push("to_missing");
  if (from.kind === "not_number") issues.push("from_not_number");
  if (to.kind === "not_number") issues.push("to_not_number");
  if (from.kind === "not_positive" || to.kind === "not_positive") issues.push("not_positive");
  if (from.kind === "ok" && to.kind === "ok" && from.value > to.value) issues.push("inverted");
  if (dteMin.kind === "not_whole" || dteMax.kind === "not_whole") issues.push("dte_not_whole");
  if (dteMin.kind === "negative" || dteMax.kind === "negative") issues.push("dte_negative");
  if (
    dteMin.kind === "ok" && dteMax.kind === "ok"
    && dteMin.value !== null && dteMax.value !== null && dteMin.value > dteMax.value
  ) issues.push("dte_inverted");
  if (issues.length > 0 || from.kind !== "ok" || to.kind !== "ok" || dteMin.kind !== "ok" || dteMax.kind !== "ok") {
    return { ok: false, issues };
  }
  const session = isoSession(ctx.session);
  if (session === null) return { ok: false, issues: ["session_invalid"] };
  const minDte = dteMin.value ?? 0;
  const maxDte = dteMax.value;
  const strikes = ctx.strikes.filter((strike) => strike >= from.value && strike <= to.value).sort((a, b) => b - a);
  const expiries = ctx.expiries.filter((exp) => {
    const expiry = isoSession(exp);
    if (expiry === null) return false;
    const days = dteRaw(expiry, session);
    if (days < 0 || days < minDte) return false;
    return maxDte === null || days <= maxDte;
  }).sort((a, b) => dteRaw(a, session) - dteRaw(b, session) || (a < b ? -1 : a > b ? 1 : 0));
  if (strikes.length === 0) issues.push("no_strikes");
  if (expiries.length === 0) issues.push("no_expiries");
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { from: from.value, to: to.value, dteMin: minDte, dteMax: maxDte }, strikes, expiries };
}
