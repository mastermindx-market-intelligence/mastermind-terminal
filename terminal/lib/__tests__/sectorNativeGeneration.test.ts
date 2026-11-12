import { describe, expect, it } from "vitest";
import { sectorDossiers, sectorWindowMeasurements } from "../sectorDossiers";
import {
  nativeSectorEvidence, sectorNativeGeneration, SECTOR_GENERATION_AUDIENCE, SECTOR_GENERATION_PATH,
  SECTOR_GENERATION_PREVIEW_AUDIENCE, SECTOR_GENERATION_PREVIEW_PATH,
} from "../sectorNativeGeneration";
import type { FeedPayload } from "../sectorIntelligence";
import captured from "./fixtures/sector_generation.captured.preview.v1.json";

// Actual capture -> five-document publisher -> mounted Macro API preview bytes.
// The population and authentication are controlled fixtures, not production proof.
const wire = () => structuredClone(captured);
/** R4 fixture law: the capture is a PREVIEW document and is never modified. A
 * successful entitled fixture is a clone of those exact bytes with both
 * audience labels flipped — nothing else differs. */
const entitledWire = () => {
  const w = wire();
  w.audience = SECTOR_GENERATION_AUDIENCE;
  w.projection.data.audience = SECTOR_GENERATION_AUDIENCE;
  return w;
};
/** R3: the receipt path must pair with the document's own audience. */
const pathFor = (data: unknown): string =>
  (data as { audience?: unknown }).audience === SECTOR_GENERATION_AUDIENCE
    ? SECTOR_GENERATION_PATH : SECTOR_GENERATION_PREVIEW_PATH;
const feed = (data: unknown = wire()): FeedPayload => ({ data, receipt: {
  source: "generation", path: pathFor(data), status: "ready",
  asOf: captured.source_session, observedAt: "2026-11-07T20:00:00Z", stale: false,
  contentHash: "a".repeat(64),
} });

