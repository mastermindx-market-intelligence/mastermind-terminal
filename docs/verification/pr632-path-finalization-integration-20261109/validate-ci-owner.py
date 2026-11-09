from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[3];terminal=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'ci-owner-r1'
head='9aa40ffb0b640afeac794d6fa2ca0aaf61d4d3e4';base='156c4b3ecfa27b9137c64068b3ed969e07efbe49';dependency='d03e7587711f1182531f25459fa1f60c679bac10'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
def sources():return json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
def closed(port):
 r=subprocess.run(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True)
 assert r.returncode in [0,1] and not r.stderr.strip()
 return r.returncode==1
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
assert git('hash-object','.github/workflows/ci.yml')=='637c518ecf481d9af5224c21e93db83b00593cea'
assert not out.exists() and not(terminal/'.next/dev/lock').exists() and all(closed(p) for p in [3536,3537,3538,3571,3564,3566])
browserProof=json.loads((proof/'drawing-regression-r1-continuation/execution.json').read_text());assert browserProof['state']=='QUALIFIED' and browserProof['browser']['stats']['expected']==89 and browserProof['browser']['stats']['skipped']==94 and browserProof['unitTestsPassed']==25
assert browserProof['chartPanelLint']['state']=='NO_NEW_DIAGNOSTICS' and browserProof['drawingSpecLint']['state']=='NO_NEW_DIAGNOSTICS'
assert all(sha(repo/p)==h for p,h in json.loads((proof/'drawing-regression-r1-continuation/source-after.json').read_text()).items())
out.mkdir();before=sources();put(out/'source-before.json',before)
env=os.environ.copy()
for key in ['GITHUB_SHA','GITHUB_EVENT_PATH','GITHUB_WORKFLOW_REF','GITHUB_REF','TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_VISUAL_EVIDENCE_OPERATION','CAPTURE_ONLY']:env.pop(key,None)
# The incumbent entrypoint requires numeric diagnostic IDs. These are explicitly local,
# never an assertion that a GitHub Actions run with this ID exists.
runId='20261109190632';attempt='1';prefix='ci-'+runId+'-'+attempt
env.update({'GITHUB_RUN_ID':runId,'GITHUB_RUN_ATTEMPT':attempt,'GITHUB_EVENT_NAME':'local_validation','GITHUB_ENV':str(out/'selected-env'),'RUNNER_TEMP':str(out/'runner-temp'),'PLAYWRIGHT_BROWSERS_PATH':str(terminal/'node_modules/.cache/pr768-playwright'),'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
command=['node','e2e/tools/capture_ci_evidence.cjs'];log=out/'owner.log'
git('add','-A')
record={'schema':'terminal_pr632_complete_ci_owner_validation.v1','executionEnvironment':'owned local validation; not a GitHub Actions run','localDiagnosticRunId':runId,'localDiagnosticAttempt':attempt,'branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'indexTreeAtStart':git('write-tree'),'command':command,'workflowBlob':'637c518ecf481d9af5224c21e93db83b00593cea','workflowCaptureMinutes':55,'ownerSharedDeadlineMinutes':54,'sourceEntries':len(before),'startedAt':now(),'state':'RUNNING'}
def save():put(out/'execution.json',record)
save();print(json.dumps({'starting':'complete existing CI owner','localDiagnosticId':prefix,'notGitHubRun':True,'sourceEntries':len(before),'captureBudgetMinutes':54}),flush=True)
start=time.monotonic()
try:
 with log.open('x') as h:r=subprocess.run(command,cwd=terminal,env=env,stdout=h,stderr=subprocess.STDOUT)
 after=sources();put(out/'source-after.json',after)
 record.update({'exit':r.returncode,'completedAt':now(),'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':before==after,'sourceBeforeSha256':sha(out/'source-before.json'),'sourceAfterSha256':sha(out/'source-after.json')});save()
 diagnostic=out/'runner-temp/terminal-ci-evidence'/(prefix+'.json')
 assert diagnostic.exists()
 native=json.loads(diagnostic.read_text());record['ownerReceipt']=str(diagnostic.relative_to(repo));record['ownerReceiptSha256']=sha(diagnostic);record['ownerState']=native['state'];save()
 assert r.returncode==0 and native['state']=='SELECTED' and before==after and record['seconds']<54*60,record
 assert native['composition']['selectedCases']==50 and len(native['references'])==2
 assert native['optionsAxis']['required'] is True
 selected=(out/'selected-env').read_text();composition=native['composition']['path']
 assert selected=='TERMINAL_EVIDENCE_MODE=records\nTERMINAL_EVIDENCE_COMPOSITION='+composition+'\n'
 assert sha(repo/composition)==native['composition']['sha256']
 assert all(closed(p) for p in [3536,3537,3538,3571,3564,3566]) and not(terminal/'.next/dev/lock').exists()
 assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and git('hash-object','.github/workflows/ci.yml')==record['workflowBlob']
 record.update({'state':'FULL_OWNER_PATH_QUALIFIED_WITHIN_EXISTING_WORKFLOW_BUDGET','composition':native['composition'],'capturedChildren':[c['packet'] for c in native['children']],'optionsAxisCaptureRequired':native['optionsAxis']['required'],'ownedPortsClosed':True,'nextLockAbsent':True});save();print(json.dumps(record),flush=True)
except BaseException as e:
 record.update({'state':'FAILED','error':str(e),'completedAt':now()});save();raise

