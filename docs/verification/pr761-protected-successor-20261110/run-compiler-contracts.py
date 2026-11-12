from pathlib import Path
import subprocess,json,hashlib,datetime,time,os,sys,re
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
mode=sys.argv[1]
assert mode in ['compiler-red','compiler-green']
record=p/(mode+'-execution.json')
assert not record.exists(),'Reconcile original result; no replay'
runtime=json.loads((p/'runtime.json').read_text());node=Path(runtime['node'])
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
files=list(json.loads((p/'source-checks.json').read_text())['sourceAfter'])
def snapshot():return {name:sha(w/name) for name in files}
before=snapshot();env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ}
env.update(PATH=str(node.parent)+os.pathsep+env['PATH'],CI='1',NEXT_TELEMETRY_DISABLED='1')
argv=[str(node),'--test','--test-concurrency=1']
if mode=='compiler-red':argv+=['--test-name-pattern','declared Webpack reaches','e2e/tools/capture_visual_evidence.test.cjs']
else:argv+=['e2e/tools/capture_visual_evidence.test.cjs','e2e/tools/retainedFontFixture.test.cjs','e2e/tools/fixtureServerWait.test.cjs','e2e/tools/visualEvidence.test.cjs','e2e/tools/capture_ci_evidence.test.cjs']
data={'schema':'terminal_pr761_compiler_contracts.v1','mode':mode,'state':'RUNNING','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'argv':argv,'sourceBefore':before,'sourceFileCount':len(before)}
def save():record.write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')
save();start=time.monotonic()
with (p/(mode+'.log')).open('x') as output:
 child=subprocess.Popen(argv,cwd=t,env=env,stdout=output,stderr=subprocess.STDOUT);data['pid']=child.pid;save();print(json.dumps({'mode':mode,'pid':child.pid,'state':'RUNNING'}),flush=True)
 data['exitCode']=child.wait()
data['seconds']=round(time.monotonic()-start,3);log=(p/(mode+'.log')).read_text()
data['counts']={name:int(value) for name,value in re.findall(r'^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$',log,re.M)}
data['sourceAfter']=snapshot();data['sourceStable']=before==data['sourceAfter'];data['logSha256']=sha(p/(mode+'.log'))
counts=data['counts']
qualified=(data['exitCode']==1 and counts.get('tests')==2 and counts.get('fail')==2 and counts.get('pass')==0) if mode=='compiler-red' else (data['exitCode']==0 and counts.get('tests')==283 and counts.get('pass')==283 and counts.get('fail')==0 and counts.get('skipped')==0)
data['state']=('DECLARED_COMPILER_COUNTEREXAMPLES_REPRODUCED' if mode=='compiler-red' else 'AFFECTED_COMPILER_AND_CAPTURE_CONTRACTS_PASSED') if qualified and data['sourceStable'] else 'RESULT_REQUIRES_CLASSIFICATION'
data['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
print(json.dumps({k:data.get(k) for k in ['mode','state','pid','exitCode','seconds','counts','sourceStable','sourceFileCount','logSha256']}),flush=True)
raise SystemExit(0 if qualified and data['sourceStable'] else 1)
