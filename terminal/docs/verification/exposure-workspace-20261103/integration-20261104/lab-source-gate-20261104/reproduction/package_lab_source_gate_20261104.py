from pathlib import Path
import hashlib,json,shutil,subprocess,zipfile
P=Path(__file__).resolve().parent;O=P.parents[1];C=P/"tree/terminal"
RO=P/"original-lab-integration-20261104";RC=P/"protected4df-20261104"
D=O/"docs/verification/exposure-workspace-20261103/integration-20261104/lab-source-gate-20261104"
assert not D.exists(),"EXISTING_DELIVERABLE_RECONCILE"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def readj(p):return json.loads(Path(p).read_text())
def copy(src,dst):
 assert Path(src).is_file(),src
 dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst);assert sha(src)==sha(dst)
parent=subprocess.check_output(["git","rev-parse","HEAD"],cwd=O,text=True).strip()
assert parent=="04afd94cb11649820688912cf23df2f3b0a5b2c3"
ob=readj(RO/"browser-after.json");cb=readj(RC/"browser-final.json")
assert ob["exit"]==0 and cb["exit"]==0 and cb["sourceStableAcrossBrowser"] and cb["retry"]==0
assert "24 passed" in (RO/"browser-after.log").read_text() and "30 passed" in (RC/"browser-final.log").read_text()
assert readj(RO/"browser-before.json")["exit"]==1
assert (RO/"browser-before.log").read_text().count("Expected: 0")>=2
for R in [RO,RC]:
 assert all(x["exit"]==0 for x in readj(R/"final-static-results.json"))
 assert all(x["exit"]==0 and x["source_stable"] and not x["failed_frames"] and x["successful_files"]==x["expected"] for x in readj(R/"gate-fixed-capture-results.json"))
runtime=["components/gexdesk/GexDeskView.tsx","components/researchlab/OptionsResearchLab.tsx","components/options-companion/GexMarketMemory.tsx","components/researchlab/ResearchReportedGammaPanel.tsx","components/researchlab/researchReportedGamma.ts"]
assert all((O/f).read_bytes()==(C/f).read_bytes() for f in runtime)
current=readj(RC/"source-after-final-browser.json")
assert all(sha(C.parent/f)==h for f,h in current.items()),"COMPOSED_SOURCE_CHANGED_AFTER_BROWSER"
D.mkdir(parents=True)
common=["gate-fixed-capture-results.json","gate-capture-promotion.json","evidence-guard-repair.json","final-static-results.json","final-evidence.log","final-typescript.log","final-lint.log","source-tsconfig.json"]
for mode,R in [("original",RO),("composed",RC)]:
 names=list(common)
 if mode=="original":names+=["port.json","browser-before.json","browser-before.log","browser-after.json","browser-after.log","static-results.json","unit.log","typescript.log","lint.log"]
 else:names+=["revision.json","source-before-qualification.json","source-gate-fix.json","source-before-final-browser.json","source-after-final-browser.json","browser-final.json","browser-final.log","static-results.json","capture-results.json","unchanged-evidence-dependencies.json","gate-fixed-capture-eod-setup-failed-port3659.json","gate-fixed-capture-eod-setup-failed-port3659.log"]
 for name in names:copy(R/name,D/mode/name)
 for name in ["gexLevelsHeatmapLoadFailureEvidence.test.ts","eodHeatmapFlowdeskLoadFailureEvidence.test.ts"]:
  copy((O if mode=="original" else C)/"lib/__tests__"/name,D/mode/"qualified-guards"/name)
# Keep the actual before-test source from its native trace, not a reconstruction.
red=O/".next/options-lab-source-before-20261104"
red_sources=[]
for zpath in red.rglob("trace.zip"):
 with zipfile.ZipFile(zpath) as z:
  for name in z.namelist():
   if name.startswith("resources/src@") and name.endswith(".txt"):
    raw=z.read(name)
    if b"Research Lab withdraws a retained" in raw:red_sources.append(raw)
assert len(red_sources)==2 and red_sources[0]==red_sources[1]
(D/"original/red-source.spec.ts.txt").write_bytes(red_sources[0])
artifacts=[]
for label,root in [("original-red",red),("original-green",O/".next/options-lab-source-after-20261104"),("composed-green",C/".next/options-lab-composed-final-20261104")]:
 for f in sorted(root.rglob("*")):
  if not f.is_file():continue
  rel=f.relative_to(root)
  keep=f.suffix in [".png",".md",".json"]
  if f.name=="trace.zip":
   keep=(label=="original-red"
    or (label=="original-green" and (("1ff68" in f.parent.name or "8019e" in f.parent.name) and f.parent.name.endswith("-desktop")
     or "85e29" in f.parent.name and f.parent.name.endswith("-mobile")))
    or (label=="composed-green" and ("1ff68" in f.parent.name and f.parent.name.endswith("-mobile")
     or f.parent.name.startswith("sector-exposure-depth") and f.parent.name.endswith("-desktop"))))
  dest=D/"browser-artifacts"/label/rel
  if keep:copy(f,dest)
  artifacts.append({"set":label,"path":str(rel),"sha256":sha(f),"bytes":f.stat().st_size,"committed":keep,"retainedNativePath":str(f)})
