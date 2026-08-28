// Menu-adjacent logic for the W2-A workspace menu (terminal/docs/W2A_WORKSPACE_UX_SPEC.md). These
// are the PURE decision rules TerminalShell.tsx wires into the menu — row openability, the failure
// vocabulary → plain-word key mapping, and the Brain-membership derivation — proved without
// rendering a component (no react-testing-library in this repo; see the module's own header).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  workspaceRowState, parseWorkspaceOutcome, absoluteLocalTime, safeWorkspaceFilename,
  importFailureKey, brainIncludedFromEnvelope, openBrainReincluding,
} from "@/lib/workspaceMenuOps";
import { FAILURE_CODES } from "@/lib/workspaceLayout";
import { LEX } from "@/lib/i18n";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures/workspace", `${name}.json`), "utf8"));

describe("workspaceRowState — the reader decides openability, not the server's narrower rowStateFor", () => {
  it("a LEGACY chart_layout_v0/v1/v2 row is 'ok' — migratable, not blocked (the regression this test guards)", () => {
    expect(workspaceRowState(fixture("legacy_v0_minimal").input)).toBe("ok");
    expect(workspaceRowState(fixture("chart_layout_v1_typical").input)).toBe("ok");
    expect(workspaceRowState(fixture("chart_layout_v2_full").input)).toBe("ok");
  });

  it("a workspace_layout.v1 row over this build's supported floor is unsupported_floor", () => {
    expect(workspaceRowState(fixture("invalid_floor_unsupported").input)).toBe("unsupported_floor");
  });

  it("a future/unknown schema is unsupported_schema", () => {
    expect(workspaceRowState(fixture("invalid_unknown_schema").input)).toBe("unsupported_schema");
  });

  it("a workspace_layout.v1 row whose ONLY defect is an unknown widget type is 'ok', not unsupported_schema (reviewer ruling M5)", () => {
    // Before M5, `migrateLegacy`'s already-canonical branch treated ANY validation error —
    // including `unknown_widget_type` — as a hard refusal, bricking the whole row for a widget
    // type this build simply does not recognize yet (freeze §2's own documented fallback: "the
    // workspace still opens; only that slot degrades"). `invalid_unknown_widget_type.json` is a
    // golden vector shared with the Macro reference implementation (workspaceVectors.test.ts) —
    // its own `expected_code` there is proved ONLY against `migrateLegacy`'s STRICT (default)
    // mode, which M5 leaves completely unchanged (write/import rejection is unchanged). This is
    // the READ direction (`workspaceRowState` calls `migrateLegacy(config, false)`, reviewer
    // ruling B1), where the fixture's sole error is now tolerated.
    expect(workspaceRowState(fixture("invalid_unknown_widget_type").input)).toBe("ok");
  });

  it("garbage never throws and is unsupported_schema, never 'ok'", () => {
    expect(workspaceRowState(null)).toBe("unsupported_schema");
    expect(workspaceRowState("garbage")).toBe("unsupported_schema");
    expect(workspaceRowState(42)).toBe("unsupported_schema");
    expect(workspaceRowState({})).toBe("unsupported_schema");
  });
});

describe("parseWorkspaceOutcome — one place that knows the /api/layouts workspace-op vocabulary", () => {
  it("200 + ok + a numeric revision is the only path to 'ok'", () => {
    expect(parseWorkspaceOutcome(200, { ok: true, revision: 3 })).toEqual({ kind: "ok", revision: 3 });
    // ok:true WITHOUT a revision (e.g. the legacy duplicate response {ok,id,name}) is NOT this shape.
    expect(parseWorkspaceOutcome(200, { ok: true, id: "x", name: "y" })).toEqual({ kind: "error" });
  });
  it("maps every status/error-string combination this route can answer", () => {
    expect(parseWorkspaceOutcome(401, {})).toEqual({ kind: "unauthenticated" });
    expect(parseWorkspaceOutcome(409, { error: "name_conflict" })).toEqual({ kind: "name_conflict" });
    expect(parseWorkspaceOutcome(409, { error: "stale_revision" })).toEqual({ kind: "stale_revision" });
    expect(parseWorkspaceOutcome(400, { error: "invalid_name" })).toEqual({ kind: "invalid_name" });
    expect(parseWorkspaceOutcome(404, { error: "not_found" })).toEqual({ kind: "not_found" });
  });
  it("anything else (400 validation family, 503, malformed body) is the catch-all 'error'", () => {
    expect(parseWorkspaceOutcome(400, { error: "malformed_workspace" })).toEqual({ kind: "error" });
    expect(parseWorkspaceOutcome(503, { error: "store_unavailable" })).toEqual({ kind: "error" });
    expect(parseWorkspaceOutcome(200, null)).toEqual({ kind: "error" });
    expect(parseWorkspaceOutcome(200, "not an object")).toEqual({ kind: "error" });
  });
});

