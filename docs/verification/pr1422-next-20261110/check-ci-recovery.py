from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4")
# Reuse the already-published passive observer and stale-owned-lock reconciliation.
shared=(repo/"docs/verification/pr1422-next-20261110/run-protected-portfolio.py").read_text()
prefix,marker,_=shared.partition("\nassert subprocess.check_output")
assert marker
exec(prefix,globals())
out=repo/"docs/verification/pr1422-next-20261110/ci-recovery"
t=repo/"terminal";head="1aec81f3c6d378cb9edc2b9ecb8bda5ff12a90df";port=34232
runtime=repo/".pr1422-qualification/runtime/node-v22.23.4-darwin-arm64/bin"
env={**os.environ,"PATH":str(runtime)+":"+os.environ["PATH"],"CI":"1","TERMINAL_E2E_PORT":str(port),"MMX_SHARED_SHELL":"0","MMX_INVESTOR_SHELL_PREVIEW":"0","PLAYWRIGHT_BROWSERS_PATH":str(Path.home()/"Library/Caches/ms-playwright"),"PLAYWRIGHT_JSON_OUTPUT_FILE":str(out/"rs-missing-chunk-report.json")}
assert subprocess.check_output(["git","rev-parse","HEAD"],cwd=repo,text=True).strip()==head
assert port_closed(port) and not (t/".next/dev/lock").exists()
def snapshot():
 p=subprocess.run(["node","-e","console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,env=env,capture_output=True,text=True)
 assert p.returncode==0,p.stderr;return json.loads(p.stdout)
steps=[
 ("bf08-reader",["node","node_modules/vitest/vitest.mjs","run","lib/__tests__/b_f08_8InvalidationEvidence.test.ts","--reporter=verbose"]),
 ("rs-lint",["node","node_modules/eslint/bin/eslint.js","e2e/rs-pivot-study.spec.ts"])
]
checks=[]
for name,command in steps:
 log=out/(name+".log");start=time.monotonic()
 with log.open("xb") as f:r=subprocess.run(command,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
 rec={"name":name,"command":command,"exit":r.returncode,"seconds":round(time.monotonic()-start,3),"logSha256":sha(log)}
 checks.append(rec);put(out/"focused-checks.json",checks);print(json.dumps(rec),flush=True)
 assert r.returncode==0
before=snapshot();put(out/"rs-source-before.json",before)
command=["node","node_modules/@playwright/test/cli.js","test","e2e/rs-pivot-study.spec.ts","--project=desktop","--project=tablet","--project=mobile","--workers=1","--retries=0","--reporter=list,json","--output="+str(repo/".pr1422-qualification/rs-missing-chunk-artifacts"),"--grep","^a missing study client chunk leaves the streamed action inert$"]
assert not(repo/".pr1422-qualification/rs-missing-chunk-artifacts").exists()
log=out/"rs-missing-chunk.log";start=time.monotonic();started=now()
with log.open("xb") as f:r=subprocess.run(command,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
after=snapshot();put(out/"rs-source-after.json",after)
rec={"sourceBase":head,"sourcePostimages":"rs-source-before.json","command":command,"exit":r.returncode,"seconds":round(time.monotonic()-start,3),"startedAt":started,"completedAt":now(),"port":port,"sourceStable":before==after,"sourceCount":len(before),"logSha256":sha(log)}
put(out/"rs-execution.json",rec)
if r.returncode:
 rec["qualification"]="FAILED_NO_EXTRA_RUNTIME_PROBE";put(out/"rs-execution.json",rec);print(json.dumps(rec),flush=True);raise SystemExit(r.returncode)
rec["lifecycle"]=reconcile_lock(port,"rs-missing-chunk")
rec["portClosed"]=port_closed(port);rec["nextLockAbsent"]=not(t/".next/dev/lock").exists()
report=json.loads((out/"rs-missing-chunk-report.json").read_text());rec["stats"]=report["stats"];rec["errors"]=report.get("errors",[])
put(out/"rs-execution.json",rec)
assert rec["sourceStable"] and rec["portClosed"] and rec["nextLockAbsent"] and not rec["errors"]
assert rec["stats"]["expected"]==3 and rec["stats"]["skipped"]==0 and rec["stats"]["unexpected"]==0 and rec["stats"]["flaky"]==0
print(json.dumps(rec),flush=True)
