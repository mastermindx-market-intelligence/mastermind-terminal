// ── W1-C parity mechanism: Terminal's migration proven byte-identical to the Macro reference ────
//
// The fixtures here (`lib/__tests__/fixtures/workspace/*.json`) are copied BYTE-IDENTICAL from the
// Macro repo's `contracts/intelligence_workspace/fixtures/workspace_migration/` — the same vectors
// `engine/intelligence_workspace/workspace_layout.py`'s own test suite pins. The digest law:
// sha256 of each file's raw bytes, then sha256 over the concatenation of those per-file hex digests
// (sorted by filename) — reproduced verbatim from `tests/test_intelligence_workspace_workspace_layout.py`
// (Macro repo) `test_manifest_recomputes_to_the_pinned_vectors_digest`.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrateLegacy } from "../workspaceMigrate";
import { CHART_CONFIG_FIELDS, validateEnvelope, type FailureCode, type WorkspaceEnvelope } from "../workspaceLayout";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/workspace/", import.meta.url));

type ManifestEntry = { name: string; sha256: string };
type Manifest = { files: ManifestEntry[]; vectors_digest: string };

const manifest: Manifest = JSON.parse(readFileSync(`${FIXTURES_DIR}MANIFEST.json`, "utf8"));

/** Hard literal (frozen packet §SCOPE-item-1): a drift here means the fixtures no longer match the
 *  Macro-side pin, and MUST be investigated rather than updated to make the test pass.
 *
 *  Re-pinned under Amendment A3 + the NB-F fixup (2026-08-26, Macro commits c305b0a9b286 /
 *  41f630183d22): real-runtime grammar, lossless-or-refuse -> direction-scoped strict/tolerant
 *  migration, IEEE-754-safe number bounds, error precedence, canonicalization
 *  (`ensure_ascii=False`), wire mode, key deny-list, optional `requires`, honest provenance. The
 *  vector set grew a real-capture vector (`chart_layout_v2_real_capture.json`) and six `tolerant_v2_*`
 *  probe-C vectors. Earlier digests (pre-A1 `4111f9d2...`, post-A1 `9eeef5b4...`) are BOTH VOID.
 *
 *  DEVIATION (see the worker's final report): the commissioning packet specified Amendment A2
 *  (digest `d8bc519a...`), but the Macro branch (`claude/deepvue-w2a-macro-contract`) advanced past
 *  it to Amendment A3 + NB-F WHILE this worker was implementing A2 — verified via a fresh `git
 *  fetch` mid-task. A2's own digest is void per A3's freeze-doc header, so this worker implemented
 *  against the CURRENT canonical state rather than a snapshot Macro itself had already superseded. */
const PINNED_VECTORS_DIGEST = "3e7c1c50faf8b03b4fa2f3ad2c66db3ebf9ba3ebd93bbb15b228654c382ff339";

type ValidVector = { input: unknown; expected: WorkspaceEnvelope };
type InvalidVector = { input: unknown; expected_code: FailureCode };
type TolerantVector = { input: unknown; expected: WorkspaceEnvelope; expected_strict_code: FailureCode; expected_unclaimed: string[] };

function loadVector(name: string): ValidVector | InvalidVector | TolerantVector {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, "utf8"));
}

