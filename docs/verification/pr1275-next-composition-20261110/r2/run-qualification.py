from pathlib import Path
import subprocess,json,hashlib,datetime,os,time,socket,sys,shutil
w=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-next-composition-web4");t=w/"terminal"
prior=Path("/tmp/mastermind-terminal-pr1275-next-composition-qualification-20261110");proof=prior/"r2"
head="17f1e9cf88728b60f7366484dac6799569c50ed3";port=47285
node_root=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4/.pr1422-qualification/runtime/node-v22.23.4-darwin-arm64");node=node_root/"bin/node"
env={k:os.environ[k] for k in ["HOME","LANG","TMPDIR","TMP","TEMP"] if k in os.environ}
env.update(PATH=str(node_root/"bin")+":"+os.environ["PATH"],CI="1",PLAYWRIGHT_BROWSERS_PATH="/Users/chriswong/Library/Caches/ms-playwright",TERMINAL_CROP_PORT=str(port))
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def git(*args):return subprocess.check_output(["git","-C",str(w),*args],text=True).strip()
def save(name,data):(proof/name).write_text(json.dumps(data,indent=2,sort_keys=True)+"\n")
assert git("rev-parse","HEAD")==head and git("status","--porcelain=v1")==""
tree=git("rev-parse","HEAD^{tree}")
assert git("show","-s","--format=%P",head)=="360c3acf4396384c321df95fc442024ccff58b8e"
assert git("rev-parse",head+":terminal/e2e/tools/f11_owned_server.cjs")=="57c6f5242a166e939a811760e9445f8addf13d28"
assert git("rev-parse",head+":terminal/e2e/tools/f11_owned_server.test.cjs")=="686f0430932c01d8366a615e0b540d1a4924939a"
assert set(git("diff","--name-only",head+"^",head).splitlines())=={"terminal/e2e/tools/f11_owned_server.cjs","terminal/e2e/tools/f11_owned_server.test.cjs"}
assert json.loads((prior/"template-green.json").read_text())["state"]=="TEMPLATE_TESTS_AND_LINT_PASSED"
assert json.loads((prior/"failure-reconciliation.json").read_text())["state"]=="ORIGINAL_LOCAL_EFFECTS_RECONCILED"
assert not proof.exists(),"EXISTING_R2_NO_REPLAY";proof.mkdir()
shutil.copy2(__file__,proof/"run-qualification.py")
old=json.loads((prior/"inputs-before.json").read_text());paths=[x["path"] for x in old]
def fingerprints():return [{"path":p,"sha256":sha(w/p),"gitBlob":git("hash-object",p)} for p in paths]
before=fingerprints();changes=[a["path"] for a,b in zip(before,old) if a!=b]
assert changes==["terminal/e2e/tools/f11_owned_server.cjs","terminal/e2e/tools/f11_owned_server.test.cjs"],changes
assert len(before)==45 and sha(node)=="2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0"
save("inputs-before.json",before)
s=socket.socket();s.bind(("127.0.0.1",port));s.close()
next_env=t/"next-env.d.ts";preimage=sha(next_env);assert preimage is None
save("preflight.json",{"head":head,"tree":tree,"port":port,"portBindBefore":"EXCLUSIVE_AVAILABLE","nodeVersion":subprocess.check_output([str(node),"--version"],text=True).strip(),"nextVersion":json.loads((t/"node_modules/next/package.json").read_text())["version"],"sourceInputs":before,"observedInputs":45,"changedFromFirstAttempt":changes,"nextEnvPreimage":preimage,"producerBlob":git("hash-object","terminal/e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs"),"ownerHelperBlob":"57c6f5242a166e939a811760e9445f8addf13d28","originalFailureReconciled":True,"at":now()})
command=[str(node),"e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs"];start=time.monotonic()
execution={"state":"STARTED","sourceHead":head,"sourceTree":tree,"command":command,"cwd":str(t),"startedAt":now(),"port":port,"nextEnvPreimage":None,"observer":"Same finite caller path; existing producer owns every browser/server and settlement; only exact generated-type template was repaired."}
with (proof/"f11-capture.log").open("xb") as log:
 process=subprocess.Popen(command,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);execution["producerPid"]=process.pid;save("execution.json",execution);print(json.dumps({"capture":"STARTED","pid":process.pid,"head":head,"tree":tree,"port":port}),flush=True);code=process.wait()
