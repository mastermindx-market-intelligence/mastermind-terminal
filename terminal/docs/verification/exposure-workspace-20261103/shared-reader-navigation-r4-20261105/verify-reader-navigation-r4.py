from pathlib import Path
import subprocess,json,hashlib,re,datetime
E=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3");T=E/"terminal";R=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-boundary-reconcile-20261105/reader-navigation-r4");R.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
rel="terminal/lib/__tests__/helpers/optionsExposureEvidence.ts";before=sha(E/rel)
assert before=="1a75aa7f5dc2f1ac2ba8c340085a10e53928010a8e84fde52c9bbb2275ebaf13"
head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=E,text=True).strip();assert head=="428fd8a845895f260c4da3f71916455c1fc35b0f"
checks=[]
for name,command in [
 ("unit",["./node_modules/.bin/vitest","run","lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts","lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts","lib/__tests__/optionsExposureEvidence.test.ts"]),
 ("lint",["./node_modules/.bin/eslint","lib/__tests__/helpers/optionsExposureEvidence.ts"])
]:
 log=R/(name+".log")
 with log.open("x") as out:r=subprocess.run(command,cwd=T,stdout=out,stderr=subprocess.STDOUT,timeout=300)
 text=re.sub(r"\x1b\[[0-9;]*m","",log.read_text())
 row={"check":name,"command":command,"exit":r.returncode,"log_sha256":sha(log),"passed":int(re.search(r"Tests\s+(\d+) passed",text).group(1)) if name=="unit" and re.search(r"Tests\s+(\d+) passed",text) else None}
 checks.append(row);print(json.dumps(row),flush=True)
 assert r.returncode==0 and (name!="unit" or row["passed"]==32)
assert sha(E/rel)==before
record={"schema":"exposure_shared_reader_revision.v1","local_parent":head, "last_published_parent":"4624a10e48b348b7298074d28cc26510fb1d6353","shared_reader_sha256":before,"new_combined_native_source_count":319,"revision":"options-navigation-r4","current_exposure_capture_profile_unchanged":True,"checks":checks,"source_stable":True,"completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
(R/"qualification.json").write_text(json.dumps(record,indent=2)+"\n")
print("EXPOSURE_READER_VERIFIED",flush=True)
