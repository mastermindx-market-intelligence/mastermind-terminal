from pathlib import Path
import shutil
r=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")
t=r/"terminal";p=t/".next/options-completion-preview-0vgroh6i/tree/terminal"
old='    for (const rel of requiredSources) expect(native.source_sha256[rel], rel).toBe(sha256Of(join(REPO, rel)));'
new='''    // The native scenes never enter Research Lab. Preserve their exact f12
    // source identity, then reconcile the one unexercised source transition.
    const capturedMapPath = join(REPO, "terminal/docs/verification/exposure-workspace-20261103/source-compatibility-20261105/original/browser-source-after.json");
    expect(sha256Of(capturedMapPath)).toBe("f1c54ada9ecc0da40ed379c8c622483f602915d9eaf2f7967258e5b9081bc6db");
    const captured = JSON.parse(readFileSync(capturedMapPath, "utf8")) as Record<string, string>;
    for (const rel of requiredSources) expect(native.source_sha256[rel], rel).toBe(captured[rel]);
    const restoredLab = "terminal/components/researchlab/OptionsResearchLab.tsx";
    const changed = requiredSources.filter(rel => native.source_sha256[rel] !== sha256Of(join(REPO, rel)));
    expect(changed).toEqual([restoredLab]);
    expect(native.source_sha256[restoredLab]).toBe("1b9bfeaa9ae3a9460fcecd812a98dcd8ef6591df0041d5dc4a53bde6dc2daf8b");
    expect(sha256Of(join(REPO, restoredLab))).toBe("365223a8182effc04fa956a8004062aa86c1426de8fc24eccebf6952e1571820");

    const boundaryDir = join(REPO, "terminal/docs/verification/exposure-workspace-20261103/boundary-compatibility-20261105");
    const qualification = JSON.parse(readFileSync(join(boundaryDir, "qualification.json"), "utf8"));
    expect(qualification.schema).toBe("options_lab_boundary_compatibility.v1");
    expect(qualification.capture_commit).toBe("f12ad44115d69b1bcd7cd453d69a689c9d6768a8");
    const boundarySources = [
      "terminal/components/gexdesk/GexDeskView.tsx",
      "terminal/components/researchlab/AdmittedOptionsResearchLab.tsx",
      restoredLab,
      "terminal/components/options-companion/GexMarketMemory.tsx",
      "terminal/components/researchlab/ResearchReportedGammaPanel.tsx",
      "terminal/components/researchlab/researchReportedGamma.ts",
      "terminal/lib/dataCache.ts", "terminal/lib/idbJsonStore.ts",
      "terminal/lib/flowClientCache.ts", "terminal/lib/optionsCompanion.ts",
      "terminal/lib/__tests__/researchLabSourceAvailability.test.tsx",
      "terminal/lib/__tests__/fixtures/reportedGammaBooks.ts",
      "terminal/lib/__tests__/fixtures/exposure-projection-observed-v2.json",
      "terminal/e2e/options-lab-source-state.spec.ts",
    ];
    expect(Object.keys(qualification.boundary_sources).sort()).toEqual([...boundarySources].sort());
    for (const mode of ["original", "preview"]) {
      const proof = qualification.browser[mode];
      const receiptFile = join(boundaryDir, mode, "browser-receipt.json");
      const mapFile = join(boundaryDir, mode, "browser-source-after.json");
      expect(sha256Of(receiptFile)).toBe(proof.receipt_sha256);
      expect(sha256Of(mapFile)).toBe(proof.source_map_sha256);
      const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
      const sourceMap = JSON.parse(readFileSync(mapFile, "utf8")) as Record<string, string>;
      expect(receipt.exit).toBe(0);
      expect(receipt.source_stable).toBe(true);
      expect(receipt.retries).toBe(0);
      expect(receipt.passed).toBe(mode === "original" ? 12 : 18);
      expect(receipt.source_map_sha256).toBe(proof.source_map_sha256);
      expect(receipt.log_sha256).toBe(sha256Of(join(boundaryDir, mode, "browser.log")));
      expect(receipt.command).toContain("e2e/options-lab-source-state.spec.ts");
      for (const rel of boundarySources) {
        expect(sourceMap[rel], mode + ": " + rel).toBe(sha256Of(join(REPO, rel)));
        expect(qualification.boundary_sources[rel], rel).toBe(sourceMap[rel]);
      }
    }'''
for name in ["gexLevelsHeatmapLoadFailureEvidence.test.ts","eodHeatmapFlowdeskLoadFailureEvidence.test.ts"]:
    f=t/"lib/__tests__"/name;s=f.read_text();assert s.count(old)==1
    s=s.replace(old,new).replace('it("binds the current full native capture and preserves both historical root image sets"', 'it("reconciles retained native capture with fresh boundary proof and preserves historical image sets"')
    f.write_text(s);shutil.copyfile(f,p/f.relative_to(t))
print("EXACT_NATIVE_SOURCE_TRANSITION_AND_FRESH_BOUNDARY_CONTRACT_WRITTEN")
