from pathlib import Path
import subprocess,json,hashlib,datetime,os,time,sys,xml.etree.ElementTree as ET
w=Path(__file__).resolve().parents[3]; proof=Path(__file__).resolve().parent;t=w/'terminal'
head='8d3a375e6d7cba8f03afc65594d3937857230442';tree='f94078ea88979ee1aed630b013f303c6d20bbe0f';port=47276
node_root=w/'.pr1275-routing-runtime/node-v22.23.4-darwin-arm64';node=node_root/'bin/node'
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ}
env.update(PATH=str(node_root/'bin')+':'+os.environ['PATH'],CI='1',PLAYWRIGHT_BROWSERS_PATH='/Users/chriswong/Library/Caches/ms-playwright',TERMINAL_CROP_PORT=str(port))
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def git(*args):return subprocess.check_output(['git','-C',str(w),*args]).decode().strip()
def save(name,data):(proof/name).write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')
assert git('rev-parse','HEAD')==head and git('rev-parse','HEAD^{tree}')==tree
assert not git('diff','--name-only') and not git('diff','--cached','--name-only')
old=json.loads((w/'docs/verification/pr1275-hosted-routing-successor-20261110/preflight.json').read_text())
paths=[x['path'] for x in old['sourceInputs']]
def fingerprints():return [{'path':p,'sha256':sha(w/p),'gitBlob':git('hash-object',p)} for p in paths]
before=fingerprints();changed=[p['path'] for p,q in zip(before,old['sourceInputs']) if p['sha256']!=q['sha256']]
assert changed==['.github/workflows/ci.yml','terminal/app/(shell)/analysis/page.tsx','terminal/next.config.ts','tests/test_merge_group_fast_lane_contract.py']
assert git('hash-object','.github/workflows/ci.yml')=='63fed28111509aed3bc440f916e75931912a97bd'
contract_paths=['.github/workflows/ci.yml','docs/CI_TERMINAL_E2E_SELFHOSTED_LANE.md','tests/test_ci_e2e_selfhosted_lane.py','.github/scripts/terminal_e2e_lane.sh']
contracts={'schema':'terminal.pr1275.routing-contracts.v1','head':head,'tree':tree,'inputs':[{'path':p,'sha256':sha(w/p),'gitBlob':git('hash-object',p)} for p in contract_paths],'startedAt':now()}
cmd=['/opt/homebrew/bin/python3.11','-m','pytest','-q','tests/test_ci_e2e_selfhosted_lane.py','--junitxml='+str(proof/'routing-contracts.xml')]
start=time.monotonic()
with (proof/'routing-contracts.log').open('xb') as log:r=subprocess.run(cmd,cwd=w,env=env,stdout=log,stderr=subprocess.STDOUT)
contracts.update(command=cmd,exitCode=r.returncode,seconds=round(time.monotonic()-start,3),finishedAt=now(),logSha256=sha(proof/'routing-contracts.log'))
save('routing-contracts.json',contracts);print(json.dumps({'routingContracts':contracts['exitCode'],'seconds':contracts['seconds']}),flush=True)
assert r.returncode==0
xml=ET.parse(proof/'routing-contracts.xml').getroot();suites=list(xml.iter('testsuite'))
counts={k:sum(int(s.get(k,'0')) for s in suites) for k in ['tests','failures','errors','skipped']}
assert counts=={'tests':33,'failures':0,'errors':0,'skipped':0},counts
contracts['counts']=counts;save('routing-contracts.json',contracts)
# The separate drift-gate suite keeps the incumbent routing count honest.
drift_cmd=['/opt/homebrew/bin/python3.11','-m','pytest','-q','tests/test_merge_group_fast_lane_contract.py','--junitxml='+str(proof/'drift-contracts.xml')]
start=time.monotonic()
with (proof/'drift-contracts.log').open('xb') as log:drift_run=subprocess.run(drift_cmd,cwd=w,env=env,stdout=log,stderr=subprocess.STDOUT)
drift={'head':head,'tree':tree,'command':drift_cmd,'exitCode':drift_run.returncode,'seconds':round(time.monotonic()-start,3),'logSha256':sha(proof/'drift-contracts.log')}
save('drift-contracts.json',drift);assert drift_run.returncode==0
drift_suites=list(ET.parse(proof/'drift-contracts.xml').getroot().iter('testsuite'))
drift_counts={k:sum(int(x.get(k,'0')) for x in drift_suites) for k in ['tests','failures','errors','skipped']}
assert drift_counts['tests']>0 and all(drift_counts[k]==0 for k in ['failures','errors','skipped'])
drift['counts']=drift_counts;save('drift-contracts.json',drift);print(json.dumps({'driftContracts':drift_counts}),flush=True)
listener=subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True)
assert listener.returncode==1 and not listener.stdout.strip() and not listener.stderr.strip()
next_env=t/'next-env.d.ts';preimage=sha(next_env)
preflight={'schema':'terminal.pr1275.f11-successor-preflight.v1','at':now(),'head':head,'tree':tree,'port':port,'node':str(node),'nodeVersion':subprocess.check_output([str(node),'--version'],text=True).strip(),'sourceInputs':before,'observedInputs':len(before),'changedFromPriorInputs':changed,'nextEnvPreimage':preimage,'portInitiallyFree':True,'producerUnchanged':True,'archivedPriorPacket':'prior-published-packet'}
save('preflight.json',preflight)
command=[str(node),'e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs'];start=time.monotonic()
execution={'schema':'terminal.pr1275.f11-successor-execution.v1','state':'STARTED','sourceHead':head,'sourceTree':tree,'command':command,'cwd':str(t),'startedAt':now(),'port':port,'nextEnvPreimage':preimage,'node':preflight['nodeVersion'],'observer':'This finite caller only; incumbent producer owns every browser/server/callback and its settlement.'}
with (proof/'f11-capture.log').open('xb') as log:
 process=subprocess.Popen(command,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
 execution['producerPid']=process.pid;save('execution.json',execution)
 print(json.dumps({'capture':'STARTED','pid':process.pid,'head':head,'port':port}),flush=True)
 code=process.wait()
if code:
 execution.update(exitCode=code,finishedAt=now(),seconds=round(time.monotonic()-start,3),logSha256=sha(proof/'f11-capture.log'),state='CAPTURE_FAILED_NO_REPLAY',runtimePostProbes='NOT_RUN: classify original failure before any further runtime observation')
 save('execution.json',execution);print(json.dumps(execution),flush=True)
 sys.exit(code)
after=fingerprints()
listener=subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True)
execution.update(exitCode=code,finishedAt=now(),seconds=round(time.monotonic()-start,3),logSha256=sha(proof/'f11-capture.log'),sourceInputsUnchanged=before==after,nextEnvPostimage=sha(next_env),portFree=listener.returncode==1 and not listener.stdout.strip() and not listener.stderr.strip(),listenerRead={'exitCode':listener.returncode,'stdout':listener.stdout,'stderr':listener.stderr},trackedChanges=git('diff','--name-only').splitlines())
execution['state']='CAPTURE_COMPLETED' if code==0 else 'CAPTURE_FAILED_NO_REPLAY'
save('execution.json',execution);print(json.dumps({k:execution[k] for k in ['state','exitCode','seconds','sourceInputsUnchanged','portFree','logSha256']}),flush=True)
if code:sys.exit(code)
assert before==after and sha(next_env)==preimage and execution['portFree']
allowed={'terminal/docs/pr-crops/b-f11-10-analysis-theses-entry/'+n for n in ['desktop-en.png','desktop-zh.png','tablet-en.png','tablet-zh.png','mobile-en.png','mobile-zh.png','EVIDENCE.yml','FIXTURE.json']}
assert set(execution['trackedChanges'])<=allowed
fixture=json.loads((t/'docs/pr-crops/b-f11-10-analysis-theses-entry/FIXTURE.json').read_text())
assert fixture['capturedAtHead']==head and len(fixture['entryObservations'])==6
assert fixture['serverSettlement']['allClosed'] and fixture['serverSettlement']['allGroupsAbsent'] and fixture['generatedTypes']['allRestored']
assert len(fixture['fixtureSources'])==15
assert all(sha(w/p)==s for p,s in fixture['fixtureSources'].items())
execution.update(state='CAPTURE_QUALIFIED_AWAITING_VISUAL_REVIEW',fixtureSha256=sha(t/'docs/pr-crops/b-f11-10-analysis-theses-entry/FIXTURE.json'),fixtureInputs=len(fixture['fixtureSources']),allSixSettled=True)
save('execution.json',execution)
reader=[str(node),'node_modules/vitest/vitest.mjs','run','lib/__tests__/b_f11_10AnalysisThesesEntryEvidence.test.ts','--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(proof/'evidence-reader-report.json')]
start=time.monotonic()
with (proof/'evidence-reader.log').open('xb') as log:r=subprocess.run(reader,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
result={'schema':'terminal.pr1275.evidence-reader.v1','head':head,'tree':tree,'command':reader,'exitCode':r.returncode,'seconds':round(time.monotonic()-start,3),'logSha256':sha(proof/'evidence-reader.log'),'reportSha256':sha(proof/'evidence-reader-report.json')}
save('evidence-reader.json',result);print(json.dumps({'readerExit':r.returncode,'seconds':result['seconds']}),flush=True)
assert r.returncode==0
report=json.loads((proof/'evidence-reader-report.json').read_text())
assert report['numPassedTests']==5 and report['numFailedTests']==0 and report['numPendingTests']==0
result.update(tests=5,passed=5,failed=0,skipped=0);save('evidence-reader.json',result)
assert fingerprints()==before
print(json.dumps({'state':'ALL_EXECUTED_CHECKS_PASSED_VISUAL_REVIEW_PENDING','head':head,'tree':tree,'routingTests':33,'readerTests':5,'captureCases':6}),flush=True)
