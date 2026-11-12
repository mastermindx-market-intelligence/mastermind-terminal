from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'source-consumers-current'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
assert git('rev-parse','HEAD')=='139ec0574b57ecbb59d237dc315c8276dd307794' and git('rev-parse','HEAD^{tree}')=='0af51d3051bb9be1052b156f95b33fcaa3cb1957' and not git('diff','--name-only','--diff-filter=U')
capture=json.loads((proof/'browser-current/execution.json').read_text());binding=json.loads((proof/'manifest-binding.json').read_text())
assert capture['state']=='QUALIFIED' and binding['state']=='CURRENT_CAPTURE_BOUND'
source=json.loads((proof/'browser-current/source-after.json').read_text())
assert all(sha(repo/p)==h for p,h in source.items())
paths=set(source)|{'terminal/docs/pr-crops/ticker-news/EVIDENCE.yml'}|{'terminal/docs/pr-crops/ticker-news/'+p for p in capture['images']}
def snapshot():
 discovered=json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
 assert not set(discovered)-set(source),'SOURCE_MEMBERSHIP_CHANGED'
 return {p:sha(repo/p) for p in sorted(paths)}
assert not out.exists();out.mkdir();before=snapshot();put(out/'source-before.json',before)
commands=[('units',['node','node_modules/vitest/vitest.mjs','run','lib/__tests__/tickerNewsEvidence.test.ts','--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'units.json')]),('lint',['node','node_modules/eslint/bin/eslint.js','e2e/ticker-news.spec.ts','lib/__tests__/tickerNewsEvidence.test.ts','--max-warnings=0'])]
typecheck=json.loads((proof/'typecheck-reuse.json').read_text());assert typecheck['state']=='EXACT_SOURCE_TREE_CI_REUSED' and typecheck['ciTree']==git('rev-parse','HEAD^{tree}') and typecheck['typecheck']['conclusion']=='success'
record={'reusedTypecheck':typecheck,'schema':'terminal_pr1426_final_source_consumers.v1','state':'RUNNING','startedAt':now(),'sourceAndPacketEntries':len(before),'results':{}}
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,stdout=h,stderr=subprocess.STDOUT)
 v={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 if label=='units' and (out/'units.json').exists():
  data=json.loads((out/'units.json').read_text());v['report']={k:data.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 record['results'][label]=v;record['sourceStable']=snapshot()==before;put(out/'execution.json',record);print(json.dumps({label:v,'sourceStable':record['sourceStable']}),flush=True)
 if r.returncode:
  record.update({'state':'FAILED','completedAt':now()});put(out/'execution.json',record)
  print(log.read_text()[-14000:],flush=True);raise SystemExit(r.returncode)
after=snapshot();put(out/'source-after.json',after)
good=all(v['exit']==0 for v in record['results'].values()) and after==before and record['results']['units']['report']=={'success':True,'numTotalTests':4,'numPassedTests':4,'numFailedTests':0,'numPendingTests':0}
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now(),'sourceStable':after==before});put(out/'execution.json',record)
raise SystemExit(0 if good else 1)
