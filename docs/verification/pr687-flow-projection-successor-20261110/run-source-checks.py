from pathlib import Path
import subprocess,json,hashlib,datetime,time,os
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
record=p/'source-checks.json';assert not record.exists(),'Reconcile existing checks before any continuation'
node=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node')
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ}
env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1',NEXT_TELEMETRY_DISABLED='1')
files=[]
for folder in ['app','components','lib','e2e','scripts','test-fixtures']:
 files.extend(f for f in (t/folder).rglob('*') if f.is_file() and f.suffix in ['.ts','.tsx','.js','.jsx','.mjs','.cjs','.css','.json','.yaml','.yml'])
files.extend(t/f for f in ['package.json','package-lock.json','next.config.ts','playwright.config.ts','tsconfig.json','vitest.config.ts','postcss.config.mjs'])
files=sorted(set(files))
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def snapshot():return {str(f.relative_to(w)):sha(f) for f in files}
def save(value):record.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
green=json.loads((p/'green-execution.json').read_text());assert green['state']=='AFFECTED_CONTRACTS_PASSED' and green['counts']['numPassedTests']==190
for file,digest in json.loads((p/'source-after-green.json').read_text()).items():assert sha(w/file)==digest,file
before=snapshot()
state={'schema':'terminal_pr687_source_checks.v1','state':'RUNNING','sourceBefore':before,'checks':[],'sourceFileCount':len(files),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
nextenv=t/'next-env.d.ts';pre=nextenv.read_bytes() if nextenv.exists() else None
if pre is not None:(p/'next-env.preimage.d.ts.txt').write_bytes(pre)
scopes=['components/flowdesk/FeedPane.tsx','components/flowdesk/FlowProjectionStrip.tsx','components/prophet/optionsAlphaMeasuredEvidence.ts','lib/flowProjection.ts','lib/__tests__/flowProjection.test.ts','lib/__tests__/flowProjectionControls.test.tsx','e2e/flow-projection.spec.ts']
commands=[
 ('typegen',[str(node),'node_modules/next/dist/bin/next','typegen']),
 ('typescript',[str(node),'node_modules/typescript/bin/tsc','--noEmit']),
 ('affected-eslint',[str(node),'node_modules/eslint/bin/eslint.js',*scopes,'--format','json','--output-file',str(p/'lint-report.json')]),
]
save(state)
try:
 for name,argv in commands:
  start=time.monotonic();item={'name':name,'argv':argv,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};state['checks'].append(item)
  with (p/(name+'.log')).open('x') as log:
   child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
   item['pid']=child.pid;save(state);print(json.dumps({'state':'STARTED','check':name,'pid':child.pid}),flush=True)
   item['exitCode']=child.wait()
  item.update(seconds=round(time.monotonic()-start,3),logSha256=sha(p/(name+'.log')))
  save(state);print(json.dumps(item),flush=True)
  if item['exitCode']!=0:break
finally:
 if nextenv.exists():(p/'next-env.generated.d.ts.txt').write_bytes(nextenv.read_bytes())
 if pre is None:
  if nextenv.exists():nextenv.unlink()
 else:nextenv.write_bytes(pre)
 state['generatedTypesRestored']=(nextenv.read_bytes() if nextenv.exists() else None)==pre
 state['sourceAfter']=snapshot();state['sourceStable']=before==state['sourceAfter']
 if (p/'lint-report.json').exists():
  lint=json.loads((p/'lint-report.json').read_text());state['lintCounts']={k:sum(x[k] for x in lint) for k in ['errorCount','warningCount']}
 state['state']='SOURCE_CHECKS_PASSED' if len(state['checks'])==3 and all(x.get('exitCode')==0 for x in state['checks']) and state['sourceStable'] and state['generatedTypesRestored'] else 'SOURCE_CHECKS_REQUIRE_CLASSIFICATION'
 state['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save(state)
print(json.dumps({k:state.get(k) for k in ['state','sourceFileCount','sourceStable','generatedTypesRestored','lintCounts']}),flush=True)
raise SystemExit(0 if state['state']=='SOURCE_CHECKS_PASSED' else 1)