describe("MANIFEST digest — recomputes to the pinned literal", () => {
  it("every listed file's sha256 matches its recorded digest", () => {
    for (const row of manifest.files) {
      const digest = createHash("sha256").update(readFileSync(`${FIXTURES_DIR}${row.name}`)).digest("hex");
      expect(digest, row.name).toBe(row.sha256);
    }
  });

  it("lists every fixture file on disk and nothing extra", () => {
    const onDisk = new Set(readdirSync(FIXTURES_DIR).filter((f) => f !== "MANIFEST.json"));
    const listed = new Set(manifest.files.map((f) => f.name));
    expect(listed).toEqual(onDisk);
  });

  it("recomputes vectors_digest = sha256(join(sorted per-file sha256 hex strings)) and it equals the hard literal", () => {
    const entries = [...manifest.files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const recomputed = createHash("sha256")
      .update(entries.map((row) => row.sha256).join(""), "utf8")
      .digest("hex");
    expect(recomputed).toBe(manifest.vectors_digest);
    expect(manifest.vectors_digest).toBe(PINNED_VECTORS_DIGEST);
  });
});

const VALID_VECTOR_FILES = [
  "legacy_v0_bare.json",
  "legacy_v0_minimal.json",
  "chart_layout_v1_sparse.json",
  "chart_layout_v1_typical.json",
  "chart_layout_v2_sparse.json",
  "chart_layout_v2_full.json",
  "chart_layout_v2_real_capture.json",
];

const INVALID_VECTOR_FILES = [
  "invalid_duplicate_widget_id.json",
  "invalid_floor_unsupported.json",
  "invalid_lane.json",
  "invalid_non_dict_input.json",
  "invalid_non_null_name.json",
  "invalid_oversized_workspace.json",
  "invalid_port.json",
  "invalid_too_many_widgets.json",
  "invalid_unknown_chart_config_key.json",
  "invalid_unknown_schema.json",
  "invalid_unknown_top_level_key.json",
  "invalid_unknown_widget_type.json",
];

// Amendment A3 ruling 1 (direction-scoped lossless law) "probe-C" vectors: each corrupts exactly
// ONE owned chart-config field. `strict=true` (WRITE/IMPORT) must refuse with `expected_strict_code`;
// `strict=false` (READ/RENDER) must claim every OTHER field and list only the corrupted one in
// `unclaimed`. NB-F: the strict expectation ships INSIDE the shared vector bytes, so the Terminal
// mirror is pinned to BOTH modes by the same digest, not just one.
const TOLERANT_VECTOR_FILES = [
  "tolerant_v2_activepane7.json",
  "tolerant_v2_charttype_empty.json",
  "tolerant_v2_comparecfg_junk.json",
  "tolerant_v2_inds_mixed.json",
  "tolerant_v2_panes_empty.json",
  "tolerant_v2_split3.json",
];

describe("golden vectors — file inventory matches the frozen fixture set", () => {
  it("25 vectors total, none missed by any list", () => {
    expect(VALID_VECTOR_FILES.length + INVALID_VECTOR_FILES.length + TOLERANT_VECTOR_FILES.length).toBe(25);
    const all = new Set([...VALID_VECTOR_FILES, ...INVALID_VECTOR_FILES, ...TOLERANT_VECTOR_FILES]);
    const listed = new Set(manifest.files.map((f) => f.name));
    expect(all).toEqual(listed);
  });
});

describe.each(VALID_VECTOR_FILES)("migrateLegacy — valid vector %s", (file) => {
  const vector = loadVector(file) as ValidVector;

  it("deep-equals the pinned expected envelope (strict, the default)", () => {
    const result = migrateLegacy(vector.input);
    expect(result).toEqual({ ok: true, envelope: vector.expected });
  });

  it("is deterministic — running it twice yields the identical envelope", () => {
    const first = migrateLegacy(vector.input);
    const second = migrateLegacy(vector.input);
    expect(first).toEqual(second);
    expect(first).toEqual({ ok: true, envelope: vector.expected });
  });
});

describe.each(INVALID_VECTOR_FILES)("migrateLegacy — invalid vector %s", (file) => {
  const vector = loadVector(file) as InvalidVector;

  it("fails with the exact expected_code", () => {
    const result = migrateLegacy(vector.input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe(vector.expected_code);
  });

  it("never throws and is deterministic on repeat", () => {
    expect(() => migrateLegacy(vector.input)).not.toThrow();
    const a = migrateLegacy(vector.input);
    const b = migrateLegacy(vector.input);
    expect(a).toEqual(b);
  });
});

describe.each(TOLERANT_VECTOR_FILES)("migrateLegacy — direction-scoped lossless law, vector %s", (file) => {
  const vector = loadVector(file) as TolerantVector;

  it("strict=true (WRITE/IMPORT, the default) refuses with expected_strict_code", () => {
    const result = migrateLegacy(vector.input, true);
    expect(result).toEqual({ ok: false, code: vector.expected_strict_code });
    // The bare one-arg call must behave identically to the default.
    expect(migrateLegacy(vector.input)).toEqual({ ok: false, code: vector.expected_strict_code });
  });

  it("strict=false (READ/RENDER) matches the committed envelope and unclaimed list, deterministically", () => {
    const first = migrateLegacy(vector.input, false);
    const second = migrateLegacy(vector.input, false);
    expect(first).toEqual(second);
    expect(first).toEqual({ ok: true, envelope: vector.expected, unclaimed: vector.expected_unclaimed });
  });

  it("the expected envelope itself passes validateEnvelope", () => {
    expect(validateEnvelope(vector.expected)).toEqual({ ok: true, errors: [] });
  });

  it("corrupts exactly one owned field; the tolerant migration drops that one and keeps every other", () => {
    expect(vector.expected_unclaimed).toHaveLength(1);
    const [dropped] = vector.expected_unclaimed;
    const config = vector.expected.widgets[0].config as Record<string, unknown>;
    expect(config).not.toHaveProperty(dropped);
    const input = vector.input as Record<string, unknown>;
    const baseFields = CHART_CONFIG_FIELDS.filter((f) => f in input);
    for (const field of baseFields) {
      if (field === dropped) continue;
      expect(config).toHaveProperty(field);
    }
  });
});

// Amendment A2 ruling 3 (M3): the real-capture vector proves the amended grammar against ACTUAL
// Terminal shapes, not synthetic examples — composite/caret/venue-qualified symbols, a hyphenated
// chart type, an underscore-prefixed indicator id, dotted premium-suite param keys, a real depth-3
// nested `_vis` shape, and a non-integral float param.
describe("chart_layout_v2_real_capture.json — amended-grammar values migrate and validate", () => {
  const vector = loadVector("chart_layout_v2_real_capture.json") as ValidVector;
  const config = vector.expected.widgets[0].config as Record<string, unknown>;

  it("composite ('NVDA+AMD') and caret ('^NDX') pane symbols", () => {
    expect(config.panes).toEqual(["NVDA+AMD", "^NDX"]);
  });

  it("hyphenated chart type ('line-markers')", () => {
    expect(config.chartType).toBe("line-markers");
  });

  it("underscore-prefixed indicator id ('_lab') in both inds and hidden", () => {
    expect(config.inds).toContain("_lab");
    expect(config.hidden).toEqual(["_lab"]);
  });

  it("dotted premium-suite param keys ('ob.showLast' etc.) inside indParams.structure", () => {
    const indParams = config.indParams as Record<string, Record<string, unknown>>;
    expect(indParams.structure).toEqual({ "ob.kImpulse": 1.6, "ob.method": "volume", "ob.on": true, "ob.showLast": 6 });
  });

  it("the real depth-3 nested _vis shape survives intact", () => {
    const indParams = config.indParams as Record<string, Record<string, unknown>>;
    expect(indParams.ema._vis).toEqual({
      days: { max: 366, min: 1, on: true },
      months: { max: 12, min: 1, on: true },
      weeks: { max: 52, min: 1, on: true },
    });
  });

  it("a real CmpCfg shape ({color,lineStyle,lineWidth,mode}) in compareCfg", () => {
    const compareCfg = config.compareCfg as Record<string, unknown>;
    expect(compareCfg.QQQ).toEqual({ color: "#26c281", lineStyle: 0, lineWidth: 2, mode: "percent" });
  });

  it("a non-integral float param (mult) survives migration and re-validates", () => {
    const indParams = config.indParams as Record<string, Record<string, unknown>>;
    expect(indParams.bb.mult).toBe(1.5);
    expect(validateEnvelope(vector.expected)).toEqual({ ok: true, errors: [] });
  });

  it("a string lockedVLine (Amendment A1) is present", () => {
    expect(config.lockedVLine).toBe("2026-08-12T14:30:00Z");
  });
});
