from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
assert not(t/'.next/dev/lock').exists()
assert json.loads((proof/'actual-evidence-binding.json').read_text())['state']=='BOUND_TO_ACTUAL_240_NATIVE_AND_144_BROWSER_RESULTS'
out=proof/'consumer-validation-r1';assert not out.exists();out.mkdir()
tests=['lib/__tests__/optionsExposureEvidence.test.ts','lib/__tests__/optionsExposureEvidenceOwner.test.ts','lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts','lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts','lib/__tests__/eodHeatmapScopedRecapture.test.ts']
env=os.environ.copy()
for k in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION']:env.pop(k,None)
commands=[('native-readers',['node','node_modules/vitest/vitest.mjs','run',*tests,'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'native-readers.json')]),('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit'])]
record={'schema':'terminal_pr768_current_consumers.v1','startedAt':now(),'state':'RUNNING','results':{}}
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 result={'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'command':command,'logSha256':sha(log)}
 if label=='native-readers' and (out/'native-readers.json').exists():
  value=json.loads((out/'native-readers.json').read_text());result['report']={k:value.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']};result['reportSha256']=sha(out/'native-readers.json')
 record['results'][label]=result;put(out/'execution.json',record);print(json.dumps({label:result}),flush=True)
 if r.returncode:print(log.read_text()[-16000:],flush=True)
record.update({'state':'QUALIFIED' if all(x['exit']==0 for x in record['results'].values()) else 'FAILED','completedAt':now()});put(out/'execution.json',record)
print(json.dumps({'state':record['state']}),flush=True)
raise SystemExit(0 if record['state']=='QUALIFIED' else 1)
