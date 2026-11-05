import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { requireSourceKeys } from "./optionsExposureEvidence";

type Kind = "vi" | "pl6";
type Map = Record<string, string>;
const BASE = "11531481b0a540ee96bcd86df418fd1e42715363";
const PARENT = "98ffa891116ccc9e6be58a64148dbe45591e6ce8";
const OP = "options-source-compatibility-20261105";
const CURRENT_REVISION = "options-navigation-r4";
const CAPTURE_DRIVER = "cd36837df355c144ecd6b60185cbe4c231e03f568a82351b7eb77caffeae5d61";
const PREVIOUS_PACKET_INVENTORY = {
  vi: "3e32136df1246cc6d405d0fd234dc0fbd130b0be48078d07ebef3e1a8a0a9ead",
  pl6: "22dfe6b7a74d007351e837dd600cecee0652b05bc9d5d831c61d966dfc436381",
};
const CONTRACT = "ae18b1cea284e9258e84bcc289939d293f60d80e82b24b6cb6cb029c35a0b9e9";
const PACKETS = { vi: "terminal-visual-intelligence", pl6: "b-pl-6-batch-1" };
const PL6_NATIVE_LAYOUT = [
  "terminal/components/OptionsHubView.tsx", "terminal/components/SearchModal.tsx",
  "terminal/components/StockAnalysis.tsx", "terminal/components/workspaces/AnalysisWorkspace.tsx",
  "terminal/components/ChartPanel.tsx", "terminal/components/DayRange.tsx",
  "terminal/lib/plainLabels.ts", "terminal/lib/i18n.tsx", "terminal/app/company-intelligence.css",
];
const PINS = {
  vi: {
    before: "77b35808e0b7ce61a20d6a48c52b1b9bf84e22fa867b8f81c3533597afe50d9c",
    protected: "b744ff3c66a2836a354bd3c9898559ada018afe98197941e334d70b42087ee02",
    priorMap: "5cedfd93c8f1b3770548e39d4e59985d4f9d8a661437c01787bd178475de2eec",
    protectedMap: "c7a341834d130aca938ace8335e32a0163143eed1f1b5d33ed522e952b2a98ed",
  },
  pl6: {
    before: "f19401dbb7a9942fb8c899819f48e65338a75579bccad0ecc72f710c844d5cd3",
    protected: "fb469ffeba649cf0a0bdfb21f8c2d27b7c0213ec90502b4be0bd49e12b4b2505",
    priorMap: "1c2537b06ebf7f3b7a984cd6f4ca48e3af44578b4c604b5fbf80f0ce0c266845",
    protectedMap: "8467d501a8636dd1a39a6705cde3688682860d7d75fd27fd6754d2b986281c69",
  },
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Options visual evidence: " + message);
}
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const equal = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function mapSection(text: string, key: string): Map {
  const marker = key + ":\n", at = text.indexOf(marker);
  check(at >= 0, "MISSING_MAP:" + key);
  const result: Map = {};
  for (const line of text.slice(at + marker.length).split("\n")) {
    if (!line.startsWith("  ")) break;
    const row = line.match(/^  (\S+): "?([0-9a-f]{64})"?$/);
    check(row && !(row[1] in result), "INVALID_MAP:" + key);
    result[row[1]] = row[2];
  }
  check(Object.keys(result).length > 0, "EMPTY_MAP:" + key);
  return result;
}
function sameMap(actual: Map, expected: Map, label: string): void {
  requireSourceKeys(actual, Object.keys(expected));
  for (const [name, digest] of Object.entries(expected)) check(actual[name] === digest, label + ":" + name);
}
function cropNames(kind: Kind): string[] {
  if (kind === "vi") return ["desktop", "tablet", "mobile"].flatMap(v => [v + "-context.png", v + "-context-zh.png"]).sort();
  return ["AnalysisWorkspace", "ChartChrome", "DiscoverLeaders", "OptionsHubView", "SearchModal", "StockAnalysis"]
    .flatMap(surface => [1440, 390].flatMap(width => [surface + "-" + width + ".png", surface + "-" + width + "-zh.png"])).sort();
}
function verifyHistory(root: string, dir: string, kind: Kind): void {
  const pins = PINS[kind];
  check(sha(join(dir, "EVIDENCE.before.yml")) === pins.before &&
    sha(join(dir, "EVIDENCE.protected.yml")) === pins.protected &&
    sha(join(dir, "prior-root-sha256.json")) === pins.priorMap &&
    sha(join(dir, "protected-root-sha256.json")) === pins.protectedMap, "HISTORY_PINS");
  const prior = json<Map>(join(dir, "prior-root-sha256.json"));
  const baseline = json<Map>(join(dir, "protected-root-sha256.json"));
  check(equal(readdirSync(join(dir, "prior-root")), Object.keys(prior)), "PRIOR_ROOT_SET");
  check(equal(readdirSync(root, { withFileTypes: true }).filter(x => x.isFile()).map(x => x.name), Object.keys(baseline)), "PROTECTED_ROOT_SET");
  for (const [name, digest] of Object.entries(prior)) check(sha(join(dir, "prior-root", name)) === digest, "PRIOR_ROOT:" + name);
  for (const [name, digest] of Object.entries(baseline))
    if (name !== "EVIDENCE.yml") check(sha(join(root, name)) === digest, "PROTECTED_ROOT:" + name);
}
type Receipt = {
  schema: string; packet: Kind; operation: string; protectedBase: string;
  capture_revision: string; driver_sha256: string;
  source_contract_sha256: string; source_stable: boolean; source_equal_options: boolean;
  source_sha256: Map; source_count: number; exit: number; passed: number; failed: number;
  skipped: number; retries: number; command: string[];
  profile: { theme: string; fixture: string; compiler: string };
  log_sha256: string; images: Map; browser_report_sha256: string | null;
  native_manifest_sha256: string | null;
};

