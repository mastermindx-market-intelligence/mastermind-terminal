import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type EvidenceKind = "gex" | "eod";
export type EvidenceProfile = "exposure" | "combined";
type SourceMap = Record<string, string>;
type NativeReceipt = {
  operation: string; protectedBase: string; kind: EvidenceKind; packet: string;
  expected: number; successful_files: number; exit: number; source_stable: boolean;
  failed_frames: string[]; source_sha256: SourceMap; image_sha256: SourceMap;
  native_manifest_sha256: string; log_sha256: string;
};
const BASE = "11531481b0a540ee96bcd86df418fd1e42715363";
const CURRENT_REVISION = "options-navigation-r4";
const PREVIOUS_PACKET_INVENTORY = {
  gex: "c9f0aa2c43cb06d0590fb065d7b0a97f019e247c13757cc9a672f665eed12670",
  eod: "4515093ab9ba4915341a7e163dd4623c4b2698368f4d1988e3d3a8c89135cb42",
};
const OP = {
  exposure: "exposure-source-compatibility-20261105",
  options: "options-source-compatibility-20261105",
  combined: "combined-source-compatibility-20261105",
} as const;
const PACKETS = { gex: "gex-levels-heatmap-load-failure", eod: "eod-heatmap-flowdesk-load-failure" };
const PROTECTED = {
  gex: "f802daa53147e8a771e01a6dd896c7991ab56a8ad3b520c9f7716726a7bbce34",
  eod: "42c027968aeafbe179333d691e5727ef76523f9775becad3b2002dc0139b05da",
};
const EXPOSED_CSS = "terminal/components/gexdesk/ExposureWorkspace.module.css";
const WRAPPER = "terminal/components/researchlab/AdmittedOptionsResearchLab.tsx";
const LAB = "terminal/components/researchlab/OptionsResearchLab.tsx";
const LAB_SOURCES = [
  LAB, "terminal/components/options-companion/GexMarketMemory.tsx",
  "terminal/components/researchlab/ResearchReportedGammaPanel.tsx",
  "terminal/components/researchlab/researchReportedGamma.ts",
];
const LAYOUT = {
  gex: [
    "terminal/app/globals.css", "terminal/components/gexdesk/GexDeskView.tsx",
    "terminal/components/gexdesk/HeatSeekerCard.tsx", "terminal/components/gexdesk/MarketStateCard.tsx",
    "terminal/components/gexdesk/StrikeLadder.tsx", "terminal/components/gexdesk/gexStrings.ts",
    "terminal/components/heatmap/HeatmapView.tsx", "terminal/components/levels/LevelsView.tsx",
    "terminal/components/levels/levelsLabels.ts", "terminal/lib/dataCache.ts", "terminal/lib/heatmapStrings.ts",
  ],
  eod: [
    "terminal/app/globals.css", "terminal/components/eodcontext/DarkPoolMini.tsx",
    "terminal/components/eodcontext/EodContextBelt.tsx", "terminal/components/eodcontext/StructureStrip.tsx",
    "terminal/components/eodcontext/eodStrings.ts", "terminal/components/flowdesk/FlowDeskView.tsx",
    "terminal/components/gexdesk/GexDeskView.tsx", "terminal/components/heatmap/HeatmapView.tsx",
    "terminal/lib/dataCache.ts", "terminal/lib/eodContext.ts", "terminal/lib/flowdeskStrings.ts",
    "terminal/lib/heatmapStrings.ts",
  ],
};
const OPTIONS_CSS = [
  "terminal/components/flowdesk/ChainHeat.module.css",
  "terminal/components/flowdesk/CommandWorkspace.module.css",
];
const OPTIONS_EXTRAS = {
  gex: ["terminal/components/levels/levelsNavigation.ts"],
  eod: ["terminal/components/flowdesk/FlowFreshnessReceipt.tsx", "terminal/app/observatory.css"],
};
const HISTORY = {
  exposure: {
    gex: [
      "fdbbde228018ceaf5073624f4bbf8b7c517a7bb86f27c94d93423d6619a3434e",
      "aa3b3b9e069939d15f5c885457942d535ee6c29079340071f5a64c755d64febf",
      "6c8f8f3e4aa200a20b1690a81d124da3e4d0cd7e800af1c24c04eabef5b7c0a1",
    ],
    eod: [
      "aa03e7e65e155f9addb167232fbc50e3b71e8380eb07fedde1f82e47ae10c91c",
      "eae49945986e6328b174529f8497ccfedcd36b505a798107a7a10c084db476d2",
      "cc89fe0b66198e8b7863dbe22e87d668db89ee1d7e1e39c9d1c6bcab1f4244b0",
    ],
  },
  options: {
    gex: [
      "a936e0154392a42753384bd7a02bf5487aa0c4f0cfee8afc974a7bd738bb371f",
      "c28e504742cbbf587d5c8ff1a20ddf2a90887f7c87d1d151df1410cc69b758d3",
      "6afdce5adee23881fba5445e168b71dce27cb8118e816e5a88072cdeffa610cb",
    ],
    eod: [
      "566645e410aba3dd89643003ce41fda25d8ad10140a87e0d38ad5a6387bf43c6",
      "8c66b3dcc55d90cfaf28f4f94fd8673bd9e7963d19ea2c5f0c1ed45d79c45ee1",
      "9e632950bfff652fca41e7e2ead1285f18ef4798cf2c425197833a94f3333d1e",
    ],
  },
};
const OPTIONS_SOURCE_PINS = {
  gex: "17cc1272ca151a0e87e900660740e909e25859be0682e68f7c594355d02a4e4a",
  eod: "e50502d710c7a108fdbe35975ebadde74d81a8aa8d90bc02c8a71b87ee04c9c8",
};
const BOUNDARY_SOURCES = [
  "terminal/components/gexdesk/GexDeskView.tsx", WRAPPER, ...LAB_SOURCES,
  "terminal/lib/dataCache.ts", "terminal/lib/idbJsonStore.ts",
  "terminal/lib/flowClientCache.ts", "terminal/lib/optionsCompanion.ts",
  "terminal/lib/__tests__/researchLabSourceAvailability.test.tsx",
  "terminal/lib/__tests__/fixtures/reportedGammaBooks.ts",
  "terminal/lib/__tests__/fixtures/exposure-projection-observed-v2.json",
  "terminal/e2e/options-lab-source-state.spec.ts",
];
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error("Options/Exposure evidence: " + code);
}
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const sameKeys = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const harness = (kind: EvidenceKind) => "terminal/e2e/tools/" +
  (kind === "gex" ? "capture_gex_levels_heatmap_load_failure.cjs" : "capture_eod_heatmap_flowdesk_load_failure.cjs");

export function requireSourceKeys(map: SourceMap, expected: string[]): void {
  check(map && typeof map === "object" && !Array.isArray(map), "SOURCE_MAP_SHAPE");
  check(sameKeys(Object.keys(map), expected), "SOURCE_KEY_SET");
  check(Object.values(map).every(value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)), "SOURCE_DIGEST");
}
export function selectWholeFingerprint<T extends { sources: SourceMap }>(candidates: T[], current: SourceMap): T {
  check(candidates.length > 0, "NO_DECLARED_CAPTURE");
  const matches = candidates.filter(candidate => Object.entries(candidate.sources)
    .every(([path, digest]) => current[path] === digest));
  check(matches.length === 1, matches.length ? "AMBIGUOUS_CAPTURE" : "NO_QUALIFIED_CAPTURE");
  return matches[0];
}
/** The pinned r4 executions are equivalent under this exact protected fixture-server default.
 * VI already supplied the value; the native runners do not use Playwright's webServer config.
 * Recorded maps remain immutable and every non-config input still matches the whole capture.
 */
