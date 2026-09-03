// ── Deterministic legacy → `workspace_layout.v1` migration + runtime capture/apply bridge ──────
//
// Frozen contract: research/DEEPVUE_W2A_WORKSPACE_LAYOUT_CONTRACT_2026-08-26.md §6 (Macro repo).
// Reference implementation this module reproduces EXACTLY (byte-for-byte, digest-pinned):
// engine/intelligence_workspace/workspace_layout.py `migrate_legacy` (Macro repo). See
// `workspaceVectors.test.ts` for the golden-vector parity proof against
// `lib/__tests__/fixtures/workspace/*.json`.
//
// `workspaceToLayout`/`captureWorkspace` are the Terminal-side bridge to the EXISTING chart-layout
// contract (`lib/layoutConfig.ts`): a workspace's `chart` widget config IS a `NormalizedLayout`/
// `LayoutConfigV2` payload, one-for-one, so the chart pane grid keeps its current owner (contract
// §2/§7 — a workspace hosts widgets, it does not re-implement their state).

import {
  LAYOUT_SCHEMA_VERSION,
  captureLayoutConfig,
  type CompareCfgMap,
  type LayoutWorkspace,
  type NormalizedLayout,
  type ParamMap as LegacyParamMap,
} from "./layoutConfig";
import {
  CHART_CONFIG_FIELDS,
  CHART_FIELD_VALIDATORS,
  FLOOR_SUPPORTED,
  INVALID,
  SCHEMA,
  validateEnvelope,
  WIDGET_TYPES,
  type ChartConfigField,
  type FailureCode,
  type MigrationProvenance,
  type MigrationSource,
  type Widget,
  type WorkspaceEnvelope,
} from "./workspaceLayout";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isPlainInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export type MigrateResult =
  | { ok: true; envelope: WorkspaceEnvelope; unclaimed: string[]; unsupportedWidgets?: string[] }
  | { ok: true; envelope: WorkspaceEnvelope }
  | { ok: false; code: FailureCode };

/** Contract §6 recognizer table, rows 0-2 (Amendment A2 ruling 13 / honest provenance:
 *  `source_revision` is null unless the payload actually carried a valid INTEGER `schemaVersion`;
 *  a boolean is never treated as a version number). `null` when the shape is not one of the
 *  recognized legacy formats (row 4: fail-closed `unsupported_schema`, handled by the caller). */
function recognizeLegacy(config: Record<string, unknown>): { source: MigrationSource; sourceRevision: number | null } | null {
  const hasSchemaVersion = "schemaVersion" in config;
  const schemaVersion = config.schemaVersion;
  const versionIsInt = isPlainInt(schemaVersion);

  if ("active" in config && !hasSchemaVersion) return { source: "legacy_v0", sourceRevision: null };
  if ("panes" in config && (!hasSchemaVersion || (versionIsInt && schemaVersion === 1))) {
    const sourceRevision = hasSchemaVersion && versionIsInt && schemaVersion === 1 ? 1 : null;
    return { source: "chart_layout_v1", sourceRevision };
  }
  if (hasSchemaVersion && versionIsInt && schemaVersion === 2) return { source: "chart_layout_v2", sourceRevision: 2 };
  return null;
}