execution.update(exitCode=code,finishedAt=now(),seconds=round(time.monotonic()-start,3),logSha256=sha(proof/"f11-capture.log"))
if code:
 execution.update(state="CAPTURE_FAILED_NO_REPLAY",runtimePostProbes="NOT_RUN: classify original return before further runtime observation");save("execution.json",execution);print(json.dumps(execution),flush=True);raise SystemExit(code)
after=fingerprints();sock=socket.socket();sock.settimeout(1);closed=sock.connect_ex(("127.0.0.1",port));sock.close()
execution.update(state="CAPTURE_COMPLETED",sourceInputsUnchanged=before==after,nextEnvPostimage=sha(next_env),portConnectAfter=closed,trackedChanges=git("diff","--name-only").splitlines())
save("execution.json",execution);save("inputs-after-capture.json",after)
assert before==after and sha(next_env) is None and closed==61
names=["desktop-en.png","desktop-zh.png","tablet-en.png","tablet-zh.png","mobile-en.png","mobile-zh.png","EVIDENCE.yml","FIXTURE.json"];active=t/"docs/pr-crops/b-f11-10-analysis-theses-entry"
assert set(execution["trackedChanges"])<={"terminal/docs/pr-crops/b-f11-10-analysis-theses-entry/"+n for n in names}
fixture=json.loads((active/"FIXTURE.json").read_text());assert fixture["capturedAtHead"]==head and len(fixture["entryObservations"])==6
assert fixture["serverSettlement"]["allClosed"] and fixture["serverSettlement"]["allGroupsAbsent"] and fixture["generatedTypes"]["allRestored"]
assert len(fixture["fixtureSources"])==15 and all(sha(w/p)==h for p,h in fixture["fixtureSources"].items())
execution.update(state="CAPTURE_QUALIFIED_AWAITING_VISUAL_REVIEW",fixtureSha256=sha(active/"FIXTURE.json"),fixtureInputs=15,allSixSettled=True);save("execution.json",execution)
cmd=[str(node),"node_modules/vitest/vitest.mjs","run","lib/__tests__/b_f11_10AnalysisThesesEntryEvidence.test.ts","--pool=forks","--maxWorkers=1","--minWorkers=1","--reporter=json","--outputFile="+str(proof/"evidence-reader-report.json")]
r={"state":"STARTED","command":cmd,"sourceHead":head,"sourceTree":tree,"startedAt":now()};save("evidence-reader.json",r);start=time.monotonic()
with (proof/"evidence-reader.log").open("xb") as log:p=subprocess.Popen(cmd,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);r["pid"]=p.pid;code=p.wait()
r.update(exitCode=code,seconds=round(time.monotonic()-start,3),finishedAt=now(),logSha256=sha(proof/"evidence-reader.log"));save("evidence-reader.json",r)
assert code==0
try:os.killpg(p.pid,0)
except ProcessLookupError:r["groupAbsent"]=True
else:raise RuntimeError("READER_GROUP_REMAINS")
report=json.loads((proof/"evidence-reader-report.json").read_text());assert report["numPassedTests"]==5 and report["numFailedTests"]==report["numPendingTests"]==0
assert fingerprints()==before
r.update(state="PASSED",tests=5,passed=5,failed=0,skipped=0,sourceInputsUnchanged=True);save("evidence-reader.json",r)
save("qualification-completion.json",{"state":"ALL_EXECUTED_CHECKS_PASSED_VISUAL_REVIEW_PENDING","head":head,"tree":tree,"readerTests":5,"captureCases":6,"observedInputs":45,"strictFixtureBindings":15,"sourceInputsUnchanged":True,"at":now()})
print(json.dumps({"state":"ALL_EXECUTED_CHECKS_PASSED_VISUAL_REVIEW_PENDING","head":head,"tree":tree,"readerTests":5,"captureCases":6,"captureSeconds":execution["seconds"],"readerSeconds":r["seconds"]}),flush=True)
