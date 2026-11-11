import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECTOR_STATE, parseSectorState, writeSectorState, type SectorState,
} from "../sectorIntelligence";
import {
  encodeSectorDepthReturn, parseSectorDepthReturn, resolveSectorDepthReturn, sectorDepthReturnQuery,
} from "../sectorDepthReturn";
import { sectorNativeGeneration } from "../sectorNativeGeneration";
import {
  sectorNativeBindingKey, sectorNativeContext, sectorNativeRankedRows,
} from "../../components/sector-intelligence/sectorNativeSlots";
import captured from "./fixtures/sector_generation.captured.preview.v1.json";

const url = (query: string) => new URLSearchParams(query);
const write = (state: SectorState, path = "/sectors") =>
  writeSectorState(new URL(`https://mastermind.invalid${path}`), state);

describe("sectorJob codec inside the incumbent typed router", () => {
  it("keeps every legacy URL's meaning byte-identical without a path", () => {
    const legacy = parseSectorState(url("sectorWorkspace=rotation&sector=xle"));
    expect(legacy.workspace).toBe("rotation");
    expect(legacy.sectorJob).toBeNull();
    expect(parseSectorState(url(""))).toEqual({ ...DEFAULT_SECTOR_STATE, sectorJob: null });
    // The historical default entry at /discover?tab=sectors stays the legacy
    // Discover surface even when it is completely clean.
    expect(parseSectorState(url(""), "/discover").sectorJob).toBeNull();
    expect(parseSectorState(url("tab=sectors"), "/discover").workspace).toBe("discover");
    expect(parseSectorState(url("tab=sectors"), "/discover").sectorJob).toBeNull();
  });

  it("opens Brief only on the clean canonical /sectors entry", () => {
    expect(parseSectorState(url(""), "/sectors").sectorJob).toBe("brief");
    // Any sector key at all keeps the legacy meaning, even on /sectors.
    expect(parseSectorState(url("sectorWorkspace=rotation"), "/sectors").sectorJob).toBeNull();
    expect(parseSectorState(url("sector=xle"), "/sectors").sectorJob).toBeNull();
    expect(parseSectorState(url("sectorTheme=light"), "/sectors").sectorJob).toBeNull();
    expect(parseSectorState(url("sectorJob=bogus"), "/sectors").sectorJob).toBeNull();
  });

  it.each([
    ["sectorBreadthSort=contract", "contract", 5],
    ["sectorBreadthWindow=1", "strong", 1],
    ["sectorBreadthSort=bogus", "strong", 5],
    ["sectorBreadthWindow=bogus", "strong", 5],
  ] as const)("keeps breadth-only URL %s out of the clean Brief entry", (query, breadthSort, breadthWindow) => {
    expect(parseSectorState(url(query), "/sectors")).toMatchObject({
      sectorJob: null, breadthSort, breadthWindow,
    });
  });

  it.each(["brief", "explore", "research", "watches"] as const)("round-trips the %s job", job => {
    const state = { ...DEFAULT_SECTOR_STATE, sectorJob: job };
    const href = write(state);
    expect(href).toContain(`sectorJob=${job}`);
    expect(parseSectorState(new URLSearchParams(href.slice(href.indexOf("?"))), "/discover").sectorJob).toBe(job);
    // Explicit job param wins on every path; absence never invents one.
    expect(parseSectorState(url(`sectorJob=${job}`)).sectorJob).toBe(job);
  });

  it("keeps a null job out of legacy addresses", () => {
    const href = write({ ...DEFAULT_SECTOR_STATE, sectorJob: null });
    expect(href).not.toContain("sectorJob");
  });
});

describe("native job depth-return snapshots", () => {
  it("captures a job surface opener with its selection", () => {
    const state = { ...DEFAULT_SECTOR_STATE, sectorJob: "explore" as const, sector: "xlf" };
    const snapshot = encodeSectorDepthReturn(state)!;
    expect(snapshot).toContain("sectorJob=explore");
    expect(parseSectorDepthReturn(snapshot)).toEqual(state);
  });

  it("keeps the reduced public return inside 1024 chars and bound to the full same-tab snapshot", () => {
    const state = { ...DEFAULT_SECTOR_STATE, sectorJob: "explore" as const, theme: "light" as const,
      finvizTheme: "科".repeat(180), finvizSubtheme: "科".repeat(180), discoveryQuery: "科".repeat(60),
      companyTableQuery: "科".repeat(60), matrixIndustry: "科".repeat(120), rotationQuery: "科".repeat(60) };
    const full = encodeSectorDepthReturn(state)!;
    expect(full.length).toBeGreaterThan(1024);
    expect(full.length).toBeLessThanOrEqual(8192);
    const query = sectorDepthReturnQuery(state)!;
    expect(query.length).toBeLessThanOrEqual(1024);
    // The reduced return still lands on the same job destination.
    expect(query).toContain("sectorJob=explore");
    expect(resolveSectorDepthReturn(query, full)).toEqual(state);
    const reduced = resolveSectorDepthReturn(query, null)!;
    expect(reduced.sectorJob).toBe("explore");
    expect(reduced.workspace).toBe("discover");
  });

  it("never captures a native dossier as its own opener", () => {
    expect(encodeSectorDepthReturn({ ...DEFAULT_SECTOR_STATE, workspace: "detail", sectorJob: "explore" })).toBeNull();
  });
});

