import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * B-F08-B5-3 §2.5 A — the suite evaluator exists AND the two lanes partition the
 * route's allow-list exactly. Reads three sources as text (no import, no network).
 *
 * Case 1 is RED today only if ingest/suite_alerts.ts is deleted — that is the
 * regression it exists to catch, not a discovery.
 */
const ROOT = path.join(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function parseQuotedStrings(block: string): string[] {
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function parseRouteAdmitted(routeSrc: string): Set<string> {
  const legacy = routeSrc.match(/const LEGACY_TYPES = new Set\(\[([^\]]+)\]\)/);
  const opt = routeSrc.match(/const OPT_TYPES = new Set\(\[([\s\S]*?)\s*\]\)/);
  const suite = routeSrc.match(/const SUITE_TYPE = "([^"]+)"/);
  const suiteSeq = routeSrc.match(/const SUITE_SEQ_TYPE = "([^"]+)"/);
  if (!legacy || !opt || !suite || !suiteSeq) {
    throw new Error("failed to parse route admitted types");
  }
  return new Set([
    ...parseQuotedStrings(legacy[1]),
    ...parseQuotedStrings(opt[1]),
    suite[1],
    suiteSeq[1],
  ]);
}

function parsePostgrestTypeList(src: string, op: "in" | "not.in"): string[] | null {
  const escaped = op === "in" ? "in" : "not\\.in";
  const matches = [...src.matchAll(new RegExp(`condition->>type=${escaped}\\.\\(([^)]+)\\)`, "g"))];
  const real = matches
    .map((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean))
    .find((list) => list.includes("suite_event") && list.includes("suite_sequence"));
  return real ?? null;
}

describe("B-F08-B5-3 suite-lane presence + partition", () => {
  const routeSrc = read("terminal/app/api/alerts/route.ts");
  const sidecarSrc = read("ingest/suite_alerts.ts");
  const engineSrc = read("ingest/alerts_engine.py");

  it("the suite evaluator exists and is named (RED only if the sidecar is deleted)", () => {
    expect(sidecarSrc).toContain("in.(suite_event,suite_sequence)");
    expect(sidecarSrc).toContain("evalSuiteEvent");
    expect(sidecarSrc).toContain("evalSuiteSequence");
    expect(sidecarSrc).toContain("validateSuiteSequence");
  });

  it("the two lanes partition the route's allow-list exactly (union = admitted, intersection = empty)", () => {
    const admitted = parseRouteAdmitted(routeSrc);
    const suiteOwned = parsePostgrestTypeList(sidecarSrc, "in");
    expect(suiteOwned, "sidecar selector").not.toBeNull();
    expect(engineSrc, "python selector must carry not.in built from SUITE_LANE_TYPES").toMatch(
      /condition->>type=not\.in\./,
    );
    const tuple = engineSrc.match(/SUITE_LANE_TYPES\s*=\s*\(([^)]+)\)/);
    const engineOwnedFilter = parsePostgrestTypeList(engineSrc, "not.in")
      ?? (tuple ? parseQuotedStrings(tuple[1]) : null);
    expect(engineOwnedFilter, "python excluded types (SUITE_LANE_TYPES)").not.toBeNull();

    const suiteSet = new Set(suiteOwned);
    const engineExcluded = new Set(engineOwnedFilter);
    // Engine owns admitted minus the excluded suite types.
    const engineSet = new Set([...admitted].filter((t) => !engineExcluded.has(t)));
    const union = new Set([...suiteSet, ...engineSet]);
    const intersection = [...suiteSet].filter((t) => engineSet.has(t));

    expect([...union].sort()).toEqual([...admitted].sort());
    expect(intersection).toEqual([]);
  });

  it("the Python engine declares the suite types as another lane's", () => {
    expect(engineSrc).toMatch(/SUITE_LANE_TYPES\s*=/);
    expect(engineSrc).toContain("suite_event");
    expect(engineSrc).toContain("suite_sequence");
    const m = engineSrc.match(/SUITE_LANE_TYPES\s*=\s*\(([^)]+)\)/);
    expect(m, "SUITE_LANE_TYPES tuple — RED today: constant absent").not.toBeNull();
    const named = parseQuotedStrings(m![1]);
    expect(named.sort()).toEqual(["suite_event", "suite_sequence"]);
  });

  it("the suite lane writes a receipt", () => {
    expect(sidecarSrc).toContain("alert_runs");
    expect(sidecarSrc).toContain('"suite_alerts"');
    expect(sidecarSrc).toContain("startRun");
    expect(sidecarSrc).toContain("concludeRun");
  });
});
