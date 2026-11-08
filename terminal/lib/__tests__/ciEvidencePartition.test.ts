import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const terminalRoot = fileURLToPath(new URL("../../", import.meta.url));
const configFile = path.join(terminalRoot, "vitest.config.ts");
const requireFromTerminal = createRequire(configFile);
const vitestPackage = requireFromTerminal.resolve("vitest/package.json");
const vitestBin = path.join(path.dirname(vitestPackage), "vitest.mjs");
const evidenceFiles = [
  "lib/__tests__/b_pl_6Batch1Evidence.test.ts",
  "lib/__tests__/visualIntelligenceEvidence.test.ts",
  "lib/__tests__/optionsLevelAxisEvidence.test.ts",
];
const ordinaryFile = "lib/__tests__/ordinary.test.ts";

type ChildReport = {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: { name: string }[];
};

it("the real Vitest config partitions discovery before evidence imports", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mmx-unit-import-barrier-"));
  const imports = path.join(fixtureRoot, "evidence-imports.log");
  try {
    // Only synthetic test data lives here. The child loads the actual repository
    // config and installed Vitest, with its normal four include globs.
    fs.symlinkSync(path.join(terminalRoot, "node_modules"), path.join(fixtureRoot, "node_modules"), "dir");
    fs.writeFileSync(path.join(fixtureRoot, "package.json"), JSON.stringify({ private: true, type: "module" }));
    for (const relative of [...evidenceFiles, ordinaryFile]) {
      const filename = path.join(fixtureRoot, relative);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const deferred = evidenceFiles.includes(relative);
      fs.writeFileSync(filename, [
        'import { it, expect } from "vitest";',
        'import fs from "node:fs";',
        deferred ? "fs.appendFileSync(process.env.MMX_CI_PARTITION_IMPORT_LOG!, " + JSON.stringify(relative + "\n") + ");" : "",
        deferred ? 'if (process.env.MMX_CI_PARTITION_FIXTURE_READY !== "yes") throw new Error("evidence imported before fixture was ready");' : "",
        "it(" + JSON.stringify(relative) + ", () => expect(1).toBe(1));",
      ].join("\n"));
    }

    let serial = 0;
    function run(overrides: Record<string, string>) {
      fs.rmSync(imports, { force: true });
      const reportFile = path.join(fixtureRoot, "report-" + serial++ + ".json");
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const name of Object.keys(env)) {
        if (name.startsWith("TERMINAL_EVIDENCE_") || name.startsWith("VITEST")
            || name === "TERMINAL_UNIT_PARTITION") delete env[name];
      }
      Object.assign(env, {
        CI: "true",
        MMX_CI_PARTITION_IMPORT_LOG: imports,
        MMX_CI_PARTITION_FIXTURE_READY: "no",
      }, overrides);
      const result = spawnSync(process.execPath, [
        vitestBin, "run", "--root", fixtureRoot, "--config", configFile,
        "--pool=threads", "--maxWorkers=1", "--minWorkers=1",
        "--reporter=json", "--outputFile", reportFile,
      ], {
        cwd: terminalRoot, env, encoding: "utf8", timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const diagnostic = String(result.error || "") + result.stdout + result.stderr;
      const report: ChildReport | undefined = fs.existsSync(reportFile)
        ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : undefined;
      const imported = fs.existsSync(imports)
        ? fs.readFileSync(imports, "utf8").trim().split("\n").sort() : [];
      return { status: result.status, signal: result.signal, error: result.error, diagnostic, report, imported };
    }

    function passed(result: ReturnType<typeof run>, expectedFiles: string[]) {
      expect(result.error, result.diagnostic).toBeUndefined();
      expect(result.signal, result.diagnostic).toBeNull();
      expect(result.status, result.diagnostic).toBe(0);
      expect(result.report?.numTotalTests).toBe(expectedFiles.length);
      expect(result.report?.numPassedTests).toBe(expectedFiles.length);
      expect(result.report?.numFailedTests).toBe(0);
      expect(result.report?.numPendingTests).toBe(0);
      return result.report!.testResults.map(item =>
        path.relative(fixtureRoot, item.name).split(path.sep).join("/")
      ).sort();
    }

    // Negative control: these same top-level poisons really fail if imported
    // without readiness; ordinary success cannot be explained by inert fixtures.
    const poisonedDefault = run({});
    expect(poisonedDefault.error, poisonedDefault.diagnostic).toBeUndefined();
    expect(poisonedDefault.signal, poisonedDefault.diagnostic).toBeNull();
    expect(poisonedDefault.status, poisonedDefault.diagnostic).toBe(1);
    expect(poisonedDefault.diagnostic + JSON.stringify(poisonedDefault.report))
      .toContain("evidence imported before fixture was ready");
    expect(poisonedDefault.imported).toEqual([...evidenceFiles].sort());

    const ordinary = run({ TERMINAL_UNIT_PARTITION: "ordinary" });
    const ordinaryDiscovered = passed(ordinary, [ordinaryFile]);
    expect(ordinaryDiscovered).toEqual([ordinaryFile]);
    expect(ordinary.imported).toEqual([]);

    const refused = run({
      TERMINAL_UNIT_PARTITION: "evidence",
      TERMINAL_EVIDENCE_PLAN_OUTCOME: "failure",
      TERMINAL_EVIDENCE_CAPTURE: "false",
      GITHUB_EVENT_NAME: "merge_group",
    });
    expect(refused.error, refused.diagnostic).toBeUndefined();
    expect(refused.signal, refused.diagnostic).toBeNull();
    expect(refused.status, refused.diagnostic).toBe(1);
    expect(refused.diagnostic).toContain("requires successful evidence capture planner");
    expect(refused.imported).toEqual([]);

    const records = run({
      TERMINAL_UNIT_PARTITION: "evidence",
      TERMINAL_EVIDENCE_PLAN_OUTCOME: "success",
      TERMINAL_EVIDENCE_CAPTURE: "true",
      TERMINAL_EVIDENCE_CAPTURE_OUTCOME: "success",
      TERMINAL_EVIDENCE_MODE: "records",
      TERMINAL_EVIDENCE_COMPOSITION: path.join(fixtureRoot, "selected.composition.json"),
      MMX_CI_PARTITION_FIXTURE_READY: "yes",
      GITHUB_EVENT_NAME: "pull_request",
    });
    const recordsDiscovered = passed(records, evidenceFiles);
    expect(recordsDiscovered).toEqual([...evidenceFiles].sort());
    expect(records.imported).toEqual([...evidenceFiles].sort());

    const legacy = run({
      TERMINAL_UNIT_PARTITION: "evidence",
      TERMINAL_EVIDENCE_PLAN_OUTCOME: "success",
      TERMINAL_EVIDENCE_CAPTURE: "false",
      TERMINAL_EVIDENCE_CAPTURE_OUTCOME: "skipped",
      MMX_CI_PARTITION_FIXTURE_READY: "yes",
      GITHUB_EVENT_NAME: "merge_group",
    });
    expect(passed(legacy, evidenceFiles)).toEqual(recordsDiscovered);
    expect(legacy.imported).toEqual([...evidenceFiles].sort());

    const defaultRun = run({ MMX_CI_PARTITION_FIXTURE_READY: "yes" });
    const defaultDiscovered = passed(defaultRun, [...evidenceFiles, ordinaryFile]);
    expect(defaultDiscovered).toEqual([...ordinaryDiscovered, ...recordsDiscovered].sort());
    expect(defaultRun.imported).toEqual([...evidenceFiles].sort());
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}, 120_000);
