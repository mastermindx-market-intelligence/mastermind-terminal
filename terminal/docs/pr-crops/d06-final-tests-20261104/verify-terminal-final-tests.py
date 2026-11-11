from pathlib import Path
import subprocess,json,hashlib,time,datetime
r=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/d06-terminal-reader-resilience-20261103-c4")
app=r/"terminal";t=Path("/tmp/d06-macro-c4-11l44i0i")
paths=["terminal/e2e/portfolio-event-refresh.spec.ts","terminal/e2e/shell-mode.spec.ts","terminal/lib/__tests__/eventImpactPanelRefresh.test.tsx","terminal/playwright.config.ts","terminal/e2e/globalSetup.ts","terminal/e2e/fixtureWarmup.cjs"]
before={p:hashlib.sha256((r/p).read_bytes()).hexdigest() for p in paths}
runs=[]
for name,cmd in [("event-refresh-units",["npm","test","--","lib/__tests__/eventImpactPanelRefresh.test.tsx"]),("focused-lint",["npx","--no-install","eslint","e2e/portfolio-event-refresh.spec.ts","e2e/shell-mode.spec.ts"])]:
 start=time.monotonic()
 with (t/("terminal-"+name+".log")).open("w") as f:ret=subprocess.run(cmd,cwd=app,stdout=f,stderr=subprocess.STDOUT)
 runs.append({"name":name,"command":cmd,"exit_code":ret.returncode,"seconds":round(time.monotonic()-start,2),"log":"terminal-"+name+".log"})
 print(json.dumps(runs[-1]),flush=True)
 if ret.returncode:break
after={p:hashlib.sha256((r/p).read_bytes()).hexdigest() for p in paths}
receipt={"schema":"d06.terminal_final_test_checks.v1","verified_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source_parent":subprocess.check_output(["git","rev-parse","HEAD"],cwd=r,text=True).strip(),"source_before":before,"source_after":after,"source_stable":before==after,"runs":runs}
(t/"terminal-final-test-checks.json").write_text(json.dumps(receipt,indent=2)+"\n")
assert before==after and len(runs)==2 and all(x["exit_code"]==0 for x in runs)
