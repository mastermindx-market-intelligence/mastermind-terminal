from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
proof=Path(__file__).resolve().parent;repo=proof.parents[2];terminal=repo/'terminal'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,d): p.write_text(json.dumps(d,indent=2,sort_keys=True)+'\n')
def sources(): return json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
def git(*a): return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
assert git('rev-parse','HEAD')=='06eb7e854942bb9703fcc1c35a5b3486e9f5238f'
assert git('rev-parse','MERGE_HEAD')=='04989d7a9b4e235b9a4c056c9f2f60c5d5008d39'
owner=json.loads((proof/'ci-owner-current/execution.json').read_text());assert owner['state']=='FULL_OWNER_PATH_QUALIFIED_WITHIN_EXISTING_WORKFLOW_BUDGET'
assert owner['ownerState']=='SELECTED' and owner['sourceStable'] and owner['ownedPortsClosed'] and owner['nextLockAbsent']
selected=proof/'ci-owner-current/selected-env';env=os.environ.copy()
for line in selected.read_text().splitlines():
 key,val=line.split('=',1);assert key in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION'];env[key]=val
assert env['TERMINAL_EVIDENCE_MODE']=='records' and env['TERMINAL_EVIDENCE_COMPOSITION']==owner['composition']['path']
assert sha(repo/owner['composition']['path'])==owner['composition']['sha256']
env['NODE_OPTIONS']='--no-experimental-webstorage'
before=sources();assert len(before)==2006 and before==json.loads((proof/'ci-owner-current/source-after.json').read_text())
report=proof/'evidence-consumers-report.json';log=proof/'evidence-consumers.log';receipt=proof/'evidence-consumers.json'
assert not report.exists() and not log.exists() and not receipt.exists()
files=['b_pl_6Batch1Evidence.test.ts','visualIntelligenceEvidence.test.ts','optionsLevelAxisEvidence.test.ts','b_pl_6Batch2Evidence.test.ts','pineBootPendingEvidence.test.ts','b_pl_6Batch3Evidence.test.ts','eodHeatmapFlowdeskLoadFailureEvidence.test.ts','gexLevelsHeatmapLoadFailureEvidence.test.ts']
command=['node','node_modules/vitest/vitest.mjs','run']+['lib/__tests__/'+f for f in files]+['--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(report)]
d={'schema':'terminal_pr632_current_evidence_consumers.v1','state':'RUNNING','startedAt':now(),'command':command,'nodeOptions':env['NODE_OPTIONS'],'composition':owner['composition'],'selectedEnvSha256':sha(selected),'sourceEntries':len(before)}
put(receipt,d);print(json.dumps({'starting':'Current evidence consumers','files':len(files),'sourceEntries':len(before)}),flush=True)
start=time.monotonic()
try:
 with log.open('x') as h:r=subprocess.run(command,cwd=terminal,env=env,stdout=h,stderr=subprocess.STDOUT)
 after=sources();parsed=json.loads(report.read_text())
 d.update(exit=r.returncode,completedAt=now(),seconds=round(time.monotonic()-start,2),logSha256=sha(log),reportSha256=sha(report),sourceStable=before==after,stats={k:parsed[k] for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']})
 put(receipt,d)
 assert r.returncode==0 and parsed['success'] and parsed['numPassedTests']==45 and parsed['numFailedTests']==0 and parsed['numPendingTests']==0 and before==after
 d['state']='QUALIFIED';put(receipt,d);print(json.dumps(d),flush=True)
except BaseException as e:
 d.update(state='FAILED',error=repr(e),completedAt=now());put(receipt,d);raise
