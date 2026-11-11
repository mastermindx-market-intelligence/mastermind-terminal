from pathlib import Path
import subprocess,json,hashlib,gzip,time,datetime
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");T=P/"terminal";R=W/"current-master-final-gates-r4";assert not R.exists();R.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def sources():
 paths=[p for n in ["app","components","lib","e2e"] for p in (T/n).rglob("*") if p.is_file()]
 paths += [T/x for x in ["package.json","package-lock.json","tsconfig.json","next.config.ts","playwright.config.ts","next-env.d.ts","vitest.config.ts","proxy.ts"] if (T/x).exists()]
 paths += [P/x for x in ["ingest/pull_macro_risk.py","tests/test_market_risk_bridge.py","tests/test_market_risk_envelope_market.py"]]
 return {str(p.relative_to(P)):sha(p) for p in sorted(paths)}
before=sources();(R/"source-before.json").write_text(json.dumps(before,indent=2)+"\n")
prior=json.loads((W/"final-repaired-gates-r4/qualification.json").read_text())
cmd=next(x["command"] for x in prior["checks"] if x["profile"]=="preview" and x["check"]=="focused-unit")
files=cmd[2:cmd.index("--maxWorkers=4")]
extra=["lib/__tests__/marketRiskMarketScope.test.tsx","lib/__tests__/marketRisk.test.ts","lib/__tests__/earningsExpectationBoundary.test.tsx","lib/__tests__/eventWorkspace.test.ts"]
assert all((T/x).exists() for x in extra);files=list(dict.fromkeys(files+extra))
jobs=[("unit",["./node_modules/.bin/vitest","run",*files,"--maxWorkers=4","--minWorkers=2","--reporter=default","--reporter=json","--outputFile="+str(R/"unit-report.json")],T,180),("typecheck",["./node_modules/.bin/tsc","--noEmit","--incremental","false"],T,240),("python",["python3","-m","pytest","tests/test_market_risk_envelope_market.py","tests/test_market_risk_bridge.py","-q","--tb=short","-p","no:cacheprovider"],P,180)]
checks=[]
for name,command,cwd,timeout in jobs:
 start=time.monotonic();print("START",name,flush=True)
 p=subprocess.run(command,cwd=cwd,capture_output=True,text=True,timeout=timeout)
 raw=(p.stdout+p.stderr).encode();(R/(name+".log.gz")).write_bytes(gzip.compress(raw,mtime=0))
 row={"check":name,"exit":p.returncode,"seconds":round(time.monotonic()-start,3),"command":command,"raw_log_sha256":hashlib.sha256(raw).hexdigest(),"compressed_log_sha256":sha(R/(name+".log.gz"))}
 if name=="unit":
  report=json.loads((R/"unit-report.json").read_text());row["summary"]={k:report[k] for k in ["numTotalTests","numPassedTests","numFailedTests","numPendingTests","numTodoTests","success"]}
  (R/"unit-report.json.gz").write_bytes(gzip.compress((R/"unit-report.json").read_bytes(),mtime=0))
 if name=="python":row["summary"]=raw.decode().strip()[-1200:]
 checks.append(row);(R/"checks.json").write_text(json.dumps(checks,indent=2)+"\n");print("RESULT",json.dumps(row),flush=True)
 if p.returncode:print(raw.decode()[-6000:],flush=True);break
after=sources();(R/"source-after.json").write_text(json.dumps(after,indent=2)+"\n")
result={"schema":"options_current_master_final_gates.v1","base":"acd173eae60e1559c87603aee8fa70e35e661b65","combined_tree":"76427bdc7a98c00f0936eca9641ac444a040b8ab","completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"checks":checks,"source_count":len(before),"source_stable":before==after,"all_passed":len(checks)==3 and all(x["exit"]==0 for x in checks),"scope":"Exact current protected delta plus existing affected Options/Exposure suites; historical captures remain unchanged."}
(R/"qualification.json").write_text(json.dumps(result,indent=2)+"\n");print("QUALIFICATION",json.dumps(result),flush=True)
assert result["all_passed"] and result["source_stable"]
