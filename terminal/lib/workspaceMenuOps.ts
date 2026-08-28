// ── Pure helpers for the W2-A workspace menu (TerminalShell.tsx wiring) ─────────────────────────
//
// Split out of TerminalShell.tsx so the mapping rules the menu depends on — "never show a raw
// failure code", "a row's openability is derived by the reader, never trusted blindly from the
// row's own stored schema tag" — are unit-testable without rendering the shell. No I/O, no React.
//
// Frozen contract: research/DEEPVUE_W2A_WORKSPACE_LAYOUT_CONTRACT_2026-08-26.md (Macro repo).
// Design spec: terminal/docs/W2A_WORKSPACE_UX_SPEC.md.

import { migrateLegacy, type MigrateResult } from "./workspaceMigrate";
import type { WorkspaceEnvelope } from "./workspaceLayout";
import type { RowState } from "@/components/LayoutMenu";

/**
 * Per-row read state (spec §1.1's `RowState`), derived the same way the actual LOAD path decides
 * openability — via `migrateLegacy` in its READ/RENDER form (`strict=false`, Amendment A3 ruling
 * 1), not the server's `rowStateFor` (which answers a narrower question: "is this row valid AS
 * `workspace_layout.v1` right now"). A legacy `chart_layout_v1/v2` row is fully loadable via
 * migrate-on-write (freeze §6) and must never be marked blocked just because it has not been saved
 * in the new format yet — that would regress every layout saved before this wave shipped. A row
 * with one per-field defect (reviewer ruling B1) is STILL "ok" — tolerant read no-claims the bad
 * field instead of refusing the whole row; the caller surfaces the resulting `unclaimed` list
 * separately (see `migrationUnclaimed`), never as a blocked row. Genuinely unrecognized/future/
 * over-floor payloads (a structural defect tolerant mode does NOT paper over) still block.
 */
export function workspaceRowState(config: unknown): RowState {
  const result = migrateLegacy(config, false);
  if (result.ok) return "ok";
  return result.code === "unsupported_floor" ? "unsupported_floor" : "unsupported_schema";
}

/** Extracts the `unclaimed` field-name list from a (possibly tolerant) `migrateLegacy` result —
 *  `[]` when the result carries no such list at all (the already-canonical row-3 clean pass-through
 *  has none) or the migration failed outright. Reviewer ruling B2: the caller surfaces a non-empty
 *  list to the user before any subsequent save. */
export function migrationUnclaimed(result: MigrateResult): string[] {
  return result.ok && "unclaimed" in result && result.unclaimed ? result.unclaimed : [];
}

/** Extracts the `unsupportedWidgets` id list (reviewer ruling M5b) — widgets a tolerant READ opened
 *  the row around because their `type` this build does not recognize. `[]` when the result carries
 *  no such list (every other path: a clean row, a per-field-tolerant legacy migration, or an
 *  outright failure). The caller surfaces a non-empty list before any subsequent save, since saving
 *  re-captures only the widgets this build knows how to render — the drop must be disclosed, never
 *  silent (contract §11). */
export function migrationUnsupportedWidgets(result: MigrateResult): string[] {
  return result.ok && "unsupportedWidgets" in result && result.unsupportedWidgets ? result.unsupportedWidgets : [];
}

/** W1-C regression surface (freeze §7/§12): whether a loaded envelope's widget graph includes the
 *  Brain dock — the ONE fact that decides whether `<BrainWidget>` mounts. `getAiContext` and every
 *  other Brain prop are untouched by this wave; only membership is new. */
export function brainIncludedFromEnvelope(envelope: Pick<WorkspaceEnvelope, "widgets">): boolean {
  return envelope.widgets.some((w) => w.type === "brain");
}

