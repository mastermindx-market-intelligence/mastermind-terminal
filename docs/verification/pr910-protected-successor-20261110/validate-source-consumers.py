from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'source-consumers-current'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
assert git('rev-parse','HEAD')=='7f4983f59a788962876a5d13ee02917c243e8afe' and git('rev-parse','MERGE_HEAD')=='839bace1e89dd6def9311d3a410786c73a6332aa' and not git('diff','--name-only','--diff-filter=U')
capture=json.loads((proof/'browser-current/execution.json').read_text());binding=json.loads((proof/'manifest-binding.json').read_text())
assert capture['state']=='QUALIFIED' and binding['state']=='CURRENT_CAPTURE_BOUND'
source=json.loads((proof/'browser-current/source-after.json').read_text())
assert all(sha(repo/p)==h for p,h in source.items())
paths=set(source)|{'terminal/docs/pr-crops/ticker-news/EVIDENCE.yml'}|{'terminal/docs/pr-crops/ticker-news/'+p for p in capture['images']}
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
assert not out.exists();out.mkdir();before=snapshot();put(out/'source-before.json',before)
commands=[('units',['node','node_modules/vitest/vitest.mjs','run','lib/__tests__/tickerNewsEvidence.test.ts','--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'units.json')]),('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']),('lint',['node','node_modules/eslint/bin/eslint.js','e2e/ticker-news.spec.ts','lib/__tests__/tickerNewsEvidence.test.ts','--max-warnings=0'])]
record={'schema':'terminal_pr910_final_source_consumers.v1','state':'RUNNING','startedAt':now(),'sourceAndPacketEntries':len(before),'results':{}}
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,stdout=h,stderr=subprocess.STDOUT)
 v={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 if label=='units' and (out/'units.json').exists():
  data=json.loads((out/'units.json').read_text());v['report']={k:data.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 record['results'][label]=v;record['sourceStable']=snapshot()==before;put(out/'execution.json',record);print(json.dumps({label:v,'sourceStable':record['sourceStable']}),flush=True)
 if r.returncode:print(log.read_text()[-14000:],flush=True)
after=snapshot();put(out/'source-after.json',after)
good=all(v['exit']==0 for v in record['results'].values()) and after==before and record['results']['units']['report']=={'success':True,'numTotalTests':4,'numPassedTests':4,'numFailedTests':0,'numPendingTests':0}
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now(),'sourceStable':after==before});put(out/'execution.json',record)
raise SystemExit(0 if good else 1)
