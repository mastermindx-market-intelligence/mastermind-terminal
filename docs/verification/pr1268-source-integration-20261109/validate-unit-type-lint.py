from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'unit-type-lint-r1'
head='f7276cf077b877a54509cba28ab247b5524d8530';base='03af393ce05c12282003a3919cc473c032264922'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
browser=json.loads((proof/'browser-r1/execution.json').read_text());assert browser['state']=='QUALIFIED' and browser['passed']==88 and browser['skipped']==8
before=json.loads((proof/'browser-r1/source-after.json').read_text())
def snapshot():return {p:sha(repo/p) for p in before}
assert snapshot()==before and not out.exists();out.mkdir();put(out/'source-before.json',before)
tests=['lib/__tests__/'+n+'.test.ts' for n in ['boatsChartCoverage','boatsChartRefresh','tiingoBoatsLiveHistory','extQuoteFreshness','tiingoBoatsCoverage','boatsWarmCacheIntegration']]
lint=['components/ChartBoatsStatus.tsx','lib/extQuoteCopy.ts','e2e/overnight-status.spec.ts','lib/__tests__/boatsChartCoverage.test.ts']
commands=[('units',['node','node_modules/vitest/vitest.mjs','run',*tests,'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'units.json')]),('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit']),('lint',['node','node_modules/eslint/bin/eslint.js',*lint])]
record={'schema':'terminal_pr1268_affected_units_type_lint.v1','state':'RUNNING','sourceEntries':len(before),'startedAt':now(),'results':{}}
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,stdout=h,stderr=subprocess.STDOUT)
 result={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 if label=='units' and (out/'units.json').exists():
  d=json.loads((out/'units.json').read_text());result['report']={k:d.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 record['results'][label]=result;record['sourceStable']=snapshot()==before;put(out/'execution.json',record);print(json.dumps({label:result,'sourceStable':record['sourceStable']}),flush=True)
 if r.returncode:print(log.read_text()[-12000:],flush=True)
after=snapshot();put(out/'source-after.json',after)
good=all(x['exit']==0 for x in record['results'].values()) and after==before and record['results']['units']['report']=={'success':True,'numTotalTests':86,'numPassedTests':86,'numFailedTests':0,'numPendingTests':0}
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now(),'sourceStable':before==after});put(out/'execution.json',record)
raise SystemExit(0 if good else 1)
