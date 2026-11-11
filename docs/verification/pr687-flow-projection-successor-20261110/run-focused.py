from pathlib import Path
import subprocess,json,hashlib,datetime,time,os,sys
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
mode=sys.argv[1];assert mode in ['red','selection-red','green']
record=p/(mode+'-execution.json');assert not record.exists(),'Reconcile the original test operation; never replay'
node=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node')
assert hashlib.sha256(node.read_bytes()).hexdigest()=='2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0'
files=[]
for root in ['components','lib']:
 files.extend(f for f in (t/root).rglob('*') if f.is_file() and f.suffix in ['.ts','.tsx','.js','.mjs','.cjs','.json','.css'])
files.extend(t/f for f in ['package.json','package-lock.json','tsconfig.json','vitest.config.ts','app/globals.css'])
files=sorted(set(files))
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def snapshot():return {str(f.relative_to(w)):sha(f) for f in files}
def save(name,value):(p/name).write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
before=snapshot();save('source-before-'+mode+'.json',before)
if mode=='red':
 for rel in ['terminal/lib/flowProjection.ts','terminal/components/flowdesk/FlowProjectionStrip.tsx','terminal/components/flowdesk/FeedPane.tsx','terminal/components/prophet/optionsAlphaMeasuredEvidence.ts']:
  target=p/('pre-repair-'+Path(rel).name+'.txt');assert not target.exists();target.write_bytes((w/rel).read_bytes())
scopes=['lib/__tests__/flowProjection.test.ts','lib/__tests__/flowProjectionControls.test.tsx']
if mode=='selection-red':scopes=['lib/__tests__/flowProjectionControls.test.tsx']
if mode=='green':scopes+=['lib/__tests__/optionsFlowBoards.test.ts','lib/__tests__/flowDeskNoFeedCountTruth.test.tsx','lib/__tests__/flowDeskFeedLoadFailureState.test.tsx','lib/__tests__/flowDeskFeedUnknownTruth.test.tsx','lib/__tests__/flowDeskMalformedFeedEvents.test.tsx','lib/__tests__/flowPrintInspector.test.ts','lib/__tests__/optionsMeasuredIntegrity.test.tsx','lib/__tests__/optionsAlphaMeasuredEvidence.test.ts']
assert all((t/f).exists() for f in scopes)
argv=[str(node),'node_modules/vitest/vitest.mjs','run',*scopes,'--reporter=default','--reporter=json','--outputFile='+str(p/(mode+'-report.json'))]
if mode=='selection-red':argv+=['--testNamePattern','collapses an expanded|does not revive|clears missing bucket']
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ}
env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1')
state={'schema':'terminal_pr687_focused_tests.v1','state':'RUNNING','mode':mode,'argv':argv,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceFiles':len(files)}
save(record.name,state);start=time.monotonic()
with (p/(mode+'.log')).open('x') as log:
 child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
 state['pid']=child.pid;save(record.name,state)
 print(json.dumps({'state':'STARTED','mode':mode,'pid':child.pid,'scopeCount':len(scopes),'sourceFiles':len(files)}),flush=True)
 code=child.wait()
after=snapshot();save('source-after-'+mode+'.json',after)
report=json.loads((p/(mode+'-report.json')).read_text())
counts={k:report.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
failed=[{'file':suite['name'],'name':case['fullName'],'status':case['status'],'messages':case.get('failureMessages',[])} for suite in report['testResults'] for case in suite['assertionResults'] if case['status']=='failed']
state.update(exitCode=code,seconds=round(time.monotonic()-start,3),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),counts=counts,sourceStable=before==after,logSha256=sha(p/(mode+'.log')),reportSha256=sha(p/(mode+'-report.json')),failedTests=failed)
passed=code==0 and counts['numFailedTests']==0 and counts['numPendingTests']==0 and state['sourceStable']
red=mode in ['red','selection-red'] and code!=0 and counts['numFailedTests']>0 and state['sourceStable']
state['state']='AFFECTED_CONTRACTS_PASSED' if passed else 'RED_COUNTEREXAMPLES_OBSERVED_REVIEW_REQUIRED' if red else 'TEST_EXECUTION_REQUIRES_CLASSIFICATION'
save(record.name,state)
print(json.dumps({k:state[k] for k in ['state','mode','exitCode','seconds','counts','sourceStable','logSha256']}),flush=True)
raise SystemExit(0 if (passed and mode=='green') or red else 1)
