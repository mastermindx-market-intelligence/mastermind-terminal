from pathlib import Path
import subprocess,json,hashlib,datetime,time,os
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
record=p/'source-checks.json';assert not record.exists(),'Reconcile existing checks; do not replay'
runtime=json.loads((p/'runtime.json').read_text());node=Path(runtime['node'])
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
green=json.loads((p/'node-green-execution.json').read_text());assert green['state']=='AFFECTED_NODE_CONTRACTS_PASSED' and green['counts']['pass']==272
for file,digest in json.loads((p/'source-after-node-green.json').read_text()).items():assert sha(w/file)==digest,file
files=[]
for folder in ['app','components','lib','e2e','scripts','test-fixtures']:
 files.extend(f for f in (t/folder).rglob('*') if f.is_file() and f.suffix in ['.ts','.tsx','.js','.jsx','.mjs','.cjs','.css','.json','.yaml','.yml','.py','.woff2'])
files.extend(t/f for f in ['package.json','package-lock.json','next.config.ts','playwright.config.ts','tsconfig.json','vitest.config.ts','postcss.config.mjs'])
files=sorted(set(files))
def snapshot():return {str(f.relative_to(w)):sha(f) for f in files}
def save(value):record.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ};env.update(PATH=str(node.parent)+os.pathsep+env['PATH'],CI='1',NEXT_TELEMETRY_DISABLED='1')
before=snapshot();state={'schema':'terminal_pr761_source_checks.v1','state':'RUNNING','sourceBefore':before,'checks':[],'sourceFileCount':len(files),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
nextenv=t/'next-env.d.ts';pre=nextenv.read_bytes() if nextenv.exists() else None
if pre is not None:(p/'next-env.preimage.d.ts.txt').write_bytes(pre)
scopes=['components/TerminalShell.tsx','components/mobile/RollerStrip.tsx','lib/useHubDiscovery.ts','e2e/mobile-chart-chrome.spec.ts','e2e/visual-evidence-capture.spec.ts','lib/__tests__/hubDiscoveryState.test.tsx','lib/__tests__/mobileHubHydrationFixture.test.ts','lib/__tests__/b_pl_6Batch1Evidence.test.ts','lib/__tests__/visualIntelligenceEvidence.test.ts']
commands=[
 ('hub-contracts',[str(node),'node_modules/vitest/vitest.mjs','run','lib/__tests__/hubDiscoveryState.test.tsx','lib/__tests__/mobileHubHydrationFixture.test.ts','--reporter=default','--reporter=json','--outputFile='+str(p/'hub-contracts-report.json')]),
 ('typegen',[str(node),'node_modules/next/dist/bin/next','typegen']),
 ('typescript',[str(node),'node_modules/typescript/bin/tsc','--noEmit']),
 ('affected-eslint',[str(node),'node_modules/eslint/bin/eslint.js',*scopes,'--format','json','--output-file',str(p/'lint-report.json')]),
]
save(state)
try:
 for name,argv in commands:
  start=time.monotonic();item={'name':name,'argv':argv,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};state['checks'].append(item)
  with (p/(name+'.log')).open('x') as log:
   child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);item['pid']=child.pid;save(state);print(json.dumps({'state':'STARTED','check':name,'pid':child.pid}),flush=True);item['exitCode']=child.wait()
  item.update(seconds=round(time.monotonic()-start,3),logSha256=sha(p/(name+'.log')));save(state);print(json.dumps({k:item[k] for k in ['name','pid','exitCode','seconds','logSha256']}),flush=True)
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
 if (p/'hub-contracts-report.json').exists():
  unit=json.loads((p/'hub-contracts-report.json').read_text());state['unitCounts']={k:unit.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']};state['unitReportSha256']=sha(p/'hub-contracts-report.json')
 state['state']='SOURCE_CHECKS_PASSED' if len(state['checks'])==4 and all(x.get('exitCode')==0 for x in state['checks']) and state['sourceStable'] and state['generatedTypesRestored'] else 'SOURCE_CHECKS_REQUIRE_CLASSIFICATION'
 state['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save(state)
print(json.dumps({k:state.get(k) for k in ['state','sourceFileCount','sourceStable','generatedTypesRestored','lintCounts','unitCounts']}),flush=True)
raise SystemExit(0 if state['state']=='SOURCE_CHECKS_PASSED' else 1)