describe("one selected native Sector generation", () => {
  it("admits the actual mounted API wire and preserves all eleven identities, zeros and companion values", () => {
    const read = sectorNativeGeneration(captured);
    expect(read).not.toBeNull();
    expect(read!.receipt).toEqual(captured.projection.receipt);
    expect(read!.sectors).toHaveLength(11);
    expect(Object.keys(read!.history.series)).toHaveLength(11);
    expect(read!.history.series.xlk.points.at(-1)).toMatchObject({ date: captured.source_session, rs21: 0, rs63: 0 });
    expect(sectorDossiers(read!.core)).toEqual(sectorDossiers(captured.projection.data.core));
    expect(sectorWindowMeasurements(read!.core)).toEqual(sectorWindowMeasurements(captured.projection.data.core));
    expect(sectorDossiers(read!.core).state).toBe("ok");
    expect(sectorWindowMeasurements(read!.core).state).toBe("ok");
  });

  it.each([
    ["outer audience", (w: ReturnType<typeof wire>) => { w.audience = "entitled"; }],
    ["projection audience", (w: ReturnType<typeof wire>) => { w.projection.data.audience = "entitled"; }],
    ["receipt session", (w: ReturnType<typeof wire>) => { w.projection.receipt.source_session = "2026-11-04"; }],
    ["receipt publication", (w: ReturnType<typeof wire>) => { w.projection.receipt.published_at = "2026-11-04T01:00:00Z"; }],
    ["receipt qualification", (w: ReturnType<typeof wire>) => { w.projection.receipt.qualification = "stale"; }],
    ["core session", (w: ReturnType<typeof wire>) => { w.projection.data.core.as_of = "2026-11-04"; }],
    ["history session", (w: ReturnType<typeof wire>) => { w.projection.data.history.meta.asOf = "2026-11-04"; }],
    ["measured session", (w: ReturnType<typeof wire>) => { w.projection.data.core.measured_read.generation.session_end = "2026-11-04"; }],
    ["history identity", (w: ReturnType<typeof wire>) => { w.projection.data.history.sectors[0].ticker = "XLE"; }],
    ["duplicate core identity", (w: ReturnType<typeof wire>) => { w.projection.data.core.sectors[1].id = w.projection.data.core.sectors[0].id; }],
    ["missing history member", (w: ReturnType<typeof wire>) => { w.projection.data.history.sectors.pop(); }],
    ["future history", (w: ReturnType<typeof wire>) => { w.projection.data.history.sectors[0].rs_history.at(-1)!.date = "2026-11-04"; }],
    ["invalid hash", (w: ReturnType<typeof wire>) => { w.projection.receipt.content_sha256 = "unbound"; }],
    ["invalid owner token", (w: ReturnType<typeof wire>) => { w.projection.receipt.generation_id = "g:1"; }],
    ["year zero", (w: ReturnType<typeof wire>) => { w.source_session = "0000-11-03"; }],
    ["oversized publication clock", (w: ReturnType<typeof wire>) => {
      w.published_at = w.projection.receipt.published_at = "2026-11-03T23:00:21.123456789012345Z";
    }],
    ["impossible date", (w: ReturnType<typeof wire>) => { w.source_session = "2026-02-30"; }],
  ])("refuses a mixed or invalid %s", (_name, mutate) => {
    const w = wire(); mutate(w); expect(sectorNativeGeneration(w)).toBeNull();
  });

  it("never compares the owner representation hash to the gateway's full wire hash", () => {
    const result = nativeSectorEvidence(feed());
    expect(result.generation).not.toBeNull();
    expect(result.feed!.receipt.contentHash).toBe("a".repeat(64));
    expect(result.generation!.receipt.content_sha256).not.toBe(result.feed!.receipt.contentHash);
    expect(result.feed!.receipt.asOf).toBe(captured.source_session);
    expect(result.feed!.receipt.observedAt).toBe("2026-11-07T20:00:00Z");
  });

  it("admits only the closed projection-error stub and never ignores an added mismatched parent", () => {
    const w = wire();
    const stub = { schema: "leadership_rotation_context.measured_group_read/v1", status: "unavailable", reason: "projection_error" };
    Object.assign(w.projection.data.core, { measured_read: stub });
    expect(sectorNativeGeneration(w)).not.toBeNull();
    Object.assign(stub, { generation: { session_end: w.source_session, benchmark: "QQQ" }, cohort: {}, groups: [] });
    expect(sectorNativeGeneration(w)).toBeNull();
  });

  it.each(["constructor", "prototype", "x".repeat(300)])("preserves accepted opaque companion receipt keys: %s", key => {
    const w = wire();
    Object.assign(w.projection.data.core.measured_read.sector_window_measurements, { receipt: { [key]: 1 } });
    const existing = sectorWindowMeasurements(w.projection.data.core);
    expect(existing.state).toBe("ok");
    const admitted = sectorNativeGeneration(w);
    expect(admitted).not.toBeNull();
    expect(sectorWindowMeasurements(admitted!.core)).toEqual(existing);
  });

  it.each(["access", "unavailable", "invalid", "error", "loading"] as const)("withdraws all native data on %s", status => {
    const f = feed(); f.receipt.status = status;
    const result = nativeSectorEvidence(f);
    expect(result.generation).toBeNull(); expect(result.feed!.data).toBeNull();
    expect(result.feed!.receipt.status).toBe(status);
  });

  it("refuses the static artifact and path/date substitutions without fallback", () => {
    expect(sectorNativeGeneration(captured.projection.data.core)).toBeNull();
    for (const patch of [{ source: "sector" as const }, { path: "/sectordata/sector_central.json" }, { asOf: "2026-11-04" }]) {
      const f = feed(); Object.assign(f.receipt, patch);
      expect(nativeSectorEvidence(f).generation).toBeNull();
      expect(nativeSectorEvidence(f).feed!.data).toBeNull();
    }
  });

  it("changes presentation identity for a same-session replacement without restamping source time", () => {
    const first = sectorNativeGeneration(wire())!;
    const next = wire(); next.projection.receipt.generation_id = "captured-sector-2";
    next.projection.receipt.content_sha256 = "b".repeat(64);
    const second = sectorNativeGeneration(next)!;
    expect(second.key).not.toBe(first.key);
    expect(second.receipt.source_session).toBe(first.receipt.source_session);
  });

  it("retains a stale/degraded owner verdict without treating retrieval as freshness", () => {
    for (const qualification of ["stale", "degraded"]) {
      const w = wire(); w.qualification = qualification; w.projection.receipt.qualification = qualification;
      const result = nativeSectorEvidence(feed(w));
      expect(result.generation!.receipt.qualification).toBe(qualification);
      expect(result.feed!.receipt.stale).toBe(qualification === "stale");
    }
  });
});

