from pathlib import Path
import subprocess,json,hashlib,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'reader-preflight-r1'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
assert not out.exists();out.mkdir()
record={'schema':'terminal_pr1248_reader_preflight.v1','state':'RUNNING','startedAt':now(),'results':{}}
commands=[
('legacy-boundary',['node','--test','e2e/tools/optionsExposureEvidence.cases.cjs']),
('source-reader-and-prophet',['node','node_modules/vitest/vitest.mjs','run','lib/__tests__/optionsExposureEvidence.test.ts','lib/__tests__/prophetOriginationDisclosure.test.ts','--reporter=json','--outputFile='+str(out/'unit-report.json')])]
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,stdout=h,stderr=subprocess.STDOUT)
 record['results'][label]={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 put(out/'execution.json',record);print(json.dumps({label:record['results'][label]}),flush=True)
 if r.returncode:print(log.read_text()[-14000:],flush=True)
report=json.loads((out/'unit-report.json').read_text()) if (out/'unit-report.json').exists() else {}
record['unitStats']={k:report.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','success']}
good=all(v['exit']==0 for v in record['results'].values()) and report.get('success') is True
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now()});put(out/'execution.json',record);print(json.dumps(record),flush=True)
raise SystemExit(0 if good else 1)
