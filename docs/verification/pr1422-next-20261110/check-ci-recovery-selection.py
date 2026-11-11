from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4")
# Reuse the already-published passive observer and stale-owned-lock reconciliation.
shared=(repo/"docs/verification/pr1422-next-20261110/run-protected-portfolio.py").read_text()
prefix,marker,_=shared.partition("\nassert subprocess.check_output")
assert marker
exec(prefix,globals())
out=repo/"docs/verification/pr1422-next-20261110/ci-recovery"
t=repo/"terminal";head="1aec81f3c6d378cb9edc2b9ecb8bda5ff12a90df";port=34233
runtime=repo/".pr1422-qualification/runtime/node-v22.23.4-darwin-arm64/bin"
env={**os.environ,"PATH":str(runtime)+":"+os.environ["PATH"],"CI":"1","TERMINAL_E2E_PORT":str(port),"MMX_SHARED_SHELL":"0","MMX_INVESTOR_SHELL_PREVIEW":"0","PLAYWRIGHT_BROWSERS_PATH":str(Path.home()/"Library/Caches/ms-playwright"),"PLAYWRIGHT_JSON_OUTPUT_FILE":str(out/"rs-missing-chunk-r2-report.json")}
assert subprocess.check_output(["git","rev-parse","HEAD"],cwd=repo,text=True).strip()==head
def snapshot():
 p=subprocess.run(["node","-e","console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,env=env,capture_output=True,text=True)
 assert p.returncode==0,p.stderr;return json.loads(p.stdout)
prior=json.loads((out/"rs-execution.json").read_text())
prior_log=(out/"rs-missing-chunk.log").read_text()
assert prior["exit"]==1 and prior["sourceStable"] and "Error: No tests found." in prior_log
assert not any(x in prior_log for x in ["EPERM","EACCES","permission denied"])
accepted=json.loads((out/"focused-checks.json").read_text())
assert len(accepted)==2 and all(x["exit"]==0 for x in accepted)
reconciled=reconcile_lock(34232,"rs-selection-r1")
put(out/"rs-selection-reconciliation.json",{"originalExit":1,"originalCaseCount":0,"reason":"The start-anchored grep did not match Playwright's full project/file/test title. No test case executed.","originalSourceStable":True,"originalLifecycle":reconciled,"change":"Remove only the start anchor; retain the exact title suffix, original test code and zero retries.","acceptedChecksReused":accepted})
assert port_closed(port) and not(t/".next/dev/lock").exists()
before=snapshot();put(out/"rs-r2-source-before.json",before)
command=["node","node_modules/@playwright/test/cli.js","test","e2e/rs-pivot-study.spec.ts","--project=desktop","--project=tablet","--project=mobile","--workers=1","--retries=0","--reporter=list,json","--output="+str(repo/".pr1422-qualification/rs-missing-chunk-r2-artifacts"),"--grep","a missing study client chunk leaves the streamed action inert$"]
assert not(repo/".pr1422-qualification/rs-missing-chunk-r2-artifacts").exists()
log=out/"rs-missing-chunk-r2.log";start=time.monotonic();started=now()
with log.open("xb") as f:r=subprocess.run(command,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
after=snapshot();put(out/"rs-r2-source-after.json",after)
rec={"sourceBase":head,"sourcePostimages":"rs-r2-source-before.json","command":command,"exit":r.returncode,"seconds":round(time.monotonic()-start,3),"startedAt":started,"completedAt":now(),"port":port,"sourceStable":before==after,"sourceCount":len(before),"logSha256":sha(log)}
put(out/"rs-r2-execution.json",rec)
if r.returncode:
 rec["qualification"]="FAILED_NO_EXTRA_RUNTIME_PROBE";put(out/"rs-r2-execution.json",rec);print(json.dumps(rec),flush=True);raise SystemExit(r.returncode)
rec["lifecycle"]=reconcile_lock(port,"rs-missing-chunk-r2")
rec["portClosed"]=port_closed(port);rec["nextLockAbsent"]=not(t/".next/dev/lock").exists()
report=json.loads((out/"rs-missing-chunk-r2-report.json").read_text());rec["stats"]=report["stats"];rec["errors"]=report.get("errors",[])
put(out/"rs-r2-execution.json",rec)
assert rec["sourceStable"] and rec["portClosed"] and rec["nextLockAbsent"] and not rec["errors"]
assert rec["stats"]["expected"]==3 and rec["stats"]["skipped"]==0 and rec["stats"]["unexpected"]==0 and rec["stats"]["flaky"]==0
print(json.dumps(rec),flush=True)
