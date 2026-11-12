from pathlib import Path
import subprocess,json,hashlib,datetime,time,os
w=Path(__file__).resolve().parents[3];t=w/'terminal';p=Path(__file__).resolve().parent
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(q):return hashlib.sha256(q.read_bytes()).hexdigest()
def put(q,j):q.write_text(json.dumps(j,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.check_output(['git',*a],cwd=w,text=True).strip()
def snap():return json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=w,text=True))
assert git('rev-parse','HEAD')=='06eb7e854942bb9703fcc1c35a5b3486e9f5238f'
assert git('rev-parse','MERGE_HEAD')=='04989d7a9b4e235b9a4c056c9f2f60c5d5008d39'
assert not (p/'focused-validation.json').exists()
before=snap();put(p/'focused-source-before.json',before)
r={'schema':'terminal_pr632_focused_composition_validation.v1','head':git('rev-parse','HEAD'),'protectedMaster':git('rev-parse','MERGE_HEAD'),'publishedDependency':'f6ff4bb4bbde8a162557cd4e15115cb085e7f77d','sourceEntries':len(before),'startedAt':now(),'state':'RUNNING','checks':[],'localNodeWebStorageDisabledForJsdom':True};put(p/'focused-validation.json',r)
env=os.environ.copy();env['NODE_OPTIONS']=(env.get('NODE_OPTIONS','')+' --no-experimental-webstorage').strip()
specs=['drawingTools.test.ts','drawingInteraction.test.ts','drawingGeometry.test.ts','drawingSettings.test.ts','boatsChartCoverage.test.ts']
checks=[('focused-tests',['node','node_modules/vitest/vitest.mjs','run',*['lib/__tests__/'+s for s in specs],'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(p/'focused-tests-report.json')]),('typegen',['node','node_modules/next/dist/bin/next','typegen']),('typescript',['node','node_modules/typescript/bin/tsc','--noEmit','--pretty','false'])]
for name,cmd in checks:
 start=time.monotonic();log=p/(name+'.log')
 with log.open('x') as h:v=subprocess.run(cmd,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 row={'name':name,'command':cmd,'exitCode':v.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 if name=='focused-tests' and (p/'focused-tests-report.json').exists():
  j=json.loads((p/'focused-tests-report.json').read_text());row['stats']={k:j.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 r['checks'].append(row);put(p/'focused-validation.json',r);print(json.dumps(row),flush=True)
 if v.returncode:r.update({'state':'FAILED','completedAt':now()});put(p/'focused-validation.json',r);raise SystemExit(v.returncode)
after=snap();put(p/'focused-source-after.json',after)
r.update({'state':'QUALIFIED' if before==after else 'FAILED_SOURCE_CHANGED','sourceStable':before==after,'sourceBeforeSha256':sha(p/'focused-source-before.json'),'sourceAfterSha256':sha(p/'focused-source-after.json'),'completedAt':now()});put(p/'focused-validation.json',r)
assert before==after
print(json.dumps({'state':r['state'],'sourceEntries':len(after),'sourceStable':True}),flush=True)