/**
 * Reference migration (contract §6): recognize an inbound legacy/native chart-layout shape and
 * produce the canonical `workspace_layout.v1` envelope, or a structured failure. Never throws.
 *
 * Claim semantics: ONLY present, correctly-typed chart fields enter the migrated widget config;
 * unclaimed (ABSENT) fields are never invented. `sync` defaults to `true` only when the source
 * predates v2 AND `panes` was claimed (verbatim contract rule) — v2 never gets an injected default.
 *
 * Direction-scoped lossless law (Amendment A3 ruling 1, supersedes the "no third state" sentence of
 * A2 ruling 2):
 *
 * - `strict = true` (the default — WRITE/IMPORT direction): lossless-or-refuse, exactly as A2
 *   froze it. A field the source format OWNS but that fails its validator is never silently
 *   dropped — migration refuses outright with `{ok: false, code: "invalid_widget_config"}`.
 * - `strict = false` (READ/RENDER direction): per-field TOLERANT, mirroring the shipped read
 *   boundary's own documented fallbacks. A present-but-invalid owned field becomes no-claim
 *   (ABSENT, exactly as if it had never been present) instead of refusing the whole migration, and
 *   its canonical field name is appended to a returned `unclaimed` array —
 *   `{ok: true, envelope: ..., unclaimed: [...]}` (empty when nothing was dropped). A bad field
 *   never makes a row unopenable in this direction; the caller MUST surface a non-empty `unclaimed`
 *   to the user in plain words before any subsequent save (a save is the WRITE direction and
 *   reverts to `strict = true`).
 *
 * The already-canonical passthrough (row 3 of the recognizer table) is unaffected by `strict` for
 * every OTHER defect — an already-`workspace_layout.v1` payload with a genuine structural problem
 * either validates whole or refuses in both directions; there is no per-field claim concept for an
 * object already in the target shape (no `unclaimed` key either way). The ONE read-only exception
 * (reviewer ruling M5): a widget whose `type` this build does not recognize is tolerated on READ —
 * it is the freeze's own documented fallback (contract §2: "the workspace still opens; only that
 * slot degrades... renders as an explicit 'unsupported widget' tile"), never a reason to make the
 * whole row unopenable. This is a Terminal-side post-validate partition, NOT a change to
 * `validateEnvelope` itself (the shared, digest-pinned Macro-mirror validator is untouched — every
 * golden vector still runs the unchanged strict path) — tolerable ONLY when EVERY reported defect
 * is `unknown_widget_type` (any other structural problem alongside it still refuses, in both
 * directions, exactly as before).
 *
 * Reviewer ruling M5b (a Save silently destroys an unknown panel): the tolerated-unknown-type
 * result also names every dropped widget's id in `unsupportedWidgets` — §11 requires the drop be
 * DISCLOSED, never silent, and a save over this row (which re-captures only the widgets this build
 * knows how to render) would otherwise remove that panel with no warning. The caller (B2's
 * unclaimed-settings note, extended for the panel case) surfaces this before any subsequent save,
 * exactly like `unclaimed`. N16: the envelope is a shallow copy (`{...config}`), never the same
 * object reference the caller's stored row holds — the prior `config as unknown as
 * WorkspaceEnvelope` aliased the row's own object, so a caller mutating the returned envelope (e.g.
 * stamping `name`/`revision` before a save) silently corrupted the un-migrated source too.
 */
