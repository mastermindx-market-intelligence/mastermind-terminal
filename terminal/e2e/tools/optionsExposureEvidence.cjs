"use strict";
// Shared runtime for the CI owner, planner and typed native-evidence consumers.
// Historical records stay immutable; current declarations select one complete qualified packet.
const { createHash } = require("node:crypto");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
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
};
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
function check(value, code) {
    if (!value)
        throw new Error("Options/Exposure evidence: " + code);
}
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const sameKeys = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const harness = (kind) => "terminal/e2e/tools/" +
    (kind === "gex" ? "capture_gex_levels_heatmap_load_failure.cjs" : "capture_eod_heatmap_flowdesk_load_failure.cjs");
function requireSourceKeys(map, expected) {
    check(map && typeof map === "object" && !Array.isArray(map), "SOURCE_MAP_SHAPE");
    check(sameKeys(Object.keys(map), expected), "SOURCE_KEY_SET");
    check(Object.values(map).every(value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)), "SOURCE_DIGEST");
}
function selectWholeFingerprint(candidates, current) {
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
function projectR4CaptureHarness(recorded, current) {
    const path = "terminal/playwright.config.ts";
    const captured = "bb09d98f2bf2647a1975dac07a0e85ab673473986145a1db0d30f22d38e5c076";
    const protectedSuccessor = "de74d9150283eb9dd5243b57c4ee597171d50f328be749d6c43ba8287a6f4525";
    check(recorded[path] === captured, "CAPTURE_HARNESS_RECORDED_SOURCE");
    check(current[path] === captured || current[path] === protectedSuccessor, "CAPTURE_HARNESS_CURRENT_SOURCE");
    return { ...recorded, [path]: current[path] };
}
/** The browser suite never imports either native producer. Its immutable 123-case proof
 * remains applicable only for these two reviewed producer-only changes; every other
 * browser dependency and both complete key sets must still match exactly.
 */
function projectIndicatorGuardBrowserSources(recorded, current) {
    const paths = masterIntegrationBrowserInputs();
    requireSourceKeys(recorded, paths);
    requireSourceKeys(current, paths);
    const projected = { ...recorded };
    for (const kind of ["gex", "eod"]) {
        const path = harness(kind);
        check(recorded[path] === INDICATOR_BROWSER_PRIOR[kind], "INDICATOR_BROWSER_RECORDED_PRODUCER:" + kind);
        check(current[path] === INDICATOR_PRODUCERS[kind], "INDICATOR_BROWSER_CURRENT_PRODUCER:" + kind);
        projected[path] = INDICATOR_PRODUCERS[kind];
    }
    return selectWholeFingerprint([{ sources: projected }], current).sources;
}
function layoutSources(kind, profile) {
    return [...LAYOUT[kind], EXPOSED_CSS,
        ...(kind === "eod" && profile === "combined" ? OPTIONS_CSS : [])].sort();
}
function nativeSources(kind, profile) {
    return [...layoutSources(kind, profile), "terminal/lib/idbJsonStore.ts", ...LAB_SOURCES,
        harness(kind), ...(profile === "exposure" ? [] : [WRAPPER, ...OPTIONS_EXTRAS[kind]])].sort();
}
function yamlBlock(key, values) {
    return key + ":\n" + Object.entries(values).map(([name, value]) => "  " + name + ': "' + value + '"\n').join("");
}
function verifyHistory(root, kind, profile, crops, protectedRoot = root) {
    const dir = join(root, "operations", OP[profile]), pins = HISTORY[profile][kind];
    const paths = ["EVIDENCE.before.yml", "prior-root-sha256.json", "protected-root-sha256.json"];
    paths.forEach((path, index) => check(sha(join(dir, path)) === pins[index], "HISTORY_DIGEST:" + profile + ":" + path));
    check(sha(join(dir, "EVIDENCE.protected.yml")) === PROTECTED[kind], "PROTECTED_MANIFEST");
    const prior = json(join(dir, paths[1])), protectedImages = json(join(dir, paths[2]));
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
        return json(sourcePath);
    }
    return {};
}
function verifyBoundary(repo, requireCurrent = true) {
    const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103/boundary-compatibility-20261105");
    check(sha(join(dir, "qualification.json")) === "badead763130c555f1257c1c5ca29f0737b19cd55b8ae575e617ce6e824ffae9", "BOUNDARY_QUALIFICATION");
    const qualification = json(join(dir, "qualification.json"));
    check(qualification.schema === "options_lab_boundary_compatibility.v1" &&
        qualification.capture_commit === "f12ad44115d69b1bcd7cd453d69a689c9d6768a8", "BOUNDARY_IDENTITY");
    requireSourceKeys(qualification.boundary_sources, BOUNDARY_SOURCES);
    for (const mode of ["original", "preview"]) {
        const ref = qualification.browser[mode], receiptPath = join(dir, mode, "browser-receipt.json");
        const sourcePath = join(dir, mode, "browser-source-after.json");
        check(sha(receiptPath) === ref.receipt_sha256 && sha(sourcePath) === ref.source_map_sha256, "BOUNDARY_RECEIPT");
        const receipt = json(receiptPath);
        check(receipt.exit === 0 && receipt.retries === 0 && receipt.source_stable &&
            receipt.passed === (mode === "original" ? 12 : 18), "BOUNDARY_BROWSER_RESULT");
        check(receipt.source_map_sha256 === ref.source_map_sha256 &&
            receipt.log_sha256 === sha(join(dir, mode, "browser.log")) &&
            receipt.command.includes("e2e/options-lab-source-state.spec.ts"), "BOUNDARY_BROWSER_BINDING");
        const sources = json(sourcePath);
        for (const path of BOUNDARY_SOURCES)
            check(sources[path] === qualification.boundary_sources[path] && (!requireCurrent || sources[path] === sha(join(repo, path))), "BOUNDARY_CURRENT_SOURCE:" + path);
    }
    return qualification.boundary_sources;
}
const JOINT_CONTRACT = "a7cd2ce244a0ae278fc24bf25a51566c0053c89f9ce3fb17ae12b350f1541db7";
const JOINT_DRIVER = "caa135fb04633289178636e9ba24b5484a988ee6797f572bd4aee0c93d9285ed";
const OFFLINE_FONT = "0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd";
const CHART_FRAMING_PATH = "terminal/components/exposure-map/ExposureMap.tsx";
const CHART_FRAMING_SPEC = "terminal/e2e/options-exposure-workspace.spec.ts";
const CHART_FRAMING_MAPS = {
    original: { before: "52dcb7e81d556e2239454dae822458236430737f55877bb5bd3b21465aa2e349", after: "de3e781dedac67c2c0aadeb1142ed2f6d3d3e2075063329e55d9cf88444121e7" },
    preview: { before: "099b71567187d5509182d9cbee9be3d44b584bf1202748df8a6f92a48e0a5c11", after: "50bdfadd453747170d597b8f1a2a11853fe864ef08c6b2ffb561299f8a3dd60c" },
};
const CHART_FRAMING_QUALIFICATION = "4175c376a016a00cd03dbf2c90c9604739c62b9004362db4a9cb277b752fc891";
/** This separately qualifies the Chart branch deliberately excluded from native Strike captures. */
function requireR4ChartIdentity(repo, original, peer, current, requireCurrentObserver = true) {
    check(original === CHART_FRAMING_MAPS.original.before && peer === CHART_FRAMING_MAPS.preview.before, "JOINT_CHART_RECORDED_IDENTITY");
    if (current === original || current === peer)
        return;
    const selected = current === CHART_FRAMING_MAPS.original.after ? "original" :
        current === CHART_FRAMING_MAPS.preview.after ? "preview" : null;
    check(selected !== null, "JOINT_CHART_SUCCESSOR_IDENTITY");
    const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103/chart-framing-20261105");
    check(sha(join(dir, "qualification.json")) === CHART_FRAMING_QUALIFICATION, "CHART_FRAMING_QUALIFICATION_DIGEST");
    const qualification = json(join(dir, "qualification.json"));
    check(qualification.schema === "exposure_chart_framing_qualification.v1" &&
        qualification.operation === "chart-framing-20261105" && qualification.nativeContractSha256 === JOINT_CONTRACT &&
        qualification.captureRevision === CURRENT_REVISION && qualification.chartPath === CHART_FRAMING_PATH, "CHART_FRAMING_QUALIFICATION_IDENTITY");
    const proofFiles = ["browser-receipt.json", "source-before.json", "source-after.json", "browser-report.json",
        "browser.log", "painted-label-witnesses.json"];
    requireSourceKeys(qualification.files, ["capture-driver.py",
        ...["baseline", "original", "preview"].flatMap(mode => proofFiles.map(file => mode + "/" + file))]);
    for (const [file, digest] of Object.entries(qualification.files))
        check(sha(join(dir, file)) === digest, "CHART_FRAMING_FILE:" + file);
    check(qualification.driverSha256 === qualification.files["capture-driver.py"], "CHART_FRAMING_DRIVER");
    const expectedCases = ["desktop", "tablet", "mobile"].flatMap(project => ["en", "zh"].map(lang => project + "|Connected exposure workspace " + lang + ": chart, comparison scopes, scanner and return"));
    const sourceMaps = {};
    function glyphs(value, positive) {
        check(Array.isArray(value) && value.length > 0 && value.length <= 6, "CHART_FRAMING_GLYPH_SET");
        const rows = value;
        check(rows.filter(row => row.strike === 756).length === 1 &&
            new Set(rows.map(row => row.strike)).size === rows.length, "CHART_FRAMING_PRIMARY_LABEL");
        for (const row of rows)
            check([756, 757, 755, 747, 746, 748].includes(row.strike) &&
                [row.gap, row.paint, row.labelTop, row.headerBottom].every(Number.isFinite) &&
                Number.isInteger(row.paint) && row.paint > 0 &&
                Math.abs(row.gap - (row.labelTop - row.headerBottom)) < .000001 && (!positive || row.gap >= 4), "CHART_FRAMING_GLYPH_GEOMETRY");
    }
    for (const mode of ["baseline", "original", "preview"]) {
        const baseline = mode === "baseline", profile = baseline ? "original" : mode;
        const prefix = mode + "/", map = qualification.maps[profile], expectedMap = CHART_FRAMING_MAPS[profile];
        check(map.before === expectedMap.before && map.after === expectedMap.after, "CHART_FRAMING_TRANSITION");
        const receipt = json(join(dir, prefix, "browser-receipt.json"));
        check(receipt.schema === "exposure_chart_framing_browser.v1" && receipt.mode === profile &&
            receipt.stage === (baseline ? "baseline" : "fixed") && receipt.expected_failure === baseline &&
            receipt.witness_version === "all-painted-ranked-labels.v2" && receipt.capture_revision === CURRENT_REVISION &&
            receipt.exit === (baseline ? 1 : 0) && receipt.expected === (baseline ? 1 : 6) &&
            receipt.passed === (baseline ? 0 : 6) && receipt.failed === (baseline ? 1 : 0) &&
            receipt.skipped === 0 && receipt.flaky === 0 && receipt.retries === 0 &&
            receipt.source_stable && receipt.owned_server_stopped &&
            receipt.command.includes("e2e/options-exposure-workspace.spec.ts"), "CHART_FRAMING_BROWSER_RESULT");
        check(receipt.source_before_sha256 === qualification.files[prefix + "source-before.json"] &&
            receipt.source_map_sha256 === qualification.files[prefix + "source-after.json"] &&
            receipt.source_before_sha256 === receipt.source_map_sha256 &&
            receipt.browser_report_sha256 === qualification.files[prefix + "browser-report.json"] &&
            receipt.log_sha256 === qualification.files[prefix + "browser.log"], "CHART_FRAMING_RECEIPT_BINDING");
        const sources = json(join(dir, prefix, "source-after.json"));
        requireSourceKeys(sources, Object.keys(sources));
        check(Object.keys(sources).length === receipt.source_count &&
            sources[CHART_FRAMING_PATH] === (baseline ? map.before : map.after) &&
            receipt.map_source_sha256 === sources[CHART_FRAMING_PATH] &&
            sources[CHART_FRAMING_SPEC] === map.observer, "CHART_FRAMING_SOURCE_BINDING");
        sourceMaps[mode] = sources;
        const report = json(join(dir, prefix, "browser-report.json"));
        check(report.stats.expected === receipt.passed && report.stats.unexpected === receipt.failed &&
            report.stats.skipped === 0 && report.stats.flaky === 0 && !report.errors?.length, "CHART_FRAMING_REPORT");
        const cases = [], witnesses = [];
        function visit(suite) {
            for (const spec of suite.specs ?? [])
                for (const test of spec.tests) {
                    cases.push(test.projectName + "|" + spec.title);
                    check(test.results.length === 1, "CHART_FRAMING_SINGLE_ATTEMPT");
                    const result = test.results[0];
                    check(result.status === (baseline ? "failed" : "passed") && result.retry === 0, "CHART_FRAMING_CASE_RESULT");
                    const names = baseline ? ["exposure-header-clearance-initial"] :
                        ["exposure-header-clearance-initial", "exposure-header-clearance"];
                    const values = {};
                    for (const name of names) {
                        const attachments = result.attachments?.filter(item => item.name === name) ?? [];
                        check(attachments.length === 1 && attachments[0].contentType === "application/json" &&
                            typeof attachments[0].body === "string" && attachments[0].path === undefined, "CHART_FRAMING_ATTACHMENT");
                        const value = JSON.parse(Buffer.from(attachments[0].body, "base64").toString("utf8"));
                        values[name] = value;
                        witnesses.push({ project: test.projectName, title: spec.title, name, value });
                    }
                    const initial = values["exposure-header-clearance-initial"];
                    glyphs(initial, !baseline);
                    if (baseline)
                        check(initial.some(row => row.gap < 0), "CHART_FRAMING_RED_WITNESS");
                    else {
                        const final = values["exposure-header-clearance"];
                        glyphs(final.initial, true);
                        glyphs(final.afterFit, true);
                        check(JSON.stringify(final.initial) === JSON.stringify(initial) &&
                            final.afterFit.find(row => row.strike === 756).paint > initial.find(row => row.strike === 756).paint, "CHART_FRAMING_FIT_REPAINT");
                    }
                }
            for (const child of suite.suites ?? [])
                visit(child);
        }
        visit(report);
        check(sameKeys(cases, baseline ? [expectedCases[4]] : expectedCases), "CHART_FRAMING_EXACT_CASES");
        check(JSON.stringify(witnesses) === JSON.stringify(json(join(dir, prefix, "painted-label-witnesses.json"))), "CHART_FRAMING_WITNESS_BINDING");
    }
    requireSourceKeys(sourceMaps.baseline, Object.keys(sourceMaps.original));
    check(sameKeys(Object.keys(sourceMaps.original).filter(path => sourceMaps.original[path] !== sourceMaps.baseline[path]), [CHART_FRAMING_PATH]), "CHART_FRAMING_ONLY_RUNTIME_CHANGE");
    // The captured observers differ only in an unrelated return readiness budget.
    // Protected chart source and branch test budgets compose independently; both
    // complete captured profiles above remain required with their original hashes.
    if (requireCurrentObserver) {
        const currentObserver = sha(join(repo, CHART_FRAMING_SPEC));
        check(currentObserver === qualification.maps.original.observer ||
            currentObserver === qualification.maps.preview.observer, "CHART_FRAMING_CURRENT_OBSERVER");
    }
}
function verifyJointNative(repo, dir, native) {
    const capture = native;
    const contractPath = join(dir, "source-contract.json");
    check(sha(contractPath) === JOINT_CONTRACT && sha(join(dir, "capture-driver.py")) === JOINT_DRIVER &&
        sha(join(dir, "offline-font-responses.cjs")) === OFFLINE_FONT, "JOINT_CAPTURE_INPUTS");
    const contract = json(contractPath);
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
    for (const name of snapshots)
        check(sha(join(dir, name)) === capture.source_snapshot_sha256[name], "JOINT_SNAPSHOT_DIGEST:" + name);
    for (const name of snapshots.slice(0, 4)) {
        const map = json(join(dir, name));
        requireSourceKeys(map, contract.sources);
        for (const [path, digest] of Object.entries(capture.source_sha256))
            check(map[path] === digest, "JOINT_STABLE_SOURCE:" + path);
    }
    for (const owner of ["original", "peer"])
        check(capture.source_snapshot_sha256["whole-" + owner + "-source-before.json"] ===
            capture.source_snapshot_sha256["whole-" + owner + "-source-after.json"], "JOINT_WHOLE_SOURCE_STABILITY");
    const excluded = contract.excluded_chart_branch;
    check(JSON.stringify(capture.excluded_chart_branch) === JSON.stringify(excluded) &&
        excluded.path === "terminal/components/exposure-map/ExposureMap.tsx" &&
        excluded.native_initial_view === "strike" && excluded.excluded_view === "chart", "JOINT_EXCLUDED_BRANCH");
    const original = json(join(dir, "whole-original-source-after.json"));
    const peer = json(join(dir, "whole-peer-source-after.json"));
    // Match the pinned producer predicate; missing runtime keys cannot hide in an intersection.
    for (const [path, digest] of Object.entries(capture.source_sha256)) {
        const included = /^terminal\/(?:app|components|lib)\//.test(path) &&
            !path.includes("/__tests__/") && !/\.(?:test|spec)\./.test(path) && /\.(?:ts|tsx|css|js|cjs|mjs|json)$/.test(path);
        if (included)
            check(original[path] === digest && peer[path] === digest, "JOINT_WHOLE_SCOPED_SOURCE:" + path);
    }
    check(original[excluded.path] === excluded.original_sha256 && peer[excluded.path] === excluded.peer_sha256, "JOINT_CHART_IDENTITY");
    requireR4ChartIdentity(repo, excluded.original_sha256, excluded.peer_sha256, sha(join(repo, excluded.path)));
}
function readCandidate(repo, root, kind, profile, crops) {
    const operation = OP[profile], operationRoot = join(root, "operations", operation);
    const dir = profile === "combined" ? join(operationRoot, "revisions", CURRENT_REVISION) : operationRoot;
    const descriptor = json(join(dir, "native-packet.json"));
    check(descriptor.schema === "options_exposure_packet.v1" && descriptor.kind === kind &&
        descriptor.profile === profile && descriptor.operation === operation &&
        descriptor.receipt === "capture-receipt.json" && descriptor.manifest === "qualified-root/EVIDENCE.yml", "PACKET_IDENTITY");
    if (profile === "combined") {
        check(descriptor.captureRevision === CURRENT_REVISION &&
            descriptor.previousPacketInventorySha256 === PREVIOUS_PACKET_INVENTORY[kind], "REVISION_IDENTITY");
        const priorPath = join(dir, "prior-packet-sha256.json");
        check(sha(priorPath) === PREVIOUS_PACKET_INVENTORY[kind], "PREVIOUS_PACKET_INVENTORY");
        const previous = json(priorPath);
        requireSourceKeys(previous, Object.keys(previous));
        for (const [path, digest] of Object.entries(previous))
            check(sha(join(repo, path)) === digest, "PREVIOUS_PACKET:" + path);
    }
    const receiptPath = join(dir, descriptor.receipt), evidence = join(dir, descriptor.manifest);
    check(sha(receiptPath) === descriptor.receiptSha256 && sha(evidence) === descriptor.manifestSha256, "PACKET_DIGEST");
    const native = json(receiptPath);
    check(native.operation === operation && native.protectedBase === BASE &&
        native.kind === kind && native.packet === PACKETS[kind], "NATIVE_IDENTITY");
    check(native.exit === 0 && native.expected === crops.length && native.successful_files === crops.length &&
        native.source_stable === true && Array.isArray(native.failed_frames) && native.failed_frames.length === 0, "NATIVE_RESULT");
    check(native.log_sha256 === sha(join(dir, "capture.log")) &&
        native.native_manifest_sha256 === descriptor.manifestSha256, "NATIVE_PAYLOAD");
    if (profile === "combined")
        verifyJointNative(repo, dir, native);
    else
        requireSourceKeys(native.source_sha256, nativeSources(kind, profile));
    requireSourceKeys(native.image_sha256, crops);
    const cropDir = join(dir, "qualified-root");
    check(sameKeys(readdirSync(cropDir).filter(name => name.endsWith(".png")), crops), "NATIVE_IMAGE_SET");
    for (const name of crops)
        check(sha(join(cropDir, name)) === native.image_sha256[name], "NATIVE_IMAGE:" + name);
    const sources = { ...native.source_sha256 };
    if (profile === "exposure") {
        const frozenPath = join(repo, "terminal/docs/verification/exposure-workspace-20261103/source-compatibility-20261105/original/browser-source-after.json");
        check(sha(frozenPath) === "f1c54ada9ecc0da40ed379c8c622483f602915d9eaf2f7967258e5b9081bc6db", "F12_SOURCE_SNAPSHOT");
        const frozen = json(frozenPath);
        for (const [path, digest] of Object.entries(sources))
            check(frozen[path] === digest, "F12_SOURCE:" + path);
        check(sources[LAB] === "1b9bfeaa9ae3a9460fcecd812a98dcd8ef6591df0041d5dc4a53bde6dc2daf8b", "F12_LAB_SOURCE");
        // One exact, separately browser-qualified compatibility transition; no arbitrary drift list.
        sources[LAB] = "365223a8182effc04fa956a8004062aa86c1426de8fc24eccebf6952e1571820";
        sources[WRAPPER] = "b5d53a1a443cd81e7598826181327777fec1d3fd52879b75a23fd6fceeaba6f8";
    }
    return { profile, sources, native, cropDir, evidence, layout: layoutSources(kind, profile), protectedManifest: join(dir, "EVIDENCE.protected.yml") };
}
/** Select one complete recorded source composition. Corrupt declarations never fall back. */
function qualifiedOptionsExposurePacket(repo, kind, crops) {
    check(crops.length === (kind === "gex" ? 114 : 126) && new Set(crops).size === crops.length &&
        crops.every(name => /^[a-z0-9-]+\.png$/.test(name)), "EXPECTED_CROP_SET");
    const root = join(repo, "terminal/docs/pr-crops", PACKETS[kind]);
    const text = readFileSync(join(root, "EVIDENCE.yml"), "utf8");
    if (text.includes(OPTIONS_INTEGRATION_REVISION))
        return readOptionsIntegration(repo, root, kind, crops, text);
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
    if (options)
        check(protectedText.split(anchor).length === 2, "ROOT_MANIFEST_ANCHOR");
    const body = options ? protectedText.replace(anchor, suffix + "\n" + anchor) : protectedText;
    check(text === prefix + body, "ROOT_MANIFEST_RECONSTRUCTION");
    const current = {};
    for (const path of new Set(candidates.flatMap(candidate => Object.keys(candidate.sources))))
        if (existsSync(join(repo, path)))
            current[path] = sha(join(repo, path));
    const qualified = candidates.map(candidate => candidate.profile === "combined"
        ? { ...candidate, sources: projectR4CaptureHarness(candidate.sources, current) } : candidate);
    const selected = selectWholeFingerprint(qualified, current);
    check(selected.profile === (options ? "combined" : "exposure"), "PROFILE_OWNERSHIP");
    const boundarySources = exposure ? verifyBoundary(repo) : null;
    if (exposure)
        verifyHistory(root, kind, "exposure", crops);
    const optionsHistorySources = options ? verifyHistory(root, kind, "options", crops) : {};
    check(sameKeys(readdirSync(root).filter(name => name.endsWith(".png")), crops), "PROTECTED_ROOT_SET");
    const exposureHistorical = exposure ? {
        ...candidates.find(candidate => candidate.profile === "exposure"), root, boundarySources: boundarySources,
    } : null;
    return { ...selected, protectedManifest: protectedPath, optionsHistorySources,
        hasExposureHistory: exposure, hasOptionsHistory: options, exposureHistorical };
}
const MASTER_REVISION = "master-integration-20261109";
const MASTER_PRIOR = "883fee550a9628812a4fbcdc77e479ab8cad3b3a";
const MASTER_PROTECTED = "f2aa1e0cb27d459149f59d3b24d98cd6e2e8389f";
const MASTER_PACKET = { gex: "6074a35447c6ec3447cf9a0542b08d6a206c3660d483abf0e271daac21e6804b", eod: "8bb050b222bc7c822486ba85a0019734013575dac1fa1f76ded272d6b62e86d8" };
const MASTER_BROWSER = "cd5a64f4cb8e1c573d923ed6567054cc126d1ccabeabe1f09ccef0d35a1692cd";
const UI_COPY_REVISION = "ui-copy-integration-20261109";
const UI_COPY_PRIOR = "282ea2c40d839fecbe5ae5dc53de9c29a02850f6";
const UI_COPY_DEPENDENCY = "663983edd16fc64e86003b420e97d557982b1bf2";
const UI_COPY_PROTECTED = "b387616013f38cce9e467cc7da7b87fd2672718c";
// These literal bindings are filled only after the actual complete successor runs.
const UI_COPY_PACKET = "ecad16da1beda4bd3a1dbb5354ce92c2181d985b8f1644bb1f5371071d401910";
const UI_COPY_BROWSER = "cdee804f8bd131e850fb045bf328fb2e5939b6ab11dddc2e72357d8707782279";
const UI_COPY_650_ARCHIVE = "16c19dfdbdf40c78660be968782fd85919550185a5c0490a273458cde2300404";
const OPTIONS_INTEGRATION_REVISION = "options-integration-20261109";
const OPTIONS_INTEGRATION_PRIOR = "90f275f15b4d174f003fb5b1087823dce6ec865a";
const OPTIONS_INTEGRATION_PROTECTED = "03af393ce05c12282003a3919cc473c032264922";
const OPTIONS_INTEGRATION_DEPENDENCY = "d3bd6b2d98c6c23398be0bed6c7450caa47bd665";
// Pending values fail closed until filled from the actual complete successor executions.
const OPTIONS_INTEGRATION_PACKET = { gex: "fd7c4364bcfb3f8b44773792c4f5d16fbc654eb47cf58a142eb169b3bac24ad7", eod: "77b3b7f07746290cad33262a3d95c221e947a5acd5e940ae95b9d9458f510a18" };
const OPTIONS_INTEGRATION_BROWSER = "48f4d579a9c661e35f51e5070424a53f509ac1a480430ee9fda9afab8bb6df90";
const OPTIONS_INTEGRATION_PRODUCERS = {
    gex: "dbb92e88972bd39984427d054f431159401fcb16bd49b4479cc1c83456f7777d",
    eod: "671062f250f16c812ffdebfb1714d5c62a8c54be0f439fa34dc1e70452c086e9",
};
const INDICATOR_REVISION = "indicator-guard-20261109";
const INDICATOR_PRIOR = "483554457f302a90305f03c360636ca97ed75fb3";
const INDICATOR_PACKET = { gex: "c0d9dc8fff216b73afc8dbc3490ca9bd84fbeecde6fe14eeac1452af5e0c0f1b", eod: "eb5a4aac927a5bf8f308f1b6536e7992306df2a78e110cc8012099a4dc185ba9" };
const INDICATOR_BROWSER_PRIOR = {
    gex: "f6c52d0666cee5a497d0836ec8e9c8eb05a9ba51fad63ba9f443d623ad99bc28",
    eod: "866a1f4f6a823f878476dbb83fa48258deee5bf26eb651b9c2fcc3d5491ad3ba",
};
const INDICATOR_PRODUCERS = {
    gex: "d1a4781a4a8147ccaef7360126dfedb038e8bc14e565853363e562074677888e",
    eod: "8c8cd2448ce05a336f40fd020f9d172534c72df834f2b3a6ff2d33d82b6bfc5e",
};
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
const masterIntegrationInputs = (kind) => [...new Set([...nativeSources(kind, "exposure"), ...MASTER_SUCCESSOR_INPUTS])].sort();
const MASTER_BROWSER_SPECS = [
    "terminal/e2e/exposure-workspace.spec.ts",
    CHART_FRAMING_SPEC,
    "terminal/e2e/options-lab-source-state.spec.ts",
    "terminal/e2e/options-exposure-surface-journey.spec.ts",
    "terminal/e2e/options-research-question.spec.ts",
];
const masterIntegrationBrowserInputs = () => [...new Set([
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
// These mounted EOD desk leaves affect the rail and its available layout height.
// Historical records retain their original input sets; the new full capture locks both.
const UI_COPY_DESK_INPUTS = [
    "terminal/components/flowdesk/FlowFreshnessReceipt.tsx",
    "terminal/components/flowdesk/InspectorPane.tsx",
];
const uiCopyIntegrationInputs = (kind) => [...new Set([...masterIntegrationInputs(kind), ...(kind === "eod" ? UI_COPY_DESK_INPUTS : [])])].sort();
const uiCopyIntegrationBrowserInputs = () => [...new Set([...masterIntegrationBrowserInputs(), ...UI_COPY_DESK_INPUTS])].sort();
const OPTIONS_INTEGRATION_INPUTS = ["terminal/components/gexdesk/GexSummaryBar.tsx", "terminal/lib/dte.ts"];
const optionsIntegrationInputs = kind => [...new Set([...uiCopyIntegrationInputs(kind), ...OPTIONS_INTEGRATION_INPUTS])].sort();
const OPTIONS_INTEGRATION_BROWSER_SPECS = [...MASTER_BROWSER_SPECS, "terminal/e2e/exposure-partial-totals.spec.ts"];
const optionsIntegrationBrowserInputs = () => [...new Set([...uiCopyIntegrationBrowserInputs(), ...OPTIONS_INTEGRATION_INPUTS,
    "terminal/e2e/exposure-partial-totals.spec.ts", "terminal/public/data/gex_fixture.json"])].sort();
/** A failed full GEX run may still emit a manifest; its actual result is decisive. */
function requireIntegrationExecution(value, kind, crops, identity = "indicator-guard") {
    check(["master-integration", "indicator-guard", "ui-copy-integration", "options-integration"].includes(identity), "INTEGRATION_CAPTURE_IDENTITY_KIND");
    const historical = identity === "master-integration", successor = identity === "ui-copy-integration", options = identity === "options-integration";
    const producerPins = options ? OPTIONS_INTEGRATION_PRODUCERS : INDICATOR_PRODUCERS;
    check(value.schema === "exposure_master_integration_capture.v1" && value.operation === OP.exposure &&
        value.revision === (options ? OPTIONS_INTEGRATION_REVISION : historical ? MASTER_REVISION : successor ? UI_COPY_REVISION : INDICATOR_REVISION) &&
        value.kind === kind && value.packet === PACKETS[kind] &&
        value.branchHead === (options ? OPTIONS_INTEGRATION_PRIOR : historical ? MASTER_PRIOR : successor ? UI_COPY_PRIOR : INDICATOR_PRIOR) &&
        value.protectedMaster === (options ? OPTIONS_INTEGRATION_PROTECTED : successor ? UI_COPY_PROTECTED : MASTER_PROTECTED) &&
        (!options || value.integratedDependency === OPTIONS_INTEGRATION_DEPENDENCY) &&
        (!successor || (kind === "eod" && value.integratedDependency === UI_COPY_DEPENDENCY)), "INTEGRATION_CAPTURE_IDENTITY");
    if (!historical) {
        check(value.portClosed === true && value.nextLockAbsent === true, "INTEGRATION_CAPTURE_LIFECYCLE");
        requireSourceKeys(value.producerPins ?? {}, [harness("gex"), harness("eod")]);
        for (const producer of ["gex", "eod"])
            check(value.producerPins[harness(producer)] === producerPins[producer], "INTEGRATION_CAPTURE_PRODUCER:" + producer);
    }
    if (options) {
        const supervisor = value.nativeSupervisor, receipt = value.nativeReceipt;
        check(typeof value.captureId === "string" && value.captureId.length > 0 && value.ownedServerStopped === true &&
            supervisor?.closed === true && supervisor.status === 0 && supervisor.signal === null && supervisor.timedOut === false &&
            Number.isInteger(supervisor.serverPid) && supervisor.serverPid > 1 && supervisor.serverReportedStopped === true &&
            supervisor.serverSettled === true && supervisor.serverRefused === null && supervisor.error === null, "INTEGRATION_NATIVE_SETTLEMENT");
        check(receipt?.family === kind && receipt.captureId === value.captureId && receipt.capturedAtHead === value.branchHead &&
            receipt.manifestSha256 === value.manifestSha256 && Array.isArray(receipt.files) &&
            sameKeys(receipt.files.map(file => file.file), crops) && new Set(receipt.files.map(file => file.file)).size === crops.length &&
            receipt.files.every(file => file.sha256 === value.images[file.file]?.sha256), "INTEGRATION_NATIVE_RECEIPT");
    }
    check(JSON.stringify(value.command) === JSON.stringify(["node", harness(kind).replace(/^terminal\//, "")]), "INTEGRATION_CAPTURE_COMMAND");
    check(value.exit === 0 && value.expected === crops.length && value.successfulFiles === crops.length &&
        value.sourceStable === true, "INTEGRATION_CAPTURE_RESULT");
    check(Array.isArray(value.frames) && value.frames.length === crops.length &&
        sameKeys(value.frames.map(frame => frame.file), crops) &&
        new Set(value.frames.map(frame => frame.file)).size === crops.length &&
        value.frames.every(frame => frame.status === "success"), "INTEGRATION_FRAME_SET");
    check(sameKeys(Object.keys(value.images), crops), "INTEGRATION_IMAGE_SET");
    for (const image of Object.values(value.images))
        check(/^[0-9a-f]{64}$/.test(image.sha256) &&
            Number.isInteger(image.bytes) && image.bytes > 1000 && Number.isInteger(image.width) && image.width > 0 &&
            Number.isInteger(image.height) && image.height > 0, "INTEGRATION_IMAGE_RECORD");
    check(/^[0-9a-f]{64}$/.test(value.logSha256), "INTEGRATION_LOCAL_LOG_PROVENANCE");
}
function integrationArchive(dir, label, kind, crops) {
    const name = "prior-" + label + "-root", inventory = join(dir, name + "-sha256.json"), archive = join(dir, name);
    check(sha(inventory) === MASTER_HISTORY[kind][label], "INTEGRATION_HISTORY_INVENTORY:" + label);
    const files = json(inventory);
    requireSourceKeys(files, [...crops, "EVIDENCE.yml"]);
    check(sameKeys(readdirSync(archive), Object.keys(files)), "INTEGRATION_HISTORY_SET:" + label);
    for (const [file, digest] of Object.entries(files))
        check(sha(join(archive, file)) === digest, "INTEGRATION_HISTORY_FILE:" + label + ":" + file);
    return archive;
}
function verifyIntegrationImages(cropDir, execution, crops) {
    check(sameKeys(readdirSync(cropDir).filter(name => name.endsWith(".png")), crops), "INTEGRATION_NATIVE_CROPS");
    for (const name of crops) {
        const bytes = readFileSync(join(cropDir, name)), record = execution.images[name];
        check(sha(join(cropDir, name)) === record.sha256 && bytes.length === record.bytes &&
            bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
            bytes.readUInt32BE(16) === record.width && bytes.readUInt32BE(20) === record.height, "INTEGRATION_NATIVE_IMAGE:" + name);
    }
}
function exposurePrefix(dir) {
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
function verifyIntegrationBrowserRecord(repo, revision, requireCurrent = true) {
    check(["master", "ui-copy", "options-integration"].includes(revision), "INTEGRATION_BROWSER_REVISION");
    const successor = revision === "ui-copy", options = revision === "options-integration";
    const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103", options ? OPTIONS_INTEGRATION_REVISION : successor ? UI_COPY_REVISION : MASTER_REVISION);
    check(sha(join(dir, "qualification.json")) === (options ? OPTIONS_INTEGRATION_BROWSER : successor ? UI_COPY_BROWSER : MASTER_BROWSER), "INTEGRATION_BROWSER_QUALIFICATION");
    const proof = json(join(dir, "qualification.json"));
    check(proof.schema === "exposure_master_integration_browser.v1" &&
        proof.branchHead === (options ? OPTIONS_INTEGRATION_PRIOR : successor ? UI_COPY_PRIOR : MASTER_PRIOR) &&
        proof.protectedMaster === (options ? OPTIONS_INTEGRATION_PROTECTED : successor ? UI_COPY_PROTECTED : MASTER_PROTECTED) &&
        (!options || proof.integratedDependency === OPTIONS_INTEGRATION_DEPENDENCY) &&
        (!successor || proof.integratedDependency === UI_COPY_DEPENDENCY), "INTEGRATION_BROWSER_IDENTITY");
    requireSourceKeys(proof.files, ["browser-report.json", "browser-execution.json", "source-before.json", "source-after.json",
        ...((successor || options) ? ["browser.log"] : [])]);
    for (const [name, digest] of Object.entries(proof.files))
        check(sha(join(dir, name)) === digest, "INTEGRATION_BROWSER_FILE:" + name);
    const before = json(join(dir, "source-before.json")), after = json(join(dir, "source-after.json"));
    check(proof.files["source-before.json"] === proof.files["source-after.json"], "INTEGRATION_BROWSER_SOURCE_STABILITY");
    const currentInputs = options ? optionsIntegrationBrowserInputs() : successor ? uiCopyIntegrationBrowserInputs() : masterIntegrationBrowserInputs();
    requireSourceKeys(proof.currentSources, currentInputs);
    for (const [path, digest] of Object.entries(proof.currentSources))
        check(before[path] === digest && after[path] === digest, "INTEGRATION_BROWSER_RECORDED_SOURCE:" + path);
    if (requireCurrent && (successor || options)) {
        const current = Object.fromEntries(currentInputs.map(path => [path, sha(join(repo, path))]));
        selectWholeFingerprint([{ sources: proof.currentSources }], current);
    }
    const execution = json(join(dir, "browser-execution.json"));
    check(execution.schema === "exposure_master_integration_browser_execution.v1" &&
        execution.branchHead === proof.branchHead && execution.protectedMaster === proof.protectedMaster &&
        (!(successor || options) || (execution.integratedDependency === (options ? OPTIONS_INTEGRATION_DEPENDENCY : UI_COPY_DEPENDENCY) &&
            execution.logSha256 === proof.files["browser.log"])), "INTEGRATION_BROWSER_EXECUTION_IDENTITY");
    const overrideKeys = ["EXPOSURE_P09_CURRENT_WITNESS", "EXPOSURE_P09_PREVIOUS_WITNESS", "EXPOSURE_NATIVE_WITNESS",
        "TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE", "TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE", "TERMINAL_EXPOSURE_PAINT_PROBE"];
    check(sameKeys(Object.keys(execution.fixtureOverrides), overrideKeys) &&
        overrideKeys.every(key => execution.fixtureOverrides[key] === null), "INTEGRATION_BROWSER_BUNDLED_FIXTURES");
    check(execution.exit === 0 && execution.retries === 0 && execution.sourceStable && execution.ownedServerStopped &&
        execution.failed === 0 && execution.flaky === 0 && execution.passed === proof.expectedPassed.length &&
        execution.skipped === proof.expectedSkipped.length &&
        (options ? OPTIONS_INTEGRATION_BROWSER_SPECS : MASTER_BROWSER_SPECS).every(path => execution.command.includes(path.replace(/^terminal\//, ""))), "INTEGRATION_BROWSER_RESULT");
    if (options) check(execution.passed === 144 && execution.skipped === 0 &&
        sameKeys(execution.command.filter(arg => arg.endsWith(".spec.ts")),
            OPTIONS_INTEGRATION_BROWSER_SPECS.map(path => path.replace(/^terminal\//, ""))), "OPTIONS_INTEGRATION_BROWSER_COMMAND");
    check(Object.keys(execution.artifactFiles).length > 0, "INTEGRATION_BROWSER_ARTIFACTS");
    for (const [path, digest] of Object.entries(execution.artifactFiles))
        check(path.startsWith("browser-artifacts/") && !path.split("/").includes("..") &&
            /^[0-9a-f]{64}$/.test(digest) && sha(join(dir, path)) === digest, "INTEGRATION_BROWSER_ARTIFACT:" + path);
    const report = json(join(dir, "browser-report.json"));
    check(!report.errors?.length && report.stats.expected === execution.passed && report.stats.unexpected === 0 &&
        report.stats.skipped === execution.skipped && report.stats.flaky === 0, "INTEGRATION_BROWSER_REPORT");
    const passed = [], skipped = [], chartCases = [];
    function visit(suite) {
        for (const spec of suite.specs ?? [])
            for (const test of spec.tests) {
                const key = test.projectName + "|" + spec.title;
                check(test.results.length === 1 && test.results[0].retry === 0, "INTEGRATION_BROWSER_ATTEMPT");
                const result = test.results[0];
                check(result.status === "passed" || result.status === "skipped", "INTEGRATION_BROWSER_CASE");
                (result.status === "passed" ? passed : skipped).push(key);
                if (spec.title.startsWith("Connected exposure workspace ")) {
                    check(result.status === "passed", "INTEGRATION_CHART_REQUIRED");
                    chartCases.push(key);
                    const attachments = result.attachments?.filter(item => item.name === "exposure-header-clearance") ?? [];
                    check(attachments.length === 1 && attachments[0].contentType === "application/json" &&
                        typeof attachments[0].body === "string" && attachments[0].path === undefined, "INTEGRATION_CHART_ATTACHMENT");
                    const witness = JSON.parse(Buffer.from(attachments[0].body, "base64").toString("utf8"));
                    for (const glyphs of [witness.initial, witness.afterFit]) {
                        check(Array.isArray(glyphs) && glyphs.length > 0 && glyphs.length <= 6 &&
                            glyphs.filter(row => row.strike === 756).length === 1 && new Set(glyphs.map(row => row.strike)).size === glyphs.length, "INTEGRATION_CHART_GLYPHS");
                        for (const row of glyphs)
                            check([756, 757, 755, 747, 746, 748].includes(row.strike) &&
                                [row.gap, row.paint, row.labelTop, row.headerBottom].every(Number.isFinite) && row.gap >= 4 &&
                                Number.isInteger(row.paint) && row.paint > 0 && Math.abs(row.gap - (row.labelTop - row.headerBottom)) < .000001, "INTEGRATION_CHART_CLEARANCE");
                    }
                    check(witness.afterFit.find(row => row.strike === 756).paint > witness.initial.find(row => row.strike === 756).paint, "INTEGRATION_CHART_FRESH_PAINT");
                }
            }
        for (const child of suite.suites ?? [])
            visit(child);
    }
    visit(report);
    check(sameKeys(passed, proof.expectedPassed) && new Set(passed).size === passed.length &&
        sameKeys(skipped, proof.expectedSkipped), "INTEGRATION_BROWSER_CASE_SET");
    check(sameKeys(chartCases, ["desktop", "tablet", "mobile"].flatMap(project => ["en", "zh"].map(lang => project + "|Connected exposure workspace " + lang + ": chart, comparison scopes, scanner and return"))), "INTEGRATION_CHART_CASE_SET");
    return proof;
}
function verifyIntegrationBrowser(repo, requireCurrent = true) {
    const historical = verifyIntegrationBrowserRecord(repo, "master");
    const current = verifyIntegrationBrowserRecord(repo, "ui-copy", requireCurrent);
    check(current.expectedPassed.length === 123 && sameKeys(current.expectedPassed, historical.expectedPassed) &&
        sameKeys(current.expectedSkipped, historical.expectedSkipped), "INTEGRATION_BROWSER_ORIGINAL_CASE_SET");
    return current;
}
function readIntegrationNativePayload(repo, dir, kind, crops, descriptor, identity, requireCurrent) {
    const execution = json(join(dir, "capture-execution.json"));
    requireIntegrationExecution(execution, kind, crops, identity);
    check(execution.logSha256 === descriptor.files["capture.log"], "INTEGRATION_CAPTURE_LOG");
    const contract = json(join(dir, "source-contract.json"));
    const options = identity === "options-integration", pins = options ? OPTIONS_INTEGRATION_PRODUCERS : INDICATOR_PRODUCERS;
    const paths = options ? optionsIntegrationInputs(kind) : identity === "ui-copy-integration" ? uiCopyIntegrationInputs(kind) : masterIntegrationInputs(kind);
    check(contract.schema === "exposure_master_capture_sources.v1" && contract.kind === kind &&
        sameKeys(contract.currentInputs, paths) && new Set(contract.currentInputs).size === paths.length, "INTEGRATION_SOURCE_CONTRACT");
    const before = json(join(dir, "capture-sources-before.json")), after = json(join(dir, "capture-sources-after.json"));
    requireSourceKeys(before, contract.observedInputs);
    requireSourceKeys(after, contract.observedInputs);
    for (const producer of ["gex", "eod"]) {
        const path = harness(producer);
        check(before[path] === pins[producer] && after[path] === pins[producer] &&
            execution.producerPins[path] === before[path], "INTEGRATION_OBSERVED_PRODUCER:" + producer);
    }
    check(execution.sourceBeforeSha256 === descriptor.files["capture-sources-before.json"] &&
        execution.sourceAfterSha256 === descriptor.files["capture-sources-after.json"] &&
        execution.sourceBeforeSha256 === execution.sourceAfterSha256, "INTEGRATION_SOURCE_STABILITY");
    const sources = Object.fromEntries(paths.map(path => [path, before[path]]));
    requireSourceKeys(sources, paths);
    if (requireCurrent) {
        const current = Object.fromEntries(paths.map(path => [path, sha(join(repo, path))]));
        selectWholeFingerprint([{ sources }], current);
        for (const producer of ["gex", "eod"])
            check(sha(join(repo, harness(producer))) === pins[producer], "INTEGRATION_CURRENT_PRODUCER:" + producer);
    }
    check(sources[harness(kind)] === pins[kind], "INTEGRATION_NATIVE_PRODUCER");
    const cropDir = join(dir, "qualified-root"), evidence = join(cropDir, "EVIDENCE.yml");
    check(execution.manifestSha256 === sha(evidence), "INTEGRATION_NATIVE_MANIFEST");
    verifyIntegrationImages(cropDir, execution, crops);
    const manifest = readFileSync(evidence, "utf8"), layout = layoutSources(kind, "exposure");
    const capturedHeads = [...manifest.matchAll(/^# capturedAtHead: ([0-9a-f]{40})$/gm)].map(match => match[1]);
    check(capturedHeads.length === 1 && capturedHeads[0] === execution.branchHead, "INTEGRATION_NATIVE_CHECKOUT");
    const layoutText = manifest.split("\nlayoutFiles:\n");
    check(layoutText.length === 2, "INTEGRATION_LAYOUT_SECTION");
    const recorded = {};
    for (const row of layoutText[1].split("\n")) {
        if (!row.startsWith("  "))
            break;
        const match = row.match(/^  (\S+): "([0-9a-f]{64})"$/);
        check(match && !recorded[match[1]], "INTEGRATION_LAYOUT_ROW");
        recorded[match[1]] = match[2];
    }
    requireSourceKeys(recorded, layout);
    for (const path of layout)
        check(recorded[path] === sources[path], "INTEGRATION_LAYOUT_CAPTURE:" + path);
    const fileRows = [...manifest.matchAll(/^  - ([a-z0-9-]+\.png)$/gm)].map(match => match[1]);
    const harnessRows = [...manifest.matchAll(/^  ([a-z0-9-]+\.png): \{ url:/gm)].map(match => match[1]);
    check(sameKeys(fileRows, crops) && sameKeys(harnessRows, crops) && new Set(fileRows).size === crops.length &&
        new Set(harnessRows).size === crops.length, "INTEGRATION_MANIFEST_CASE_SET");
    const native = { operation: OP.exposure, protectedBase: execution.protectedMaster, kind, packet: PACKETS[kind],
        expected: execution.expected, successful_files: execution.successfulFiles, exit: execution.exit, source_stable: execution.sourceStable,
        failed_frames: [], source_sha256: sources, image_sha256: Object.fromEntries(Object.entries(execution.images).map(([name, value]) => [name, value.sha256])),
        native_manifest_sha256: execution.manifestSha256, log_sha256: execution.logSha256 };
    return { sources, native, cropDir, evidence, layout, execution };
}
function readExposureMasterIntegration(repo, root, kind, crops, text, requireCurrent = true) {
    const successor = kind === "eod";
    const revision = successor ? UI_COPY_REVISION : INDICATOR_REVISION;
    const branchHead = successor ? UI_COPY_PRIOR : INDICATOR_PRIOR;
    const protectedMaster = successor ? UI_COPY_PROTECTED : MASTER_PROTECTED;
    const packetPin = successor ? UI_COPY_PACKET : INDICATOR_PACKET[kind];
    const operation = join(root, "operations", OP.exposure);
    const relative = "operations/" + OP.exposure + "/revisions/" + revision;
    const dir = join(root, relative), descriptorPath = join(dir, "native-packet.json");
    check(sha(descriptorPath) === packetPin, "INTEGRATION_PACKET_DIGEST");
    const descriptor = json(descriptorPath);
    check(descriptor.schema === "options_exposure_master_packet.v1" && descriptor.kind === kind && descriptor.profile === "exposure" &&
        descriptor.operation === OP.exposure && descriptor.captureRevision === revision && descriptor.branchHead === branchHead &&
        descriptor.protectedMaster === protectedMaster &&
        (!successor || descriptor.integratedDependency === UI_COPY_DEPENDENCY), "INTEGRATION_PACKET_IDENTITY");
    const files = ["capture-execution.json", "capture-sources-before.json", "capture-sources-after.json", "source-contract.json",
        "qualified-root/EVIDENCE.yml", "history.json", "EVIDENCE.before.yml", "capture.log"];
    requireSourceKeys(descriptor.files, files);
    for (const [file, digest] of Object.entries(descriptor.files))
        check(sha(join(dir, file)) === digest, "INTEGRATION_PAYLOAD:" + file);
    const historyDir = join(operation, "revisions", MASTER_REVISION);
    check(sha(join(historyDir, "native-packet.json")) === MASTER_PACKET[kind], "INTEGRATION_PREDECESSOR_DESCRIPTOR");
    const predecessor = json(join(historyDir, "native-packet.json"));
    requireSourceKeys(predecessor.files, ["capture-execution.json", "capture-sources-before.json", "capture-sources-after.json",
        "source-contract.json", "qualified-root/EVIDENCE.yml", "history.json", "prior-exposure-root-sha256.json", "prior-protected-root-sha256.json"]);
    for (const [file, digest] of Object.entries(predecessor.files))
        check(sha(join(historyDir, file)) === digest, "INTEGRATION_PREDECESSOR_FILE:" + file);
    const priorExecution = json(join(historyDir, "capture-execution.json"));
    requireIntegrationExecution(priorExecution, kind, crops, "master-integration");
    check(priorExecution.manifestSha256 === predecessor.files["qualified-root/EVIDENCE.yml"], "INTEGRATION_PREDECESSOR_MANIFEST");
    verifyIntegrationImages(join(historyDir, "qualified-root"), priorExecution, crops);
    const indicatorDir = join(operation, "revisions", INDICATOR_REVISION);
    check(sha(join(indicatorDir, "native-packet.json")) === INDICATOR_PACKET[kind], "INTEGRATION_INDICATOR_DESCRIPTOR");
    const indicator = json(join(indicatorDir, "native-packet.json"));
    check(indicator.schema === "options_exposure_master_packet.v1" && indicator.kind === kind && indicator.profile === "exposure" &&
        indicator.operation === OP.exposure && indicator.captureRevision === INDICATOR_REVISION &&
        indicator.branchHead === INDICATOR_PRIOR && indicator.protectedMaster === MASTER_PROTECTED, "INTEGRATION_INDICATOR_IDENTITY");
    requireSourceKeys(indicator.files, files);
    for (const [file, digest] of Object.entries(indicator.files))
        check(sha(join(indicatorDir, file)) === digest, "INTEGRATION_INDICATOR_PAYLOAD:" + file);
    const history = json(join(indicatorDir, "history.json"));
    check(history.schema === "exposure_indicator_guard_history.v1" && history.branchHead === INDICATOR_PRIOR &&
        history.protectedMaster === MASTER_PROTECTED && history.packet === PACKETS[kind] &&
        history.predecessor.revision === MASTER_REVISION && history.predecessor.descriptorSha256 === MASTER_PACKET[kind], "INTEGRATION_PREDECESSOR_IDENTITY");
    const priorRoot = integrationArchive(historyDir, "exposure", kind, crops);
    const protectedRoot = integrationArchive(historyDir, "protected", kind, crops);
    const oldDeclaration = "# Current source proof is the complete Exposure master integration revision.\n" +
        yamlBlock("exposureMasterIntegration20261109", {
            revision: "operations/" + OP.exposure + "/revisions/" + MASTER_REVISION,
            descriptorSha256: MASTER_PACKET[kind], branchHead: MASTER_PRIOR, protectedMaster: MASTER_PROTECTED,
        }) + "\n";
    check(readFileSync(join(indicatorDir, "EVIDENCE.before.yml"), "utf8") === oldDeclaration +
        readFileSync(join(protectedRoot, "EVIDENCE.yml"), "utf8"), "INTEGRATION_PREDECESSOR_DECLARATION");
    const indicatorDeclaration = "# Current source proof is the complete Exposure indicator-guard revision.\n" +
        yamlBlock("exposureMasterIntegration20261109", {
            revision: "operations/" + OP.exposure + "/revisions/" + INDICATOR_REVISION,
            descriptorSha256: INDICATOR_PACKET[kind], branchHead: INDICATOR_PRIOR, protectedMaster: MASTER_PROTECTED,
        }) + "\n";
    if (successor) {
        readIntegrationNativePayload(repo, indicatorDir, kind, crops, indicator, "indicator-guard", false);
        const currentHistory = json(join(dir, "history.json"));
        const inventoryRelative = "terminal/docs/verification/pr650-exposure-integration-20261109/prior-published650-eod-sha256.json";
        check(currentHistory.schema === "exposure_ui_copy_history.v1" && currentHistory.branchHead === UI_COPY_PRIOR &&
            currentHistory.protectedMaster === UI_COPY_PROTECTED && currentHistory.integratedDependency === UI_COPY_DEPENDENCY &&
            currentHistory.packet === PACKETS[kind] && currentHistory.predecessor.revision === INDICATOR_REVISION &&
            currentHistory.predecessor.descriptorSha256 === INDICATOR_PACKET[kind] &&
            currentHistory.published650Archive.inventory === inventoryRelative &&
            currentHistory.published650Archive.sha256 === UI_COPY_650_ARCHIVE, "INTEGRATION_UI_COPY_HISTORY");
        check(sha(join(repo, inventoryRelative)) === UI_COPY_650_ARCHIVE, "INTEGRATION_PUBLISHED650_INVENTORY");
        const inventory = json(join(repo, inventoryRelative));
        requireSourceKeys(inventory, [...crops, "EVIDENCE.yml"]);
        const archive = join(repo, "terminal/docs/verification/pr650-exposure-integration-20261109/prior-published650-eod");
        check(sameKeys(readdirSync(archive), Object.keys(inventory)), "INTEGRATION_PUBLISHED650_ARCHIVE_SET");
        for (const [file, digest] of Object.entries(inventory))
            check(sha(join(archive, file)) === digest, "INTEGRATION_PUBLISHED650_ARCHIVE:" + file);
        check(readFileSync(join(dir, "EVIDENCE.before.yml"), "utf8") === indicatorDeclaration +
            readFileSync(join(protectedRoot, "EVIDENCE.yml"), "utf8"), "INTEGRATION_UI_COPY_PRIOR_DECLARATION");
    }
    const historical = readCandidate(repo, root, kind, "exposure", crops), boundarySources = verifyBoundary(repo, false);
    verifyHistory(root, kind, "exposure", crops, priorRoot);
    check(readFileSync(join(priorRoot, "EVIDENCE.yml"), "utf8") === exposurePrefix(operation) +
        readFileSync(historical.protectedManifest, "utf8"), "INTEGRATION_EXPOSURE_MANIFEST_HISTORY");
    for (const path of [LAB, WRAPPER])
        check(historical.sources[path] === boundarySources[path], "INTEGRATION_BOUNDARY_HISTORY:" + path);
    requireR4ChartIdentity(repo, CHART_FRAMING_MAPS.original.before, CHART_FRAMING_MAPS.preview.before, CHART_FRAMING_MAPS.original.after, false);
    const declaration = successor ? "# Current source proof is the complete Exposure UI-copy integration revision.\n" +
        yamlBlock("exposureMasterIntegration20261109", {
            revision: relative, descriptorSha256: packetPin, branchHead, protectedMaster, integratedDependency: UI_COPY_DEPENDENCY,
        }) + "\n" : indicatorDeclaration;
    check(text === declaration + readFileSync(join(protectedRoot, "EVIDENCE.yml"), "utf8"), "INTEGRATION_ROOT_MANIFEST");
    check(sameKeys(readdirSync(root).filter(name => name.endsWith(".png")), crops), "INTEGRATION_PROTECTED_ROOT_SET");
    for (const name of crops)
        check(sha(join(root, name)) === sha(join(protectedRoot, name)), "INTEGRATION_PROTECTED_ROOT_IMAGE:" + name);
    const selected = readIntegrationNativePayload(repo, dir, kind, crops, descriptor, successor ? "ui-copy-integration" : "indicator-guard", requireCurrent);
    verifyIntegrationBrowser(repo, requireCurrent);
    return { profile: "exposure", captureRevision: revision, descriptorSha256: packetPin, ...selected,
        protectedManifest: join(protectedRoot, "EVIDENCE.yml"), optionsHistorySources: {},
        hasExposureHistory: true, hasOptionsHistory: false,
        exposureHistorical: { ...historical, root: priorRoot, boundarySources } };
}

function optionsIntegrationDeclaration(kind) {
    return "# Current source proof is the complete Options integration revision.\n" +
        yamlBlock("exposureMasterIntegration20261109", {
            revision: "operations/" + OP.exposure + "/revisions/" + OPTIONS_INTEGRATION_REVISION,
            descriptorSha256: OPTIONS_INTEGRATION_PACKET[kind], branchHead: OPTIONS_INTEGRATION_PRIOR,
            protectedMaster: OPTIONS_INTEGRATION_PROTECTED, integratedDependency: OPTIONS_INTEGRATION_DEPENDENCY,
        }) + "\n";
}
function readOptionsIntegrationDescriptor(repo, kind) {
    const root = join(repo, "terminal/docs/pr-crops", PACKETS[kind]);
    const dir = join(root, "operations", OP.exposure, "revisions", OPTIONS_INTEGRATION_REVISION);
    const file = join(dir, "native-packet.json");
    check(sha(file) === OPTIONS_INTEGRATION_PACKET[kind], "OPTIONS_INTEGRATION_PACKET_DIGEST:" + kind);
    const descriptor = json(file);
    check(descriptor.schema === "options_exposure_master_packet.v1" && descriptor.kind === kind && descriptor.profile === "exposure" &&
        descriptor.operation === OP.exposure && descriptor.captureRevision === OPTIONS_INTEGRATION_REVISION &&
        descriptor.branchHead === OPTIONS_INTEGRATION_PRIOR && descriptor.protectedMaster === OPTIONS_INTEGRATION_PROTECTED &&
        descriptor.integratedDependency === OPTIONS_INTEGRATION_DEPENDENCY, "OPTIONS_INTEGRATION_PACKET_IDENTITY:" + kind);
    requireSourceKeys(descriptor.files, ["capture-execution.json", "capture-sources-before.json", "capture-sources-after.json", "source-contract.json",
        "qualified-root/EVIDENCE.yml", "history.json", "EVIDENCE.before.yml", "capture.log"]);
    for (const [name, digest] of Object.entries(descriptor.files))
        check(sha(join(dir, name)) === digest, "OPTIONS_INTEGRATION_PAYLOAD:" + kind + ":" + name);
    const history = json(join(dir, "history.json")), predecessor = kind === "eod" ? UI_COPY_REVISION : INDICATOR_REVISION;
    check(history.schema === "exposure_options_integration_history.v1" && history.operation === OP.exposure &&
        history.revision === OPTIONS_INTEGRATION_REVISION && history.kind === kind && history.packet === PACKETS[kind] &&
        history.branchHead === OPTIONS_INTEGRATION_PRIOR && history.protectedMaster === OPTIONS_INTEGRATION_PROTECTED &&
        history.integratedDependency === OPTIONS_INTEGRATION_DEPENDENCY &&
        history.predecessor?.revision === predecessor &&
        history.predecessor.descriptorSha256 === (kind === "eod" ? UI_COPY_PACKET : INDICATOR_PACKET[kind]), "OPTIONS_INTEGRATION_HISTORY:" + kind);
    return { root, dir, descriptor };
}
function requireOptionsIntegrationBrowserCases(current, historical) {
    const titles = [
        "Exposure 0DTE unknown cell withholds the total", "Exposure 0DTE complete grid shows its total",
        "Exposure All except 0DTE withholds the total when a chain expiration is outside the snapshot",
        "[en] Exposure known subtotal keeps its date-only source session", "[en] Exposure complete grid keeps its date-only source session",
        "[zh] Exposure known subtotal keeps its date-only source session", "[zh] Exposure complete grid keeps its date-only source session",
    ];
    const expected = [...historical.expectedPassed, ...["desktop", "tablet", "mobile"].flatMap(project => titles.map(title => project + "|" + title))];
    check(historical.expectedPassed.length === 123 && new Set(current.expectedPassed).size === 144 &&
        current.expectedPassed.length === 144 && sameKeys(current.expectedPassed, expected) &&
        current.expectedSkipped.length === 0 && historical.expectedSkipped.length === 0, "OPTIONS_INTEGRATION_BROWSER_CASE_SET");
}
function verifyOptionsIntegrationBrowser(repo) {
    requireOptionsIntegrationBrowserCases(verifyIntegrationBrowserRecord(repo, "options-integration"), verifyIntegrationBrowser(repo, false));
}
function readOptionsIntegration(repo, root, kind, crops, text) {
    const packets = Object.fromEntries(["gex", "eod"].map(family => [family, readOptionsIntegrationDescriptor(repo, family)]));
    let historical, selected;
    for (const family of ["gex", "eod"]) {
        const packet = packets[family];
        const expected = family === kind ? crops : require("./" + harness(family).split("/").at(-1)).expectedFiles();
        const prior = readExposureMasterIntegration(repo, packet.root, family, expected,
            readFileSync(join(packet.dir, "EVIDENCE.before.yml"), "utf8"), false);
        const current = readIntegrationNativePayload(repo, packet.dir, family, expected, packet.descriptor, "options-integration", true);
        const actual = family === kind ? text : readFileSync(join(packet.root, "EVIDENCE.yml"), "utf8");
        check(actual === optionsIntegrationDeclaration(family) + readFileSync(prior.protectedManifest, "utf8"), "OPTIONS_INTEGRATION_ROOT:" + family);
        if (family === kind) { historical = prior; selected = current; }
    }
    verifyOptionsIntegrationBrowser(repo);
    return { ...historical, ...selected, captureRevision: OPTIONS_INTEGRATION_REVISION,
        descriptorSha256: OPTIONS_INTEGRATION_PACKET[kind] };
}

/** Legacy is eligible only when neither a declaration nor any qualified operation history exists. */
function optionalQualifiedOptionsExposurePacket(repo, kind, crops) {
    const root = join(repo, "terminal/docs/pr-crops", PACKETS[kind]);
    const history = Object.values(OP).some(operation => existsSync(join(root, "operations", operation)));
    let text;
    try { text = readFileSync(join(root, "EVIDENCE.yml"), "utf8"); }
    catch (error) { if (error.code === "ENOENT" && !history) return null; throw error; }
    const declared = /exposureMasterIntegration20261109|exposureSourceCompatibility20261105|optionsSourceCompatibility20261105/.test(text);
    return declared || history ? qualifiedOptionsExposurePacket(repo, kind, crops) : null;
}

module.exports = { requireSourceKeys, selectWholeFingerprint, projectR4CaptureHarness, projectIndicatorGuardBrowserSources, layoutSources, requireR4ChartIdentity, qualifiedOptionsExposurePacket, masterIntegrationInputs, MASTER_BROWSER_SPECS, masterIntegrationBrowserInputs, uiCopyIntegrationInputs, uiCopyIntegrationBrowserInputs, requireIntegrationExecution, optionalQualifiedOptionsExposurePacket, optionsIntegrationInputs, OPTIONS_INTEGRATION_BROWSER_SPECS, optionsIntegrationBrowserInputs, requireOptionsIntegrationBrowserCases };
