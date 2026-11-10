from pathlib import Path
import hashlib,json
P=Path(__file__).resolve().parent
records=[]
for mode in ["original","preview"]:
 T=P.parents[1] if mode=="original" else P/"tree/terminal"
 R=P/("original-lab-integration-20261104" if mode=="original" else "protected4df-20261104")
 op="exposure-1243-lab-source-gate-20261104" if mode=="original" else "options-combined-4df-lab-source-gate-20261104"
 for kind,packet,count in [("gex","gex-levels-heatmap-load-failure",54),("eod","eod-heatmap-flowdesk-load-failure",42)]:
  name="gexLevelsHeatmapLoadFailureEvidence.test.ts" if kind=="gex" else "eodHeatmapFlowdeskLoadFailureEvidence.test.ts"
  f=T/"lib/__tests__"/name;before=f.read_text();assert 'verifies the qualified Lab source gate against current sources' not in before
  prior_sha=hashlib.sha256((T/"docs/pr-crops"/packet/"EVIDENCE.yml").read_bytes()).hexdigest()
  title='it("binds the Paper hierarchy recapture to current sources and immutable operation crops", () => {'
  start=before.index(title)
  anchor=before.index('    expect(receipt).toContain(\'  packetRootCrops: "preserved at original committed bytes"\');',start)
  a=before.index("\n",anchor)+1
  b=before.index('    const expected = STATES.filter',a)
  replacement='''    // Preserve the accepted Paper operation as history. The following test binds
    // the newer source gate to its own capture and exact current source bytes.
    const priorPath = join(CROP_DIR, "operations/'''+op+'''/EVIDENCE.before.yml");
    expect(sha256Of(priorPath)).toBe("'''+prior_sha+'''");
    const prior = readFileSync(priorPath, "utf8");
    expect(receipt).toBe(receiptSection(prior, "exposureHierarchyRecapture"));
'''
  after=before[:a]+replacement+before[b:]
  after=after.replace(title,'it("preserves the Paper hierarchy receipt and immutable operation crops", () => {',1)
  if mode=="preview":
   after=after.replace('receiptSection(yml, "currentBaseCapture20261104")','receiptSection(yml, "labSourceGateRecapture20261104")')
   if kind=="eod":
    assert after.count('const record = yml.slice(sectionAt + 1);')==1
    after=after.replace('const record = yml.slice(sectionAt + 1);','const record = receiptSection(yml, "commandChainHeatFollowup");',1)
  extra='''
  it("verifies the qualified Lab source gate against current sources and native operation crops", () => {
    const record = receiptSection(evidenceText(), "labSourceGateRecapture20261104");
    const folder = "operations/'''+op+'''";
    expect(record).toContain(§  outputDir: "¤{folder}/gate-fixed"§);
    expect(record).toContain("  actualCases: '''+str(count)+'''");
    expect(record).toContain("  failedCases: 0");
    expect(record).toContain("  sourceStableAcrossCapture: true");
    const receiptPath = join(CROP_DIR, folder, "capture-receipt.json");
    expect(record).toContain(§  captureReceiptSha256: "¤{sha256Of(receiptPath)}"§);
    const native = JSON.parse(readFileSync(receiptPath, "utf8"));
    expect(native.exit).toBe(0);
    expect(native.source_stable).toBe(true);
    expect(native.failed_frames).toEqual([]);
    for (const rel of [...LAYOUT_FILES,
      "terminal/components/researchlab/OptionsResearchLab.tsx",
      "terminal/components/options-companion/GexMarketMemory.tsx",
      "terminal/components/researchlab/ResearchReportedGammaPanel.tsx",
      "terminal/components/researchlab/researchReportedGamma.ts",
    ]) {
      const actual = sha256Of(join(REPO, rel));
      expect(record).toContain(§    ¤{rel}: "¤{actual}"§);
      expect(native.source_sha256[rel]).toBe(actual);
    }
    const harness = "terminal/e2e/tools/'''+("capture_gex_levels_heatmap_load_failure.cjs" if kind=="gex" else "capture_eod_heatmap_flowdesk_load_failure.cjs")+'''";
    expect(record).toContain(§  currentCaptureHarnessSha256: "¤{sha256Of(join(REPO, harness))}"§);
    expect(native.source_sha256[harness]).toBe(sha256Of(join(REPO, harness)));
    const expected = CROPS.filter(name => name.startsWith("'''+kind+'''-"));
    expect(expected).toHaveLength('''+str(count)+''');
    expect(Object.keys(native.image_sha256).sort()).toEqual([...expected].sort());
    expect(readdirSync(join(CROP_DIR, folder, "gate-fixed")).filter(name => name.endsWith(".png")).sort())
      .toEqual([...expected].sort());
    for (const name of expected) {
      const file = join(CROP_DIR, folder, "gate-fixed", name);
      expect(statSync(file).size, name).toBeGreaterThan(1000);
      expect(sha256Of(file), name).toBe(native.image_sha256[name]);
      expect(record).toContain(§    ¤{name}: "¤{sha256Of(file)}"§);
    }
'''
  if mode=="preview":
   extra+='''    // The other families reuse the exact full-baseline pixels and source binding.
    const baselinePath = join(CROP_DIR, folder, "baseline-receipt.json");
    expect(record).toContain(§  baselineReceiptSha256: "¤{sha256Of(baselinePath)}"§);
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(baseline.exit).toBe(0);
    expect(baseline.source_stable).toBe(true);
    for (const name of CROPS) {
      const expectedSha = native.image_sha256[name] ?? baseline.image_sha256[name];
      expect(sha256Of(join(CROP_DIR, name)), name).toBe(expectedSha);
    }
    const prior = readFileSync(join(CROP_DIR, folder, "EVIDENCE.before.yml"), "utf8");
    expect(receiptSection(evidenceText(), "currentBaseCapture20261104"))
      .toBe(receiptSection(prior, "currentBaseCapture20261104"));
'''
  extra+='''  });
'''
  extra=extra.replace("§",chr(96)).replace("¤","$")
  end=after.rfind("\n});");assert end>0
  after=after[:end]+"\n"+extra+after[end:]
  backup=R/(name+".before");assert not backup.exists();backup.write_text(before)
  f.write_text(after)
  records.append({"mode":mode,"file":"terminal/lib/__tests__/"+name,"beforeSha256":hashlib.sha256(before.encode()).hexdigest(),"afterSha256":hashlib.sha256(after.encode()).hexdigest(),"priorManifestSha256":prior_sha})
for mode in ["original","preview"]:
 R=P/("original-lab-integration-20261104" if mode=="original" else "protected4df-20261104")
 (R/"evidence-guard-repair.json").write_text(json.dumps([x for x in records if x["mode"]==mode],indent=2)+"\n")
print(json.dumps(records,indent=2))