export function projectR4CaptureHarness(recorded: SourceMap, current: SourceMap): SourceMap {
  const path = "terminal/playwright.config.ts";
  const captured = "bb09d98f2bf2647a1975dac07a0e85ab673473986145a1db0d30f22d38e5c076";
  const protectedSuccessor = "de74d9150283eb9dd5243b57c4ee597171d50f328be749d6c43ba8287a6f4525";
  check(recorded[path] === captured, "CAPTURE_HARNESS_RECORDED_SOURCE");
  check(current[path] === captured || current[path] === protectedSuccessor, "CAPTURE_HARNESS_CURRENT_SOURCE");
  return { ...recorded, [path]: current[path] };
}
export function layoutSources(kind: EvidenceKind, profile: EvidenceProfile): string[] {
  return [...LAYOUT[kind], EXPOSED_CSS,
    ...(kind === "eod" && profile === "combined" ? OPTIONS_CSS : [])].sort();
}
function nativeSources(kind: EvidenceKind, profile: EvidenceProfile): string[] {
  return [...layoutSources(kind, profile), "terminal/lib/idbJsonStore.ts", ...LAB_SOURCES,
    harness(kind), ...(profile === "exposure" ? [] : [WRAPPER, ...OPTIONS_EXTRAS[kind]])].sort();
}
function yamlBlock(key: string, values: Record<string, string>): string {
  return key + ":\n" + Object.entries(values).map(([name, value]) => "  " + name + ': "' + value + '"\n').join("");
}
function verifyHistory(root: string, kind: EvidenceKind, profile: "exposure" | "options", crops: string[], protectedRoot = root): SourceMap {
  const dir = join(root, "operations", OP[profile]), pins = HISTORY[profile][kind];
  const paths = ["EVIDENCE.before.yml", "prior-root-sha256.json", "protected-root-sha256.json"];
  paths.forEach((path, index) => check(sha(join(dir, path)) === pins[index], "HISTORY_DIGEST:" + profile + ":" + path));
  check(sha(join(dir, "EVIDENCE.protected.yml")) === PROTECTED[kind], "PROTECTED_MANIFEST");
  const prior = json<SourceMap>(join(dir, paths[1])), protectedImages = json<SourceMap>(join(dir, paths[2]));
  check(sameKeys(Object.keys(prior).filter(name => name.endsWith(".png")), crops), "PRIOR_IMAGE_SET");
  check(sameKeys(Object.keys(protectedImages).filter(name => name.endsWith(".png")), crops), "PROTECTED_IMAGE_SET");
  check(sameKeys(readdirSync(join(dir, "prior-root")), Object.keys(prior)), "PRIOR_DIRECTORY_SET");
  for (const [name, digest] of Object.entries(prior))
    check(sha(join(dir, "prior-root", name)) === digest, "PRIOR_IMAGE:" + name);
  for (const name of crops)
    check(sha(join(protectedRoot, name)) === protectedImages[name], "PROTECTED_ROOT_IMAGE:" + name);
  if (profile === "options") {
    const sourcePath = join(dir, "historical-source-sha256.json");
    check(sha(sourcePath) === OPTIONS_SOURCE_PINS[kind], "OPTIONS_HISTORICAL_SOURCES");
    return json<SourceMap>(sourcePath);
  }
  return {};
}
function verifyBoundary(repo: string, requireCurrent = true): SourceMap {
  const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103/boundary-compatibility-20261105");
  check(sha(join(dir, "qualification.json")) === "badead763130c555f1257c1c5ca29f0737b19cd55b8ae575e617ce6e824ffae9", "BOUNDARY_QUALIFICATION");
  const qualification = json<{
    schema: string; capture_commit: string; boundary_sources: SourceMap;
    browser: Record<string, { receipt_sha256: string; source_map_sha256: string }>;
  }>(join(dir, "qualification.json"));
  check(qualification.schema === "options_lab_boundary_compatibility.v1" &&
    qualification.capture_commit === "f12ad44115d69b1bcd7cd453d69a689c9d6768a8", "BOUNDARY_IDENTITY");
  requireSourceKeys(qualification.boundary_sources, BOUNDARY_SOURCES);
  for (const mode of ["original", "preview"]) {
    const ref = qualification.browser[mode], receiptPath = join(dir, mode, "browser-receipt.json");
    const sourcePath = join(dir, mode, "browser-source-after.json");
    check(sha(receiptPath) === ref.receipt_sha256 && sha(sourcePath) === ref.source_map_sha256, "BOUNDARY_RECEIPT");
    const receipt = json<{ exit: number; passed: number; retries: number; source_stable: boolean;
      source_map_sha256: string; log_sha256: string; command: string[] }>(receiptPath);
    check(receipt.exit === 0 && receipt.retries === 0 && receipt.source_stable &&
      receipt.passed === (mode === "original" ? 12 : 18), "BOUNDARY_BROWSER_RESULT");
    check(receipt.source_map_sha256 === ref.source_map_sha256 &&
      receipt.log_sha256 === sha(join(dir, mode, "browser.log")) &&
      receipt.command.includes("e2e/options-lab-source-state.spec.ts"), "BOUNDARY_BROWSER_BINDING");
    const sources = json<SourceMap>(sourcePath);
    for (const path of BOUNDARY_SOURCES)
      check(sources[path] === qualification.boundary_sources[path] && (!requireCurrent || sources[path] === sha(join(repo, path))),
        "BOUNDARY_CURRENT_SOURCE:" + path);
  }
  return qualification.boundary_sources;
}
const JOINT_CONTRACT = "a7cd2ce244a0ae278fc24bf25a51566c0053c89f9ce3fb17ae12b350f1541db7";
const JOINT_DRIVER = "caa135fb04633289178636e9ba24b5484a988ee6797f572bd4aee0c93d9285ed";
const OFFLINE_FONT = "0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd";
type ChartFramingMode = "original" | "preview";
type ChartGlyph = { strike: number; gap: number; paint: number; labelTop: number; headerBottom: number };
type ChartFramingResult = {
  status: string; retry: number;
  attachments?: { name: string; contentType: string; body?: string; path?: string }[];
};
type ChartFramingSuite = {
  specs?: { title: string; tests: { projectName: string; results: ChartFramingResult[] }[] }[];
  suites?: ChartFramingSuite[];
};
const CHART_FRAMING_PATH = "terminal/components/exposure-map/ExposureMap.tsx";
const CHART_FRAMING_SPEC = "terminal/e2e/options-exposure-workspace.spec.ts";
const CHART_FRAMING_MAPS = {
  original: { before: "52dcb7e81d556e2239454dae822458236430737f55877bb5bd3b21465aa2e349", after: "de3e781dedac67c2c0aadeb1142ed2f6d3d3e2075063329e55d9cf88444121e7" },
  preview: { before: "099b71567187d5509182d9cbee9be3d44b584bf1202748df8a6f92a48e0a5c11", after: "50bdfadd453747170d597b8f1a2a11853fe864ef08c6b2ffb561299f8a3dd60c" },
};
const CHART_FRAMING_QUALIFICATION = "4175c376a016a00cd03dbf2c90c9604739c62b9004362db4a9cb277b752fc891";

