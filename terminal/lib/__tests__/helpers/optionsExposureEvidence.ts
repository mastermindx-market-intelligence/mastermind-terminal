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
function verifyHistory(root: string, kind: EvidenceKind, profile: "exposure" | "options", crops: string[]): SourceMap {
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
    check(sha(join(root, name)) === protectedImages[name], "PROTECTED_ROOT_IMAGE:" + name);
  if (profile === "options") {
    const sourcePath = join(dir, "historical-source-sha256.json");
    check(sha(sourcePath) === OPTIONS_SOURCE_PINS[kind], "OPTIONS_HISTORICAL_SOURCES");
    return json<SourceMap>(sourcePath);
  }
  return {};
}
function verifyBoundary(repo: string): void {
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
      check(sources[path] === qualification.boundary_sources[path] && sources[path] === sha(join(repo, path)),
        "BOUNDARY_CURRENT_SOURCE:" + path);
  }
}
const JOINT_CONTRACT = "a7cd2ce244a0ae278fc24bf25a51566c0053c89f9ce3fb17ae12b350f1541db7";
const JOINT_DRIVER = "9126a93f34d6f4fb0bdab4c285dc687b6fb53ca166736a8db34bb55fe56f0881";
const OFFLINE_FONT = "0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd";
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
  check(original[excluded.path] === excluded.original_sha256 && peer[excluded.path] === excluded.peer_sha256 &&
    [excluded.original_sha256, excluded.peer_sha256].includes(sha(join(repo, excluded.path))), "JOINT_CHART_IDENTITY");
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
    suffix = "\n# Qualified Options and combined source compositions; protected baseline above is retained.\n" +
      yamlBlock("optionsSourceCompatibility20261105", {
        protectedBase: BASE, priorPublishedHead: "98ffa891116ccc9e6be58a64148dbe45591e6ce8",
        priorManifest: folder + "/EVIDENCE.before.yml",
        acceptedExposureDependency: "0182a45abccb9c0e77b2c8e4626431e89635b35f",
        jointPacket: combined + "/native-packet.json", jointPacketSha256: sha(join(root, combined, "native-packet.json")),
        sourceContractSha256: JOINT_CONTRACT,
      });
    candidates.push(readCandidate(repo, root, kind, "combined", crops));
  }
  check(text === prefix + readFileSync(protectedPath, "utf8") + suffix, "ROOT_MANIFEST_RECONSTRUCTION");
  const current: SourceMap = {};
  for (const path of new Set(candidates.flatMap(candidate => Object.keys(candidate.sources))))
    if (existsSync(join(repo, path))) current[path] = sha(join(repo, path));
  const selected = selectWholeFingerprint(candidates, current);
  check(selected.profile === (options ? "combined" : "exposure"), "PROFILE_OWNERSHIP");
  if (exposure) { verifyHistory(root, kind, "exposure", crops); verifyBoundary(repo); }
  const optionsHistorySources = options ? verifyHistory(root, kind, "options", crops) : {};
  check(sameKeys(readdirSync(root).filter(name => name.endsWith(".png")), crops), "PROTECTED_ROOT_SET");
  return { ...selected, protectedManifest: protectedPath, optionsHistorySources, hasExposureHistory: exposure, hasOptionsHistory: options };
}
