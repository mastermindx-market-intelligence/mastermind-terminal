from pathlib import Path
import subprocess,json,hashlib,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'source-checks-r1'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
b=json.loads((proof/'consumer-browser-r2/execution.json').read_text());assert b['state']=='QUALIFIED' and b['stats']['expected']==12
source=json.loads((proof/'consumer-browser-r2/source-after.json').read_text());assert all(sha(repo/p)==h for p,h in source.items())
assert not out.exists();out.mkdir();put(out/'source-before.json',source)
record={'schema':'terminal_pr1291_fixture_source_checks.v1','state':'RUNNING','startedAt':now(),'sourceEntries':len(source),'results':{}}
commands=[('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']),('lint',['node','node_modules/eslint/bin/eslint.js','e2e/options-plan-compare-mounted.spec.ts','e2e/options-exposure-surface-journey.spec.ts','--max-warnings=0'])]
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,stdout=h,stderr=subprocess.STDOUT)
 v={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 record['results'][label]=v;record['sourceStable']=all(sha(repo/p)==h for p,h in source.items());put(out/'execution.json',record);print(json.dumps({label:v,'sourceStable':record['sourceStable']}),flush=True)
 if r.returncode:print(log.read_text()[-14000:],flush=True)
after={p:sha(repo/p) for p in source};put(out/'source-after.json',after)
good=all(v['exit']==0 for v in record['results'].values()) and after==source
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now(),'sourceStable':after==source});put(out/'execution.json',record)
raise SystemExit(0 if good else 1)