// Item 7 (COO 19:56Z): lane 1's next increment grows `typed_blocks` from seven
// names to twelve. The five new names — all entitled-only — are appended after
// `theme_table`: confluence_universe_sp500, confluence_universe_nasdaq,
// confluence_universe_russell, confluence_universe_baskets, theme_rows. Each is
// {status, reason, value} like the others; a value can be up to 516 KiB
// encoded; the 4 MiB whole-document bound is unchanged.
//
// R3/R4 note: those five names are entitled-only. An AVAILABLE value in any of
// them is lawful only on an ENTITLED document — on a preview document it makes
// the whole document invalid (see the R3 suite below). Every test below that
// plants available values in the five therefore derives from `entitledWire()`;
// preview-based arms plant only incumbent names or unavailable stubs.
describe("sectorTypedBlocks — item 7 (COO 19:56Z): twelve typed-block names, unknown names tolerated", () => {
  const INCUMBENT_KEYS = ["r1_rising_priced_share", "r2_display_order", "r2_hazard_qualification",
    "etf_flows", "confluence", "bottoming_watch", "theme_table"] as const;
  const NEW_KEYS = ["confluence_universe_sp500", "confluence_universe_nasdaq",
    "confluence_universe_russell", "confluence_universe_baskets", "theme_rows"] as const;
  const TWELVE = [...INCUMBENT_KEYS, ...NEW_KEYS];
  const universe = { members: ["AAPL", "MSFT", "NVDA"], as_of: "2026-11-03" };

  const withBlocks = (blocks: Record<string, unknown>, base: ReturnType<typeof wire> = wire()) => {
    const w = base;
    Object.assign(w.projection.data, { typed_blocks: blocks });
    return w;
  };
  type PlantedBlock = { status: string; reason: string | null; value: unknown };
  /** All twelve present with legal mixed states — the incumbent seven keep
   * their today shapes; each new name is available with a small value. */
  const twelveBlocks = (): Record<string, PlantedBlock> => ({
    r1_rising_priced_share: { status: "unavailable", reason: "not_produced", value: null },
    r2_display_order: { status: "available", reason: null, value: ["xlk", "xlf"] },
    r2_hazard_qualification: { status: "unavailable", reason: "not_produced", value: null },
    etf_flows: { status: "available", reason: null, value: [{ ticker: "SMH", net: 1 }] },
    confluence: { status: "unavailable", reason: "not_produced", value: null },
    bottoming_watch: { status: "available", reason: null, value: { as_of: "2026-11-03", rows: [] } },
    theme_table: { status: "available", reason: null, value: [{ theme: "ai", score: 1 }] },
    confluence_universe_sp500: { status: "available", reason: null, value: { ...universe } },
    confluence_universe_nasdaq: { status: "available", reason: null, value: { ...universe, members: ["AAPL"] } },
    confluence_universe_russell: { status: "available", reason: null, value: { ...universe, members: ["A", "B"] } },
    confluence_universe_baskets: { status: "available", reason: null, value: { semis: ["SMH"] } },
    theme_rows: { status: "available", reason: null, value: [{ id: "ai", label: "AI" }] },
  });

  it("admits a generation carrying all twelve typed-block names and passes the five new ones through untouched", () => {
    const blocks = twelveBlocks();
    const read = sectorNativeGeneration(withBlocks(blocks, entitledWire()));
    expect(read).not.toBeNull();
    expect(Object.keys(read!.typedBlocks)).toEqual(TWELVE);
    // Passed through untouched: same value reference, verbatim status/reason.
    expect(read!.typedBlocks.confluence_universe_sp500).toEqual({
      status: "available", reason: null, value: blocks.confluence_universe_sp500.value });
    expect(read!.typedBlocks.theme_rows.value).toBe(blocks.theme_rows.value);
    expect(read!.typedBlocks.etf_flows.value).toBe(blocks.etf_flows.value);
  });

  it("admits a generation that still carries only the seven incumbent names — the five new ones stay not_produced", () => {
    const read = sectorNativeGeneration(withBlocks({
      etf_flows: { status: "available", reason: null, value: [] },
      confluence: { status: "unavailable", reason: "audience_not_entitled", value: null },
    }));
    expect(read).not.toBeNull();
    expect(Object.keys(read!.typedBlocks)).toEqual(TWELVE);
    expect(read!.typedBlocks.etf_flows.status).toBe("available");
    expect(read!.typedBlocks.confluence).toEqual({ status: "unavailable", reason: "audience_not_entitled", value: null });
    for (const key of NEW_KEYS) {
      expect(read!.typedBlocks[key]).toEqual({ status: "unavailable", reason: "not_produced", value: null });
    }
  });

  it("admits a generation carrying an unknown thirteenth block name — ignored, never refused, never thrown", () => {
    const blocks = twelveBlocks();
    Object.assign(blocks, { quarterly_attributions: { status: "available", reason: null, value: [1, 2, 3] } });
    const read = sectorNativeGeneration(withBlocks(blocks, entitledWire()));
    expect(read).not.toBeNull();
    expect(Object.keys(read!.typedBlocks)).toEqual(TWELVE);
    expect(read!.typedBlocks.quarterly_attributions).toBeUndefined();
  });

  it("admits a new-name block whose value is null with reason block_too_large as its own unavailable state", () => {
    const blocks = twelveBlocks();
    blocks.confluence_universe_baskets = { status: "unavailable", reason: "block_too_large", value: null };
    const read = sectorNativeGeneration(withBlocks(blocks, entitledWire()));
    expect(read).not.toBeNull();
    expect(read!.typedBlocks.confluence_universe_baskets).toEqual({
      status: "unavailable", reason: "block_too_large", value: null });
  });

  it("admits a new-name block whose value is one 516 KiB-encoded string — no per-block cap below 516 KiB", () => {
    // 516 * 1024 ASCII chars = exactly 516 KiB of UTF-8.
    const fiveSixteen = "x".repeat(516 * 1024);
    const blocks = twelveBlocks();
    blocks.theme_rows = { status: "available", reason: null, value: fiveSixteen };
    const read = sectorNativeGeneration(withBlocks(blocks, entitledWire()));
    expect(read).not.toBeNull();
    expect(read!.typedBlocks.theme_rows.status).toBe("available");
    const carried = read!.typedBlocks.theme_rows.value as string;
    expect(carried.length).toBe(516 * 1024);
    expect(carried.startsWith("xxxx")).toBe(true);
  });

  it("admits a new-name block whose ~516 KiB value is an array of scalars — the walk budget follows the byte bound", () => {
    // 264,192 minimal two-byte elements ("1,") = 516 KiB encoded; a 10,000-entry
    // per-container cap smaller than that would refuse a legal value.
    const rows = Array.from({ length: 264_192 }, () => 1);
    const blocks = twelveBlocks();
    blocks.confluence_universe_russell = { status: "available", reason: null, value: rows };
    const read = sectorNativeGeneration(withBlocks(blocks, entitledWire()));
    expect(read).not.toBeNull();
    expect((read!.typedBlocks.confluence_universe_russell.value as number[]).length).toBe(264_192);
  });

  // N-7 (third review): the array path must refuse a monster array BEFORE
  // enumerating its children. The boolean outcome (refused) is the same either
  // way, so the law is observed through an ownKeys spy: the pre-check reads
  // only .length and must never let Object.entries touch the array's keys.
  it("N-7: an array over the remaining node budget is refused BEFORE its children are enumerated", () => {
    let enumerated = false;
    const monster = new Proxy(new Array(600_005).fill(null), {
      ownKeys: (target: null[]) => { enumerated = true; return Reflect.ownKeys(target); },
    });
    const blocks = twelveBlocks();
    blocks.theme_rows = { status: "available", reason: null, value: monster as unknown as object[] };
    expect(sectorNativeGeneration(withBlocks(blocks, entitledWire()))).toBeNull();
    expect(enumerated).toBe(false);
  });
});