/** This separately qualifies the Chart branch deliberately excluded from native Strike captures. */
export function requireR4ChartIdentity(repo: string, original: string, peer: string, current: string, requireCurrentObserver = true): void {
  check(original === CHART_FRAMING_MAPS.original.before && peer === CHART_FRAMING_MAPS.preview.before,
    "JOINT_CHART_RECORDED_IDENTITY");
  if (current === original || current === peer) return;
  const selected: ChartFramingMode | null = current === CHART_FRAMING_MAPS.original.after ? "original" :
    current === CHART_FRAMING_MAPS.preview.after ? "preview" : null;
  check(selected !== null, "JOINT_CHART_SUCCESSOR_IDENTITY");
  const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103/chart-framing-20261105");
  check(sha(join(dir, "qualification.json")) === CHART_FRAMING_QUALIFICATION, "CHART_FRAMING_QUALIFICATION_DIGEST");
  const qualification = json<{
    schema: string; operation: string; nativeContractSha256: string; captureRevision: string;
    chartPath: string; driverSha256: string; files: SourceMap;
    maps: Record<ChartFramingMode, { before: string; after: string; observer: string }>;
  }>(join(dir, "qualification.json"));
  check(qualification.schema === "exposure_chart_framing_qualification.v1" &&
    qualification.operation === "chart-framing-20261105" && qualification.nativeContractSha256 === JOINT_CONTRACT &&
    qualification.captureRevision === CURRENT_REVISION && qualification.chartPath === CHART_FRAMING_PATH,
    "CHART_FRAMING_QUALIFICATION_IDENTITY");
  const proofFiles = ["browser-receipt.json", "source-before.json", "source-after.json", "browser-report.json",
    "browser.log", "painted-label-witnesses.json"];
  requireSourceKeys(qualification.files, ["capture-driver.py",
    ...["baseline", "original", "preview"].flatMap(mode => proofFiles.map(file => mode + "/" + file))]);
  for (const [file, digest] of Object.entries(qualification.files))
    check(sha(join(dir, file)) === digest, "CHART_FRAMING_FILE:" + file);
  check(qualification.driverSha256 === qualification.files["capture-driver.py"], "CHART_FRAMING_DRIVER");
  const expectedCases = ["desktop", "tablet", "mobile"].flatMap(project => ["en", "zh"].map(lang =>
    project + "|Connected exposure workspace " + lang + ": chart, comparison scopes, scanner and return"));
  const sourceMaps: Record<string, SourceMap> = {};
  function glyphs(value: unknown, positive: boolean): asserts value is ChartGlyph[] {
    check(Array.isArray(value) && value.length > 0 && value.length <= 6, "CHART_FRAMING_GLYPH_SET");
    const rows = value as ChartGlyph[];
    check(rows.filter(row => row.strike === 756).length === 1 &&
      new Set(rows.map(row => row.strike)).size === rows.length, "CHART_FRAMING_PRIMARY_LABEL");
    for (const row of rows) check([756,757,755,747,746,748].includes(row.strike) &&
      [row.gap,row.paint,row.labelTop,row.headerBottom].every(Number.isFinite) &&
      Number.isInteger(row.paint) && row.paint > 0 &&
      Math.abs(row.gap-(row.labelTop-row.headerBottom)) < .000001 && (!positive || row.gap >= 4),
      "CHART_FRAMING_GLYPH_GEOMETRY");
  }
  for (const mode of ["baseline", "original", "preview"] as const) {
    const baseline = mode === "baseline", profile: ChartFramingMode = baseline ? "original" : mode;
    const prefix = mode + "/", map = qualification.maps[profile], expectedMap = CHART_FRAMING_MAPS[profile];
    check(map.before === expectedMap.before && map.after === expectedMap.after, "CHART_FRAMING_TRANSITION");
    const receipt = json<{
      schema: string; mode: string; stage: string; witness_version: string; capture_revision: string;
      expected_failure: boolean; exit: number; expected: number; passed: number; failed: number;
      skipped: number; flaky: number; retries: number; source_stable: boolean; source_count: number;
      source_before_sha256: string; source_map_sha256: string; browser_report_sha256: string;
      log_sha256: string; map_source_sha256: string; owned_server_stopped: boolean; command: string[];
    }>(join(dir, prefix, "browser-receipt.json"));
    check(receipt.schema === "exposure_chart_framing_browser.v1" && receipt.mode === profile &&
      receipt.stage === (baseline ? "baseline" : "fixed") && receipt.expected_failure === baseline &&
      receipt.witness_version === "all-painted-ranked-labels.v2" && receipt.capture_revision === CURRENT_REVISION &&
      receipt.exit === (baseline ? 1 : 0) && receipt.expected === (baseline ? 1 : 6) &&
      receipt.passed === (baseline ? 0 : 6) && receipt.failed === (baseline ? 1 : 0) &&
      receipt.skipped === 0 && receipt.flaky === 0 && receipt.retries === 0 &&
      receipt.source_stable && receipt.owned_server_stopped &&
      receipt.command.includes("e2e/options-exposure-workspace.spec.ts"), "CHART_FRAMING_BROWSER_RESULT");
    check(receipt.source_before_sha256 === qualification.files[prefix+"source-before.json"] &&
      receipt.source_map_sha256 === qualification.files[prefix+"source-after.json"] &&
      receipt.source_before_sha256 === receipt.source_map_sha256 &&
      receipt.browser_report_sha256 === qualification.files[prefix+"browser-report.json"] &&
      receipt.log_sha256 === qualification.files[prefix+"browser.log"], "CHART_FRAMING_RECEIPT_BINDING");
    const sources = json<SourceMap>(join(dir, prefix, "source-after.json"));
    requireSourceKeys(sources, Object.keys(sources));
    check(Object.keys(sources).length === receipt.source_count &&
      sources[CHART_FRAMING_PATH] === (baseline ? map.before : map.after) &&
      receipt.map_source_sha256 === sources[CHART_FRAMING_PATH] &&
      sources[CHART_FRAMING_SPEC] === map.observer, "CHART_FRAMING_SOURCE_BINDING");
    sourceMaps[mode] = sources;
    const report = json<ChartFramingSuite & {
      stats: { expected: number; unexpected: number; skipped: number; flaky: number }; errors?: unknown[];
    }>(join(dir, prefix, "browser-report.json"));
    check(report.stats.expected === receipt.passed && report.stats.unexpected === receipt.failed &&
      report.stats.skipped === 0 && report.stats.flaky === 0 && !report.errors?.length, "CHART_FRAMING_REPORT");
    const cases: string[] = [], witnesses: { project: string; title: string; name: string; value: unknown }[] = [];
    function visit(suite: ChartFramingSuite): void {
      for (const spec of suite.specs ?? []) for (const test of spec.tests) {
        cases.push(test.projectName+"|"+spec.title);
        check(test.results.length === 1, "CHART_FRAMING_SINGLE_ATTEMPT");
        const result = test.results[0];
        check(result.status === (baseline ? "failed" : "passed") && result.retry === 0, "CHART_FRAMING_CASE_RESULT");
        const names = baseline ? ["exposure-header-clearance-initial"] :
          ["exposure-header-clearance-initial", "exposure-header-clearance"];
        const values: Record<string, unknown> = {};
        for (const name of names) {
          const attachments = result.attachments?.filter(item => item.name === name) ?? [];
          check(attachments.length === 1 && attachments[0].contentType === "application/json" &&
            typeof attachments[0].body === "string" && attachments[0].path === undefined, "CHART_FRAMING_ATTACHMENT");
          const value: unknown = JSON.parse(Buffer.from(attachments[0].body, "base64").toString("utf8"));
          values[name] = value; witnesses.push({project:test.projectName,title:spec.title,name,value});
        }
        const initial = values["exposure-header-clearance-initial"]; glyphs(initial, !baseline);
        if (baseline) check(initial.some(row => row.gap < 0), "CHART_FRAMING_RED_WITNESS");
        else {
          const final = values["exposure-header-clearance"] as { initial: unknown; afterFit: unknown };
          glyphs(final.initial, true); glyphs(final.afterFit, true);
          check(JSON.stringify(final.initial) === JSON.stringify(initial) &&
            final.afterFit.find(row => row.strike === 756)!.paint > initial.find(row => row.strike === 756)!.paint,
            "CHART_FRAMING_FIT_REPAINT");
        }
      }
      for (const child of suite.suites ?? []) visit(child);
    }
    visit(report);
    check(sameKeys(cases, baseline ? [expectedCases[4]] : expectedCases), "CHART_FRAMING_EXACT_CASES");
    check(JSON.stringify(witnesses) === JSON.stringify(json(join(dir,prefix,"painted-label-witnesses.json"))),
      "CHART_FRAMING_WITNESS_BINDING");
  }
  requireSourceKeys(sourceMaps.baseline, Object.keys(sourceMaps.original));
  check(sameKeys(Object.keys(sourceMaps.original).filter(path => sourceMaps.original[path] !== sourceMaps.baseline[path]),
    [CHART_FRAMING_PATH]), "CHART_FRAMING_ONLY_RUNTIME_CHANGE");
  // The captured observers differ only in an unrelated return readiness budget.
  // Protected chart source and branch test budgets compose independently; both
  // complete captured profiles above remain required with their original hashes.
  if (requireCurrentObserver) {
    const currentObserver = sha(join(repo, CHART_FRAMING_SPEC));
    check(currentObserver === qualification.maps.original.observer ||
      currentObserver === qualification.maps.preview.observer, "CHART_FRAMING_CURRENT_OBSERVER");
  }
}

