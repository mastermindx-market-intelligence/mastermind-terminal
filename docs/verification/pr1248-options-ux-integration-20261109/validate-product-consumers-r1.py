from pathlib import Path
import subprocess,json,hashlib,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'product-consumers-r1'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
paths=set(json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout))
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
tests=['replayEngine.test.ts','researchReportedGammaMounted.test.tsx','prophetOriginationDisclosure.test.ts','leadersPresentation.test.ts','flowDeskMalformedFeedEvents.test.tsx','selectionCohort.test.ts','surfaceContract.test.ts','researchReportedGamma.test.ts','selectionCohortCssBoundary.test.ts','flowFreshness.test.ts','flowPrintInspector.test.ts','flowPrintInspectorView.test.tsx','optionsWorkspaceNavigation.test.tsx']
assert not out.exists();out.mkdir();before=snapshot();put(out/'source-before.json',before)
commands=[('units',['node','node_modules/vitest/vitest.mjs','run',*['lib/__tests__/'+n for n in tests],'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'units.json')]),('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']),('lint',['node','node_modules/eslint/bin/eslint.js','components/flowdesk/FlowFreshnessReceipt.tsx','components/workspaces/OptionsWorkspace.tsx','e2e/flow-freshness-responsive.spec.ts','--max-warnings=0'])]
record={'schema':'terminal_pr1248_product_consumer_validation.v1','state':'RUNNING','startedAt':now(),'sourceEntries':len(before),'testFiles':tests,'results':{}}
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,stdout=h,stderr=subprocess.STDOUT)
 v={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 if label=='units' and (out/'units.json').exists():
  data=json.loads((out/'units.json').read_text());v['report']={k:data.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTotalTestSuites','numPassedTestSuites']}
 record['results'][label]=v;record['sourceStable']=snapshot()==before;put(out/'execution.json',record);print(json.dumps({label:v,'sourceStable':record['sourceStable']}),flush=True)
 if r.returncode:print(log.read_text()[-18000:],flush=True)
after=snapshot();put(out/'source-after.json',after)
good=all(v['exit']==0 for v in record['results'].values()) and after==before
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now(),'sourceStable':after==before});put(out/'execution.json',record)
raise SystemExit(0 if good else 1)
