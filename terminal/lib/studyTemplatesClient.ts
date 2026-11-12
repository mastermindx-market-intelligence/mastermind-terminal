"use client";
// E07 — typed browser client for /api/study-templates. Every outcome the route can give has its
// own branch: a network failure or an unexpected answer is `unavailable`, never an empty library
// and never a saved template.
import type { StudyTemplateBody } from "@/lib/studyTemplateSchema";
import type { AccountStudyTemplate } from "@/lib/studyTemplateStore";

export type { AccountStudyTemplate };

const URL_PATH = "/api/study-templates";

export type AccountTemplatesList =
  | { status: "ok"; templates: AccountStudyTemplate[]; unreadable: number; truncated: boolean }
  | { status: "signed_out" }
  | { status: "unavailable" };

export type AccountTemplateWriteError =
  | "signed_out"
  | "unavailable"
  | "invalid_name"
  | "name_too_long"
  | "empty"
  | "too_many_studies"
  | "too_large"
  | "invalid_body"
  | "invalid_id"
  | "limit_reached"
  | "not_found"
  | "name_taken"
  | "conflict"
  | "newer_version";

export type AccountTemplateWrite =
  | { ok: true; template: AccountStudyTemplate }
  | { ok: false; error: AccountTemplateWriteError; existing?: AccountStudyTemplate; current?: AccountStudyTemplate };

const KNOWN_ERRORS = new Set<AccountTemplateWriteError>([
  "invalid_name", "name_too_long", "empty", "too_many_studies", "too_large", "invalid_body", "invalid_id",
  "limit_reached", "not_found", "name_taken", "conflict", "newer_version",
]);

const isTemplate = (value: unknown): value is AccountStudyTemplate =>
  !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
  && Array.isArray((value as { indicators?: unknown }).indicators)
  && typeof (value as { revision?: unknown }).revision === "number";

export async function fetchAccountTemplates(signal?: AbortSignal): Promise<AccountTemplatesList> {
  try {
    const response = await fetch(URL_PATH, { cache: "no-store", credentials: "same-origin", signal });
    if (response.status === 401) return { status: "signed_out" };
    if (!response.ok) return { status: "unavailable" };
    const payload = await response.json() as { templates?: unknown; unreadable?: unknown; truncated?: unknown };
    if (!Array.isArray(payload.templates) || !payload.templates.every(isTemplate)) return { status: "unavailable" };
    return {
      status: "ok",
      templates: payload.templates,
      unreadable: typeof payload.unreadable === "number" ? payload.unreadable : 0,
      truncated: payload.truncated === true,
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function send(payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetch(URL_PATH, {
    method: "PUT",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await response.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function writeOutcome(status: number, body: Record<string, unknown> | null): AccountTemplateWrite {
  if ((status === 200 || status === 201) && isTemplate(body?.template)) return { ok: true, template: body!.template as AccountStudyTemplate };
  if (status === 401) return { ok: false, error: "signed_out" };
  const error = body?.error;
  if (typeof error === "string" && KNOWN_ERRORS.has(error as AccountTemplateWriteError)) {
    return {
      ok: false,
      error: error as AccountTemplateWriteError,
      ...(isTemplate(body?.existing) ? { existing: body!.existing as AccountStudyTemplate } : {}),
      ...(isTemplate(body?.current) ? { current: body!.current as AccountStudyTemplate } : {}),
    };
  }
  return { ok: false, error: "unavailable" };
}

export async function createAccountTemplate(name: string, body: StudyTemplateBody): Promise<AccountTemplateWrite> {
  try {
    const answer = await send({ action: "create", name, body });
    return writeOutcome(answer.status, answer.body);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function updateAccountTemplate(
  id: string,
  baseRevision: number,
  change: { name?: string; body?: StudyTemplateBody },
): Promise<AccountTemplateWrite> {
  try {
    const answer = await send({ action: "update", id, baseRevision, ...change });
    return writeOutcome(answer.status, answer.body);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function deleteAccountTemplate(
  id: string,
  baseRevision: number,
): Promise<{ ok: true } | { ok: false; error: AccountTemplateWriteError; current?: AccountStudyTemplate }> {
  try {
    const answer = await send({ action: "delete", id, baseRevision });
    if (answer.status === 200 && answer.body?.ok === true) return { ok: true };
    const outcome = writeOutcome(answer.status, answer.body);
    return outcome.ok ? { ok: false, error: "unavailable" } : outcome;
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
