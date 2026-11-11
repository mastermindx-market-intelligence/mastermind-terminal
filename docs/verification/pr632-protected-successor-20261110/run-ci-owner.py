from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[3]
terminal=repo/'terminal'; proof=Path(__file__).resolve().parent; out=proof/'ci-owner-current'
head='06eb7e854942bb9703fcc1c35a5b3486e9f5238f'
mergeHead='04989d7a9b4e235b9a4c056c9f2f60c5d5008d39'
protected='04989d7a9b4e235b9a4c056c9f2f60c5d5008d39'
dependency='f6ff4bb4bbde8a162557cd4e15115cb085e7f77d'
workflow='05d88e88524d3235f0f916e6aec19b17460fdaac'
owner='51956187614f10d745c5a65f62621845d96cac25'
ports=[3536,3537,3538,3571,3572,3564,3566]
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x): p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def git(*a): return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
def sources(): return json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
def closed(port):
 r=subprocess.run(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True)
 assert r.returncode in [0,1] and not r.stderr.strip(),(port,r.returncode,r.stderr)
 return r.returncode==1
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==mergeHead and not git('ls-files','-u')
assert git('hash-object','.github/workflows/ci.yml')==workflow
assert git('hash-object','terminal/e2e/tools/capture_ci_evidence.cjs')==owner
assert not out.exists() and not (terminal/'.next/dev/lock').exists() and all(closed(p) for p in ports)
browser=json.loads((proof/'drawing-regression-current/execution.json').read_text())
assert browser['state']=='QUALIFIED' and browser['browser']['stats']['expected']==89 and browser['browser']['stats']['skipped']==94
assert browser['browser']['stats']['unexpected']==0 and browser['browser']['stats']['flaky']==0 and browser['browser']['sourceStable']
assert browser['ownedPortClosed'] and browser['nextLockAbsent']
assert all(sha(repo/p)==h for p,h in json.loads((proof/'drawing-regression-current/source-after.json').read_text()).items())
focused=json.loads((proof/'focused-validation.json').read_text())
assert focused['state']=='QUALIFIED' and [c['name'] for c in focused['checks']]==['focused-tests','typegen','typescript']
assert all(c['exitCode']==0 for c in focused['checks'])
assert focused['checks'][0]['stats']['numPassedTests']==30
assert json.loads((proof/'drawing-guard-current/execution.json').read_text())['state']=='QUALIFIED'
composition=json.loads((proof/'composition.json').read_text())
assert composition['state']=='CONFLICTS_RESOLVED_PENDING_SOURCE_AND_PROOF_QUALIFICATION' and composition['protectedMaster']==protected
out.mkdir()
before=sources(); put(out/'source-before.json',before)
env=os.environ.copy()
for key in ['GITHUB_SHA','GITHUB_EVENT_PATH','GITHUB_WORKFLOW_REF','GITHUB_REF','TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_VISUAL_EVIDENCE_OPERATION','CAPTURE_ONLY']:
 env.pop(key,None)
# Numeric diagnostic identity belongs only to this local execution, not GitHub Actions.
runId=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')+'632'; attempt='1'; prefix='ci-'+runId+'-'+attempt
env.update({'GITHUB_RUN_ID':runId,'GITHUB_RUN_ATTEMPT':attempt,'GITHUB_EVENT_NAME':'local_validation','GITHUB_ENV':str(out/'selected-env'),'RUNNER_TEMP':str(out/'runner-temp'),'PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
git('add','--',str(proof.relative_to(repo)))
command=['node','e2e/tools/capture_ci_evidence.cjs']; log=out/'owner.log'
record={'schema':'terminal_pr632_complete_ci_owner_validation.v2','executionEnvironment':'Owned local validation; not a GitHub Actions run.','localDiagnosticRunId':runId,'localDiagnosticAttempt':attempt,'branchHead':head,'actualGitMergeHead':mergeHead,'protectedMaster':protected,'integratedDependency':dependency,'indexTreeAtStart':git('write-tree'),'command':command,'workflowBlob':workflow,'captureOwnerBlob':owner,'workflowCaptureMinutes':85,'ownerSharedDeadlineMinutes':84,'sourceEntries':len(before),'startedAt':now(),'state':'RUNNING','ownedPorts':ports,'priorBrowserExecutionSha256':sha(proof/'drawing-regression-current/execution.json'),'priorFocusedValidationSha256':sha(proof/'focused-validation.json'),'sourceCompositionReceiptSha256':sha(proof/'composition.json')}
def save(): put(out/'execution.json',record)
save(); print(json.dumps({'starting':'Existing complete CI evidence owner','localDiagnosticId':prefix,'notGitHubRun':True,'sourceEntries':len(before),'captureBudgetMinutes':84}),flush=True)
start=time.monotonic()
try:
 with log.open('x') as h:
  result=subprocess.run(command,cwd=terminal,env=env,stdout=h,stderr=subprocess.STDOUT)
 after=sources(); put(out/'source-after.json',after)
 record.update({'exit':result.returncode,'completedAt':now(),'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':before==after,'sourceBeforeSha256':sha(out/'source-before.json'),'sourceAfterSha256':sha(out/'source-after.json')});save()
 diagnostic=out/'runner-temp/terminal-ci-evidence'/(prefix+'.json')
 assert diagnostic.exists()
 native=json.loads(diagnostic.read_text())
 record.update({'ownerReceipt':str(diagnostic.relative_to(repo)),'ownerReceiptSha256':sha(diagnostic),'ownerState':native['state']});save()
 assert result.returncode==0 and native['state']=='SELECTED' and before==after and record['seconds']<84*60
 assert native['composition']['selectedCases']==50 and len(native['references'])==2
 assert native['optionsAxis']['required'] is True
 selected=(out/'selected-env').read_text(); composition=native['composition']['path']
 assert selected=='TERMINAL_EVIDENCE_MODE=records\nTERMINAL_EVIDENCE_COMPOSITION='+composition+'\n'
 assert sha(repo/composition)==native['composition']['sha256']
 record.update({'composition':native['composition'],'capturedChildren':[c['packet'] for c in native['children']],'optionsAxisCaptureRequired':native['optionsAxis']['required'],'ownedPortsClosed':all(closed(p) for p in ports),'nextLockAbsent':not (terminal/'.next/dev/lock').exists()});save()
 assert record['ownedPortsClosed'] and record['nextLockAbsent']
 assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==mergeHead and git('hash-object','.github/workflows/ci.yml')==workflow
 record['state']='FULL_OWNER_PATH_QUALIFIED_WITHIN_EXISTING_WORKFLOW_BUDGET';save();print(json.dumps(record),flush=True)
except BaseException as e:
 record.update({'state':'FAILED','error':repr(e),'completedAt':now()});save();raise