function verifyJointNative(repo: string, dir: string, native: NativeReceipt): void {
  const capture = native as NativeReceipt & {
    schema: string; profile: string; capture_revision: string; source_count: number;
    source_equal_combined: boolean; source_contract_sha256: string;
    source_snapshot_sha256: SourceMap; excluded_chart_branch: unknown; offline_font_sha256: string;
  };
  const contractPath = join(dir, "source-contract.json");
  check(sha(contractPath) === JOINT_CONTRACT && sha(join(dir, "capture-driver.py")) === JOINT_DRIVER &&
    sha(join(dir, "offline-font-responses.cjs")) === OFFLINE_FONT, "JOINT_CAPTURE_INPUTS");
  const contract = json<{ schema: string; protectedBase: string; optionsParent: string; acceptedExposureHead: string;
    sources: string[]; offline_font_sha256: string;
    excluded_chart_branch: { path: string; original_sha256: string; peer_sha256: string; native_initial_view: string; excluded_view: string };
  }>(contractPath);
  check(contract.schema === "options_exposure_native_contract.v1" && contract.protectedBase === BASE &&
    contract.optionsParent === "98ffa891116ccc9e6be58a64148dbe45591e6ce8" &&
    contract.acceptedExposureHead === "0182a45abccb9c0e77b2c8e4626431e89635b35f" &&
    contract.sources.length === 319 && new Set(contract.sources).size === 319 &&
    contract.offline_font_sha256 === OFFLINE_FONT, "JOINT_CONTRACT_IDENTITY");
  check(capture.schema === "options_exposure_native.v1" && capture.profile === "combined" &&
    capture.capture_revision === CURRENT_REVISION && capture.source_count === 319 &&
    capture.source_equal_combined === true && capture.source_contract_sha256 === JOINT_CONTRACT &&
    capture.offline_font_sha256 === OFFLINE_FONT, "JOINT_CAPTURE_IDENTITY");
  requireSourceKeys(capture.source_sha256, contract.sources);
  const snapshots = ["source-before.json", "source-after.json", "peer-source-before.json", "peer-source-after.json",
    "whole-original-source-before.json", "whole-original-source-after.json",
    "whole-peer-source-before.json", "whole-peer-source-after.json"];
  requireSourceKeys(capture.source_snapshot_sha256, snapshots);
  for (const name of snapshots) check(sha(join(dir, name)) === capture.source_snapshot_sha256[name], "JOINT_SNAPSHOT_DIGEST:" + name);
  for (const name of snapshots.slice(0, 4)) {
    const map = json<SourceMap>(join(dir, name));
    requireSourceKeys(map, contract.sources);
    for (const [path, digest] of Object.entries(capture.source_sha256)) check(map[path] === digest, "JOINT_STABLE_SOURCE:" + path);
  }
  for (const owner of ["original", "peer"]) check(
    capture.source_snapshot_sha256["whole-" + owner + "-source-before.json"] ===
    capture.source_snapshot_sha256["whole-" + owner + "-source-after.json"], "JOINT_WHOLE_SOURCE_STABILITY");
  const excluded = contract.excluded_chart_branch;
  check(JSON.stringify(capture.excluded_chart_branch) === JSON.stringify(excluded) &&
    excluded.path === "terminal/components/exposure-map/ExposureMap.tsx" &&
    excluded.native_initial_view === "strike" && excluded.excluded_view === "chart", "JOINT_EXCLUDED_BRANCH");
  const original = json<SourceMap>(join(dir, "whole-original-source-after.json"));
  const peer = json<SourceMap>(join(dir, "whole-peer-source-after.json"));
  // Match the pinned producer predicate; missing runtime keys cannot hide in an intersection.
  for (const [path, digest] of Object.entries(capture.source_sha256)) {
    const included = /^terminal\/(?:app|components|lib)\//.test(path) &&
      !path.includes("/__tests__/") && !/\.(?:test|spec)\./.test(path) && /\.(?:ts|tsx|css|js|cjs|mjs|json)$/.test(path);
    if (included) check(original[path] === digest && peer[path] === digest, "JOINT_WHOLE_SCOPED_SOURCE:" + path);
  }
  check(original[excluded.path] === excluded.original_sha256 && peer[excluded.path] === excluded.peer_sha256,
    "JOINT_CHART_IDENTITY");
  requireR4ChartIdentity(repo, excluded.original_sha256, excluded.peer_sha256, sha(join(repo, excluded.path)));
}