describe("native slot context: source ordinal and binding discipline", () => {
  const generation = sectorNativeGeneration(captured)!;
  const base = {
    generation, transport: "ready" as const, subjectId: null as string | null,
    language: "en" as const, theme: "dark" as const, ownerRevision: "guest#0",
  };

  it("orders the ranked rows by the producer's measured rank, never the wire order", () => {
    const rows = sectorNativeRankedRows(generation);
    expect(rows.map(row => row.ticker)).toEqual(
      ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
    expect(rows[0]).toMatchObject({ id: "xlb", rank: 1, rs63d: 0.1, measured: true });
    expect(rows.slice(1).every(row => row.rs63d === 0 && row.rs21d === 0)).toBe(true);
    // The wire order (xlb, xlk, xlc, …) is a different ordering and must not leak in.
    expect(generation.sectors.map(row => String(row.id)).indexOf("xlk")).toBe(1);
    expect(rows.findIndex(row => row.id === "xlk")).toBe(5);
  });

  it("keeps unmeasured rows after the measured ones with their own reason", () => {
    // The published cohort is one closed document family (measured read,
    // dossiers, breadth counts, exact windows) and re-admission of a partial
    // read would require every companion to agree. This test isolates the
    // ranked-rows reader's own contract: a withheld group keeps its identity
    // and reason, never a borrowed value, and follows the measured rows.
    const core = structuredClone(captured.projection.data.core);
    const group = core.measured_read.groups
      .find((entry: { group_id: string }) => entry.group_id === "XLC") as {
        current: { status: string; reason: string | null; rank?: number; rs_21d?: number; rs_63d?: number } };
    group.current.status = "unmeasured";
    group.current.reason = "missing_input";
    delete group.current.rank;
    delete group.current.rs_21d;
    delete group.current.rs_63d;
    // Full generation spread + the mutated core: only the withheld group changes,
    // every other admitted companion (actionBoard/typedBlocks/historyWire) rides along.
    const synthetic = { ...generation, core };
    const rows = sectorNativeRankedRows(synthetic);
    expect(rows).toHaveLength(11);
    const unmeasured = rows.filter(row => !row.measured);
    expect(unmeasured.map(row => row.ticker)).toEqual(["XLC"]);
    expect(unmeasured[0]).toMatchObject({ rs21d: null, rs63d: null, rank: null, reason: "missing_input" });
    expect(rows.slice(0, 10).map(row => row.ticker)).toEqual(
      ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
  });

  it("exposes ranked63 in source-ordinal order and lead21 as its own separate input", () => {
    const context = sectorNativeContext(base);
    // Producer order: XLB first. The 21-session lead is Technology (xlk), a
    // different input that must never masquerade as the 63-order head.
    expect(context.ranked63[0]).toBe("xlb");
    expect(context.ranked63).toHaveLength(11);
    expect(context.lead21).toBe("xlk");
    expect(context.lead21).not.toBe(context.ranked63[0]);
    expect(context.binding).toMatchObject({
      ownerRevision: "guest#0", subjectId: null, universe: "us",
      metric: "relative_wealth_pct", windows: [21, 63], basis: "total_return",
    });
    expect(context.binding.generationKey).toBe(
      `${generation.receipt.generation_id}|${generation.receipt.content_sha256}`);
  });

  it("retires work when any binding field changes: generation, subject, owner, windows", () => {
    const same = sectorNativeContext(base);
    expect(sectorNativeBindingKey(same.binding)).toBe(sectorNativeBindingKey(sectorNativeContext(base).binding));
    // Replaced generation (a different content hash) retires prior work.
    const republished = structuredClone(captured);
    republished.projection.receipt.generation_id = "gen_two";
    republished.projection.data.core.measured_read.generation.session_end = captured.source_session;
    const other = sectorNativeGeneration(republished);
    if (other) {
      const replaced = sectorNativeContext({ ...base, generation: other });
      expect(sectorNativeBindingKey(replaced.binding))
        .not.toBe(sectorNativeBindingKey(same.binding));
    }
    // Rapid selection: a different subject is a different binding.
    const subjectA = sectorNativeContext({ ...base, subjectId: "xlf" });
    const subjectB = sectorNativeContext({ ...base, subjectId: "xlu" });
    expect(subjectA.subject?.ticker).toBe("XLF");
    expect(sectorNativeBindingKey(subjectA.binding)).not.toBe(sectorNativeBindingKey(subjectB.binding));
    // Access switch: another owner revision (account or refresh) retires replies.
    const otherOwner = sectorNativeContext({ ...base, subjectId: "xlf", ownerRevision: "user-uuid#1" });
    expect(sectorNativeBindingKey(otherOwner.binding)).not.toBe(sectorNativeBindingKey(subjectA.binding));
    // A different measured-window contract is a different binding.
    expect(sectorNativeBindingKey({ ...subjectA.binding, windows: [21] }))
      .not.toBe(sectorNativeBindingKey(subjectA.binding));
  });

  it("names the real cause instead of falling back when no generation is admitted", () => {
    for (const transport of ["loading", "access", "unavailable", "invalid", "error"] as const) {
      const context = sectorNativeContext({ ...base, generation: null, transport });
      expect(context.generation).toBeNull();
      expect(context.ranked63).toEqual([]);
      expect(context.lead21).toBeNull();
      expect(context.subject).toBeNull();
      expect(context.binding.generationKey).toBe("");
      expect(context.transport).toBe(transport);
    }
  });
});
