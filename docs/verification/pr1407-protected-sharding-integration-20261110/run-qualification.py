from pathlib import Path
import subprocess,json,hashlib,datetime,time,os
w=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-experience-refinement-20261109-sol-01')
p=w/'docs/verification/pr1407-protected-sharding-integration-20261110'; t=w/'terminal'
head='c0810319e70ab04da776b651580c7f35873088df'; base='04989d7a9b4e235b9a4c056c9f2f60c5d5008d39'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(q):return hashlib.sha256(q.read_bytes()).hexdigest()
def put(q,j):q.write_text(json.dumps(j,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.check_output(['git',*a],cwd=w,text=True).strip()
def snapshot():return json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=w,text=True))
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base
assert not (p/'qualification.json').exists()
before=snapshot();put(p/'source-before.json',before)
r={'schema':'terminal_pr1407_protected_sharding_qualification.v1','originalHead':head,'protectedParent':base,'sourceTreeAtStart':git('write-tree'),'sourceEntries':len(before),'startedAt':now(),'state':'RUNNING','localNodeWebStorageDisabledForJsdom':True,'checks':[]}
def save():put(p/'qualification.json',r)
save()
env=os.environ.copy()
for k in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_VISUAL_EVIDENCE_OPERATION','CAPTURE_ONLY']:env.pop(k,None)
env['NODE_OPTIONS']=(env.get('NODE_OPTIONS','')+' --no-experimental-webstorage').strip()
product=['lib/__tests__/layoutRenameFocus.test.tsx','lib/__tests__/indicatorsScriptRename.test.tsx','lib/__tests__/chartObjectTree.test.tsx','lib/__tests__/layoutMenuTeamRead.test.ts','lib/__tests__/workspaceMenuOps.test.ts','lib/__tests__/workspaceMenuLex.test.ts']
guards=['lib/__tests__/b_f08_6AlertPrefsEvidence.test.ts','lib/__tests__/b_f08_8InvalidationEvidence.test.ts','lib/__tests__/b_f08_9RiskHistoryEvidence.test.ts','lib/__tests__/b_f08_b5_1TargetsEvidence.test.ts','lib/__tests__/conductorFitBadgeZhEvidence.test.ts','lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts','lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts','lib/__tests__/w9t_f08_13TargetsReadoutEvidence.test.ts','lib/__tests__/chartLayersUxEvidence.test.ts','lib/__tests__/optionsExposureEvidence.test.ts']
checks=[('product-and-evidence',['node','node_modules/vitest/vitest.mjs','run',*product,*guards,'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(p/'product-and-evidence.json')]),('typegen',['node','node_modules/next/dist/bin/next','typegen']),('typescript',['node','node_modules/typescript/bin/tsc','--noEmit','--pretty','false'])]
for name,cmd in checks:
 start=time.monotonic();log=p/(name+'.log')
 with log.open('x') as h: result=subprocess.run(cmd,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 row={'name':name,'command':cmd,'exitCode':result.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 if name=='product-and-evidence' and (p/'product-and-evidence.json').exists():
  j=json.loads((p/'product-and-evidence.json').read_text());row['report']={k:j.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 r['checks'].append(row);save();print(json.dumps(row),flush=True)
 if result.returncode:
  r.update({'state':'FAILED','completedAt':now()});save();raise SystemExit(result.returncode)
after=snapshot();put(p/'source-after.json',after)
r.update({'state':'QUALIFIED' if before==after else 'FAILED_SOURCE_CHANGED','sourceStable':before==after,'sourceBeforeSha256':sha(p/'source-before.json'),'sourceAfterSha256':sha(p/'source-after.json'),'completedAt':now()});save()
print(json.dumps(r),flush=True)
assert before==after and git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base