function readCandidate(repo: string, root: string, kind: EvidenceKind, profile: EvidenceProfile, crops: string[]) {
  const operation = OP[profile], operationRoot = join(root, "operations", operation);
  const dir = profile === "combined" ? join(operationRoot, "revisions", CURRENT_REVISION) : operationRoot;
  const descriptor = json<{ schema: string; kind: string; profile: string; operation: string;
    receipt: string; receiptSha256: string; manifest: string; manifestSha256: string;
    captureRevision?: string; previousPacketInventorySha256?: string }>(join(dir, "native-packet.json"));
  check(descriptor.schema === "options_exposure_packet.v1" && descriptor.kind === kind &&
    descriptor.profile === profile && descriptor.operation === operation &&
    descriptor.receipt === "capture-receipt.json" && descriptor.manifest === "qualified-root/EVIDENCE.yml", "PACKET_IDENTITY");
  if (profile === "combined") {
    check(descriptor.captureRevision === CURRENT_REVISION &&
      descriptor.previousPacketInventorySha256 === PREVIOUS_PACKET_INVENTORY[kind], "REVISION_IDENTITY");
    const priorPath = join(dir, "prior-packet-sha256.json");
    check(sha(priorPath) === PREVIOUS_PACKET_INVENTORY[kind], "PREVIOUS_PACKET_INVENTORY");
    const previous = json<SourceMap>(priorPath);
    requireSourceKeys(previous, Object.keys(previous));
    for (const [path, digest] of Object.entries(previous))
      check(sha(join(repo, path)) === digest, "PREVIOUS_PACKET:" + path);
  }
  const receiptPath = join(dir, descriptor.receipt), evidence = join(dir, descriptor.manifest);
  check(sha(receiptPath) === descriptor.receiptSha256 && sha(evidence) === descriptor.manifestSha256, "PACKET_DIGEST");
  const native = json<NativeReceipt>(receiptPath);
  check(native.operation === operation && native.protectedBase === BASE &&
    native.kind === kind && native.packet === PACKETS[kind], "NATIVE_IDENTITY");
  check(native.exit === 0 && native.expected === crops.length && native.successful_files === crops.length &&
    native.source_stable === true && Array.isArray(native.failed_frames) && native.failed_frames.length === 0, "NATIVE_RESULT");
  check(native.log_sha256 === sha(join(dir, "capture.log")) &&
    native.native_manifest_sha256 === descriptor.manifestSha256, "NATIVE_PAYLOAD");
  if (profile === "combined") verifyJointNative(repo, dir, native);
  else requireSourceKeys(native.source_sha256, nativeSources(kind, profile));
  requireSourceKeys(native.image_sha256, crops);
  const cropDir = join(dir, "qualified-root");
  check(sameKeys(readdirSync(cropDir).filter(name => name.endsWith(".png")), crops), "NATIVE_IMAGE_SET");
  for (const name of crops) check(sha(join(cropDir, name)) === native.image_sha256[name], "NATIVE_IMAGE:" + name);
  const sources = { ...native.source_sha256 };
  if (profile === "exposure") {
    const frozenPath = join(repo, "terminal/docs/verification/exposure-workspace-20261103/source-compatibility-20261105/original/browser-source-after.json");
    check(sha(frozenPath) === "f1c54ada9ecc0da40ed379c8c622483f602915d9eaf2f7967258e5b9081bc6db", "F12_SOURCE_SNAPSHOT");
    const frozen = json<SourceMap>(frozenPath);
    for (const [path, digest] of Object.entries(sources)) check(frozen[path] === digest, "F12_SOURCE:" + path);
    check(sources[LAB] === "1b9bfeaa9ae3a9460fcecd812a98dcd8ef6591df0041d5dc4a53bde6dc2daf8b", "F12_LAB_SOURCE");
    // One exact, separately browser-qualified compatibility transition; no arbitrary drift list.
    sources[LAB] = "365223a8182effc04fa956a8004062aa86c1426de8fc24eccebf6952e1571820";
    sources[WRAPPER] = "b5d53a1a443cd81e7598826181327777fec1d3fd52879b75a23fd6fceeaba6f8";
  }
  return { profile, sources, native, cropDir, evidence, layout: layoutSources(kind, profile), protectedManifest: join(dir, "EVIDENCE.protected.yml") };
}

/** Select one complete recorded source composition. Corrupt declarations never fall back. */
export function qualifiedOptionsExposurePacket(repo: string, kind: EvidenceKind, crops: string[]) {
  check(crops.length === (kind === "gex" ? 114 : 126) && new Set(crops).size === crops.length &&
    crops.every(name => /^[a-z0-9-]+\.png$/.test(name)), "EXPECTED_CROP_SET");
  const root = join(repo, "terminal/docs/pr-crops", PACKETS[kind]);
  const text = readFileSync(join(root, "EVIDENCE.yml"), "utf8");
  if (text.includes("exposureMasterIntegration20261109"))
    return readExposureMasterIntegration(repo, root, kind, crops, text);
  const exposure = text.includes("\nexposureSourceCompatibility20261105:\n");
  const options = text.includes("\noptionsSourceCompatibility20261105:\n");
  check(exposure || options, "MISSING_PACKET_DECLARATION");
  const expDir = join(root, "operations", OP.exposure), optDir = join(root, "operations", OP.options);
  const protectedPath = join(exposure ? expDir : optDir, "EVIDENCE.protected.yml");
  check(sha(protectedPath) === PROTECTED[kind], "PROTECTED_BASELINE_DIGEST");
  let prefix = "", suffix = "";
  const candidates = [];
  if (exposure) {
    const folder = "operations/" + OP.exposure;
    prefix = "# Current candidate proof is the operation below; the remainder preserves the protected baseline.\n" +
      yamlBlock("exposureSourceCompatibility20261105", {
        protectedBase: BASE, priorPublishedHead: "e9fa843122ac0eee36d607b8313e0bb264bed840",
        activeManifest: folder + "/qualified-root/EVIDENCE.yml", priorManifest: folder + "/EVIDENCE.before.yml",
        priorImages: folder + "/prior-root", activeManifestSha256: sha(join(expDir, "qualified-root/EVIDENCE.yml")),
        captureReceiptSha256: sha(join(expDir, "capture-receipt.json")),
        qualifiedPacket: folder + "/native-packet.json", qualifiedPacketSha256: sha(join(expDir, "native-packet.json")),
      }) + "\n";
    candidates.push(readCandidate(repo, root, kind, "exposure", crops));
  }
  if (options) {
    const folder = "operations/" + OP.options, combined = "operations/" + OP.combined + "/revisions/" + CURRENT_REVISION;
    suffix = "\n# Qualified Options and combined source compositions; protected baseline is retained.\n" +
      yamlBlock("optionsSourceCompatibility20261105", {
        protectedBase: BASE, priorPublishedHead: "98ffa891116ccc9e6be58a64148dbe45591e6ce8",
        priorManifest: folder + "/EVIDENCE.before.yml",
        acceptedExposureDependency: "0182a45abccb9c0e77b2c8e4626431e89635b35f",
        jointPacket: combined + "/native-packet.json", jointPacketSha256: sha(join(root, combined, "native-packet.json")),
        sourceContractSha256: JOINT_CONTRACT,
      });
    candidates.push(readCandidate(repo, root, kind, "combined", crops));
  }
  const protectedText = readFileSync(protectedPath, "utf8");
  const anchor = "theme: dark\n";
  if (options) check(protectedText.split(anchor).length === 2, "ROOT_MANIFEST_ANCHOR");
  const body = options ? protectedText.replace(anchor, suffix + "\n" + anchor) : protectedText;
  check(text === prefix + body, "ROOT_MANIFEST_RECONSTRUCTION");
  const current: SourceMap = {};
  for (const path of new Set(candidates.flatMap(candidate => Object.keys(candidate.sources))))
    if (existsSync(join(repo, path))) current[path] = sha(join(repo, path));
  const qualified = candidates.map(candidate => candidate.profile === "combined"
    ? { ...candidate, sources: projectR4CaptureHarness(candidate.sources, current) } : candidate);
  const selected = selectWholeFingerprint(qualified, current);
  check(selected.profile === (options ? "combined" : "exposure"), "PROFILE_OWNERSHIP");
  const boundarySources = exposure ? verifyBoundary(repo) : null;
  if (exposure) verifyHistory(root, kind, "exposure", crops);
  const optionsHistorySources = options ? verifyHistory(root, kind, "options", crops) : {};
  check(sameKeys(readdirSync(root).filter(name => name.endsWith(".png")), crops), "PROTECTED_ROOT_SET");
  const exposureHistorical = exposure ? {
    ...candidates.find(candidate => candidate.profile === "exposure")!, root, boundarySources: boundarySources!,
  } : null;
  return { ...selected, protectedManifest: protectedPath, optionsHistorySources,
    hasExposureHistory: exposure, hasOptionsHistory: options, exposureHistorical };
}

