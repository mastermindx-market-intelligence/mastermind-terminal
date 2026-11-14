from pathlib import Path
import subprocess,json,time,hashlib,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
assert json.loads((proof/'capture-r2/execution.json').read_text())['state']=='FULL_16_CAPTURE_QUALIFIED'
assert json.loads((proof/'capture-r2/supervision.json').read_text())['state']=='CLOSED'
out=proof/'checks-r1';assert not out.exists();out.mkdir()
commands=[('reader',['node','node_modules/vitest/vitest.mjs','run','lib/__tests__/b_f08_b5_3CollisionsEvidence.test.ts','--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'reader.json')]),('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit']),('lint',['node','node_modules/eslint/bin/eslint.js','e2e/tools/capture_b_f08_b5_3_collisions.cjs','lib/__tests__/b_f08_b5_3CollisionsEvidence.test.ts'])]
record={'schema':'terminal_pr896_affected_checks.v1','state':'RUNNING','results':{}}
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,stdout=h,stderr=subprocess.STDOUT)
 result={'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'command':command,'logSha256':sha(log)}
 if label=='reader' and (out/'reader.json').exists():
  d=json.loads((out/'reader.json').read_text());result['report']={k:d.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 record['results'][label]=result;put(out/'execution.json',record);print(json.dumps({label:result}),flush=True)
 if r.returncode:print(log.read_text()[-10000:],flush=True)
record.update({'state':'QUALIFIED' if all(x['exit']==0 for x in record['results'].values()) else 'FAILED','completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()});put(out/'execution.json',record)
raise SystemExit(0 if record['state']=='QUALIFIED' else 1)