/** The existing explicit composition path remains the caller's first choice.
 * This default path binds one actual capture, its complete declared source closure,
 * and both immutable histories. No directory scan or alternate-run fallback.
 */
export function qualifiedOptionsVisualPacket(repo: string, kind: Kind) {
  const root = join(repo, "terminal/docs/pr-crops", PACKETS[kind]), historyDir = join(root, "operations", OP);
  const dir = join(historyDir, "revisions", CURRENT_REVISION);
  const descriptorPath = join(dir, "qualified-packet.json");
  const descriptor = json<{ schema: string; kind: Kind; operation: string; receipt: string; receiptSha256: string;
    manifest: string; manifestSha256: string; sourceBeforeSha256: string; sourceAfterSha256: string;
    inventoryReconciliationSha256?: string; captureRevision: string; driverSha256: string;
    previousPacketInventorySha256: string }>(descriptorPath);
  check(descriptor.schema === "options_visual_packet.v1" && descriptor.kind === kind && descriptor.operation === OP &&
    descriptor.receipt === "capture-receipt.json" && descriptor.manifest === "qualified-root/EVIDENCE.yml" &&
    descriptor.captureRevision === CURRENT_REVISION && descriptor.driverSha256 === CAPTURE_DRIVER &&
    descriptor.inventoryReconciliationSha256 === undefined, "PACKET_IDENTITY");
  const priorPath = join(dir, "prior-packet-sha256.json");
  check(descriptor.previousPacketInventorySha256 === PREVIOUS_PACKET_INVENTORY[kind] &&
    sha(priorPath) === PREVIOUS_PACKET_INVENTORY[kind], "PREVIOUS_PACKET_INVENTORY");
  const previous = json<Map>(priorPath);
  requireSourceKeys(previous, Object.keys(previous));
  for (const [path, digest] of Object.entries(previous))
    check(sha(join(repo, path)) === digest, "PREVIOUS_PACKET:" + path);
  check(sha(join(dir, "capture-driver.py")) === CAPTURE_DRIVER, "CAPTURE_DRIVER");
  const footer = "\n# Current Options visual qualification; protected baseline above is retained.\n" +
    "optionsVisualSourceCompatibility20261105:\n" +
    '  protectedBase: "' + BASE + '"\n' + '  priorPublishedHead: "' + PARENT + '"\n' +
    '  qualifiedPacket: "operations/' + OP + '/revisions/' + CURRENT_REVISION + '/qualified-packet.json"\n' +
    '  qualifiedPacketSha256: "' + sha(descriptorPath) + '"\n';
  const protectedText = readFileSync(join(historyDir, "EVIDENCE.protected.yml"), "utf8");
  check(readFileSync(join(root, "EVIDENCE.yml"), "utf8") === protectedText + footer, "ROOT_RECONSTRUCTION");
  verifyHistory(root, historyDir, kind);
  check(sha(join(dir, "source-contract.json")) === CONTRACT, "SOURCE_CONTRACT_DIGEST");
  const contract = json<{ schema: string; protectedBase: string; optionsParent: string; additionalSources: string[] }>(join(dir, "source-contract.json"));
  check(contract.schema === "options_visual_source_contract.v1" && contract.protectedBase === BASE && contract.optionsParent === PARENT, "SOURCE_CONTRACT_IDENTITY");
  const paths = new Set(contract.additionalSources);
  for (const packet of ["vi", "pl6"] as const) {
    const protectedPath = join(repo, "terminal/docs/pr-crops", PACKETS[packet], "operations", OP, "EVIDENCE.protected.yml");
    check(sha(protectedPath) === PINS[packet].protected, "SOURCE_BASELINE_DIGEST");
    const text = readFileSync(protectedPath, "utf8");
    for (const key of ["layoutFiles", "captureHarnessFiles"]) for (const name of Object.keys(mapSection(text, key))) paths.add(name);
  }
  check(paths.size === 138, "SOURCE_CONTRACT_SIZE");
  const receiptPath = join(dir, descriptor.receipt), evidence = join(dir, descriptor.manifest);
  check(sha(receiptPath) === descriptor.receiptSha256 && sha(evidence) === descriptor.manifestSha256 &&
    sha(join(dir, "source-before.json")) === descriptor.sourceBeforeSha256 &&
    sha(join(dir, "source-after.json")) === descriptor.sourceAfterSha256, "PACKET_DIGEST");
  const receipt = json<Receipt>(receiptPath);
  check(receipt.schema === "options_visual_native.v1" && receipt.packet === kind && receipt.operation === OP &&
    receipt.protectedBase === BASE && receipt.source_contract_sha256 === CONTRACT &&
    receipt.capture_revision === CURRENT_REVISION && receipt.driver_sha256 === CAPTURE_DRIVER, "CAPTURE_IDENTITY");
  check(receipt.exit === 0 && receipt.passed === (kind === "vi" ? 30 : 24) && receipt.failed === 0 &&
    receipt.skipped === 0 && receipt.retries === 0 && receipt.source_stable && receipt.source_equal_options &&
    receipt.source_count === 138, "CAPTURE_RESULT");
  check(receipt.profile.theme === "dark" && receipt.profile.fixture === "terminal-e2e.v1" && receipt.profile.compiler === "webpack", "CAPTURE_PROFILE");
  check(receipt.command.includes(kind === "vi" ? "e2e/visual-intelligence.spec.ts" : "e2e/tools/capture_pl6_batch1.cjs"), "CAPTURE_COMMAND");
  check(sha(join(dir, "capture.log")) === receipt.log_sha256, "CAPTURE_LOG");
  requireSourceKeys(receipt.source_sha256, [...paths]);
  sameMap(json<Map>(join(dir, "source-before.json")), receipt.source_sha256, "SOURCE_BEFORE");
  sameMap(json<Map>(join(dir, "source-after.json")), receipt.source_sha256, "SOURCE_AFTER");
  for (const [path, digest] of Object.entries(receipt.source_sha256)) check(sha(join(repo, path)) === digest, "CURRENT_SOURCE:" + path);
  const cropDir = join(dir, "qualified-root"), crops = cropNames(kind);
  requireSourceKeys(receipt.images, crops);
  check(equal(readdirSync(cropDir).filter(name => name.endsWith(".png")), crops), "CAPTURE_IMAGE_SET");
  const text = readFileSync(evidence, "utf8");
  sameMap(mapSection(text, "layoutFiles"), receipt.source_sha256, "QUALIFICATION_SOURCES");
  sameMap(mapSection(text, "cropFiles"), receipt.images, "QUALIFICATION_IMAGES");
  for (const name of crops) {
    const path = join(cropDir, name);
    check(sha(path) === receipt.images[name], "CAPTURE_IMAGE:" + name);
    const png = PNG.sync.read(readFileSync(path), { checkCRC: true });
    check(png.width > 0 && png.height > 0 && png.data.length === png.width * png.height * 4, "PNG_DECODE:" + name);
    let first: number | undefined, varied = false;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      const color = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
      if (first === undefined) first = color; else if (color !== first) varied = true;
    }
    check(first !== undefined && varied, "PNG_BLANK:" + name);
  }
  if (kind === "vi") check(receipt.native_manifest_sha256 === null && descriptor.inventoryReconciliationSha256 === undefined &&
    sha(join(cropDir, "browser-report.json")) === receipt.browser_report_sha256, "ACTUAL_BROWSER_REPORT");
  else {
    const nativePath = join(cropDir, "EVIDENCE.native.yml");
    check(receipt.browser_report_sha256 === null && sha(nativePath) === receipt.native_manifest_sha256, "ACTUAL_NATIVE_MANIFEST");
    const nativeLayout = mapSection(readFileSync(nativePath, "utf8"), "layoutFiles");
    requireSourceKeys(nativeLayout, PL6_NATIVE_LAYOUT);
    for (const [path, digest] of Object.entries(nativeLayout))
      check(receipt.source_sha256[path] === digest, "NATIVE_LAYOUT_SOURCE:" + path);
    // The fixed r3 driver expects all 24 captures. The prior count correction
    // remains immutable in the preceding packet and is covered by its inventory.
  }
  return { cropDir, evidence };
}