// R3 (COO rulings 2026-11-11): the audience is a closed set of exactly two —
// {entitled, preview} — and a generation document is admitted only under full
// four-way agreement: the path fetched, the outer audience, the nested
// projection audience and the feed receipt's own path must all name the same
// audience. Cross-bindings are rejected in BOTH directions. And as defense in
// depth beyond what the owner enforces: a preview document in which any of the
// five entitled-only blocks carries rows instead of a stub is invalid whole.
describe("sectorNativeGeneration — R3 four-way audience binding", () => {
  const ENTITLED_ONLY = ["confluence_universe_sp500", "confluence_universe_nasdaq",
    "confluence_universe_russell", "confluence_universe_baskets", "theme_rows"] as const;
  const evidenceFor = (data: unknown, path: string): FeedPayload => ({ data, receipt: {
    source: "generation", path, status: "ready",
    asOf: captured.source_session, observedAt: "2026-11-07T20:00:00Z", stale: false,
    contentHash: "a".repeat(64),
  } });

  it("admits both audiences under full four-way agreement", () => {
    const entitled = nativeSectorEvidence(evidenceFor(entitledWire(), SECTOR_GENERATION_PATH));
    expect(entitled.generation).not.toBeNull();
    expect(entitled.generation!.sectors).toHaveLength(11);
    expect(entitled.generation!.receipt.source_session).toBe(captured.source_session);
    const preview = nativeSectorEvidence(evidenceFor(wire(), SECTOR_GENERATION_PREVIEW_PATH));
    expect(preview.generation).not.toBeNull();
    expect(preview.generation!.sectors).toHaveLength(11);
  });

  it("admits the preview document whose five entitled-only blocks arrive as audience_not_entitled stubs", () => {
    const w = wire();
    const stub = { status: "unavailable", reason: "audience_not_entitled", value: null };
    Object.assign(w.projection.data, { typed_blocks: {
      confluence_universe_sp500: { ...stub }, confluence_universe_nasdaq: { ...stub },
      confluence_universe_russell: { ...stub }, confluence_universe_baskets: { ...stub },
      theme_rows: { ...stub },
    } });
    const result = nativeSectorEvidence(evidenceFor(w, SECTOR_GENERATION_PREVIEW_PATH));
    expect(result.generation).not.toBeNull();
    for (const key of ENTITLED_ONLY) {
      expect(result.generation!.typedBlocks[key]).toEqual(stub);
    }
  });

  it("rejects an entitled document whenever any one of the four bindings disagrees", () => {
    const breaks: Array<[name: string, mutate?: (w: ReturnType<typeof entitledWire>) => void, path?: string]> = [
      ["outer audience flipped to preview", (w) => { w.audience = SECTOR_GENERATION_PREVIEW_AUDIENCE; }],
      ["nested projection audience flipped to preview", (w) => { w.projection.data.audience = SECTOR_GENERATION_PREVIEW_AUDIENCE; }],
      ["receipt path names the preview audience", undefined, SECTOR_GENERATION_PREVIEW_PATH],
      ["receipt path outside the closed two-path set", undefined, "/api/sector-generation"],
      ["receipt path carries a hostile audience", undefined, "/api/sector-generation?audience=member"],
    ];
    for (const [name, mutate, path] of breaks) {
      const w = entitledWire(); mutate?.(w);
      const result = nativeSectorEvidence(evidenceFor(w, path ?? SECTOR_GENERATION_PATH));
      expect(result.generation, name).toBeNull();
      expect(result.feed!.data, name).toBeNull();
    }
  });

  it("rejects a preview document whenever any one of the four bindings disagrees", () => {
    const breaks: Array<[name: string, mutate?: (w: ReturnType<typeof wire>) => void, path?: string]> = [
      ["outer audience flipped to entitled", (w) => { w.audience = SECTOR_GENERATION_AUDIENCE; }],
      ["nested projection audience flipped to entitled", (w) => { w.projection.data.audience = SECTOR_GENERATION_AUDIENCE; }],
      ["receipt path names the entitled audience", undefined, SECTOR_GENERATION_PATH],
      ["receipt path outside the closed two-path set", undefined, "/api/sector-generation"],
      ["receipt path carries a hostile audience", undefined, "/api/sector-generation?audience=entitled&x=1"],
    ];
    for (const [name, mutate, path] of breaks) {
      const w = wire(); mutate?.(w);
      const result = nativeSectorEvidence(evidenceFor(w, path ?? SECTOR_GENERATION_PREVIEW_PATH));
      expect(result.generation, name).toBeNull();
      expect(result.feed!.data, name).toBeNull();
    }
  });

  it.each(["member", "public", "internal", null])(
    "refuses an audience outside the closed set even when outer and nested agree: %s", value => {
      const w = wire();
      w.audience = value as string;
      w.projection.data.audience = value as string;
      expect(sectorNativeGeneration(w)).toBeNull();
      expect(sectorNativeGeneration(w, SECTOR_GENERATION_PREVIEW_AUDIENCE)).toBeNull();
    });

  it.each(ENTITLED_ONLY)("R3 defense in depth: a preview document carrying rows in %s is invalid whole", key => {
    const w = wire();
    Object.assign(w.projection.data, { typed_blocks: {
      [key]: { status: "available", reason: null, value: [{ id: "LEAK-PREVIEW-ROW" }] },
    } });
    // All four bindings agree on preview — the document is still refused whole.
    const result = nativeSectorEvidence(evidenceFor(w, SECTOR_GENERATION_PREVIEW_PATH));
    expect(result.generation).toBeNull();
    expect(result.feed!.data).toBeNull();
    expect(sectorNativeGeneration(w, SECTOR_GENERATION_PREVIEW_AUDIENCE)).toBeNull();
  });

  it("the same rows on an entitled document are admitted — the defense is scoped to the preview audience", () => {
    const w = entitledWire();
    Object.assign(w.projection.data, { typed_blocks: {
      theme_rows: { status: "available", reason: null, value: [{ id: "lawful-theme-row" }] },
      confluence_universe_sp500: { status: "available", reason: null, value: { members: ["AAPL"] } },
    } });
    const result = nativeSectorEvidence(evidenceFor(w, SECTOR_GENERATION_PATH));
    expect(result.generation).not.toBeNull();
    expect((result.generation!.typedBlocks.theme_rows.value as { id: string }[])[0].id).toBe("lawful-theme-row");
  });

  it("a stub whose value is not null still invalidates a preview document — the stub law is exact", () => {
    const w = wire();
    Object.assign(w.projection.data, { typed_blocks: {
      theme_rows: { status: "unavailable", reason: "audience_not_entitled", value: [{ id: "LEAK-STUB-VALUE" }] },
    } });
    expect(sectorNativeGeneration(w, SECTOR_GENERATION_PREVIEW_AUDIENCE)).toBeNull();
  });
});
