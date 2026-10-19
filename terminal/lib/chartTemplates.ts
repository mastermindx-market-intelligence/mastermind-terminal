"use client";
// Study templates kept on THIS DEVICE (`localStorage["mm.chartTemplates"]`), plus the menu list the
// chart's right-click "Chart templates" group reads.
//
// The key is the pre-E07 store, read in place: a v1 record `{id,name,indicators,indParams,createdAt}`
// is still listed and applied (its params pruned to its own studies, see studyTemplateSchema.ts).
// Records written here are v2, a strict superset an older build still reads.
//
// Ownership (AC-E07-04): a device template belongs to this browser profile, exactly as before. It
// is never uploaded to an account on its own — only an explicit "Copy to account" does that, and
// that copy is a NEW account record; the device record stays where it was.
//
// Truthfulness (AC-E07-06): every write reads its bytes back before it answers `ok`. A store that
// cannot be read (blocked storage, corrupt JSON) is reported `unavailable` and is NEVER overwritten,
// so a parse failure can never turn into an empty list that the next save writes over. Entries this
// build cannot read are kept verbatim in place.
import {
  STUDY_TEMPLATE_LIMITS,
  buildStudyTemplateRecord,
  normalizeStudyTemplateRecord,
  normalizeTemplateName,
  sameTemplateName,
  templateNameProblem,
  validateStudyTemplateWrite,
  type StudyTemplateBody,
  type StudyTemplateRecord,
  type StudyTemplateWriteProblem,
} from "@/lib/studyTemplateSchema";

export const DEVICE_TEMPLATES_KEY = "mm.chartTemplates";

export type DeviceStudyTemplate = StudyTemplateRecord & { newer: boolean };

export type DeviceTemplatesRead =
  | { status: "ok"; templates: DeviceStudyTemplate[]; unreadable: number }
  | { status: "unavailable"; reason: "storage_blocked" | "unreadable" };

export type DeviceTemplateError =
  | StudyTemplateWriteProblem
  | "storage_blocked"
  | "unreadable"
  | "write_failed"
  | "limit_reached"
  | "name_taken"
  | "newer_version"
  | "not_found";

export type DeviceTemplateWrite =
  | { ok: true; record: DeviceStudyTemplate }
  | { ok: false; error: DeviceTemplateError; existingId?: string };

type RawRead = { ok: true; entries: unknown[] } | { ok: false; reason: "storage_blocked" | "unreadable" };

