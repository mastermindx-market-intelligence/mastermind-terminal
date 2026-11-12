from pathlib import Path
import subprocess,json,hashlib,datetime,os,time,sys,shutil,socket
w=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-next-composition-web4")
t=w/"terminal";proof=w/"docs/verification/pr1275-next-composition-20261110"
head="360c3acf4396384c321df95fc442024ccff58b8e";tree="38a4df7b21280409adeebe8eabe715965fd23d1c";port=47285
node_root=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4/.pr1422-qualification/runtime/node-v22.23.4-darwin-arm64");node=node_root/"bin/node"
env={k:os.environ[k] for k in ["HOME","LANG","TMPDIR","TMP","TEMP"] if k in os.environ}
env.update(PATH=str(node_root/"bin")+":"+os.environ["PATH"],CI="1",PLAYWRIGHT_BROWSERS_PATH="/Users/chriswong/Library/Caches/ms-playwright",TERMINAL_CROP_PORT=str(port))
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def git(*args):return subprocess.check_output(["git","-C",str(w),*args],text=True).strip()
def save(name,data):(proof/name).write_text(json.dumps(data,indent=2,sort_keys=True)+"\n")
assert git("rev-parse","HEAD")==head and git("rev-parse","HEAD^{tree}")==tree
assert git("show","-s","--format=%P",head).split()==["6ddc6b49695ef98e6a10bcd6bf41af39f36b8b34","b5afc7eca5c37b3e2eee25871b764807203957a6"]
assert not git("diff","--name-only") and not git("diff","--cached","--name-only")
assert not proof.exists(),"EXISTING_QUALIFICATION_NO_REPLAY"
# The typed commit has positively settled. Clear only its stale local merge metadata if retained.
merge_head=subprocess.run(["git","-C",str(w),"rev-parse","--verify","MERGE_HEAD"],capture_output=True,text=True)
if merge_head.returncode==0:
 assert merge_head.stdout.strip()=="b5afc7eca5c37b3e2eee25871b764807203957a6"
 subprocess.run(["git","-C",str(w),"merge","--quit"],check=True)
proof.mkdir(parents=True)
shutil.copy2("/tmp/mastermind-terminal-pr1275-next-resolution-20261110.json",proof/"source-resolution.json")
shutil.copy2("/tmp/mastermind-terminal-pr1275-next-composition-20261110.json",proof/"merge-preparation.json")
shutil.copy2(__file__,proof/"run-qualification.py")
old=json.loads((w/"docs/verification/pr1275-drift-integration-20261110/QUALIFICATION.json").read_text())
paths=[x["path"] for x in old["sourceInputs"]]
oldmap={x["path"]:x for x in old["sourceInputs"]}
changed=[p for p in paths if sha(w/p)!=oldmap[p]["sha256"]]
assert changed==["terminal/lib/__tests__/productionTypeProject.test.ts","terminal/next.config.ts","terminal/package-lock.json"]
paths+=["terminal/package.json","terminal/lib/__tests__/nextConfigDevIndicator.test.ts"]
def fingerprints():return [{"path":p,"sha256":sha(w/p),"gitBlob":git("hash-object",p)} for p in paths]
before=fingerprints();assert len(before)==45
assert git("rev-parse",head+":terminal/e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs")=="64db6796786a706e9ae110c5e059eb8417613cb6"
assert sha(node)=="2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0"
active=t/"docs/pr-crops/b-f11-10-analysis-theses-entry";prior=proof/"prior-published-packet";prior.mkdir()
names=["desktop-en.png","desktop-zh.png","tablet-en.png","tablet-zh.png","mobile-en.png","mobile-zh.png","EVIDENCE.yml","FIXTURE.json"]
archive=[]
for name in names:
 p=active/name;shutil.copy2(p,prior/name);assert p.read_bytes()==(prior/name).read_bytes();archive.append({"path":name,"sha256":sha(p),"bytes":p.stat().st_size})
save("prior-published-packet.json",archive)
save("inputs-before.json",before)
state={"state":"SOURCE_QUALIFICATION_STARTED","sourceHead":head,"sourceTree":tree,"protectedBase":"b5afc7eca5c37b3e2eee25871b764807203957a6","startedAt":now(),"changedPriorInputs":changed,"observedInputs":45,"steps":[],"nodeVersion":subprocess.check_output([str(node),"--version"],text=True).strip(),"nodeSha256":sha(node)}
def run(name,cmd):
 record={"name":name,"command":cmd,"startedAt":now()};state["steps"].append(record);save("source-checks.json",state)
 start=time.monotonic()
 with (proof/(name+".log")).open("xb") as log:
  p=subprocess.Popen(cmd,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);record["pid"]=p.pid;save("source-checks.json",state);code=p.wait()
 record.update(exit=code,seconds=round(time.monotonic()-start,3),finishedAt=now(),logSha256=sha(proof/(name+".log")))
 if code:
  state["state"]="STEP_FAILED_NO_REPLAY";save("source-checks.json",state);raise SystemExit(code)
 try:os.killpg(p.pid,0)
 except ProcessLookupError:record["groupAbsent"]=True
 except PermissionError:
  record["groupObservation"]="DENIED";state["state"]="LIFECYCLE_OBSERVATION_DENIED_NO_REPLAY";save("source-checks.json",state);raise
 else:
  state["state"]="GROUP_REMAINS_NO_SIGNAL";save("source-checks.json",state);raise RuntimeError("GROUP_REMAINS")
 save("source-checks.json",state);print(json.dumps({"step":name,"exit":code,"seconds":record["seconds"]}),flush=True)
