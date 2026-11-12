from pathlib import Path
import base64,datetime,hashlib,json,os,socket,subprocess,time
ROOT=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1419-mobile-readiness-web4")
OUT=ROOT/"docs/verification/pr1419-mobile-readiness-20261110"
TERM=ROOT/"terminal"
NODEBIN=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4/.pr1422-qualification/runtime/node-v22.23.4-darwin-arm64/bin")
PORT=47279
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def put(name,data):(OUT/name).write_text(json.dumps(data,indent=2)+"\n")
def git(*args):return subprocess.run(["git","-C",str(ROOT),*args],capture_output=True,text=True,check=True).stdout.strip()
assert git("rev-parse","HEAD")=="ceab6184a492911b1dd224430b1c6a0e66f9b0a2"
deps=json.loads((OUT/"dependencies.json").read_text())
assert deps["exit"]==0 and deps["lockBefore"]==deps["lockAfter"]
env=os.environ.copy()
env.update({"PATH":str(NODEBIN)+os.pathsep+env["PATH"],"CI":"1","NEXT_PUBLIC_SECTOR_DEPTH":"1","TERMINAL_E2E_PORT":str(PORT),"PLAYWRIGHT_BROWSERS_PATH":"/Users/chriswong/Library/Caches/ms-playwright","PLAYWRIGHT_JSON_OUTPUT_NAME":str(OUT/"browser-report.json")})
def port_open():
    with socket.socket() as s:
        s.settimeout(1);return s.connect_ex(("127.0.0.1",PORT))==0
assert not port_open(),"Owned proof port is already listening; no reuse or signal"
tracked=subprocess.run(["git","-C",str(ROOT),"ls-files","-z"],capture_output=True,check=True).stdout.decode().split("\0")
sources=[p for p in tracked if p.startswith("terminal/") and Path(p).suffix in {".ts",".tsx",".js",".jsx",".cjs",".mjs",".css",".json",".yml",".yaml"} and not p.startswith("terminal/public/data/")]
def snapshot():
    return {p:sha((ROOT/p).read_bytes()) if (ROOT/p).is_file() else None for p in sources}
generated={p:(TERM/p).read_bytes() if (TERM/p).exists() else None for p in ("next-env.d.ts","tsconfig.json")}
put("generated-preimages.json",{p:{"sha256":sha(b) if b is not None else None,"base64":base64.b64encode(b).decode() if b is not None else None} for p,b in generated.items()})
proof_files=list((TERM/"e2e/proof/sector-retained-depth").glob("*.png"))
proof_before={str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in proof_files}
before=snapshot();put("source-before.json",before);put("proof-before.json",proof_before)
selector="calls contract board: keyboard show-more and trace disclosure|navigation out flows through the onNavigate callback with the exact href|emergence mark: owner-carried flag renders the R6-09 chip, copy and evidence link"
cmd=[str(NODEBIN/"node"),"node_modules/@playwright/test/cli.js","test","e2e/sector-retained-depth.spec.ts","--project=desktop","--project=tablet","--project=mobile","--workers=1","--retries=0","--grep",selector,"--reporter=json","--output="+str(OUT/"browser-artifacts")]
state={"base":git("rev-parse","HEAD"),"startedAt":now(),"phase":"STARTING","command":cmd,"port":PORT,"sourceCount":len(before),"sourceSpecSha256":sha((TERM/"e2e/sector-retained-depth.spec.ts").read_bytes()),"configuration":"Unchanged committed playwright.config.ts and globalSetup.ts","newRetries":0}
put("execution.json",state)
def table():
    p=subprocess.run(["ps","-axo","pid=,ppid=,pgid="],capture_output=True,text=True,check=True)
    return [tuple(map(int,line.split())) for line in p.stdout.splitlines() if len(line.split())==3]
