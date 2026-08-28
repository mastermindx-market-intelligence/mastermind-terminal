import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHART_CONFIG_FIELDS, ENTITY_TYPES, FAILURE_CODES, FLOOR_SUPPORTED, MAX_ENVELOPE_BYTES,
  MAX_LINK_GROUPS, MAX_PORTS, MAX_WIDGETS, MIGRATION_SOURCES, SCHEMA, SEMANTIC_LANES, WIDGET_TYPES,
  envelopeDigest, isWorkspaceEnvelope, rowStateFor, validateEnvelope,
} from "../workspaceLayout";

// A minimal, valid `workspace_layout.v1` envelope (chart-main + brain-dock, the frozen §7 proof
// pair). Every test below mutates a clone of this rather than re-deriving the shape.
function validEnvelope(): Record<string, unknown> {
  return {
    schema: SCHEMA,
    requires: { floor: 1 },
    revision: 1,
    name: null,
    link_groups: { primary_security: { entity_type: "security" } },
    widgets: [
      {
        id: "chart-main", type: "chart", semantic_lane: "primary",
        context_in: ["primary_security"], context_out: ["primary_security"],
        config: { panes: ["NVDA"], sync: true },
      },
      {
        id: "brain-dock", type: "brain", semantic_lane: "dock",
        context_in: ["primary_security"], context_out: [],
        config: {},
      },
    ],
    migration: { source: "none", source_revision: null },
  };
}

/** A single-chart-widget envelope with the given chart-config overrides — used across the
 *  Amendment A1/A2/A3 regression suites below to probe one field at a time. */
function widgetConfig(config: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: SCHEMA, requires: { floor: 1 }, revision: 1, name: null,
    link_groups: { primary_security: { entity_type: "security" } },
    widgets: [{
      id: "chart-main", type: "chart", semantic_lane: "primary",
      context_in: ["primary_security"], context_out: ["primary_security"],
      config: { panes: ["NVDA"], ...config },
    }],
    migration: { source: "none", source_revision: null },
  };
}

describe("frozen vocabularies — shape and cardinality (contract §1-§8)", () => {
  it("widget/lane/entity/migration vocabularies match the frozen list", () => {
    expect(WIDGET_TYPES).toEqual(["chart", "brain"]);
    expect(SEMANTIC_LANES).toEqual(["primary", "secondary", "rail", "dock"]);
    expect(ENTITY_TYPES).toEqual(["security", "industry", "theme", "portfolio", "event"]);
    expect(MIGRATION_SOURCES).toEqual(["legacy_v0", "chart_layout_v1", "chart_layout_v2", "none", "import"]);
  });

  it("exactly 16 failure codes, no more, no fewer", () => {
    expect(FAILURE_CODES).toHaveLength(16);
    expect(new Set(FAILURE_CODES).size).toBe(16);
  });

  it("frozen limits", () => {
    expect(MAX_WIDGETS).toBe(12);
    expect(MAX_ENVELOPE_BYTES).toBe(65536);
    expect(MAX_LINK_GROUPS).toBe(8);
    expect(MAX_PORTS).toBe(8);
    expect(FLOOR_SUPPORTED).toBe(1);
  });

  it("the 12 chart-config fields", () => {
    expect(CHART_CONFIG_FIELDS).toEqual([
      "panes", "paneTfs", "split", "activePane", "sync", "chartType",
      "inds", "indParams", "hidden", "compare", "compareCfg", "lockedVLine",
    ]);
  });
});

