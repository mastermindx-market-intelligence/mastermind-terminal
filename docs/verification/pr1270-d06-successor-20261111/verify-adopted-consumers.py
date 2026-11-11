from pathlib import Path
import hashlib,json,subprocess,time,datetime,os
w=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/d06-terminal-reader-resilience-20261103-c4')
p=w/'docs/verification/pr1270-d06-successor-20261111/reader-adoption'
assert (p/'receipt.json').exists() and not (p/'consumer-checks.json').exists()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
receipt=json.loads((p/'receipt.json').read_text())
assert receipt['state']=='QUALIFIED_D06_PINS_ADOPTED_AWAITING_CONSUMER_CHECKS'
assert sha(w/'terminal/e2e/tools/optionsExposureEvidence.cjs')==receipt['reader']['afterSha256']
assert sha(w/'terminal/lib/__tests__/optionsExposureEvidenceOwner.test.ts')==receipt['ownerTests']['afterSha256']
suites=['lib/__tests__/optionsExposureD06Successor.test.ts','lib/__tests__/optionsExposureEvidenceOwner.test.ts','lib/__tests__/optionsExposureHeatmapCopy.test.ts','lib/__tests__/optionsExposureR5Successor.test.ts','lib/__tests__/optionsExposureEvidence.test.ts','lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts','lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts']
assert all((w/'terminal'/s).is_file() for s in suites)
inputs=['terminal/e2e/tools/optionsExposureEvidence.cjs','terminal/e2e/tools/optionsExposureEvidence.d.cts',*['terminal/'+s for s in suites]]
before={s:sha(w/s) for s in inputs}
probe="""const assert=require('node:assert/strict'); const owner=require('./e2e/tools/capture_ci_evidence.cjs'); const root=require('node:path').resolve('..'); const out={}; for(const [kind,pin] of Object.entries({eod:'46b35e7f1bf23454dede63797644bb4d8082bdb484dfa7918e377f9b3e1c6a90',gex:'076271811c0cedfec4ad4d0344ec3594aa20c9d44e30cd1287fc94179ebe471c'})){const packet=kind==='eod'?owner.eodPacket(root):owner.gexPacket(root); assert.equal(packet.selection,'qualified'); assert.equal(packet.capturedAtHead,'357c32f1a330dda9362955361ae0ab30a3e54048'); assert.equal(packet.captureRevision,'d06-r5-copy-20261111'); assert.equal(packet.descriptorSha256,pin); assert.deepEqual(packet.plan,{required:false,changed:[]}); out[kind]={path:packet.path,sha256:packet.sha256,capturedAtHead:packet.capturedAtHead,captureRevision:packet.captureRevision,descriptorSha256:packet.descriptorSha256,plan:packet.plan};} console.log(JSON.stringify(out));"""
checks=[
 ('reader-syntax',['node','--check','e2e/tools/optionsExposureEvidence.cjs']),
 ('current-owner-probe',['node','-e',probe]),
 ('affected-consumers',['./node_modules/.bin/vitest','run',*suites,'--maxWorkers=1','--minWorkers=1','--reporter=default','--reporter=json','--outputFile='+str(p/'vitest-report.json')]),
 ('typescript',['./node_modules/.bin/tsc','--noEmit']),
 ('affected-lint',['./node_modules/.bin/eslint','--max-warnings=0',*suites]),
]
record={'state':'RUNNING','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'before':before,'checks':[]}
def save():(p/'consumer-checks.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
save();print(json.dumps({'state':'STARTED','suites':len(suites),'checks':[n for n,_ in checks]}),flush=True)
for name,cmd in checks:
 started=time.monotonic();print(json.dumps({'stage':name,'state':'STARTED'}),flush=True)
 with (p/(name+'.log')).open('w') as log:r=subprocess.run(cmd,cwd=w/'terminal',stdout=log,stderr=subprocess.STDOUT,text=True)
 item={'name':name,'command':cmd,'exit':r.returncode,'seconds':round(time.monotonic()-started,3),'logSha256':sha(p/(name+'.log'))}
 record['checks'].append(item);save();print(json.dumps({k:v for k,v in item.items() if k!='command'}),flush=True)
 if r.returncode:
  record['state']='FAILED';save();print((p/(name+'.log')).read_text()[-6000:],flush=True);raise SystemExit(r.returncode)
record['after']={s:sha(w/s) for s in inputs};assert record['before']==record['after']
diff=subprocess.run(['git','-C',str(w),'diff','--check'],text=True,capture_output=True)
(p/'diff-check.log').write_text(diff.stdout+diff.stderr)
record['diffCheckExit']=diff.returncode
assert diff.returncode==0,diff.stdout+diff.stderr
maps={}
base=w/'terminal/docs/verification/exposure-workspace-20261103/d06-r5-copy-20261111'
for stage,directory in [('joint',base),('expiry',base/'expiry-journeys')]:
 proof=json.loads((directory/'qualification.json').read_text())
 assert all(sha(w/path)==pin for path,pin in proof['currentSources'].items());maps[stage]=len(proof['currentSources'])
for kind,packet in [('eod','eod-heatmap-flowdesk-load-failure'),('gex','gex-levels-heatmap-load-failure')]:
 descriptor=json.loads((w/'terminal/docs/pr-crops'/packet/'operations/exposure-source-compatibility-20261105/revisions/d06-r5-copy-20261111/native-packet.json').read_text())
 maps[kind]='validated through both current owner entry points'
record['currentApplicability']=maps;record['state']='ALL_AFFECTED_CONSUMERS_PASSED';record['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
report=json.loads((p/'vitest-report.json').read_text())
print(json.dumps({'state':record['state'],'numPassedTests':report.get('numPassedTests'),'numFailedTests':report.get('numFailedTests'),'numPendingTests':report.get('numPendingTests'),'sourceStable':True,'applicability':maps}),flush=True)
