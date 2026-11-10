from pathlib import Path
import datetime,gzip,hashlib,json,os,re,subprocess,time
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");R=W/"final-repaired-gates-r4";assert not R.exists();R.mkdir();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
roots={"original":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3"),"preview":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree"),"exposure":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")}
native=["gexLevelsHeatmapLoadFailureEvidence","eodHeatmapFlowdeskLoadFailureEvidence","optionsExposureEvidence"]
more=["visualIntelligenceEvidence","b_pl_6Batch1Evidence","b_f11_10AnalysisThesesEntryEvidence","exposureMapPrimitive","exposureMap","exposureWorkspace"]
jsx=["sharedShellLoginDefault","frozenNodeEntryView","researchLabSourceAvailability","researchLabAdmission"]
env=os.environ.copy();env.pop("CI",None);env["NODE_OPTIONS"]="--no-experimental-webstorage";checks=[]
for mode,root in roots.items():
 T=root/"terminal";d=R/mode;d.mkdir();paths=[p for folder in ["app","components","lib","e2e"] for p in (T/folder).rglob("*") if p.is_file()]+[T/n for n in ["package.json","package-lock.json","next.config.ts","playwright.config.ts","tsconfig.json","next-env.d.ts","proxy.ts","vitest.config.ts"] if (T/n).exists()]
 before={str(p.relative_to(root)):sha(p) for p in sorted(paths)};(d/"source-before.json").write_text(json.dumps(before,indent=2)+"\n")
 suites=["lib/__tests__/"+n+".test.ts" for n in native+(more if mode!="exposure" else ["exposureMapPrimitive","exposureMap","exposureWorkspace"])]+["lib/__tests__/"+n+".test.tsx" for n in jsx]
 commands=[("focused-unit",["./node_modules/.bin/vitest","run",*suites,"--maxWorkers=4","--minWorkers=2","--reporter=default","--reporter=json","--outputFile="+str(d/"unit-report.json")],240),("typecheck",["./node_modules/.bin/tsc","--noEmit","--incremental","false"],600)]
 for name,command,timeout in commands:
  log=d/(name+".log");start=time.monotonic();print("REPAIRED_GATE_START",mode,name,flush=True)
  with log.open("x") as out:result=subprocess.run(command,cwd=T,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=timeout)
  row={"profile":mode,"check":name,"exit":result.returncode,"seconds":round(time.monotonic()-start,3),"command":command,"log_sha256":sha(log)}
  if name=="focused-unit":
   report=json.loads((d/"unit-report.json").read_text());row["summary"]={k:report.get(k) for k in ["success","numTotalTests","numPassedTests","numFailedTests","numPendingTests","numTodoTests"]}
  (d/(name+".log.gz")).write_bytes(gzip.compress(log.read_bytes(),mtime=0));checks.append(row);(R/"checks.json").write_text(json.dumps(checks,indent=2)+"\n");print("REPAIRED_GATE_RESULT",json.dumps(row),flush=True)
 after={str(p.relative_to(root)):sha(p) for p in sorted(paths)};assert before==after;(d/"source-after.json").write_text(json.dumps(after,indent=2)+"\n")
record={"schema":"options_repaired_final_gates.v1","completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"checks":checks,"source_stable":True,"all_passed":all(c["exit"]==0 for c in checks)};(R/"qualification.json").write_text(json.dumps(record,indent=2)+"\n");print("REPAIRED_FINAL",json.dumps(record),flush=True)
assert record["all_passed"],"REPAIRED_GATES_REQUIRE_RECONCILIATION"