/**
 * Reviewer ruling M6(b): every Brain-opening entry point (the toolbar "Mastermind AI" button, the
 * MegaPane's `onOpenCopilot`, the "Ask AI about `<symbol>`" button, and the `?ai=1`/`mm:copilot`
 * deep-link effect) re-includes the dock in the live workspace graph — `setBrainIncluded(true)` —
 * BEFORE actually opening it. Asking for the assistant is itself opting back in, even when a
 * workspace load or an explicit toggle had dropped it (freeze §7's membership rule flows both
 * ways: a workspace can drop the dock, and asking for the assistant brings it back). Pulled out of
 * TerminalShell's four call sites into one function so the re-inclusion order is unit-testable
 * without rendering the shell.
 */
export function openBrainReincluding(setBrainIncluded: (included: boolean) => void, open: () => void): void {
  setBrainIncluded(true);
  open();
}

export type WorkspaceOpOutcome =
  | { kind: "ok"; revision: number; id?: string }
  | { kind: "name_conflict" }
  | { kind: "stale_revision" }
  | { kind: "unauthenticated" }
  | { kind: "invalid_name" }
  | { kind: "not_found" }
  | { kind: "error" };

/** Maps an `/api/layouts` workspace-op response to a discriminated outcome — one place that knows
 *  the HTTP status/error-string vocabulary, so every caller (save/rename/duplicate/import) reasons
 *  about the same six shapes instead of re-deriving them. `id` (present on `save_workspace`'s
 *  response) lets the caller re-thread the ABA-fence identity (Amendment A3 ruling 5) after a
 *  create or a migrate-on-write conversion, when the row's uuid was not already known. */
export function parseWorkspaceOutcome(status: number, json: unknown): WorkspaceOpOutcome {
  const body = (json && typeof json === "object" ? json : {}) as { ok?: boolean; revision?: number; id?: string; error?: string };
  if (status === 200 && body.ok && typeof body.revision === "number") {
    return typeof body.id === "string" ? { kind: "ok", revision: body.revision, id: body.id } : { kind: "ok", revision: body.revision };
  }
  if (status === 401) return { kind: "unauthenticated" };
  if (status === 409 && body.error === "name_conflict") return { kind: "name_conflict" };
  if (status === 409 && body.error === "stale_revision") return { kind: "stale_revision" };
  if (status === 400 && body.error === "invalid_name") return { kind: "invalid_name" };
  if (status === 404) return { kind: "not_found" };
  return { kind: "error" };
}

/** Absolute local time, HH:MM, via the caller's locale — spec §2.2 GAP-2 resolution: the row
 *  carries only `updated_at` and no bilingual relative-time helper exists in this codebase, so the
 *  stale-revision fork states a fact ("saved 3:14 PM") rather than minting a new relative-time
 *  formatter. Never throws on a malformed/missing timestamp. */
export function absoluteLocalTime(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
}

// Filesystem-hostile character set for the export filename law (spec §3.3): backslash, slash,
// colon, asterisk, question mark, quote, angle brackets, pipe, plus every ASCII control character.
// Built via fromCharCode (never a literal control byte in this source file) so the codepoints
// 0x00-0x1f never appear as raw bytes in the repo.
const ASCII_CONTROL_CHARS = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join("");
const FILENAME_UNSAFE_RE = new RegExp(`[\\\\/:*?"<>|${ASCII_CONTROL_CHARS}]+`, "g");

/** Export filename law (spec §3.3). Deliberately NOT `exportList`'s `replace(/[^\w.-]+/g,"_")`
 *  (`TerminalShell.tsx` watchlist export) — `\w` is ASCII-only, so a zh workspace name would export
 *  as `___.csv`. This strips only filesystem-hostile characters and keeps every script. */
export function safeWorkspaceFilename(name: string): string {
  const safe = name
    .replace(FILENAME_UNSAFE_RE, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${safe || "workspace"}.workspace.json`;
}

/** Every frozen §8 code an IMPORT can fail with, mapped to its plain-word i18n KEY (never a raw
 *  code — spec §2.2/§7 assertion 3). Callers pass the key through `t()`. */
export function importFailureKey(code: string | undefined): string {
  switch (code) {
    case "oversized_workspace": return "wsImportTooBig";
    case "too_many_widgets": return "wsImportTooManyPanels";
    case "unknown_widget_type": return "wsImportUnknownPanel";
    default: return "wsImportBad";
  }
}