describe("validateEnvelope — accepts the canonical shape", () => {
  it("accepts the frozen §1 worked example verbatim (post-Amendment A1: split 1, not 50)", () => {
    // Amendment A1 (2026-08-26, Macro commit 8b4d326514f6) corrected the doc's own §1 example: the
    // original `split: 50` was an authoring error (0-100 range never matched Terminal's {1,2,4}
    // domain), fixed to `split: 1` in the same commit that fixed the validator.
    const envelope = {
      schema: "workspace_layout.v1",
      requires: { floor: 1 },
      revision: 3,
      name: null,
      link_groups: { primary_security: { entity_type: "security" } },
      widgets: [
        {
          id: "chart-main", type: "chart", semantic_lane: "primary",
          grid: { x: 0, y: 0, w: 16, h: 18 },
          context_in: ["primary_security"], context_out: ["primary_security"],
          config: {
            panes: ["NVDA"], paneTfs: ["1D"], split: 1, activePane: 0,
            sync: true, chartType: "candles", inds: ["ema21"],
            indParams: {}, hidden: [], compare: [], compareCfg: {},
            lockedVLine: null,
          },
        },
        {
          id: "brain-dock", type: "brain", semantic_lane: "dock",
          context_in: ["primary_security"], context_out: [],
          config: {},
        },
      ],
      migration: { source: "chart_layout_v2", source_revision: 2 },
    };
    expect(validateEnvelope(envelope)).toEqual({ ok: true, errors: [] });
  });

  it("accepts secondary/rail lanes (valid-but-unconsumed in W2-A, contract §2)", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[1].semantic_lane = "rail";
    expect(validateEnvelope(e).ok).toBe(true);
  });

  it("accepts an optional grid within bounds", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[0].grid = { x: 0, y: 0, w: 64, h: 64 };
    expect(validateEnvelope(e).ok).toBe(true);
  });
});

describe("validateEnvelope — rejects with the frozen codes (cross-field laws)", () => {
  it("duplicate widget id", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[1].id = "chart-main";
    const r = validateEnvelope(e);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((x) => x.code === "duplicate_widget_id")).toBe(true);
  });

  it("undeclared port ref", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[0].context_in = ["no_such_group"];
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "invalid_port")).toBe(true);
  });

  it("stored name must be null", () => {
    const e = validEnvelope();
    e.name = "My Workspace";
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "malformed_workspace" && x.path === "$.name")).toBe(true);
  });

  it("unsupported floor", () => {
    const e = validEnvelope();
    e.requires = { floor: 2 };
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "unsupported_floor")).toBe(true);
  });

  it("wrong schema literal", () => {
    const e = validEnvelope();
    e.schema = "workspace_layout.v2";
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors[0].code).toBe("unsupported_schema");
  });

  it("closed shapes — unknown top-level key", () => {
    const e = validEnvelope();
    e.extra = "nope";
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "malformed_workspace")).toBe(true);
  });

  it("closed shapes — unknown widget key", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[0].extra = "nope";
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "invalid_widget_config")).toBe(true);
  });

  it("closed shapes — unknown chart config key", () => {
    const e = validEnvelope();
    ((e.widgets as Record<string, unknown>[])[0].config as Record<string, unknown>).zzz = 1;
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "invalid_widget_config")).toBe(true);
  });

  it("brain config must be exactly {}", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[1].config = { anything: 1 };
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "invalid_widget_config")).toBe(true);
  });

  it("too many widgets", () => {
    const e = validEnvelope();
    const widgets = e.widgets as Record<string, unknown>[];
    for (let i = 0; i < 11; i++) {
      widgets.push({ id: `extra-${i}`, type: "brain", semantic_lane: "dock", context_in: [], context_out: [], config: {} });
    }
    expect(widgets.length).toBe(13);
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors[0].code).toBe("too_many_widgets");
  });

  it("zero widgets", () => {
    const e = validEnvelope();
    e.widgets = [];
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "malformed_workspace")).toBe(true);
  });

  it("unknown widget type", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[0].type = "table";
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "unknown_widget_type")).toBe(true);
  });

  it("invalid lane", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[0].semantic_lane = "primaryy";
    const r = validateEnvelope(e);
    expect(!r.ok && r.errors.some((x) => x.code === "invalid_lane")).toBe(true);
  });

  it("oversized workspace", () => {
    // Reuse the digest-pinned golden vector's own oversized `compareCfg` construction (32 symbols x
    // 16 params x 64-char values, ~106KB serialized) rather than re-deriving the byte count by hand.
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/workspace/invalid_oversized_workspace.json", import.meta.url), "utf8"),
    ) as { input: Record<string, unknown> };
    const r = validateEnvelope(fixture.input);
    expect(!r.ok && r.errors.some((x) => x.code === "oversized_workspace")).toBe(true);
  });

  it("too many link_groups", () => {
    const e = validEnvelope();
    const groups: Record<string, unknown> = {};
    for (let i = 0; i < 9; i++) groups[`g${i}`] = { entity_type: "security" };
    e.link_groups = groups;
    const r = validateEnvelope(e);
    expect(r.ok).toBe(false);
  });
});