groups=set();observed_pids=set();start=time.monotonic()
with (OUT/"browser.log").open("wb") as log:
    proc=subprocess.Popen(cmd,cwd=TERM,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    state.update({"phase":"RUNNING","pid":proc.pid,"pgid":os.getpgid(proc.pid)})
    groups.add(state["pgid"]);put("execution.json",state)
    while proc.poll() is None:
        rows=table();desc={proc.pid}
        while True:
            child={pid for pid,ppid,pgid in rows if ppid in desc}
            new=child-desc
            if not new:break
            desc|=new
        observed_pids|=desc
        groups|={pgid for pid,ppid,pgid in rows if pid in desc}
        if time.monotonic()-start>900:
            state.update({"phase":"EXECUTION_STILL_RUNNING_NO_REPLAY","observedAt":now(),"observedGroups":sorted(groups),"observedPids":sorted(observed_pids)})
            put("execution.json",state)
            raise SystemExit(12)
        time.sleep(1)
    state.update({"phase":"BROWSER_RETURNED","browserExit":proc.returncode,"durationSeconds":round(time.monotonic()-start,3),"browserCompletedAt":now()})
put("execution.json",state)
raw_after=snapshot();put("source-after-before-generated-restoration.json",raw_after)
restored=[]
for p,b in generated.items():
    path=TERM/p
    current=path.read_bytes() if path.exists() else None
    if current!=b:
        restored.append({"path":"terminal/"+p,"generatedSha256":sha(current) if current is not None else None,"restoredSha256":sha(b) if b is not None else None})
        if b is None:path.unlink()
        else:path.write_bytes(b)
after=snapshot();put("source-after.json",after)
rows=table()
remaining=[{"pid":pid,"ppid":ppid,"pgid":pgid} for pid,ppid,pgid in rows if pgid in groups]
closure={"observedGroups":sorted(groups),"observedPids":sorted(observed_pids),"remaining":remaining,"groupsAbsent":not remaining,"portListeningAfter":port_open(),"noSignalsSent":True}
put("lifecycle.json",closure)
put("generated-restoration.json",restored)
proof_after={str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in proof_files};put("proof-after.json",proof_after)
with (OUT/"lint.log").open("wb") as log:
    lint=subprocess.run([str(NODEBIN/"node"),"node_modules/eslint/bin/eslint.js","e2e/sector-retained-depth.spec.ts"],cwd=TERM,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180)
diff=subprocess.run(["git","-C",str(ROOT),"diff","--check","--","terminal/e2e/sector-retained-depth.spec.ts"],capture_output=True,text=True)
(OUT/"diff-check.log").write_text(diff.stdout+diff.stderr)
report=json.loads((OUT/"browser-report.json").read_text())
cases=[]
def visit(suite,prefix=""):
    for spec in suite.get("specs",[]):
        for test in spec.get("tests",[]):
            cases.append({"title":spec["title"],"project":test["projectName"],"status":test["status"],"results":[{"status":r["status"],"retry":r.get("retry"),"duration":r["duration"],"errors":r.get("errors",[])} for r in test.get("results",[])]})
    for sub in suite.get("suites",[]):visit(sub)
for suite in report.get("suites",[]):visit(suite)
stats=report.get("stats",{})
qualification={"base":state["base"],"productionSourceChanged":False,"sourceCount":len(before),"sourceStable":before==after,"generatedRestoration":restored,"browserExit":proc.returncode,"browserDurationSeconds":state["durationSeconds"],"stats":stats,"cases":cases,"lintExit":lint.returncode,"diffCheckExit":diff.returncode,"lifecycle":closure,"proofChanged":[p for p in proof_before if proof_before[p]!=proof_after[p]],"completedAt":now()}
qualification["qualified"]=proc.returncode==0 and before==after and lint.returncode==0 and diff.returncode==0 and not remaining and not closure["portListeningAfter"] and len(cases)==9 and all(t["status"]=="expected" and len(t["results"])==1 and t["results"][0]["status"]=="passed" for t in cases) and stats.get("expected")==9 and all(stats.get(k,0)==0 for k in ("unexpected","flaky","skipped"))
put("QUALIFICATION.json",qualification)
state.update({"phase":"QUALIFIED" if qualification["qualified"] else "QUALIFICATION_FAILED","observerCompletedAt":now()});put("execution.json",state)
(OUT/"qualify.py").write_bytes(Path(__file__).read_bytes())
print(json.dumps({k:qualification[k] for k in ("qualified","browserDurationSeconds","stats","sourceCount","sourceStable","lintExit","diffCheckExit","lifecycle","proofChanged")}),flush=True)
raise SystemExit(0 if qualification["qualified"] else 1)