const MASTER_REVISION = "master-integration-20261109";
const MASTER_PRIOR = "883fee550a9628812a4fbcdc77e479ab8cad3b3a";
const MASTER_PROTECTED = "f2aa1e0cb27d459149f59d3b24d98cd6e2e8389f";
const MASTER_PACKET = { gex: "6074a35447c6ec3447cf9a0542b08d6a206c3660d483abf0e271daac21e6804b", eod: "8bb050b222bc7c822486ba85a0019734013575dac1fa1f76ded272d6b62e86d8" };
const MASTER_BROWSER = "cd5a64f4cb8e1c573d923ed6567054cc126d1ccabeabe1f09ccef0d35a1692cd";
const MASTER_HISTORY = {
  gex: { exposure: "b98ca38abe6ec26a2fa0156c3ca1e2e2caedad04ea81a4a862f1f38f4ff309e6", protected: "5bad92213f181ace64539f60e5b9e7312906e3f893a9d3fb7fe2044dcc37601e" },
  eod: { exposure: "b0110a00f14c663c504fb49ae25dbe5f24cbc33c82e45e6bf4c0ef204a54df40", protected: "c726ac1938cc85bf005b71ba01e0cec0a00dc57ae4ca168c1724a6200ea275bf" },
};
const MASTER_SUCCESSOR_INPUTS = [
  WRAPPER,
  "terminal/lib/accountIdentity.ts",
  "terminal/components/researchlab/ResearchQuestionAction.tsx",
  "terminal/lib/optionsQuestionContext.ts",
  "terminal/lib/matrixAcquisition.ts",
  "terminal/lib/investigationEvidenceOptions.ts",
  "terminal/lib/investigationEvidenceOptionsSelection.ts",
  "terminal/lib/investigationOptionsReference.ts",
  "terminal/lib/mastermindBrain.ts",
];
export const masterIntegrationInputs = (kind: EvidenceKind): string[] =>
  [...new Set([...nativeSources(kind, "exposure"), ...MASTER_SUCCESSOR_INPUTS])].sort();
export const MASTER_BROWSER_SPECS = [
  "terminal/e2e/exposure-workspace.spec.ts",
  CHART_FRAMING_SPEC,
  "terminal/e2e/options-lab-source-state.spec.ts",
  "terminal/e2e/options-exposure-surface-journey.spec.ts",
  "terminal/e2e/options-research-question.spec.ts",
];
export const masterIntegrationBrowserInputs = (): string[] => [...new Set([
  ...masterIntegrationInputs("gex"), ...masterIntegrationInputs("eod"), ...BOUNDARY_SOURCES,
  ...MASTER_BROWSER_SPECS, CHART_FRAMING_PATH,
  "terminal/components/researchlab/researchLabAdapter.ts",
  "terminal/components/researchlab/ResearchLab.module.css",
  "terminal/playwright.config.ts", "terminal/e2e/globalSetup.ts", "terminal/e2e/fixtureWarmup.cjs",
  "terminal/e2e/presentationControls.ts",
  "terminal/lib/__tests__/fixtures/exposure-projection-one-sided-v2.json",
  "terminal/lib/__tests__/fixtures/exposure-projection.json",
  "terminal/components/options-companion/optionsStrings.ts",
  "terminal/components/exposure-map/exposureMapStrings.ts",
  "terminal/components/exposure-map/exposureSurfaceStrings.ts",
  "terminal/lib/watchlistsFixtureDb.ts", "terminal/lib/exposureChartLink.ts",
  "terminal/lib/exposureMap.ts", "terminal/lib/exposureMapProjection.ts",
  "terminal/lib/marketStructure.ts", "terminal/lib/gexLadder.ts", "terminal/lib/dte.ts",
  "terminal/lib/usEquitySessionClock.ts", "terminal/lib/usEquitySessionProjection.json",
])].sort();
type IntegrationExecution = {
  schema: string; operation: string; revision: string; kind: EvidenceKind; packet: string;
  branchHead: string; protectedMaster: string; command: string[]; exit: number;
  expected: number; successfulFiles: number; sourceStable: boolean;
  sourceBeforeSha256: string; sourceAfterSha256: string; manifestSha256: string; logSha256: string;
  frames: { file: string; status: string }[];
  images: Record<string, { sha256: string; bytes: number; width: number; height: number }>;
};