(D/"browser-artifacts.json").write_text(json.dumps(artifacts,indent=2)+"\n")
# Existing packet owners retain the composed operation; original active source/image locks stay original.
combined_packets=[]
for kind,packet in [("gex","gex-levels-heatmap-load-failure"),("eod","eod-heatmap-flowdesk-load-failure")]:
 name="options-combined-4df-lab-source-gate-20261104"
 src=C/"docs/pr-crops"/packet/"operations"/name
 dest=O/"docs/pr-crops"/packet/"operations"/name
 assert not dest.exists();shutil.copytree(src,dest)
 copy(C/"docs/pr-crops"/packet/"EVIDENCE.yml",dest/"combined-EVIDENCE.yml")
 qualified=dest/"qualified-root";qualified.mkdir()
 capture=readj(RC/("capture-"+kind+".json"));gate=readj(RC/("gate-fixed-capture-"+kind+".json"))
 active=dict(capture["image_sha256"]);active.update(gate["image_sha256"])
 for f,h in active.items():
  copy(C/"docs/pr-crops"/packet/f,qualified/f);assert sha(qualified/f)==h
 (dest/"qualified-root-sha256.json").write_text(json.dumps(active,indent=2)+"\n")
 (dest/"README.md").write_text("# Qualified composed capture reference\n\nThis is a frozen Options + Exposure source-preview reference at protected base §4df7aad16ea775ad8112858a5095210c076efe08§. It does not replace the original branch's active packet.\n\n§combined-EVIDENCE.yml§ is the frozen preview manifest; §qualified-root/§ contains its final active pixels. §baseline-before-gate/§ retains the complete pre-gate native run, §gate-fixed/§ the affected native recapture, and §prior-root/§ the previous cd2 active pixels. The §qualified-root-sha256.json§ map binds the delivered final pixel set. Historical source and operation links inside the frozen manifest retain their original preview-relative meaning; they are not claims that this reference directory is an independently mounted application.\n\nThe original branch's new gate capture is under §../exposure-1243-lab-source-gate-20261104/§. The complete source and test qualification is linked from §docs/verification/exposure-workspace-20261103/integration-20261104/lab-source-gate-20261104/README.md§.\n".replace("§",chr(96)))
 manifest=O/"docs/pr-crops"/packet/"EVIDENCE.yml";text=manifest.read_text();key="optionsCombined4dfPreview20261104"
 assert "\n"+key+":\n" not in text
 text=text.rstrip("\n")+"\n\n"+key+':\n  status: "SOURCE_COMPOSED_PREVIEW_NOT_RELEASED"\n  protectedBase: "4df7aad16ea775ad8112858a5095210c076efe08"\n  optionsHead: "98ffa891116ccc9e6be58a64148dbe45591e6ce8"\n  artifactDir: "operations/'+name+'"\n  frozenPreviewManifestSha256: "'+sha(dest/"combined-EVIDENCE.yml")+'"\n  qualifiedRootSha256: "'+sha(dest/"qualified-root-sha256.json")+'"\n  sourceProof: "terminal/docs/verification/exposure-workspace-20261103/integration-20261104/lab-source-gate-20261104/qualification.json"\n'
 manifest.write_text(text)
 combined_packets.append({"kind":kind,"reference":str(dest.relative_to(O.parent)),"qualifiedRootImages":len(active),"freshGateImages":len(gate["image_sha256"]),"retainedBaselineImages":len(active)-len(gate["image_sha256"]),"frozenManifestSha256":sha(dest/"combined-EVIDENCE.yml"),"qualifiedRootSha256":sha(dest/"qualified-root-sha256.json")})
for name in ["port_original_lab_20261104.py","verify_original_lab_source_20261104.py","verify_original_lab_static_20261104.py","capture_lab_source_gate_20261104.py","resume_preview_gate_eod_20261104.py","qualify_lab_source_gate_20261104.py","repair_lab_gate_evidence_guards_20261104.py","verify_composed_lab_gate_20261104.py","verify_final_lab_gate_static_20261104.py","advance_protected4df_20261104.py","capture_protected4df_20261104.py"]:
 copy(P/name,D/"reproduction"/name)