// ── Amendment A1 (2026-08-26, Macro commit 8b4d326514f6) regression ────────────────────────────
// `lockedVLine` is `string 1..64, no ASCII control chars, | null` (was `number | null`); `split` is
// the discrete enum `{1, 2, 4}` (was `0..100`). Both were falsified against the real Terminal
// runtime by this worker's own KNOWN GAP tests (a numeric lockedVLine and an out-of-domain split
// value silently failed to survive the existing, unmodified `layoutConfig.ts` pipeline downstream),
// then ruled real contract defects and fixed on the Macro side. Mirrors
// `tests/test_intelligence_workspace_workspace_layout.py`'s own Amendment A1 regression suite
// (Macro repo) case-for-case.
describe("validateEnvelope — Amendment A1 regression (lockedVLine string, split enum)", () => {
  it("a string lockedVLine validates", () => {
    expect(validateEnvelope(widgetConfig({ lockedVLine: "2026-08-12T14:30:00Z" }))).toEqual({ ok: true, errors: [] });
  });

  it("a numeric lockedVLine is invalid_widget_config (the pre-amendment shape)", () => {
    const r = validateEnvelope(widgetConfig({ lockedVLine: 1700000000 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && new Set(r.errors.map((e) => e.code))).toEqual(new Set(["invalid_widget_config"]));
  });

  it("lockedVLine: null remains a legitimate claimed value (explicit 'no lock')", () => {
    expect(validateEnvelope(widgetConfig({ lockedVLine: null }))).toEqual({ ok: true, errors: [] });
  });

  it("lockedVLine rejects control characters and oversize/empty strings", () => {
    for (const bad of ["\x00", "a\nb", "x".repeat(65), ""]) {
      const r = validateEnvelope(widgetConfig({ lockedVLine: bad }));
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(!r.ok && new Set(r.errors.map((e) => e.code))).toEqual(new Set(["invalid_widget_config"]));
    }
  });

  it("lockedVLine accepts exactly 64 chars (the boundary) and rejects 65", () => {
    expect(validateEnvelope(widgetConfig({ lockedVLine: "x".repeat(64) }))).toEqual({ ok: true, errors: [] });
    expect(validateEnvelope(widgetConfig({ lockedVLine: "x".repeat(65) })).ok).toBe(false);
  });

  it("split: 2 validates", () => {
    expect(validateEnvelope(widgetConfig({ split: 2 }))).toEqual({ ok: true, errors: [] });
  });

  it("split: 50 is invalid_widget_config (the pre-amendment shape)", () => {
    const r = validateEnvelope(widgetConfig({ split: 50 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && new Set(r.errors.map((e) => e.code))).toEqual(new Set(["invalid_widget_config"]));
  });

  it("split only allows the frozen enum {1, 2, 4}", () => {
    for (const value of [0, 3, 5, 100, -1]) {
      const r = validateEnvelope(widgetConfig({ split: value }));
      expect(r.ok, String(value)).toBe(false);
      expect(!r.ok && new Set(r.errors.map((e) => e.code))).toEqual(new Set(["invalid_widget_config"]));
    }
    for (const value of [1, 2, 4]) {
      expect(validateEnvelope(widgetConfig({ split: value }))).toEqual({ ok: true, errors: [] });
    }
  });
});

// ── Amendment A2/A3 regression (Phase 6 adversarial review + follow-up) ─────────────────────────
describe("validateEnvelope — amended real-runtime grammar (Amendment A2 ruling 1)", () => {
  it("composite ('NVDA+AMD'), caret ('^NDX'), and venue-qualified ('BINANCE:BTCUSDT') symbols validate", () => {
    for (const symbol of ["NVDA+AMD", "^NDX", "BINANCE:BTCUSDT"]) {
      expect(validateEnvelope(widgetConfig({ panes: [symbol] })), symbol).toEqual({ ok: true, errors: [] });
    }
  });

  it("a hyphenated chart type ('line-markers') validates", () => {
    expect(validateEnvelope(widgetConfig({ chartType: "line-markers" }))).toEqual({ ok: true, errors: [] });
  });

  it("an underscore-prefixed indicator id ('_lab') validates in inds and hidden", () => {
    expect(validateEnvelope(widgetConfig({ inds: ["_lab"] }))).toEqual({ ok: true, errors: [] });
    expect(validateEnvelope(widgetConfig({ hidden: ["_lab"] }))).toEqual({ ok: true, errors: [] });
  });

  it("a dotted premium-suite param key ('ob.showLast') validates inside indParams", () => {
    const r = validateEnvelope(widgetConfig({ indParams: { structure: { "ob.showLast": 6, "ob.on": true } } }));
    expect(r).toEqual({ ok: true, errors: [] });
  });

  it("a nested _vis shape at depth 2 (well within the depth-3 budget) validates", () => {
    const r = validateEnvelope(widgetConfig({
      indParams: { ema: { _vis: { days: { max: 366, min: 1, on: true } } } },
    }));
    expect(r).toEqual({ ok: true, errors: [] });
  });

  it("param nesting at exactly the depth-3 boundary validates; one level deeper is invalid", () => {
    // depth budget: indicator -> paramName -> L1 -> L2 -> L3(leaf). One more dict level exhausts it.
    const atBoundary = validateEnvelope(widgetConfig({
      indParams: { ema: { p: { l1: { l2: { l3: 1 } } } } },
    }));
    expect(atBoundary).toEqual({ ok: true, errors: [] });
    const beyond = validateEnvelope(widgetConfig({
      indParams: { ema: { p: { l1: { l2: { l3: { l4: 1 } } } } } },
    }));
    expect(beyond.ok).toBe(false);
  });

  it("too many keys at a single param-object level is invalid", () => {
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 65; i++) tooMany[`k${i}`] = i;
    const r = validateEnvelope(widgetConfig({ indParams: { ema: tooMany } }));
    expect(r.ok).toBe(false);
  });

  it("64 keys at a param-object level is exactly the boundary and still valid", () => {
    const exactly64: Record<string, number> = {};
    for (let i = 0; i < 64; i++) exactly64[`k${i}`] = i;
    const r = validateEnvelope(widgetConfig({ indParams: { ema: exactly64 } }));
    expect(r).toEqual({ ok: true, errors: [] });
  });
});

describe("validateEnvelope — key deny-list (Amendment A2 ruling 10)", () => {
  it("__proto__/constructor/prototype are invalid widget ids", () => {
    for (const bad of ["__proto__", "constructor", "prototype"]) {
      const e = validEnvelope();
      (e.widgets as Record<string, unknown>[])[0].id = bad;
      const r = validateEnvelope(e);
      expect(r.ok, bad).toBe(false);
    }
  });

  it("__proto__/constructor/prototype are invalid link-group names", () => {
    for (const bad of ["__proto__", "constructor", "prototype"]) {
      const e = widgetConfig({});
      // link_groups names must also match [a-z][a-z0-9_]{0,31} — these three all happen to,
      // so the deny-list is the ONLY thing that can reject them here.
      (e as Record<string, unknown>).link_groups = { [bad]: { entity_type: "security" } };
      const widgets = (e as Record<string, unknown>).widgets as Record<string, unknown>[];
      widgets[0].context_in = [];
      widgets[0].context_out = [];
      const r = validateEnvelope(e);
      expect(r.ok, bad).toBe(false);
    }
  });

  it("__proto__/constructor/prototype are invalid indParams indicator keys", () => {
    for (const bad of ["__proto__", "constructor", "prototype"]) {
      const r = validateEnvelope(widgetConfig({ indParams: { [bad]: { period: 1 } } }));
      expect(r.ok, bad).toBe(false);
    }
  });

  it("__proto__/constructor/prototype are invalid nested param keys (any depth)", () => {
    for (const bad of ["__proto__", "constructor", "prototype"]) {
      const r = validateEnvelope(widgetConfig({ indParams: { ema: { [bad]: 1 } } }));
      expect(r.ok, bad).toBe(false);
      const nested = validateEnvelope(widgetConfig({ indParams: { ema: { p: { [bad]: 1 } } } }));
      expect(nested.ok, `nested ${bad}`).toBe(false);
    }
  });

  it("__proto__/constructor/prototype are invalid compareCfg nested param keys", () => {
    for (const bad of ["__proto__", "constructor", "prototype"]) {
      const r = validateEnvelope(widgetConfig({ compare: ["SPY"], compareCfg: { SPY: { [bad]: 1 } } }));
      expect(r.ok, bad).toBe(false);
    }
  });
});

describe("validateEnvelope — `requires` optional (Amendment A2 ruling 11)", () => {
  it("a missing requires key entirely defaults to floor 1", () => {
    const e = validEnvelope();
    delete (e as Record<string, unknown>).requires;
    expect(validateEnvelope(e)).toEqual({ ok: true, errors: [] });
  });

  it("an empty requires object ({}) defaults to floor 1", () => {
    const e = validEnvelope();
    e.requires = {};
    expect(validateEnvelope(e)).toEqual({ ok: true, errors: [] });
  });

  it("requires with an unknown key is still malformed", () => {
    const e = validEnvelope();
    e.requires = { floor: 1, ceiling: 9 };
    const r = validateEnvelope(e);
    expect(r.ok).toBe(false);
  });
});

describe("validateEnvelope — source_revision law (Amendment A2 ruling 12/13)", () => {
  it("source_revision: 0 is malformed", () => {
    const e = validEnvelope();
    e.migration = { source: "chart_layout_v2", source_revision: 0 };
    expect(validateEnvelope(e).ok).toBe(false);
  });

  it("source_revision: negative is malformed", () => {
    const e = validEnvelope();
    e.migration = { source: "chart_layout_v2", source_revision: -1 };
    expect(validateEnvelope(e).ok).toBe(false);
  });

  it("source_revision: null remains valid (honest provenance for a natively-created workspace)", () => {
    const e = validEnvelope();
    e.migration = { source: "none", source_revision: null };
    expect(validateEnvelope(e)).toEqual({ ok: true, errors: [] });
  });
});

describe("validateEnvelope — wire mode (Amendment A2 ruling 5/14)", () => {
  it("stored mode (default) still refuses a non-null name", () => {
    const e = validEnvelope();
    e.name = "My Workspace";
    expect(validateEnvelope(e).ok).toBe(false);
    expect(validateEnvelope(e, false).ok).toBe(false);
  });

  it("wire mode accepts a normalized non-null name", () => {
    const e = validEnvelope();
    e.name = "My Workspace";
    expect(validateEnvelope(e, true)).toEqual({ ok: true, errors: [] });
  });

  it("wire mode still refuses an un-normalized name (leading/trailing space, doubled internal space)", () => {
    for (const bad of ["  My Workspace", "My Workspace  ", "My  Workspace"]) {
      const e = validEnvelope();
      e.name = bad;
      expect(validateEnvelope(e, true).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("wire mode still accepts null (export of an unnamed-in-payload envelope is not a real case, but null must not regress)", () => {
    const e = validEnvelope();
    expect(validateEnvelope(e, true)).toEqual({ ok: true, errors: [] });
  });
});

describe("validateEnvelope — number law (Amendment A3 ruling 2, IEEE-754 safe range + float window)", () => {
  const MAX_SAFE = 9007199254740991;

  it("an integer beyond the safe range is invalid_widget_config", () => {
    const r = validateEnvelope(widgetConfig({ indParams: { ema21: { period: MAX_SAFE + 2 } } }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((e) => e.code === "invalid_widget_config")).toBe(true);
  });

  it("an integer at the safe-range boundary is valid", () => {
    expect(validateEnvelope(widgetConfig({ indParams: { ema21: { period: MAX_SAFE } } }))).toEqual({ ok: true, errors: [] });
  });

  it("revision beyond the safe range is malformed", () => {
    const e = validEnvelope();
    e.revision = 2 ** 60;
    expect(validateEnvelope(e).ok).toBe(false);
  });

  it("source_revision beyond the safe range is malformed", () => {
    const e = validEnvelope();
    e.migration = { source: "chart_layout_v2", source_revision: 2 ** 60 };
    expect(validateEnvelope(e).ok).toBe(false);
  });

  it("requires.floor beyond the safe range is malformed_workspace, not unsupported_floor", () => {
    const e = validEnvelope();
    e.requires = { floor: 2 ** 60 };
    const r = validateEnvelope(e);
    expect(r.ok).toBe(false);
    expect(!r.ok && new Set(r.errors.map((x) => x.code))).toEqual(new Set(["malformed_workspace"]));
  });

  it("a non-integral float just below the floor (1e-4) is invalid", () => {
    expect(validateEnvelope(widgetConfig({ indParams: { ema21: { mult: 1e-5 } } })).ok).toBe(false);
  });

  it("a non-integral float at the floor boundary (1e-4) is valid", () => {
    expect(validateEnvelope(widgetConfig({ indParams: { ema21: { mult: 1e-4 } } }))).toEqual({ ok: true, errors: [] });
  });

  it("a non-integral float at the ceiling (>=1e12) is invalid", () => {
    expect(validateEnvelope(widgetConfig({ indParams: { ema21: { mult: 1_000_000_000_000.5 } } })).ok).toBe(false);
  });

  it("an integral-valued float AT 1e12 is valid (it normalizes to the plain integer)", () => {
    expect(validateEnvelope(widgetConfig({ indParams: { ema21: { mult: 1e12 } } }))).toEqual({ ok: true, errors: [] });
  });

  it("a non-integral float just below the ceiling is valid", () => {
    expect(validateEnvelope(widgetConfig({ indParams: { ema21: { mult: 999999999999.9 } } }))).toEqual({ ok: true, errors: [] });
  });

  it.each([1.5, 0.0001, 123456.789])("representative non-integral float %f is accepted", (value) => {
    expect(validateEnvelope(widgetConfig({ indParams: { ema21: { mult: value } } }))).toEqual({ ok: true, errors: [] });
  });

  it("an integral-valued number digests identically to the equivalent integer (JS has one number type)", () => {
    expect(envelopeDigest({ a: 20.0 })).toBe(envelopeDigest({ a: 20 }));
  });
});

describe("validateEnvelope — error precedence (Amendment A3 ruling 3)", () => {
  it("a future/unknown schema with an unknown top-level key reports unsupported_schema ALONE", () => {
    const envelope = {
      schema: "workspace_layout.v2", requires: { floor: 1 }, revision: 1, name: null,
      link_groups: {}, widgets: [], migration: { source: "none", source_revision: null },
      v2_new_field: 1,
    };
    expect(validateEnvelope(envelope)).toEqual({ ok: false, errors: [{ code: "unsupported_schema", path: "$.schema" }] });
  });

  it("an unsupported floor with an unknown top-level key reports unsupported_floor ALONE", () => {
    const e = validEnvelope();
    e.requires = { floor: 2 };
    (e as Record<string, unknown>).some_future_top_level_field = 1;
    expect(validateEnvelope(e)).toEqual({ ok: false, errors: [{ code: "unsupported_floor", path: "$.requires.floor" }] });
  });

  it("a structurally malformed requires (not merely unsupported) folds into the general sweep", () => {
    const e = validEnvelope();
    e.requires = { floor: 1, ceiling: 9 };
    const r = validateEnvelope(e);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((x) => x.code === "malformed_workspace")).toBe(true);
  });

  it("a supported floor (1) never short-circuits other genuine errors", () => {
    const e = validEnvelope();
    e.revision = -1; // a genuine, unrelated defect
    const r = validateEnvelope(e);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((x) => x.code === "malformed_workspace" && x.path === "$.revision")).toBe(true);
  });
});

describe("validateEnvelope — hostile fuzz (never throws, always fails closed)", () => {
  const hostiles: unknown[] = [
    null, undefined, [], 1, "string", true, () => {}, Symbol("x"),
    { schema: "workspace_layout.v1" },
    { schema: "workspace_layout.v1", widgets: "not-an-array" },
    { schema: "workspace_layout.v1", widgets: [null, 1, "x", [], {}] },
  ];

  // A genuinely deep nesting bomb — proves no stack overflow / no throw on recursive structures.
  function nestedBomb(depth: number): unknown {
    let node: unknown = { leaf: true };
    for (let i = 0; i < depth; i++) node = { child: node };
    return node;
  }

  it.each(hostiles.map((h, i) => [i, h] as const))("hostile input #%i never throws", (_i, hostile) => {
    expect(() => validateEnvelope(hostile)).not.toThrow();
    const r = validateEnvelope(hostile);
    expect(r.ok).toBe(false);
  });

  it("a deeply nested bomb never throws and fails closed", () => {
    const bomb = nestedBomb(5000);
    expect(() => validateEnvelope(bomb)).not.toThrow();
    expect(validateEnvelope(bomb).ok).toBe(false);
  });

  it("a hostile widget config never throws", () => {
    const e = validEnvelope();
    (e.widgets as Record<string, unknown>[])[0].config = nestedBomb(500);
    expect(() => validateEnvelope(e)).not.toThrow();
  });

  it("unknown migration.source never throws and fails closed", () => {
    const e = validEnvelope();
    e.migration = { source: "from_the_future", source_revision: null };
    expect(() => validateEnvelope(e)).not.toThrow();
    expect(validateEnvelope(e).ok).toBe(false);
  });

  it("non-integer revision never throws and fails closed", () => {
    const e = validEnvelope();
    for (const bad of [1.5, "3", null, -1, 0, NaN, Infinity]) {
      e.revision = bad;
      expect(() => validateEnvelope(e)).not.toThrow();
      expect(validateEnvelope(e).ok).toBe(false);
    }
  });
});

describe("isWorkspaceEnvelope", () => {
  it("recognizes a valid canonical envelope", () => {
    expect(isWorkspaceEnvelope(validEnvelope())).toBe(true);
  });

  it("rejects a non-workspace config without throwing", () => {
    expect(isWorkspaceEnvelope({ schemaVersion: 2, panes: ["AAPL"] })).toBe(false);
    expect(isWorkspaceEnvelope(null)).toBe(false);
    expect(isWorkspaceEnvelope("nope")).toBe(false);
  });

  it("rejects a same-schema-tagged but structurally invalid payload", () => {
    const e = validEnvelope();
    e.revision = -1;
    expect(isWorkspaceEnvelope(e)).toBe(false);
  });
});

describe("rowStateFor — library row read state (contract §8/§9)", () => {
  it("ok for a valid envelope", () => {
    expect(rowStateFor(validEnvelope())).toBe("ok");
  });

  it("unsupported_floor for a floor above what this build supports", () => {
    const e = validEnvelope();
    e.requires = { floor: 2 };
    expect(rowStateFor(e)).toBe("unsupported_floor");
  });

  it("unsupported_schema for a non-workspace config", () => {
    expect(rowStateFor({ schemaVersion: 2, panes: ["AAPL"] })).toBe("unsupported_schema");
    expect(rowStateFor(null)).toBe("unsupported_schema");
    expect(rowStateFor("garbage")).toBe("unsupported_schema");
  });

  it("unsupported_schema (never crashes) for a structurally broken workspace-tagged payload", () => {
    const e = validEnvelope();
    e.widgets = "not-an-array";
    expect(() => rowStateFor(e)).not.toThrow();
    expect(rowStateFor(e)).toBe("unsupported_schema");
  });

  it("never renders a failure state as ok — a row is never silently healthy", () => {
    const brokenOnes = [
      { ...validEnvelope(), revision: -1 },
      { ...validEnvelope(), name: "not null" },
    ];
    for (const b of brokenOnes) expect(rowStateFor(b)).not.toBe("ok");
  });
});

describe("envelopeDigest", () => {
  it("is deterministic and key-order independent", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(envelopeDigest(a)).toBe(envelopeDigest(b));
    expect(envelopeDigest(a)).toBe(envelopeDigest(a));
  });

  it("never throws on hostile input and always returns a 64-char hex string", () => {
    for (const hostile of [null, undefined, [], 1, "x", validEnvelope()]) {
      let digest: string | undefined;
      expect(() => { digest = envelopeDigest(hostile); }).not.toThrow();
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("differs for a materially different envelope", () => {
    const a = validEnvelope();
    const b = validEnvelope();
    b.revision = 999;
    expect(envelopeDigest(a)).not.toBe(envelopeDigest(b));
  });
});
