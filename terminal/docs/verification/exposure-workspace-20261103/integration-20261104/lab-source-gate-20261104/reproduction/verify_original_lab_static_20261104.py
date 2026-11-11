from pathlib import Path
import hashlib,json,os,subprocess
T=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal")
R=T/".next/options-completion-preview-0vgroh6i/original-lab-integration-20261104"
config=R/"source-tsconfig.json"
assert not (R/"static-results.json").exists()
config.write_text(json.dumps({"extends":str(T/"tsconfig.json"),"compilerOptions":{"incremental":False},"exclude":[str(T/"node_modules"),str(T/".next")]},indent=2)+"\n")
tests=["ExposureOriginStrip.test.tsx","exposureChartLink.test.ts","exposureChartReference.test.tsx","exposureOrigin.test.ts","exposureReplay.test.tsx","exposureReplayFrames.test.ts","gexDeskLoadFailureState.test.tsx","gexDeskPartialData.test.tsx","gexDeskStateRace.test.tsx","optionsMarketMemory.test.tsx","researchLabAdapter.test.ts","researchLabAdmission.test.tsx","researchLabView.test.tsx","researchReportedGamma.test.ts","researchReportedGammaMounted.test.tsx","sectorDepthReturn.test.ts","useExposureOriginRoster.test.tsx"]
available={p.name:str(p.relative_to(T)) for p in (T/"lib/__tests__").rglob("*") if p.is_file()}
missing=[x for x in tests if x not in available]
assert not missing,missing
files=["components/gexdesk/GexDeskView.tsx","components/researchlab/OptionsResearchLab.tsx","components/options-companion/GexMarketMemory.tsx","components/researchlab/ResearchReportedGammaPanel.tsx","components/researchlab/researchReportedGamma.ts","lib/__tests__/researchReportedGamma.test.ts","lib/__tests__/researchReportedGammaMounted.test.tsx","e2e/options-lab-reported-gamma.spec.ts","e2e/options-lab-source-state.spec.ts"]
env=os.environ.copy();env["NODE_OPTIONS"]="--no-experimental-webstorage"
results=[]
for label,cmd in [
 ("unit",["./node_modules/.bin/vitest","run",*[available[x] for x in tests]]),
 ("typescript",["./node_modules/.bin/tsc","--noEmit","-p",str(config)]),
 ("lint",["./node_modules/.bin/eslint",*files]),
]:
 log=R/(label+".log")
 print("STATIC_START",label,flush=True)
 with log.open("x") as out:
  result=subprocess.run(cmd,cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=600)
 record={"check":label,"exit":result.returncode,"command":cmd,"logSha256":hashlib.sha256(log.read_bytes()).hexdigest()}
 results.append(record);print("STATIC_RESULT",json.dumps(record),flush=True)
 print("\n".join(log.read_text(errors="replace").splitlines()[-20:])[-4500:],flush=True)
(R/"static-results.json").write_text(json.dumps(results,indent=2)+"\n")
