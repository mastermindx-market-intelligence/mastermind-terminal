from pathlib import Path
import subprocess,json,hashlib,datetime,time,os,sys,re
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
mode=sys.argv[1];assert mode in ['origin-red','origin-red-valid','node-green']
record=p/(mode+'-execution.json');assert not record.exists(),'Retain original test operation; no replay'
runtime=json.loads((p/'runtime.json').read_text());assert runtime['state']=='LOCKED_DEPENDENCIES_READY'
node=Path(runtime['node'])
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
assert sha(node)==runtime['nodeSha256']
files=[]
for root in ['app','components','lib','e2e']:
 files.extend(f for f in (t/root).rglob('*') if f.is_file() and f.suffix in ['.ts','.tsx','.js','.mjs','.cjs','.json','.css','.py','.woff2'])
files.extend(t/f for f in ['package.json','package-lock.json','tsconfig.json','vitest.config.ts','playwright.config.ts','next.config.ts'])
files=sorted(set(files))
def snapshot():return {str(f.relative_to(w)):sha(f) for f in files}
def save(name,value):(p/name).write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
before=snapshot();save('source-before-'+mode+'.json',before)
args=[str(node),'--test','--test-reporter=tap']
if mode.startswith('origin-red'):args+=['--test-name-pattern','actual tracker validates current capture origin','e2e/tools/retainedFontFixture.test.cjs']
else:args+=['e2e/tools/capture_visual_evidence.test.cjs','e2e/tools/retainedFontFixture.test.cjs','e2e/tools/fixtureServerWait.test.cjs','e2e/tools/visualEvidence.test.cjs','e2e/tools/capture_ci_evidence.test.cjs']
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ};env.update(PATH=str(node.parent)+os.pathsep+env['PATH'],CI='1')
state={'schema':'terminal_pr761_node_contract_execution.v1','state':'RUNNING','mode':mode,'argv':args,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceFiles':len(files)}
save(mode+'-execution.json',state);start=time.monotonic()
with (p/(mode+'.log')).open('x') as log:
 child=subprocess.Popen(args,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);state['pid']=child.pid;save(mode+'-execution.json',state);code=child.wait()
after=snapshot();save('source-after-'+mode+'.json',after)
log=(p/(mode+'.log')).read_text()
counts={key:int(re.search(r'^# '+key+r' (\d+)$',log,re.M).group(1)) for key in ['tests','pass','fail','skipped','cancelled','todo'] if re.search(r'^# '+key+r' (\d+)$',log,re.M)}
state.update(exitCode=code,seconds=round(time.monotonic()-start,3),counts=counts,sourceStable=before==after,logSha256=sha(p/(mode+'.log')),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
expected=code==1 and counts.get('fail')==2 if mode.startswith('origin-red') else code==0 and counts.get('fail')==0 and counts.get('skipped')==0 and counts.get('cancelled')==0
state['state']=('CURRENT_ORIGIN_COUNTEREXAMPLES_REPRODUCED' if mode.startswith('origin-red') else 'AFFECTED_NODE_CONTRACTS_PASSED') if expected and state['sourceStable'] else 'NODE_EXECUTION_REQUIRES_CLASSIFICATION'
save(mode+'-execution.json',state);print(json.dumps(state),flush=True)
if state['state']=='NODE_EXECUTION_REQUIRES_CLASSIFICATION':print(log[-14000:],flush=True)
raise SystemExit(0 if expected and state['sourceStable'] else 1)