export function migrateLegacy(config: unknown, strict = true): MigrateResult {
  if (!isRecord(config)) return { ok: false, code: "malformed_workspace" };

  if (config.schema === SCHEMA) {
    // Row 3: already-canonical — passes through validation unchanged.
    const result = validateEnvelope(config);
    if (result.ok) return { ok: true, envelope: { ...config } as WorkspaceEnvelope };
    if (!strict && result.errors.length > 0 && result.errors.every((e) => e.code === "unknown_widget_type")) {
      const rawWidgets = Array.isArray(config.widgets) ? config.widgets : [];
      const unsupportedWidgets = rawWidgets
        .filter((w): w is Record<string, unknown> => isRecord(w) && !(WIDGET_TYPES as readonly unknown[]).includes(w.type))
        .map((w) => String(w.id));
      return { ok: true, envelope: { ...config } as WorkspaceEnvelope, unclaimed: [], unsupportedWidgets };
    }
    return { ok: false, code: result.errors[0].code };
  }

  const recognized = recognizeLegacy(config);
  if (!recognized) return { ok: false, code: "unsupported_schema" };
  const { source, sourceRevision } = recognized;
  const version = source === "legacy_v0" ? 0 : source === "chart_layout_v1" ? 1 : 2;

  const claims: Record<string, unknown> = {};
  const unclaimed: string[] = [];
  for (const field of CHART_CONFIG_FIELDS) {
    if (field in config) {
      const normalized = CHART_FIELD_VALIDATORS[field](config[field]);
      if (normalized === INVALID) {
        if (strict) return { ok: false, code: "invalid_widget_config" };
        unclaimed.push(field);
        continue;
      }
      claims[field] = normalized;
    }
  }

  // Legacy scalar -> canonical array mappings (contract §6, v0/v1 only): only applied when the
  // canonical array field was not already directly claimed above, and never for v2 (which owns
  // `panes`/`paneTfs` natively and never carried the singular `active`/`tf` legacy keys). Same
  // direction-scoped lossless law applies to these legacy-named owned fields.
  if (version < 2 && !("panes" in claims) && "active" in config) {
    const rawActive = config.active;
    const normalized = typeof rawActive === "string" ? CHART_FIELD_VALIDATORS.panes([rawActive]) : INVALID;
    if (normalized === INVALID) {
      if (strict) return { ok: false, code: "invalid_widget_config" };
      if (!unclaimed.includes("panes")) unclaimed.push("panes");
    } else {
      claims.panes = normalized;
    }
  }
  if (version < 2 && !("paneTfs" in claims) && "tf" in config) {
    const rawTf = config.tf;
    const normalized = typeof rawTf === "string" ? CHART_FIELD_VALIDATORS.paneTfs([rawTf]) : INVALID;
    if (normalized === INVALID) {
      if (strict) return { ok: false, code: "invalid_widget_config" };
      if (!unclaimed.includes("paneTfs")) unclaimed.push("paneTfs");
    } else {
      claims.paneTfs = normalized;
    }
  }

  // sync defaults true ONLY when version<2 AND panes claimed (verbatim).
  if (version < 2 && "panes" in claims && !("sync" in claims)) {
    claims.sync = true;
  }

  const envelope: WorkspaceEnvelope = {
    schema: SCHEMA,
    requires: { floor: FLOOR_SUPPORTED },
    revision: 1,
    name: null,
    link_groups: { primary_security: { entity_type: "security" } },
    widgets: [
      {
        id: "chart-main",
        type: "chart",
        semantic_lane: "primary",
        context_in: ["primary_security"],
        context_out: ["primary_security"],
        config: claims,
      },
    ],
    migration: { source, source_revision: sourceRevision },
  };
  if (strict) return { ok: true, envelope };
  return { ok: true, envelope, unclaimed };
}

function findChartWidget(envelope: WorkspaceEnvelope): Widget | undefined {
  return (
    envelope.widgets.find((w) => w.type === "chart" && w.semantic_lane === "primary") ??
    envelope.widgets.find((w) => w.type === "chart")
  );
}

function findBrainWidget(envelope: WorkspaceEnvelope): Widget | undefined {
  return envelope.widgets.find((w) => w.type === "brain");
}

/** Envelope chart widget config -> the existing `NormalizedLayout` claims shape, so the existing,
 *  UNMODIFIED `applyLayoutConfig` folds it onto the live workspace exactly as it folds any other
 *  saved layout (contract §7: the chart pane grid keeps its current owner). A field absent from the
 *  widget config claims nothing (`null`) — never re-interpreted as "reset to default". */
export function workspaceToLayout(envelope: WorkspaceEnvelope): NormalizedLayout {
  const widget = findChartWidget(envelope);
  const config: Record<string, unknown> = isRecord(widget?.config) ? widget.config : {};
  const claim = <T,>(field: ChartConfigField): T | null => (field in config ? (config[field] as T) : null);

  // Amendment A1 (2026-08-26, Macro commit 8b4d326514f6): `lockedVLine` is `string | null` in both
  // the frozen contract and Terminal's real runtime, so a claimed string/null value carries through
  // as a real claim; anything else (e.g. a stray number from a pre-amendment or hostile envelope)
  // is correctly "no claim" rather than corrupting the live value with the wrong type.
  const rawLockedVLine = config.lockedVLine;
  const lockedVLine: string | null | undefined =
    typeof rawLockedVLine === "string" ? rawLockedVLine : rawLockedVLine === null ? null : undefined;

  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    panes: claim<string[]>("panes"),
    paneTfs: claim<string[]>("paneTfs"),
    split: claim<number>("split"),
    activePane: claim<number>("activePane"),
    sync: claim<boolean>("sync"),
    chartType: claim<string>("chartType"),
    inds: claim<string[]>("inds"),
    indParams: claim<LegacyParamMap>("indParams"),
    hidden: claim<string[]>("hidden"),
    compare: claim<string[]>("compare"),
    compareCfg: claim<CompareCfgMap>("compareCfg"),
    lockedVLine,
  };
}

