from pathlib import Path
import subprocess,json,hashlib,gzip,os,time,datetime
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");roots={"original":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3"),"exposure":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3"),"preview":Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree")};R=W/"final-observer-binding-gates-r4"
assert not R.exists();assert json.loads((W/"options-only-observer-green-r4/projection.json").read_text())["state"]=="RESTORED";R.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def sources(root):
 T=root/"terminal";paths=[p for folder in ["app","components","lib","e2e"] for p in (T/folder).rglob("*") if p.is_file()]
 paths += [T/n for n in ["package.json","package-lock.json","next.config.ts","playwright.config.ts","tsconfig.json","next-env.d.ts","proxy.ts","vitest.config.ts"] if (T/n).exists()]
 return {str(p.relative_to(root)):sha(p) for p in sorted(paths)}
before={tag:sources(root) for tag,root in roots.items()}
for tag,m in before.items():(R/(tag+"-source-before.json")).write_text(json.dumps(m,indent=2)+"\n")
env=os.environ.copy();env.pop("CI",None);env["NODE_OPTIONS"]="--no-experimental-webstorage";checks=[]
prior=json.loads((W/"final-repaired-gates-r4/qualification.json").read_text());current=json.loads((W/"current-master-final-gates-r4-v2/qualification.json").read_text())
jobs=[]
for tag in ["original","exposure","preview"]:
 if tag=="preview":cmd=list(current["checks"][0]["command"])
 else:cmd=list(next(x["command"] for x in prior["checks"] if x["profile"]==tag and x["check"]=="focused-unit"))
 cmd=[("--outputFile="+str(R/(tag+"-unit-report.json"))) if x.startswith("--outputFile=") else x for x in cmd]
 jobs.append((tag,"unit",cmd,180))
jobs.append(("preview","typecheck",["./node_modules/.bin/tsc","--noEmit","--incremental","false"],240))
jobs.append(("original","lint",["./node_modules/.bin/eslint","lib/__tests__/helpers/optionsExposureEvidence.ts","lib/__tests__/optionsExposureEvidence.test.ts","--max-warnings=0"],120))
for tag,check,command,timeout in jobs:
 print("START",tag,check,flush=True);begin=time.monotonic()
 p=subprocess.run(command,cwd=roots[tag]/"terminal",env=env,capture_output=True,text=True,timeout=timeout);raw=(p.stdout+p.stderr).encode()
 log=R/(tag+"-"+check+".log.gz");log.write_bytes(gzip.compress(raw,mtime=0))
 row={"profile":tag,"check":check,"exit":p.returncode,"seconds":round(time.monotonic()-begin,3),"command":command,"raw_log_sha256":hashlib.sha256(raw).hexdigest(),"gzip_sha256":sha(log)}
 if check=="unit":
  q=R/(tag+"-unit-report.json");d=json.loads(q.read_text());(R/(tag+"-unit-report.json.gz")).write_bytes(gzip.compress(q.read_bytes(),mtime=0));row["summary"]={k:d[k] for k in ["numTotalTests","numPassedTests","numFailedTests","numPendingTests","numTodoTests","success"]}
 checks.append(row);(R/"checks.json").write_text(json.dumps(checks,indent=2)+"\n");print("RESULT",json.dumps(row),flush=True)
 if p.returncode:print(raw.decode()[-5000:],flush=True);break
after={tag:sources(root) for tag,root in roots.items()}
for tag,m in after.items():(R/(tag+"-source-after.json")).write_text(json.dumps(m,indent=2)+"\n")
result={"schema":"options_observer_binding_final_gates.v1","completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"checks":checks,"source_stable":before==after,"all_passed":len(checks)==5 and all(x["exit"]==0 for x in checks),"runtime_unchanged":True,"source_change":"Evidence reader compatibility and regression tests only."}
(R/"qualification.json").write_text(json.dumps(result,indent=2)+"\n");print("QUALIFICATION",json.dumps(result),flush=True);assert result["all_passed"] and result["source_stable"]