# Store final original source identity, including the new runtime and test paths.
original_sources={"terminal/"+str(f.relative_to(O)):sha(f) for folder in ["app","components","lib","e2e"] for f in sorted((O/folder).rglob("*")) if f.is_file()}
(D/"original/source-final.json").write_text(json.dumps(original_sources,indent=2)+"\n")
qualification={
 "schema":"terminal.options-exposure.lab-source-gate-qualification.v1",
 "status":"IMPLEMENTATION_AND_LOCAL_INTEGRATION_QUALIFIED",
 "sourceLawPin":"700eef54bca4a2dc4e30d94a6b30dcfa733ad57c",
 "protectedTerminalPin":"4df7aad16ea775ad8112858a5095210c076efe08",
 "originalCarrierOperation":"exposure-strike-workspace-ux-20261103-c3",
 "originalParentHead":parent,"exposurePaperImplementation":"6d6cdc727b9e8d0d70af23d8b0caa239c6304b5b","optionsHead":"98ffa891116ccc9e6be58a64148dbe45591e6ce8",
 "paper":{"fileId":"01M3NSZGE8JWN2EZCSF0DT05RM","pageId":"p-V-0","acceptedBoards":["1SWN-0","1T68-0","1TD2-0","1TK8-0","1TR5-0","1TY2-0"],"disposition":"DO_NOT_REDO; prior screenshot and JSX acceptance retained"},
 "runtimeSha256":{"terminal/"+x:sha(O/x) for x in runtime},
 "original":{"redFailures":2,"redCause":"A retained payload remained visible after classified absent/unavailable SSE status.","browserPassed":24,"retries":0,"focusedUnitPassed":304,"finalEvidencePassed":21,"sourceTypecheck":"PASS; generated Next validator output excluded","lint":"PASS","sourceMapSha256":sha(D/"original/source-final.json")},
 "composed":{"browserPassed":30,"retries":0,"browserSourceStable":True,"browserSourceFileCount":cb["sourceFileCount"],"browserSourceMapSha256":cb["sourceMapAfterSha256"],"focusedUnitBeforeGatePassed":308,"finalEvidencePassed":38,"sourceTypecheck":"PASS; generated Next validator output excluded","lint":"PASS","notAGitMergeCommit":True},
 "captures":{"originalFreshAffected":96,"composedFullBeforeGate":240,"composedFreshAffectedAfterGate":96,"composedFinalActive":240,"composedRetainedUnaffected":144,"packets":combined_packets},
 "reusedProof":readj(RC/"unchanged-evidence-dependencies.json"),
 "visualQA":{"result":"PASS","reviewedActualScreenshots":[
 "original-green/options-lab-reported-gamma-61a05-exact-host-consumer-en-dark-mobile/gamma-en-dark.png",
 "original-green/options-lab-reported-gamma-75ead-xact-host-consumer-zh-light-mobile/gamma-zh-light.png",
 "original-green/options-lab-source-state-R-85e29-ting-an-available-live-book-tablet/archived-no-live-fallback.png",
 "composed-green/options-lab-source-state-R-1ff68-s-the-exact-pin-on-recovery-mobile/unavailable-withdrawn.png",
 "composed-green/exposure-workspace-Exposur-3f168-es-Market-State-and-history-desktop/exposure-entry.png",
 "composed-green/exposure-workspace-Exposur-3f168-es-Market-State-and-history-tablet/history-controls.png",
 "composed-green/exposure-workspace-Exposur-3f168-es-Market-State-and-history-mobile/exposure-entry.png"],
 "checks":["Hierarchy and readable values","No horizontal overflow","Native disclosure state","Source withdrawal","Archive identity retained","Responsive ladder and History controls"]},
 "scopeLimits":["Synthetic identity and data fixtures; no production provider/account proof.","App shell remains dark; light Paper boards and component-theme checks do not claim an appwide light setting.","No fresh VI/B-PL6 browser run; historical proof reused only for unchanged declared dependencies.","The earlier 166/171 run plus 12/12 recovery remains historical; the full 18,000+ unit inventory was not rerun after this bounded repair."],
 "release":{"merged":False,"deployed":False,"authority":"Existing no-merge/no-enqueue/no-Ready/no-label/no-deploy restrictions retained.","nativeCI":"Not replaced by local proof; exact new-head status must be read after publication."},
 "nextAuthorizedAction":"Publish this exact bounded source and proof through the original C3 typed publisher, read back the head and native checks, and update the existing PR description."
}
(D/"qualification.json").write_text(json.dumps(qualification,indent=2)+"\n")
print(json.dumps({"status":"PACKAGED_AWAITING_README_AND_FINAL_READBACK","path":str(D),"qualificationSha256":sha(D/"qualification.json"),"committedBrowserArtifacts":sum(x["committed"] for x in artifacts),"committedBrowserBytes":sum(x["bytes"] for x in artifacts if x["committed"]),"composedPackets":combined_packets},indent=2))