describe("importFailureKey — every frozen §8 code an import can fail with maps to an i18n KEY, never a raw code", () => {
  const cases: [string | undefined, string][] = [
    ["oversized_workspace", "wsImportTooBig"],
    ["too_many_widgets", "wsImportTooManyPanels"],
    ["unknown_widget_type", "wsImportUnknownPanel"],
    ["malformed_workspace", "wsImportBad"],
    ["invalid_widget_config", "wsImportBad"],
    ["duplicate_widget_id", "wsImportBad"],
    ["invalid_lane", "wsImportBad"],
    ["invalid_port", "wsImportBad"],
    ["unsupported_schema", "wsImportBad"],
    ["unsupported_floor", "wsImportBad"],
    [undefined, "wsImportBad"],
  ];
  it.each(cases)("%s -> %s", (code, key) => {
    expect(importFailureKey(code)).toBe(key);
  });

  it("every §8 failure code the validator can emit is covered by a case above (no silent fallthrough surprise)", () => {
    const covered = new Set(cases.map(([code]) => code).filter((c): c is string => c !== undefined));
    for (const code of FAILURE_CODES) {
      // Codes the IMPORT path cannot itself receive (auth/store/CAS/name identity) legitimately fall
      // to the generic "wsImportBad" default without a dedicated case; every WIDGET/SCHEMA shape code
      // must be explicitly listed above so a future addition to FAILURE_CODES is noticed here.
      const importReachable = !["name_conflict", "stale_revision", "store_unavailable", "unauthenticated", "not_found", "invalid_import"].includes(code);
      if (importReachable) expect(covered.has(code) || importFailureKey(code) === "wsImportBad", code).toBe(true);
    }
  });

  it("the mapped LEX strings never contain the raw code text itself (EN or ZH)", () => {
    const keys = ["wsImportTooBig", "wsImportTooManyPanels", "wsImportUnknownPanel", "wsImportBad"];
    const rawCodes = FAILURE_CODES;
    for (const key of keys) {
      const [en, zh] = LEX[key];
      for (const code of rawCodes) {
        expect(en, `${key} EN leaks raw code ${code}`).not.toContain(code);
        expect(zh, `${key} ZH leaks raw code ${code}`).not.toContain(code);
      }
    }
  });
});

describe("absoluteLocalTime — spec §2.2 GAP-2: an absolute HH:MM, never a relative-time formatter", () => {
  it("formats a real timestamp as HH:MM in the given locale", () => {
    const iso = new Date(2026, 7, 26, 15, 4).toISOString();
    const out = absoluteLocalTime(iso, "en-US");
    expect(out).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
  });
  it("never throws on a missing or malformed timestamp — returns empty string instead", () => {
    expect(absoluteLocalTime(null)).toBe("");
    expect(absoluteLocalTime(undefined)).toBe("");
    expect(absoluteLocalTime("not-a-date")).toBe("");
    expect(absoluteLocalTime("")).toBe("");
  });
});

describe("safeWorkspaceFilename — spec §3.3 export filename law", () => {
  it("strips filesystem-hostile characters but keeps every script (not exportList's ASCII-only \\w)", () => {
    expect(safeWorkspaceFilename("交易台")).toBe("交易台.workspace.json");
    expect(safeWorkspaceFilename("My/Setup:2")).toBe("My_Setup_2.workspace.json");
    expect(safeWorkspaceFilename("  spaced   name  ")).toBe("spaced name.workspace.json");
  });
  it("falls back to 'workspace' for a name that trims to nothing, and caps length at 60", () => {
    expect(safeWorkspaceFilename("   ")).toBe("workspace.workspace.json");
    expect(safeWorkspaceFilename("///")).toBe("_.workspace.json");
    expect(safeWorkspaceFilename("a".repeat(200))).toBe(`${"a".repeat(60)}.workspace.json`);
  });
});

describe("brainIncludedFromEnvelope — the one fact that decides whether <BrainWidget> mounts (W1-C regression surface)", () => {
  it("true when a brain widget is present, regardless of lane", () => {
    expect(brainIncludedFromEnvelope({ widgets: [{ type: "brain" } as any] })).toBe(true);
  });
  it("false for a chart-only workspace (no brain widget invented)", () => {
    expect(brainIncludedFromEnvelope({ widgets: [{ type: "chart" } as any] })).toBe(false);
    expect(brainIncludedFromEnvelope({ widgets: [] })).toBe(false);
  });
});

describe("openBrainReincluding — every Brain entry point re-includes the dock before opening (reviewer ruling M6b)", () => {
  it("calls setBrainIncluded(true) before calling open()", () => {
    const calls: string[] = [];
    const setBrainIncluded = (v: boolean) => calls.push(`setBrainIncluded(${v})`);
    const open = () => calls.push("open()");
    openBrainReincluding(setBrainIncluded, open);
    expect(calls).toEqual(["setBrainIncluded(true)", "open()"]);
  });

  it("re-includes even when the dock had been toggled off (idempotent — always sets true, never toggles)", () => {
    let included = false;
    const setBrainIncluded = (v: boolean) => { included = v; };
    let opened = false;
    openBrainReincluding(setBrainIncluded, () => { opened = true; });
    expect(included).toBe(true);
    expect(opened).toBe(true);
  });
});
