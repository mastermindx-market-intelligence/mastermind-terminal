import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requireIntegrationBrowserReport } from "../../e2e/tools/optionsExposureEvidence.cjs";

type Attachment = { name: string; contentType: string; body?: string; path?: string };
type Result = { status: string; retry: number; attachments?: Attachment[] };
type Case = { projectName: string; results: Result[] };
type Spec = { title: string; tests: Case[] };
type Suite = { specs?: Spec[]; suites?: Suite[] };
type Report = Suite & { errors?: unknown[]; stats: { expected: number; unexpected: number; skipped: number; flaky: number } };
type Glyph = { strike: number; gap: number; paint: number; labelTop: number; headerBottom: number };
type Witness = { initial: Glyph[]; afterFit: Glyph[] };

const directory = new URL("../../docs/verification/exposure-workspace-20261103/options-integration-20261109/", import.meta.url);
const original = JSON.parse(readFileSync(new URL("browser-report.json", directory), "utf8")) as Report;
const qualification = JSON.parse(readFileSync(new URL("qualification.json", directory), "utf8")) as { expectedPassed: string[]; expectedSkipped: string[] };

function chart(report: Report): { spec: Spec; test: Case; result: Result } {
  const found: { spec: Spec; test: Case; result: Result }[] = [];
  const visit = (suite: Suite) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      if (spec.title.startsWith("Connected exposure workspace ")) found.push({ spec, test, result: test.results[0] });
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  visit(report);
  if (found.length !== 6) throw new Error("historical chart case fixture changed");
  return found[0];
}

function changeWitness(report: Report, change: (value: Witness) => void) {
  const attachment = chart(report).result.attachments!.find(row => row.name === "exposure-header-clearance")!;
  const witness = JSON.parse(Buffer.from(attachment.body!, "base64").toString("utf8")) as Witness;
  change(witness);
  attachment.body = Buffer.from(JSON.stringify(witness)).toString("base64");
}

describe("Options/Exposure shared browser-report validation", () => {
  it("accepts the immutable real144-case report without changing its bytes", () => {
    const before = JSON.stringify(original);
    expect(qualification.expectedPassed).toHaveLength(144);
    expect(qualification.expectedSkipped).toEqual([]);
    expect(() => requireIntegrationBrowserReport(original, qualification)).not.toThrow();
    expect(JSON.stringify(original)).toBe(before);
  });

  const mutations: [string, (report: Report) => void][] = [
    ["a retry disguised as a pass", report => { chart(report).result.retry = 1; }],
    ["an additional attempt", report => { const row = chart(report); row.test.results.push(structuredClone(row.result)); }],
    ["a substituted case", report => { chart(report).spec.title = "different journey"; }],
    ["a duplicated case", report => { const row = chart(report); row.spec.tests.push(structuredClone(row.test)); }],
    ["a missing clearance attachment", report => { chart(report).result.attachments = []; }],
    ["a path in place of inline clearance", report => {
      const attachment = chart(report).result.attachments!.find(row => row.name === "exposure-header-clearance")!;
      attachment.path = "unqualified.json"; delete attachment.body;
    }],
    ["insufficient label clearance", report => changeWitness(report, witness => { witness.initial[0].gap = 0; })],
    ["contradictory geometry", report => changeWitness(report, witness => { witness.initial[0].labelTop += 1; })],
    ["a reused strike756 paint", report => changeWitness(report, witness => {
      witness.afterFit.find(row => row.strike === 756)!.paint = witness.initial.find(row => row.strike === 756)!.paint;
    })],
    ["an undeclared skipped test", report => { report.stats.skipped = 1; }],
  ];

  it.each(mutations)("rejects %s", (_label, mutate) => {
    const report = structuredClone(original);
    mutate(report);
    expect(() => requireIntegrationBrowserReport(report, qualification)).toThrow(/INTEGRATION_/);
  });
});
