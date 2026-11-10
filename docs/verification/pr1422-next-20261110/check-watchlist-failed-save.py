from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4")
shared=(repo/"docs/verification/pr1422-next-20261110/run-protected-portfolio.py").read_text()
prefix,marker,_=shared.partition("\nassert subprocess.check_output");assert marker
exec(prefix,globals())
out=repo/"docs/verification/pr1422-next-20261110/ci-recovery/watchlist-repro"
prior=json.loads((out/"execution.json").read_text());log=(out/"browser.log").read_text()
assert prior["exit"]==1 and prior["sourceStable"] and prior["stats"]["unexpected"]==1
assert 'Received: "synced"' in log and not any(s in log for s in ["EPERM","EACCES","permission denied"])
lifecycle=reconcile_lock(34234,"watchlist-repro")
put(out/"reconciliation.json",{"outcome":"REPRODUCED_ORIGINAL_EXPECTED_RETRYING_BUT_SYNCED","lifecycle":lifecycle,"no_cases_qualified":True,"source_unchanged_during_reproduction":True})
out=repo/"docs/verification/pr1422-next-20261110/ci-recovery/watchlist-fixed";out.mkdir(exist_ok=False)
t=repo/"terminal";head="1aec81f3c6d378cb9edc2b9ecb8bda5ff12a90df";port=34235
runtime=repo/".pr1422-qualification/runtime/node-v22.23.4-darwin-arm64/bin"
env={**os.environ,"PATH":str(runtime)+":"+os.environ["PATH"],"CI":"1","TERMINAL_E2E_PORT":str(port),"MMX_SHARED_SHELL":"0","MMX_INVESTOR_SHELL_PREVIEW":"0","PLAYWRIGHT_BROWSERS_PATH":str(Path.home()/"Library/Caches/ms-playwright"),"PLAYWRIGHT_JSON_OUTPUT_FILE":str(out/"report.json")}
assert subprocess.check_output(["git","rev-parse","HEAD"],cwd=repo,text=True).strip()==head
assert port_closed(port) and not(t/".next/dev/lock").exists()
def snapshot():
 p=subprocess.run(["node","-e","console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,env=env,capture_output=True,text=True)
 assert p.returncode==0,p.stderr;return json.loads(p.stdout)
cmd=["node","node_modules/eslint/bin/eslint.js","e2e/watchlist-annotation-sync.spec.ts"]
with (out/"lint.log").open("xb") as f:p=subprocess.run(cmd,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
put(out/"lint.json",{"command":cmd,"exit":p.returncode});assert p.returncode==0
before=snapshot();put(out/"source-before.json",before)
command=["node","node_modules/@playwright/test/cli.js","test","e2e/watchlist-annotation-sync.spec.ts","--project=desktop","--project=tablet","--project=mobile","--workers=1","--retries=0","--reporter=list,json","--trace=on","--output="+str(repo/".pr1422-qualification/watchlist-failed-save-fixed"),"--grep","a failed save never shows Synced and never overwrites the local edit$"]
assert not(repo/".pr1422-qualification/watchlist-failed-save-fixed").exists()
log=out/"browser.log";start=time.monotonic();started=now()
with log.open("xb") as f:r=subprocess.run(command,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
after=snapshot();put(out/"source-after.json",after)
rec={"sourceBase":head,"command":command,"exit":r.returncode,"seconds":round(time.monotonic()-start,3),"startedAt":started,"completedAt":now(),"port":port,"sourceStable":before==after,"sourceCount":len(before),"logSha256":sha(log)}
report=json.loads((out/"report.json").read_text());rec["stats"]=report["stats"];rec["errors"]=report.get("errors",[])
put(out/"execution.json",rec)
if r.returncode:
 rec["qualification"]="FAILED_NO_EXTRA_RUNTIME_PROBE";put(out/"execution.json",rec);print(json.dumps(rec),flush=True);raise SystemExit(r.returncode)
rec["lifecycle"]=reconcile_lock(port,"watchlist-fixed");rec["portClosed"]=port_closed(port);rec["nextLockAbsent"]=not(t/".next/dev/lock").exists()
put(out/"execution.json",rec)
assert rec["sourceStable"] and rec["portClosed"] and rec["nextLockAbsent"] and not rec["errors"]
assert rec["stats"]["expected"]==3 and rec["stats"]["skipped"]==rec["stats"]["unexpected"]==rec["stats"]["flaky"]==0
print(json.dumps(rec),flush=True)