run("npm-ci",[str(node),str(node_root/"lib/node_modules/npm/bin/npm-cli.js"),"ci","--no-audit","--no-fund"])
assert fingerprints()==before
state["nextVersion"]=json.loads((t/"node_modules/next/package.json").read_text())["version"]
assert state["nextVersion"]=="16.4.6"
run("affected-config-tests",[str(node),"node_modules/vitest/vitest.mjs","run","lib/__tests__/productionTypeProject.test.ts","lib/__tests__/nextConfigDevIndicator.test.ts","--pool=forks","--maxWorkers=1","--minWorkers=1","--reporter=json","--outputFile="+str(proof/"affected-config-report.json")])
report=json.loads((proof/"affected-config-report.json").read_text());assert report["success"] and report["numPassedTests"]>0 and report["numFailedTests"]==report["numPendingTests"]==report["numTodoTests"]==0
state["tests"]={k:report[k] for k in ["numTotalTests","numPassedTests","numFailedTests","numPendingTests","numTodoTests","success"]}
run("affected-lint",[str(node),"node_modules/eslint/bin/eslint.js","next.config.ts","lib/__tests__/productionTypeProject.test.ts"])
assert fingerprints()==before
state.update(state="AFFECTED_SOURCE_QUALIFIED",sourceInputsUnchanged=True,finishedAt=now());save("source-checks.json",state)
# Original producer owns every server/browser/cleanup action; this finite caller only observes its return.
s=socket.socket();s.bind(("127.0.0.1",port));s.close()
next_env=t/"next-env.d.ts";preimage=sha(next_env)
save("preflight.json",{"head":head,"tree":tree,"port":port,"portBindBefore":"EXCLUSIVE_AVAILABLE","node":str(node),"nodeVersion":state["nodeVersion"],"nextVersion":state["nextVersion"],"nodeSha256":sha(node),"sourceInputs":before,"observedInputs":45,"priorObservedInputs":43,"changedFromPriorInputs":changed,"nextEnvPreimage":preimage,"producerUnchanged":True,"archivedPriorPacket":"prior-published-packet","at":now()})
command=[str(node),"e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs"];start=time.monotonic()
execution={"schema":"terminal.pr1275.f11-next-composition-execution.v1","state":"STARTED","sourceHead":head,"sourceTree":tree,"command":command,"cwd":str(t),"startedAt":now(),"port":port,"nextEnvPreimage":preimage,"node":state["nodeVersion"],"next":state["nextVersion"],"observer":"Finite caller; unchanged producer owns every browser/server and settlement."}
with (proof/"f11-capture.log").open("xb") as log:
 process=subprocess.Popen(command,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
 execution["producerPid"]=process.pid;save("execution.json",execution);print(json.dumps({"capture":"STARTED","pid":process.pid,"head":head,"port":port}),flush=True)
 code=process.wait()
execution.update(exitCode=code,finishedAt=now(),seconds=round(time.monotonic()-start,3),logSha256=sha(proof/"f11-capture.log"))
if code:
 execution.update(state="CAPTURE_FAILED_NO_REPLAY",runtimePostProbes="NOT_RUN: classify original return before any more runtime observation")
 save("execution.json",execution);print(json.dumps(execution),flush=True);raise SystemExit(code)
after=fingerprints();sock=socket.socket();sock.settimeout(1);closed=sock.connect_ex(("127.0.0.1",port));sock.close()
execution.update(state="CAPTURE_COMPLETED",sourceInputsUnchanged=before==after,nextEnvPostimage=sha(next_env),portConnectAfter=closed,trackedChanges=git("diff","--name-only").splitlines())
save("execution.json",execution);save("inputs-after-capture.json",after)
assert before==after and sha(next_env)==preimage and closed==61
assert set(execution["trackedChanges"])<={"terminal/docs/pr-crops/b-f11-10-analysis-theses-entry/"+n for n in names}
fixture=json.loads((active/"FIXTURE.json").read_text())
assert fixture["capturedAtHead"]==head and len(fixture["entryObservations"])==6
assert fixture["serverSettlement"]["allClosed"] and fixture["serverSettlement"]["allGroupsAbsent"] and fixture["generatedTypes"]["allRestored"]
assert len(fixture["fixtureSources"])==15 and all(sha(w/p)==h for p,h in fixture["fixtureSources"].items())
execution.update(state="CAPTURE_QUALIFIED_AWAITING_VISUAL_REVIEW",fixtureSha256=sha(active/"FIXTURE.json"),fixtureInputs=15,allSixSettled=True);save("execution.json",execution)
reader=[str(node),"node_modules/vitest/vitest.mjs","run","lib/__tests__/b_f11_10AnalysisThesesEntryEvidence.test.ts","--pool=forks","--maxWorkers=1","--minWorkers=1","--reporter=json","--outputFile="+str(proof/"evidence-reader-report.json")]
run("evidence-reader",reader)
report=json.loads((proof/"evidence-reader-report.json").read_text());assert report["numPassedTests"]==5 and report["numFailedTests"]==report["numPendingTests"]==0
assert fingerprints()==before
save("qualification-completion.json",{"state":"ALL_EXECUTED_CHECKS_PASSED_VISUAL_REVIEW_PENDING","head":head,"tree":tree,"configTests":state["tests"],"readerTests":5,"captureCases":6,"observedInputs":45,"strictFixtureBindings":15,"sourceInputsUnchanged":True,"at":now()})
print(json.dumps({"state":"ALL_EXECUTED_CHECKS_PASSED_VISUAL_REVIEW_PENDING","head":head,"configTests":state["tests"]["numPassedTests"],"readerTests":5,"captureCases":6,"captureSeconds":execution["seconds"]}),flush=True)
