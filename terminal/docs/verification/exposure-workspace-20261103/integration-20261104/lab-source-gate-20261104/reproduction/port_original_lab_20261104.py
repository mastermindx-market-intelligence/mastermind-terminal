from pathlib import Path
import hashlib,json,subprocess,shutil
P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i");T=P/"tree/terminal";REPO=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3");O=REPO/"terminal";R=P/"original-lab-integration-20261104"
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
assert subprocess.check_output(["git","-C",str(REPO),"rev-parse","HEAD"],text=True).strip()=="04afd94cb11649820688912cf23df2f3b0a5b2c3"
assert not subprocess.check_output(["git","-C",str(REPO),"status","--porcelain=v1"],text=True).strip()
assert not R.exists();R.mkdir()
deps=["lib/optionsCompanion.ts","lib/exposureReportedChange.ts","components/researchlab/researchLabAdapter.ts","components/options-companion/optionsStrings.ts","components/options-companion/OptionsCompanion.module.css","lib/__tests__/fixtures/reportedGammaBooks.ts","components/researchlab/AdmittedOptionsResearchLab.tsx"]
for rel in deps:assert (O/rel).read_bytes()==(T/rel).read_bytes(),("DEPENDENCY_MISMATCH",rel)
paths=["components/researchlab/OptionsResearchLab.tsx","components/options-companion/GexMarketMemory.tsx","components/researchlab/ResearchReportedGammaPanel.tsx","components/researchlab/researchReportedGamma.ts","lib/__tests__/researchReportedGamma.test.ts","lib/__tests__/researchReportedGammaMounted.test.tsx","e2e/options-lab-reported-gamma.spec.ts"]
changes=[]
for rel in paths:
 dst=O/rel;before=sha(dst) if dst.exists() else None
 if dst.exists():
  saved=R/"before"/rel;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(dst,saved)
 dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(T/rel,dst)
 assert dst.read_bytes()==(T/rel).read_bytes()
 changes.append({"path":"terminal/"+rel,"beforeSha256":before,"afterSha256":sha(dst),"source":"composed protected4df"})
f=O/"components/gexdesk/GexDeskView.tsx";before=f.read_text();saved=R/"before/components/gexdesk/GexDeskView.tsx";saved.parent.mkdir(parents=True,exist_ok=True);saved.write_text(before)
anchor='      matrix={isArchived ? null : visibleMatrix}\n'
assert before.count(anchor)==1
after=before.replace(anchor,anchor+'      // Reuse the selected Exposure book; null prevents a separate live fallback.\n      currentGexSnapshot={!isArchived && rootOk ? activePayload : null}\n')
f.write_text(after)
changes.append({"path":"terminal/components/gexdesk/GexDeskView.tsx","beforeSha256":sha(saved),"afterSha256":sha(f),"source":"bounded host prop; sector comment preserved"})
receipt={"schema":"terminal.options_lab_port.v1","originalHead":"04afd94cb11649820688912cf23df2f3b0a5b2c3","protected":"4df7aad16ea775ad8112858a5095210c076efe08","state":"UNQUALIFIED_SOURCE_PORT_FOR_FALSIFICATION","changes":changes,"dependencies":{x:sha(O/x) for x in deps},"knownGap":"Retained unavailable/absent data still reaches Lab; reproduce before narrow source-gate repair."}
(R/"port.json").write_text(json.dumps(receipt,indent=2)+"\n")
subprocess.run(["git","-C",str(REPO),"diff","--check"],check=True)
print("BOUNDED_LAB_PORT_FOR_FALSIFIER",len(changes),"files",sha(R/"port.json"))
