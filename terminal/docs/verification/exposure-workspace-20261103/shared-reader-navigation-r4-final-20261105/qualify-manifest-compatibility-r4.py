from pathlib import Path
import datetime,gzip,hashlib,json,os,re,subprocess
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");R=W/"reader-root-compatibility-r4";assert not R.exists();R.mkdir()
roots={"original":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3"),"preview":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree"),"exposure":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
expected={"original":41,"preview":51,"exposure":38}
native=["lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts","lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts","lib/__tests__/optionsExposureEvidence.test.ts"]
visual=["lib/__tests__/visualIntelligenceEvidence.test.ts","lib/__tests__/b_pl_6Batch1Evidence.test.ts"]
env=os.environ.copy();env.pop("CI",None);env["NODE_OPTIONS"]="--no-experimental-webstorage";records=[]
for name,root in roots.items():
 d=R/name;d.mkdir();files=["terminal/lib/__tests__/helpers/optionsExposureEvidence.ts","terminal/lib/__tests__/optionsExposureEvidence.test.ts"]+([] if name=="exposure" else ["terminal/lib/__tests__/helpers/optionsVisualEvidence.ts"])
 before={rel:sha(root/rel) for rel in files}
 for kind,cmd in [
  ("unit",["./node_modules/.bin/vitest","run",*native,*([] if name=="exposure" else visual)]),
  ("lint",["./node_modules/.bin/eslint",*[rel.removeprefix("terminal/") for rel in files]])]:
  log=d/(kind+".log")
  with log.open("x") as out:result=subprocess.run(cmd,cwd=root/"terminal",env=env,stdout=out,stderr=subprocess.STDOUT,timeout=240)
  text=re.sub(r"\x1b\[[0-9;]*m","",log.read_text());match=re.search(r"Tests\s+(\d+) passed",text);passed=int(match.group(1)) if match else None
  row={"profile":name,"check":kind,"command":cmd,"exit":result.returncode,"passed":passed,"log_sha256":sha(log)}
  records.append(row);(d/(kind+".log.gz")).write_bytes(gzip.compress(log.read_bytes(),mtime=0))
  assert gzip.decompress((d/(kind+".log.gz")).read_bytes())==log.read_bytes()
  print("EVIDENCE_CHECK",json.dumps(row),flush=True)
 after={rel:sha(root/rel) for rel in files};assert before==after
 (d/"source-sha256.json").write_text(json.dumps(after,indent=2)+"\n")
record={"schema":"options_r4_evidence_consumers.v1","completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"checks":records,"expected_passed":expected,"source_stable":True,"native_capture_count":240,"visual_browser_count":30,"supplemental_native_visual_count":24,"old_packets_retained":True}
(R/"qualification.json").write_text(json.dumps(record,indent=2)+"\n")
assert all(row["exit"]==0 and (row["check"]!="unit" or row["passed"]==expected[row["profile"]]) for row in records),"EVIDENCE_CONSUMERS_REQUIRE_RECONCILIATION"
print("ALL_R4_EVIDENCE_CONSUMERS_QUALIFIED",flush=True)
