from pathlib import Path
import subprocess,json,hashlib,gzip,os,sys,datetime,time
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");O=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");T=P/"terminal"
phase=sys.argv[1];assert phase in ["red","green"];R=W/("options-only-observer-"+phase+"-r4");assert not R.exists();R.mkdir()
tree="3406788889facc2d8e89b4730e1c66d2d975e115";combined="e0e001c553c7c9875e39bed4548e2e13a7fac90e"
sha=lambda b:hashlib.sha256(b).hexdigest();blob=lambda b:hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
def git(args,check=True):return subprocess.run(["git",*args],cwd=O,capture_output=True,check=check)
diff=git(["diff","--name-only",combined,tree,"--","terminal"]).stdout.decode().splitlines()
paths=[x for x in diff if not x.startswith(("terminal/docs/","terminal/design_refs/")) or (x.startswith("terminal/docs/pr-crops/") and len(x.split("/"))==5 and x.endswith("/EVIDENCE.yml"))]
assert len([x for x in paths if not x.startswith("terminal/docs/")])==6
rows=[]
for path in paths:
 p=P/path;before=p.read_bytes() if p.exists() else None;result=git(["show",tree+":"+path],False);assert result.returncode in [0,128]
 after=result.stdout if result.returncode==0 else None
 for label,raw in [("before",before),("projected",after)]:
  if raw is not None:
   q=R/label/path;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(raw)
 rows.append({"path":path,"before_sha256":sha(before) if before is not None else None,"projected_sha256":sha(after) if after is not None else None,"projected_git_blob":blob(after) if after is not None else None})
state={"schema":"options_independent_branch_reader_projection.v1","phase":phase,"state":"STAGED","base_options_tree":tree,"combined_tree":combined,"paths":rows,"effects":"Temporary non-Git preview projection; exact application/test files and native root manifests; unrelated retained proof files remain present but undeclared.","started_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
(R/"projection.json").write_text(json.dumps(state,indent=2)+"\n")
applied=[]
try:
 for row in rows:
  p=P/row["path"];raw=p.read_bytes() if p.exists() else None;assert (sha(raw) if raw is not None else None)==row["before_sha256"]
  if row["projected_sha256"] is None:p.unlink()
  else:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((R/"projected"/row["path"]).read_bytes())
  applied.append(row)
 state["state"]="APPLIED";(R/"projection.json").write_text(json.dumps(state,indent=2)+"\n")
 entries=git(["ls-tree","-rz",tree,"terminal"]).stdout.decode().split("\0")
 exceptions={"terminal/lib/__tests__/helpers/optionsExposureEvidence.ts","terminal/lib/__tests__/optionsExposureEvidence.test.ts"}
 verified={};candidate={}
 for item in entries:
  if not item:continue
  meta,path=item.split("\t",1);mode,kind,expected=meta.split(" ")
  if kind!="blob" or path.startswith(("terminal/docs/","terminal/design_refs/")):continue
  raw=(P/path).read_bytes();actual=blob(raw)
  if path in exceptions:candidate[path]={"git_tree_blob":expected,"candidate_git_blob":actual,"sha256":sha(raw)}
  else:assert actual==expected,path
  verified[path]=sha(raw)
 (R/"projected-source-map.json").write_text(json.dumps(verified,indent=2)+"\n");state.update(verified_tracked_files=len(verified),candidate_overlays=candidate)
 env=os.environ.copy();env.pop("CI",None);env["NODE_OPTIONS"]="--no-experimental-webstorage"
 cmd=["./node_modules/.bin/vitest","run","lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts","lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts","lib/__tests__/optionsExposureEvidence.test.ts","--maxWorkers=2","--minWorkers=1","--reporter=default","--reporter=json","--outputFile="+str(R/"unit-report.json")]
 begin=time.monotonic();p=subprocess.run(cmd,cwd=T,env=env,capture_output=True,text=True,timeout=180);raw=(p.stdout+p.stderr).encode()
 (R/"unit.log.gz").write_bytes(gzip.compress(raw,mtime=0));report=json.loads((R/"unit-report.json").read_text());(R/"unit-report.json.gz").write_bytes(gzip.compress((R/"unit-report.json").read_bytes(),mtime=0))
 failures=[{"title":a["fullName"],"messages":a["failureMessages"]} for suite in report["testResults"] for a in suite["assertionResults"] if a["status"]=="failed"]
 state.update(exit=p.returncode,seconds=round(time.monotonic()-begin,3),passed=report["numPassedTests"],failed=report["numFailedTests"],pending=report["numPendingTests"],failures=failures,command=cmd,raw_log_sha256=sha(raw))
 print("RESULT",json.dumps({k:state[k] for k in ["phase","exit","seconds","passed","failed","pending","failures"]}),flush=True)
finally:
 for row in reversed(applied):
  p=P/row["path"];raw=p.read_bytes() if p.exists() else None;assert (sha(raw) if raw is not None else None)==row["projected_sha256"],"PROJECTION_DRIFT:"+row["path"]
  if row["before_sha256"] is None:p.unlink()
  else:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((R/"before"/row["path"]).read_bytes())
 for row in rows:
  p=P/row["path"];raw=p.read_bytes() if p.exists() else None;assert (sha(raw) if raw is not None else None)==row["before_sha256"]
 state.update(state="RESTORED",owned_source_restored=True,completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
 (R/"projection.json").write_text(json.dumps(state,indent=2)+"\n");print("SOURCE_RESTORED",phase,flush=True)
if phase=="green":assert state["exit"]==0 and state["failed"]==state["pending"]==0
else:assert state["exit"]!=0 and state["failed"]>0
