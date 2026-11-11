from pathlib import Path
import subprocess,json,hashlib,datetime,os,time
w=Path(__file__).resolve().parents[3];proof=Path(__file__).resolve().parent;t=w/"terminal"
head="8d3a375e6d7cba8f03afc65594d3937857230442";tree="f94078ea88979ee1aed630b013f303c6d20bbe0f"
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def git(*a):return subprocess.check_output(["git",*a],cwd=w,text=True).strip()
def save(name,data):(proof/name).write_text(json.dumps(data,indent=2)+"\n")
assert git("rev-parse","HEAD")==head and git("rev-parse","HEAD^{tree}")==tree
before=json.loads((proof/"preflight.json").read_text());execution=json.loads((proof/"execution.json").read_text())
assert execution["state"]=="CAPTURE_COMPLETED" and execution["exitCode"]==0 and execution["sourceInputsUnchanged"] and execution["portFree"]
assert execution["sourceHead"]==head and execution["sourceTree"]==tree
assert execution["logSha256"]==sha(proof/"f11-capture.log")
assert execution["nextEnvPreimage"]==execution["nextEnvPostimage"]==sha(t/"next-env.d.ts")
def fingerprints():return [{"path":x["path"],"sha256":sha(w/x["path"]),"gitBlob":git("hash-object",x["path"])} for x in before["sourceInputs"]]
assert fingerprints()==before["sourceInputs"] and len(before["sourceInputs"])==43
packet=t/"docs/pr-crops/b-f11-10-analysis-theses-entry";fixture=json.loads((packet/"FIXTURE.json").read_text())
assert fixture["capturedAtHead"]==head and len(fixture["entryObservations"])==6
assert fixture["serverSettlement"]["allClosed"] and fixture["serverSettlement"]["allGroupsAbsent"] and fixture["generatedTypes"]["allRestored"]
assert len(fixture["fixtureSources"])==15 and all(sha(w/p)==h for p,h in fixture["fixtureSources"].items())
allowed={"terminal/docs/pr-crops/b-f11-10-analysis-theses-entry/"+n for n in ["desktop-en.png","desktop-zh.png","tablet-en.png","tablet-zh.png","mobile-en.png","mobile-zh.png","EVIDENCE.yml","FIXTURE.json"]}
assert set(git("diff","--name-only").splitlines())<=allowed and not git("diff","--cached","--name-only")
assert not (proof/"evidence-reader.json").exists() and not (proof/"evidence-reader.log").exists()
reconciliation={"state":"CAPTURE_POSTCONDITIONS_VERIFIED_READER_NOT_PREVIOUSLY_STARTED","at":now(),"head":head,"tree":tree,"originalObserverPid":74932,"originalObserverExit":"NOT_OBSERVED","originalReturnChannel":"Studio Direct read_process_output returned No session found for PID 74932","originalObserverAbsence":"Exact ps read returned 1 with no stdout/stderr before this continuation","causeOfLostReturn":"NOT_PROVEN","originalProducerExit":0,"originalCaptureSeconds":execution["seconds"],"captureCases":6,"sourceInputsStable":43,"fixtureBindingsMatch":15,"serverGroupsClosedAndAbsent":True,"generatedTypesRestored":True,"originalPortFreeReceipt":execution["listenerRead"],"runtimeRerunOrProbe":False,"continuedAction":"Only unexecuted existing evidence-reader checks and final file/source verification"}
save("post-capture-reconciliation.json",reconciliation)
node_root=w/".pr1275-routing-runtime/node-v22.23.4-darwin-arm64";node=node_root/"bin/node"
env={k:os.environ[k] for k in ["HOME","LANG","TMPDIR","TMP","TEMP"] if k in os.environ}
env.update(PATH=str(node_root/"bin")+":"+os.environ["PATH"],CI="1",PLAYWRIGHT_BROWSERS_PATH="/Users/chriswong/Library/Caches/ms-playwright")
cmd=[str(node),"node_modules/vitest/vitest.mjs","run","lib/__tests__/b_f11_10AnalysisThesesEntryEvidence.test.ts","--pool=forks","--maxWorkers=1","--minWorkers=1","--reporter=json","--outputFile="+str(proof/"evidence-reader-report.json")]
result={"state":"STARTED","head":head,"tree":tree,"command":cmd,"startedAt":now()};save("evidence-reader.json",result);start=time.monotonic()
with (proof/"evidence-reader.log").open("xb") as log:r=subprocess.run(cmd,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
result.update(state="EXECUTED",exitCode=r.returncode,seconds=round(time.monotonic()-start,3),finishedAt=now(),logSha256=sha(proof/"evidence-reader.log"),reportSha256=sha(proof/"evidence-reader-report.json"));save("evidence-reader.json",result);assert r.returncode==0
report=json.loads((proof/"evidence-reader-report.json").read_text())
assert report["numPassedTests"]==5 and report["numFailedTests"]==0 and report["numPendingTests"]==0
assert fingerprints()==before["sourceInputs"]
result.update(state="PASSED",tests=5,passed=5,failed=0,skipped=0,sourceInputsUnchanged=True);save("evidence-reader.json",result)
save("qualification-completion.json",{"state":"ALL_EXECUTED_CHECKS_PASSED_VISUAL_REVIEW_PENDING","head":head,"tree":tree,"routingTests":33,"driftContractTests":22,"readerTests":5,"captureCases":6,"sourceInputs":43,"fixtureBindings":15,"captureReplayed":False,"originalObserverExit":"NOT_OBSERVED","at":now()})
print(json.dumps({"state":"ALL_EXECUTED_CHECKS_PASSED_VISUAL_REVIEW_PENDING","head":head,"readerTests":5,"captureCases":6,"readerSeconds":result["seconds"]}),flush=True)
