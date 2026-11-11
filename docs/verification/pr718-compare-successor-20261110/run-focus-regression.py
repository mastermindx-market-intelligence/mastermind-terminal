from pathlib import Path
import subprocess,json,os,hashlib,datetime,time,sys
p=Path(__file__).resolve().parent;w=p.parents[2];t=w/'terminal';mode=sys.argv[1];assert mode in ['focus-red','focus-green']
node=Path(json.loads((p/'runtime.json').read_text())['node']);original=json.loads((p/'source-after-green.json').read_text())
files=list(original)
def snapshot():return {f:hashlib.sha256((w/f).read_bytes()).hexdigest() for f in files}
def save(name,data):(p/name).write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')
assert not (p/(mode+'-execution.json')).exists()
before=snapshot();save('source-before-'+mode+'.json',before)
if mode=='focus-red':assert before['terminal/components/CompareSettings.tsx']==original['terminal/components/CompareSettings.tsx']
tests=['lib/__tests__/compareSettingsUx.test.tsx'] if mode=='focus-red' else ['lib/__tests__/compareSettingsUx.test.tsx','lib/__tests__/compareSettingsAccessibility.test.tsx','lib/__tests__/chartSettingsUi.test.ts']
argv=[str(node),'node_modules/vitest/vitest.mjs','run',*tests,'--reporter=default','--reporter=json','--outputFile='+str(p/(mode+'-report.json'))]
if mode=='focus-red':argv+=['--testNamePattern','returns focus to the matching visible comparison|preserves a surviving Settings opener']
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ};env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1')
state={'state':'RUNNING','mode':mode,'argv':argv,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};save(mode+'-execution.json',state);start=time.monotonic()
with (p/(mode+'.log')).open('x') as log:
 child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);state['pid']=child.pid;save(mode+'-execution.json',state);rc=child.wait()
report=json.loads((p/(mode+'-report.json')).read_text());after=snapshot();save('source-after-'+mode+'.json',after)
failed=[x['fullName'] for s in report['testResults'] for x in s['assertionResults'] if x['status']=='failed']
state.update(state='TEST_REPORT_RECEIVED',exitCode=rc,seconds=round(time.monotonic()-start,3),sourceStable=before==after,counts={k:report[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']},failedTests=failed,logSha256=hashlib.sha256((p/(mode+'.log')).read_bytes()).hexdigest());save(mode+'-execution.json',state)
if mode=='focus-red':
 qualified=rc==1 and report['numFailedTests']==1 and report['numPassedTests']==1 and report['numPendingTests']==12 and 'returns focus to the matching visible comparison' in failed[0]
 state['selectionNote']='Two targeted cases executed; twelve other cases in the file were unselected, not claimed as executed.'
 state['state']='MISSING_OPENER_COUNTEREXAMPLE_REPRODUCED' if qualified else 'COUNTEREXAMPLE_REQUIRES_CLASSIFICATION'
else:
 qualified=rc==0 and report['numPassedTests']==64 and report['numFailedTests']==report['numPendingTests']==0
 state['state']='AFFECTED_CONTRACTS_PASSED' if qualified else 'AFFECTED_CONTRACTS_FAILED'
qualified=qualified and before==after;save(mode+'-execution.json',state);print(json.dumps(state),flush=True)
raise SystemExit(0 if qualified else 1)