export type CaptureWorkspaceInput = {
  /** Current runtime workspace state, in the shape the existing chart surface already holds. */
  layout: LayoutWorkspace;
  /** Whether the assistant (Brain) dock is part of the workspace being saved (contract §7). */
  brainIncluded: boolean;
  /** The envelope this save is layered over (an existing named workspace, if any) — widget ids and
   *  migration provenance are PRESERVED from it rather than re-minted (contract §2: "user-created
   *  widgets get ids minted once at creation and persisted thereafter"). Omit for a brand-new
   *  workspace (native creation: `migration = {source:"none", source_revision:null}`). */
  prior?: WorkspaceEnvelope;
};

export type CaptureWorkspaceResult = { ok: true; envelope: WorkspaceEnvelope; dropped: string[] };

/** Runtime capture -> canonical envelope. Chart widget config is exactly `captureLayoutConfig`'s
 *  output, re-validated field-by-field through the SAME frozen validators `migrateLegacy` uses (so
 *  a captured value that would fail cross-repo validation is never persisted un-claimed instead of
 *  rejected). Under Amendment A1 (2026-08-26, Macro commit 8b4d326514f6) `lockedVLine` is
 *  `string | null` on both sides, so a live string lockedVLine now survives capture as a real claim
 *  — pre-amendment, the frozen validator only accepted `number | null` and would have silently
 *  dropped every real Terminal lockedVLine value (this worker's own KNOWN GAP finding, ruled a real
 *  contract defect and fixed on the Macro side rather than worked around here).
 *
 *  Reviewer ruling M4: capture is a pure transform of the live in-memory state and always succeeds
 *  (`ok: true`), but it NAMES every chart field that was present in the live capture yet failed its
 *  own frozen validator in `dropped` (empty when nothing was dropped) — capture itself never
 *  silently narrows the workspace. The caller (the save flow) is the one that refuses to actually
 *  PERSIST an envelope with a non-empty `dropped`; see the `saveLayout`/`saveWorkspaceAsCopy`
 *  call sites in TerminalShell.tsx and `wsSaveUnreadable`. */
export function captureWorkspace(input: CaptureWorkspaceInput): CaptureWorkspaceResult {
  const captured = captureLayoutConfig(input.layout) as unknown as Record<string, unknown>;
  const chartConfig: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const field of CHART_CONFIG_FIELDS) {
    if (!(field in captured)) continue;
    const normalized = CHART_FIELD_VALIDATORS[field](captured[field]);
    if (normalized !== INVALID) chartConfig[field] = normalized;
    else dropped.push(field);
  }

  const priorChart = input.prior ? findChartWidget(input.prior) : undefined;
  const priorBrain = input.prior ? findBrainWidget(input.prior) : undefined;

  const chartWidget: Widget = {
    id: priorChart?.id ?? "chart-main",
    type: "chart",
    semantic_lane: priorChart?.semantic_lane ?? "primary",
    context_in: priorChart?.context_in ?? ["primary_security"],
    context_out: priorChart?.context_out ?? ["primary_security"],
    config: chartConfig,
    ...(priorChart?.grid ? { grid: priorChart.grid } : {}),
  };

  const widgets: Widget[] = [chartWidget];
  if (input.brainIncluded) {
    widgets.push({
      id: priorBrain?.id ?? "brain-dock",
      type: "brain",
      semantic_lane: priorBrain?.semantic_lane ?? "dock",
      context_in: priorBrain?.context_in ?? ["primary_security"],
      context_out: priorBrain?.context_out ?? [],
      config: {},
    });
  }

  const migration: MigrationProvenance = input.prior?.migration ?? { source: "none", source_revision: null };
  const linkGroups = input.prior?.link_groups ?? { primary_security: { entity_type: "security" } };
  const revision = input.prior?.revision ?? 1;

  const envelope: WorkspaceEnvelope = {
    schema: SCHEMA,
    requires: { floor: FLOOR_SUPPORTED },
    revision,
    name: null,
    link_groups: linkGroups,
    widgets,
    migration,
  };
  return { ok: true, envelope, dropped };
}
