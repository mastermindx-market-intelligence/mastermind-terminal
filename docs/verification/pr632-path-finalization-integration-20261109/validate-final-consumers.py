from pathlib import Path
import subprocess,json,os,time,hashlib,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
owner=json.loads((proof/'ci-owner-r1/execution-final.json').read_text());assert owner['state']=='FULL_OWNER_PATH_QUALIFIED_WITHIN_EXISTING_WORKFLOW_BUDGET'
out=proof/'final-consumers-r1';assert not out.exists();out.mkdir()
tests=['lib/__tests__/b_pl_6Batch1Evidence.test.ts','lib/__tests__/visualIntelligenceEvidence.test.ts','lib/__tests__/optionsLevelAxisEvidence.test.ts','lib/__tests__/b_pl_6Batch2Evidence.test.ts','lib/__tests__/pineBootPendingEvidence.test.ts']
commands=[('selected-consumers',['node','node_modules/vitest/vitest.mjs','run',*tests,'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'selected-consumers.json')])]
record={'schema':'terminal_pr632_final_consumer_validation.v1','state':'RUNNING','composition':owner['composition'],'results':{}}
for label,command in commands:
 env=os.environ.copy();env.pop('TERMINAL_EVIDENCE_MODE',None);env.pop('TERMINAL_EVIDENCE_COMPOSITION',None)
 if label=='selected-consumers':env.update({'TERMINAL_EVIDENCE_MODE':'records','TERMINAL_EVIDENCE_COMPOSITION':owner['composition']['path']})
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 result={'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'command':command,'logSha256':sha(log)}
 if label=='selected-consumers' and (out/'selected-consumers.json').exists():
  d=json.loads((out/'selected-consumers.json').read_text());result['report']={k:d.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 record['results'][label]=result;put(out/'execution.json',record);print(json.dumps({label:result}),flush=True)
 if r.returncode:print(log.read_text()[-14000:],flush=True)
record.update({'state':'QUALIFIED' if all(x['exit']==0 for x in record['results'].values()) else 'FAILED','completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()});put(out/'execution.json',record)
raise SystemExit(0 if record['state']=='QUALIFIED' else 1)