function readRaw(): RawRead {
  let text: string | null;
  try {
    text = window.localStorage.getItem(DEVICE_TEMPLATES_KEY);
  } catch {
    return { ok: false, reason: "storage_blocked" };
  }
  if (text === null) return { ok: true, entries: [] };
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? { ok: true, entries: parsed } : { ok: false, reason: "unreadable" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Write and read back. `false` unless the exact bytes are now stored. */
function writeRaw(entries: unknown[]): boolean {
  const serialized = JSON.stringify(entries);
  try {
    window.localStorage.setItem(DEVICE_TEMPLATES_KEY, serialized);
    return window.localStorage.getItem(DEVICE_TEMPLATES_KEY) === serialized;
  } catch {
    return false;
  }
}

function parseEntry(entry: unknown): DeviceStudyTemplate | null {
  const read = normalizeStudyTemplateRecord(entry, { scope: "device" });
  return read ? { ...read.record, newer: read.newer } : null;
}

export function readDeviceTemplates(): DeviceTemplatesRead {
  const raw = readRaw();
  if (!raw.ok) return { status: "unavailable", reason: raw.reason };
  const templates: DeviceStudyTemplate[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  for (const entry of raw.entries) {
    const template = parseEntry(entry);
    // A duplicated id cannot be addressed safely; the first one wins and the rest are counted.
    if (!template || seen.has(template.id)) {
      unreadable += 1;
      continue;
    }
    seen.add(template.id);
    templates.push(template);
  }
  return { status: "ok", templates, unreadable };
}

const mintDeviceId = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "ct_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** Index of the entry carrying this id, among READABLE entries only. */
function indexOfId(entries: unknown[], id: string): number {
  return entries.findIndex((entry) => parseEntry(entry)?.id === id);
}

function finish(entries: unknown[], record: DeviceStudyTemplate): DeviceTemplateWrite {
  return writeRaw(entries) ? { ok: true, record } : { ok: false, error: "write_failed" };
}

/**
 * Save the current studies as a device template. With `overwriteId`, replace that template's
 * studies (keeping its id and creation time, bumping its revision); otherwise a name already in
 * use answers `name_taken` with its id so the caller can offer to replace it.
 */
export function saveDeviceTemplate(
  name: unknown,
  body: StudyTemplateBody,
  options: { overwriteId?: string; now?: Date } = {},
): DeviceTemplateWrite {
  const valid = validateStudyTemplateWrite(name, body);
  if (!valid.ok) return { ok: false, error: valid.problem };
  const raw = readRaw();
  if (!raw.ok) return { ok: false, error: raw.reason };
  const entries = [...raw.entries];
  const parsed = entries.map(parseEntry);
  const now = (options.now ?? new Date()).toISOString();
  if (options.overwriteId) {
    const index = indexOfId(entries, options.overwriteId);
    const current = index >= 0 ? parsed[index] : null;
    if (!current) return { ok: false, error: "not_found" };
    if (current.newer) return { ok: false, error: "newer_version" };
    const clash = parsed.find((t) => t && t.id !== current.id && sameTemplateName(t.name, valid.name));
    if (clash) return { ok: false, error: "name_taken", existingId: clash.id };
    const record = buildStudyTemplateRecord({
      id: current.id,
      name: valid.name,
      body: valid.body,
      revision: current.revision + 1,
      createdAt: current.createdAt || now,
      updatedAt: now,
    });
    entries[index] = record;
    return finish(entries, { ...record, newer: false });
  }
  const clash = parsed.find((t) => t && sameTemplateName(t.name, valid.name));
  if (clash) return { ok: false, error: "name_taken", existingId: clash.id };
  if (parsed.filter(Boolean).length >= STUDY_TEMPLATE_LIMITS.templatesMax) return { ok: false, error: "limit_reached" };
  const record = buildStudyTemplateRecord({ id: mintDeviceId(), name: valid.name, body: valid.body, revision: 1, createdAt: now, updatedAt: now });
  entries.push(record);
  return finish(entries, { ...record, newer: false });
}

/** Rename in place. Everything else in the stored entry — including a v1 shape — is kept. */
export function renameDeviceTemplate(id: string, name: unknown, options: { now?: Date } = {}): DeviceTemplateWrite {
  const problem = templateNameProblem(name);
  if (problem) return { ok: false, error: problem === "too_long" ? "name_too_long" : "invalid_name" };
  const nextName = normalizeTemplateName(name)!;
  const raw = readRaw();
  if (!raw.ok) return { ok: false, error: raw.reason };
  const entries = [...raw.entries];
  const index = indexOfId(entries, id);
  const current = index >= 0 ? parseEntry(entries[index]) : null;
  if (!current) return { ok: false, error: "not_found" };
  if (current.newer) return { ok: false, error: "newer_version" };
  const clash = entries.map(parseEntry).find((t) => t && t.id !== id && sameTemplateName(t.name, nextName));
  if (clash) return { ok: false, error: "name_taken", existingId: clash.id };
  const updatedAt = (options.now ?? new Date()).toISOString();
  entries[index] = { ...(entries[index] as Record<string, unknown>), name: nextName, revision: current.revision + 1, updatedAt };
  return finish(entries, { ...current, name: nextName, revision: current.revision + 1, updatedAt });
}

export function deleteDeviceTemplate(id: string): { ok: true } | { ok: false; error: "storage_blocked" | "unreadable" | "write_failed" | "not_found" } {
  const raw = readRaw();
  if (!raw.ok) return { ok: false, error: raw.reason };
  const index = indexOfId(raw.entries, id);
  if (index < 0) return { ok: false, error: "not_found" };
  const entries = raw.entries.filter((_, i) => i !== index);
  return writeRaw(entries) ? { ok: true } : { ok: false, error: "write_failed" };
}

// --- the chart menu ---------------------------------------------------------------------------

export type TemplateMenuEntry = { id: string; name: string };

/** Account menu rows id-prefixed so they can never collide with a device id (device ids have no ':'). */
export const ACCOUNT_MENU_PREFIX = "acct:";

let accountMenu: { entries: TemplateMenuEntry[]; deviceSuffix: string } | null = null;

/**
 * The template host publishes the signed-in owner's account templates here (and clears them on
 * sign-out or owner change), so the chart's synchronous menu can list both stores without a fetch.
 */
export function publishTemplateMenu(menu: { account: TemplateMenuEntry[]; deviceSuffix: string } | null): void {
  accountMenu = menu
    ? { entries: menu.account.map((t) => ({ id: ACCOUNT_MENU_PREFIX + t.id, name: t.name })), deviceSuffix: menu.deviceSuffix }
    : null;
}

/** Rows for the chart's "Chart templates" menu: account templates first, then this device's. */
export function listTemplates(): TemplateMenuEntry[] {
  const device = readDeviceTemplates();
  const deviceRows = device.status === "ok" ? device.templates.map((t) => ({ id: t.id, name: t.name })) : [];
  if (!accountMenu || !accountMenu.entries.length) return deviceRows;
  const suffix = accountMenu.deviceSuffix;
  return [...accountMenu.entries, ...deviceRows.map((row) => ({ id: row.id, name: suffix ? `${row.name} · ${suffix}` : row.name }))];
}