/** A failed full GEX run may still emit a manifest; its actual result is decisive. */
export function requireIntegrationExecution(value: IntegrationExecution, kind: EvidenceKind, crops: string[]): void {
  check(value.schema === "exposure_master_integration_capture.v1" && value.operation === OP.exposure &&
    value.revision === MASTER_REVISION && value.kind === kind && value.packet === PACKETS[kind] &&
    value.branchHead === MASTER_PRIOR && value.protectedMaster === MASTER_PROTECTED, "INTEGRATION_CAPTURE_IDENTITY");
  check(JSON.stringify(value.command) === JSON.stringify(["node", harness(kind).replace(/^terminal\//, "")]),
    "INTEGRATION_CAPTURE_COMMAND");
  check(value.exit === 0 && value.expected === crops.length && value.successfulFiles === crops.length &&
    value.sourceStable === true, "INTEGRATION_CAPTURE_RESULT");
  check(Array.isArray(value.frames) && value.frames.length === crops.length &&
    sameKeys(value.frames.map(frame => frame.file), crops) &&
    new Set(value.frames.map(frame => frame.file)).size === crops.length &&
    value.frames.every(frame => frame.status === "success"), "INTEGRATION_FRAME_SET");
  check(sameKeys(Object.keys(value.images), crops), "INTEGRATION_IMAGE_SET");
  for (const image of Object.values(value.images)) check(/^[0-9a-f]{64}$/.test(image.sha256) &&
    Number.isInteger(image.bytes) && image.bytes > 1000 && Number.isInteger(image.width) && image.width > 0 &&
    Number.isInteger(image.height) && image.height > 0, "INTEGRATION_IMAGE_RECORD");
  check(/^[0-9a-f]{64}$/.test(value.logSha256), "INTEGRATION_LOCAL_LOG_PROVENANCE");
}

function integrationArchive(dir: string, label: "exposure" | "protected", kind: EvidenceKind, crops: string[]): string {
  const name = "prior-" + label + "-root", inventory = join(dir, name + "-sha256.json"), archive = join(dir, name);
  check(sha(inventory) === MASTER_HISTORY[kind][label], "INTEGRATION_HISTORY_INVENTORY:" + label);
  const files = json<SourceMap>(inventory);
  requireSourceKeys(files, [...crops, "EVIDENCE.yml"]);
  check(sameKeys(readdirSync(archive), Object.keys(files)), "INTEGRATION_HISTORY_SET:" + label);
  for (const [file, digest] of Object.entries(files))
    check(sha(join(archive, file)) === digest, "INTEGRATION_HISTORY_FILE:" + label + ":" + file);
  return archive;
}

function exposurePrefix(dir: string): string {
  const folder = "operations/" + OP.exposure;
  return "# Current candidate proof is the operation below; the remainder preserves the protected baseline.\n" +
    yamlBlock("exposureSourceCompatibility20261105", {
      protectedBase: BASE, priorPublishedHead: "e9fa843122ac0eee36d607b8313e0bb264bed840",
      activeManifest: folder + "/qualified-root/EVIDENCE.yml", priorManifest: folder + "/EVIDENCE.before.yml",
      priorImages: folder + "/prior-root", activeManifestSha256: sha(join(dir, "qualified-root/EVIDENCE.yml")),
      captureReceiptSha256: sha(join(dir, "capture-receipt.json")),
      qualifiedPacket: folder + "/native-packet.json", qualifiedPacketSha256: sha(join(dir, "native-packet.json")),
    }) + "\n";
}

function verifyIntegrationBrowser(repo: string): void {
  const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103", MASTER_REVISION);
  check(sha(join(dir, "qualification.json")) === MASTER_BROWSER, "INTEGRATION_BROWSER_QUALIFICATION");
  const proof = json<{ schema: string; branchHead: string; protectedMaster: string; files: SourceMap;
    currentSources: SourceMap; expectedPassed: string[]; expectedSkipped: string[];
  }>(join(dir, "qualification.json"));
  check(proof.schema === "exposure_master_integration_browser.v1" && proof.branchHead === MASTER_PRIOR &&
    proof.protectedMaster === MASTER_PROTECTED, "INTEGRATION_BROWSER_IDENTITY");
  requireSourceKeys(proof.files, ["browser-report.json", "browser-execution.json", "source-before.json", "source-after.json"]);
  for (const [name, digest] of Object.entries(proof.files)) check(sha(join(dir, name)) === digest, "INTEGRATION_BROWSER_FILE:" + name);
  const before = json<SourceMap>(join(dir, "source-before.json")), after = json<SourceMap>(join(dir, "source-after.json"));
  check(proof.files["source-before.json"] === proof.files["source-after.json"], "INTEGRATION_BROWSER_SOURCE_STABILITY");
  requireSourceKeys(proof.currentSources, masterIntegrationBrowserInputs());
  for (const [path, digest] of Object.entries(proof.currentSources))
    check(before[path] === digest && after[path] === digest && sha(join(repo, path)) === digest,
      "INTEGRATION_BROWSER_CURRENT_SOURCE:" + path);
  const execution = json<{ exit: number; retries: number; sourceStable: boolean; command: string[]; ownedServerStopped: boolean;
    passed: number; failed: number; skipped: number; flaky: number;
    fixtureOverrides: Record<string, string | null>; artifactFiles: SourceMap;
  }>(join(dir, "browser-execution.json"));
  const overrideKeys = ["EXPOSURE_P09_CURRENT_WITNESS", "EXPOSURE_P09_PREVIOUS_WITNESS", "EXPOSURE_NATIVE_WITNESS",
    "TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE", "TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE", "TERMINAL_EXPOSURE_PAINT_PROBE"];
  check(sameKeys(Object.keys(execution.fixtureOverrides), overrideKeys) &&
    overrideKeys.every(key => execution.fixtureOverrides[key] === null), "INTEGRATION_BROWSER_BUNDLED_FIXTURES");
  check(execution.exit === 0 && execution.retries === 0 && execution.sourceStable && execution.ownedServerStopped &&
    execution.failed === 0 && execution.flaky === 0 && execution.passed === proof.expectedPassed.length &&
    execution.skipped === proof.expectedSkipped.length &&
    MASTER_BROWSER_SPECS.every(path => execution.command.includes(path.replace(/^terminal\//, ""))), "INTEGRATION_BROWSER_RESULT");
  check(Object.keys(execution.artifactFiles).length > 0, "INTEGRATION_BROWSER_ARTIFACTS");
  for (const [path, digest] of Object.entries(execution.artifactFiles))
    check(path.startsWith("browser-artifacts/") && !path.split("/").includes("..") &&
      /^[0-9a-f]{64}$/.test(digest) && sha(join(dir, path)) === digest, "INTEGRATION_BROWSER_ARTIFACT:" + path);
  const report = json<ChartFramingSuite & { errors?: unknown[]; stats: { expected: number; unexpected: number; skipped: number; flaky: number } }>(join(dir, "browser-report.json"));
  check(!report.errors?.length && report.stats.expected === execution.passed && report.stats.unexpected === 0 &&
    report.stats.skipped === execution.skipped && report.stats.flaky === 0, "INTEGRATION_BROWSER_REPORT");
  const passed: string[] = [], skipped: string[] = [], chartCases: string[] = [];
  function visit(suite: ChartFramingSuite): void {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      const key = test.projectName + "|" + spec.title;
      check(test.results.length === 1 && test.results[0].retry === 0, "INTEGRATION_BROWSER_ATTEMPT");
      const result = test.results[0];
      check(result.status === "passed" || result.status === "skipped", "INTEGRATION_BROWSER_CASE");
      (result.status === "passed" ? passed : skipped).push(key);
      if (spec.title.startsWith("Connected exposure workspace ")) {
        check(result.status === "passed", "INTEGRATION_CHART_REQUIRED"); chartCases.push(key);
        const attachments = result.attachments?.filter(item => item.name === "exposure-header-clearance") ?? [];
        check(attachments.length === 1 && attachments[0].contentType === "application/json" &&
          typeof attachments[0].body === "string" && attachments[0].path === undefined, "INTEGRATION_CHART_ATTACHMENT");
        const witness = JSON.parse(Buffer.from(attachments[0].body, "base64").toString("utf8")) as { initial: ChartGlyph[]; afterFit: ChartGlyph[] };
        for (const glyphs of [witness.initial, witness.afterFit]) {
          check(Array.isArray(glyphs) && glyphs.length > 0 && glyphs.length <= 6 &&
            glyphs.filter(row => row.strike === 756).length === 1 && new Set(glyphs.map(row => row.strike)).size === glyphs.length,
            "INTEGRATION_CHART_GLYPHS");
          for (const row of glyphs) check([756,757,755,747,746,748].includes(row.strike) &&
            [row.gap,row.paint,row.labelTop,row.headerBottom].every(Number.isFinite) && row.gap >= 4 &&
            Number.isInteger(row.paint) && row.paint > 0 && Math.abs(row.gap-(row.labelTop-row.headerBottom)) < .000001,
            "INTEGRATION_CHART_CLEARANCE");
        }
        check(witness.afterFit.find(row => row.strike === 756)!.paint > witness.initial.find(row => row.strike === 756)!.paint,
          "INTEGRATION_CHART_FRESH_PAINT");
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(report);
  check(sameKeys(passed, proof.expectedPassed) && new Set(passed).size === passed.length &&
    sameKeys(skipped, proof.expectedSkipped), "INTEGRATION_BROWSER_CASE_SET");
  check(sameKeys(chartCases, ["desktop", "tablet", "mobile"].flatMap(project => ["en", "zh"].map(lang =>
    project + "|Connected exposure workspace " + lang + ": chart, comparison scopes, scanner and return"))), "INTEGRATION_CHART_CASE_SET");
}

function readExposureMasterIntegration(repo: string, root: string, kind: EvidenceKind, crops: string[], text: string) {
  const operation = join(root, "operations", OP.exposure), relative = "operations/" + OP.exposure + "/revisions/" + MASTER_REVISION;
  const dir = join(root, relative), descriptorPath = join(dir, "native-packet.json");
  check(sha(descriptorPath) === MASTER_PACKET[kind], "INTEGRATION_PACKET_DIGEST");
  const descriptor = json<{ schema: string; kind: EvidenceKind; profile: string; operation: string; captureRevision: string;
    branchHead: string; protectedMaster: string; files: SourceMap;
  }>(descriptorPath);
  check(descriptor.schema === "options_exposure_master_packet.v1" && descriptor.kind === kind && descriptor.profile === "exposure" &&
    descriptor.operation === OP.exposure && descriptor.captureRevision === MASTER_REVISION &&
    descriptor.branchHead === MASTER_PRIOR && descriptor.protectedMaster === MASTER_PROTECTED, "INTEGRATION_PACKET_IDENTITY");
  const files = ["capture-execution.json", "capture-sources-before.json", "capture-sources-after.json", "source-contract.json",
    "qualified-root/EVIDENCE.yml", "history.json", "prior-exposure-root-sha256.json", "prior-protected-root-sha256.json"];
  requireSourceKeys(descriptor.files, files);
  for (const [file, digest] of Object.entries(descriptor.files)) check(sha(join(dir, file)) === digest, "INTEGRATION_PAYLOAD:" + file);
  const priorRoot = integrationArchive(dir, "exposure", kind, crops), protectedRoot = integrationArchive(dir, "protected", kind, crops);
  const historical = readCandidate(repo, root, kind, "exposure", crops), boundarySources = verifyBoundary(repo, false);
  verifyHistory(root, kind, "exposure", crops, priorRoot);
  check(readFileSync(join(priorRoot, "EVIDENCE.yml"), "utf8") === exposurePrefix(operation) +
    readFileSync(historical.protectedManifest, "utf8"), "INTEGRATION_EXPOSURE_MANIFEST_HISTORY");
  for (const path of [LAB, WRAPPER]) check(historical.sources[path] === boundarySources[path], "INTEGRATION_BOUNDARY_HISTORY:" + path);
  requireR4ChartIdentity(repo, CHART_FRAMING_MAPS.original.before, CHART_FRAMING_MAPS.preview.before,
    CHART_FRAMING_MAPS.original.after, false);
  const declaration = "# Current source proof is the complete Exposure master integration revision.\n" +
    yamlBlock("exposureMasterIntegration20261109", {
      revision: relative, descriptorSha256: MASTER_PACKET[kind], branchHead: MASTER_PRIOR, protectedMaster: MASTER_PROTECTED,
    }) + "\n";
  check(text === declaration + readFileSync(join(protectedRoot, "EVIDENCE.yml"), "utf8"), "INTEGRATION_ROOT_MANIFEST");
  check(sameKeys(readdirSync(root).filter(name => name.endsWith(".png")), crops), "INTEGRATION_PROTECTED_ROOT_SET");
  for (const name of crops) check(sha(join(root, name)) === sha(join(protectedRoot, name)), "INTEGRATION_PROTECTED_ROOT_IMAGE:" + name);
  const execution = json<IntegrationExecution>(join(dir, "capture-execution.json"));
  requireIntegrationExecution(execution, kind, crops);
  const contract = json<{ schema: string; kind: EvidenceKind; currentInputs: string[]; observedInputs: string[] }>(join(dir, "source-contract.json"));
  const paths = masterIntegrationInputs(kind);
  check(contract.schema === "exposure_master_capture_sources.v1" && contract.kind === kind &&
    sameKeys(contract.currentInputs, paths) && new Set(contract.currentInputs).size === paths.length,
    "INTEGRATION_SOURCE_CONTRACT");
  const before = json<SourceMap>(join(dir, "capture-sources-before.json")), after = json<SourceMap>(join(dir, "capture-sources-after.json"));
  requireSourceKeys(before, contract.observedInputs); requireSourceKeys(after, contract.observedInputs);
  check(execution.sourceBeforeSha256 === descriptor.files["capture-sources-before.json"] &&
    execution.sourceAfterSha256 === descriptor.files["capture-sources-after.json"] &&
    execution.sourceBeforeSha256 === execution.sourceAfterSha256, "INTEGRATION_SOURCE_STABILITY");
  const sources = Object.fromEntries(paths.map(path => [path, before[path]]));
  requireSourceKeys(sources, paths);
  const current = Object.fromEntries(paths.map(path => [path, sha(join(repo, path))]));
  selectWholeFingerprint([{ sources }], current);
  const cropDir = join(dir, "qualified-root"), evidence = join(cropDir, "EVIDENCE.yml");
  check(execution.manifestSha256 === sha(evidence), "INTEGRATION_NATIVE_MANIFEST");
  check(sameKeys(readdirSync(cropDir).filter(name => name.endsWith(".png")), crops), "INTEGRATION_NATIVE_CROPS");
  for (const name of crops) {
    const bytes = readFileSync(join(cropDir, name)), record = execution.images[name];
    check(sha(join(cropDir, name)) === record.sha256 && bytes.length === record.bytes &&
      bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      bytes.readUInt32BE(16) === record.width && bytes.readUInt32BE(20) === record.height, "INTEGRATION_NATIVE_IMAGE:" + name);
  }
  const manifest = readFileSync(evidence, "utf8"), layout = layoutSources(kind, "exposure");
  const layoutText = manifest.split("\nlayoutFiles:\n"); check(layoutText.length === 2, "INTEGRATION_LAYOUT_SECTION");
  const recorded: SourceMap = {};
  for (const row of layoutText[1].split("\n")) {
    if (!row.startsWith("  ")) break;
    const match = row.match(/^  (\S+): "([0-9a-f]{64})"$/); check(match && !recorded[match[1]], "INTEGRATION_LAYOUT_ROW"); recorded[match[1]] = match[2];
  }
  requireSourceKeys(recorded, layout);
  for (const path of layout) check(recorded[path] === sources[path], "INTEGRATION_LAYOUT_CAPTURE:" + path);
  const fileRows = [...manifest.matchAll(/^  - ([a-z0-9-]+\.png)$/gm)].map(match => match[1]);
  const harnessRows = [...manifest.matchAll(/^  ([a-z0-9-]+\.png): \{ url:/gm)].map(match => match[1]);
  check(sameKeys(fileRows, crops) && sameKeys(harnessRows, crops) && new Set(fileRows).size === crops.length &&
    new Set(harnessRows).size === crops.length, "INTEGRATION_MANIFEST_CASE_SET");
  verifyIntegrationBrowser(repo);
  const native: NativeReceipt = { operation: OP.exposure, protectedBase: MASTER_PROTECTED, kind, packet: PACKETS[kind],
    expected: execution.expected, successful_files: execution.successfulFiles, exit: execution.exit, source_stable: execution.sourceStable,
    failed_frames: [], source_sha256: sources, image_sha256: Object.fromEntries(Object.entries(execution.images).map(([name, value]) => [name, value.sha256])),
    native_manifest_sha256: execution.manifestSha256, log_sha256: execution.logSha256 };
  return { profile: "exposure" as const, captureRevision: MASTER_REVISION, sources, native, cropDir, evidence, layout,
    protectedManifest: join(protectedRoot, "EVIDENCE.yml"), optionsHistorySources: {} as SourceMap,
    hasExposureHistory: true, hasOptionsHistory: false,
    exposureHistorical: { ...historical, root: priorRoot, boundarySources } };
}
