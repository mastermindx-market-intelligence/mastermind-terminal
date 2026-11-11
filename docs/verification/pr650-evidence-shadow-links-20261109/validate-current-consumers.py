from pathlib import Path
import subprocess,json,hashlib,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'current-consumers-r1'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
assert not out.exists();out.mkdir()
paths=set(json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout))
paths.add('terminal/lib/__tests__/optionsExposureEvidenceOwner.test.ts')
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
before=snapshot();put(out/'source-before.json',before)
record={'schema':'terminal_evidence_shadow_current_consumers.v1','state':'RUNNING','startedAt':now(),'sourceEntries':len(before),'results':{}}
commands=[
('readers',['node','node_modules/vitest/vitest.mjs','run','lib/__tests__/optionsExposureEvidenceOwner.test.ts','lib/__tests__/optionsExposureEvidence.test.ts','--reporter=json','--outputFile='+str(out/'unit-report.json')]),
('legacy-boundary',['node','--test','e2e/tools/optionsExposureEvidence.cases.cjs']),
('typegen',['node','node_modules/next/dist/bin/next','typegen']),
('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']),
('lint',['node','node_modules/eslint/bin/eslint.js','lib/__tests__/optionsExposureEvidenceOwner.test.ts','--max-warnings=0'])]
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label,'proof':proof.name}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,stdout=h,stderr=subprocess.STDOUT)
 record['results'][label]={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 record['sourceStable']=snapshot()==before;put(out/'execution.json',record);print(json.dumps({label:record['results'][label],'sourceStable':record['sourceStable']}),flush=True)
 if r.returncode:print(log.read_text()[-16000:],flush=True)
after=snapshot();put(out/'source-after.json',after)
report=json.loads((out/'unit-report.json').read_text());record['unitStats']={k:report.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','success']}
good=all(v['exit']==0 for v in record['results'].values()) and before==after and report['success'] and report['numFailedTests']==0
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now(),'sourceStable':before==after});put(out/'execution.json',record)
print(json.dumps({'state':record['state'],'unitStats':record['unitStats'],'sourceStable':before==after,'sourceEntries':len(before)}),flush=True)
raise SystemExit(0 if good else 1)
