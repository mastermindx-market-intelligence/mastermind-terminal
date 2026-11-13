from pathlib import Path
import subprocess,json,hashlib,datetime,time,os
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
record=p/'final-source-checks.json'
assert not record.exists(),'Existing final check must be reconciled'
capture=json.loads((p/'capture-webpack-execution.json').read_text())
assert capture['state']=='CAPTURED_COMPOSED_AND_READ_BACK' and capture['sourceStable'] and not capture['completeSourceChanged'] and capture['generatedTypesRestored']
runtime=json.loads((p/'runtime.json').read_text());node=Path(runtime['node'])
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
files=list(capture['completeSourceBefore'])
def snap():return {f:sha(w/f) for f in files}
before=snap();assert before==capture['completeSourceBefore']
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ}
env.update(PATH=str(node.parent)+os.pathsep+env['PATH'],CI='1',NEXT_TELEMETRY_DISABLED='1')
n=t/'next-env.d.ts';pre=n.read_bytes() if n.exists() else None
state={'schema':'terminal_pr761_final_source_checks.v1','state':'RUNNING','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceBefore':before,'sourceFileCount':len(before),'checks':[],'capture':'capture-webpack-execution.json','inheritedLintClassification':'lint-baseline-classification.json'}
def save():record.write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
cmds=[
 ('strict-composition-readers',[str(node),'node_modules/vitest/vitest.mjs','run','lib/__tests__/b_pl_6Batch1Evidence.test.ts','lib/__tests__/visualIntelligenceEvidence.test.ts','--reporter=default','--reporter=json','--outputFile='+str(p/'strict-composition-readers-report.json')]),
 ('final-typegen',[str(node),'node_modules/next/dist/bin/next','typegen']),
 ('final-typescript',[str(node),'node_modules/typescript/bin/tsc','--noEmit']),
 ('final-reader-eslint',[str(node),'node_modules/eslint/bin/eslint.js','lib/__tests__/b_pl_6Batch1Evidence.test.ts','lib/__tests__/visualIntelligenceEvidence.test.ts','--format','json','--output-file',str(p/'final-reader-eslint-report.json')])
]
save()
try:
 for name,args in cmds:
  step={'name':name,'argv':args,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};state['checks'].append(step);start=time.monotonic()
  with (p/(name+'.log')).open('x') as output:
   child=subprocess.Popen(args,cwd=t,env=env,stdout=output,stderr=subprocess.STDOUT);step['pid']=child.pid;save();print(json.dumps({'name':name,'pid':child.pid,'state':'RUNNING'}),flush=True);step['exitCode']=child.wait()
  step['seconds']=round(time.monotonic()-start,3);step['logSha256']=sha(p/(name+'.log'));save();print(json.dumps(step),flush=True)
  if step['exitCode']!=0:break
finally:
 if n.exists():(p/'final-next-env.generated.d.ts.txt').write_bytes(n.read_bytes())
 if pre is None:
  if n.exists():n.unlink()
 else:n.write_bytes(pre)
 state['generatedTypesRestored']=(n.read_bytes() if n.exists() else None)==pre
 state['sourceAfter']=snap();state['sourceStable']=state['sourceAfter']==before
 if (p/'strict-composition-readers-report.json').exists():
  r=json.loads((p/'strict-composition-readers-report.json').read_text())
  state['readerCounts']={k:r.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 if (p/'final-reader-eslint-report.json').exists():
  r=json.loads((p/'final-reader-eslint-report.json').read_text())
  state['lintCounts']={k:sum(x[k] for x in r) for k in ['errorCount','warningCount']}
 state['state']='FINAL_SOURCE_AND_COMPOSITION_READERS_PASSED' if len(state['checks'])==4 and all(s.get('exitCode')==0 for s in state['checks']) and state['sourceStable'] and state['generatedTypesRestored'] else 'FINAL_SOURCE_CHECKS_REQUIRE_CLASSIFICATION'
 state['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
print(json.dumps({k:state.get(k) for k in ['state','readerCounts','lintCounts','sourceFileCount','sourceStable','generatedTypesRestored']}),flush=True)
raise SystemExit(0 if state['state']=='FINAL_SOURCE_AND_COMPOSITION_READERS_PASSED' else 1)
