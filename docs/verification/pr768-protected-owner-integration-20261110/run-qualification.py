from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,re
repo=Path(__file__).resolve().parents[3]; terminal=repo/'terminal'; proof=Path(__file__).resolve().parent
head='20c16787dac0655dc874990e7823e5cba2cef9e6'; master='33f9224f2b1e68512e38fab33d32c64a0bef6096'; tree='4a1f3c9161596f8fb520b4acad626315b204d64a'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*a):return subprocess.check_output(['git','-C',str(repo),*a],text=True).strip()
def snap():
    data=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True))
    for p in ['.github/workflows/ci.yml','terminal/e2e/tools/capture_ci_evidence.cjs','terminal/e2e/tools/capture_ci_evidence.test.cjs','terminal/e2e/tools/optionsExposureEvidence.cjs','terminal/e2e/tools/optionsExposureEvidence.d.cts','terminal/scripts/ci/plan-evidence-capture.cjs','terminal/scripts/ci/plan-evidence-capture.test.cjs','tests/test_ci_browser_setup.py','tests/test_ci_scenario_consumer.py','tests/test_ci_pytest_results.py','tests/test_ci_e2e_scope.py','tests/test_ci_pr_scope.py']:
        data[p]=sha(repo/p)
    return dict(sorted(data.items()))
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==master and git('write-tree')==tree
before=snap();put(proof/'source-before.json',before)
prior=json.loads((repo/'docs/verification/pr768-duty-integration-20261110/qualification.json').read_text())
plan=[]
for key in ['node-owners-planners','native-readers','typegen','typecheck','python-ci-contracts']:
    item=prior['results'][key]; cmd=list(item['command'])
    for i,arg in enumerate(cmd):
        if arg.startswith('--outputFile='):cmd[i]='--outputFile='+str(proof/'native-readers.json')
    plan.append((key,cmd,repo if key=='python-ci-contracts' else terminal))
env=os.environ.copy(); env['CI']='1'; env['NODE_OPTIONS']='--no-experimental-webstorage';env['PLAYWRIGHT_BROWSERS_PATH']=str(terminal/'node_modules/.cache/pr768-playwright')
receipt={'schema':'terminal_pr768_protected_owner_qualification.v1','head':head,'protectedMaster':master,'sourceTree':tree,'state':'RUNNING','startedAt':now(),'sourceEntries':len(before),'results':{}}
put(proof/'qualification.json',receipt)
for key,cmd,cwd in plan:
    print(json.dumps({'starting':key}),flush=True);start=time.monotonic();log=proof/(key+'.log')
    with log.open('w') as output:r=subprocess.run(cmd,cwd=cwd,env=env,stdout=output,stderr=subprocess.STDOUT)
    item={'command':cmd,'cwd':str(cwd),'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
    text=log.read_text(errors='replace')
    if key=='node-owners-planners':
        item['totals']={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)$',text,re.M)}
    if key=='native-readers' and (proof/'native-readers.json').exists():
        data=json.loads((proof/'native-readers.json').read_text());item['report']={k:data.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
    if key=='python-ci-contracts':
        match=re.search(r'(\d+) passed',text);item['passed']=int(match.group(1)) if match else None
    receipt['results'][key]=item;put(proof/'qualification.json',receipt);print(json.dumps({'finished':key,**item}),flush=True)
    if r.returncode:receipt['state']='FAILED';break
after=snap();put(proof/'source-after.json',after);receipt['sourceStable']=before==after;receipt['completedAt']=now();receipt['preparedTreeAfter']=git('write-tree')
receipt['unstagedTracked']=git('diff','--name-only')
if receipt['state']!='FAILED':
    result=receipt['results']
    ok=all(x['exit']==0 for x in result.values()) and len(result)==5 and result['node-owners-planners']['totals']=={'tests':250,'pass':250,'fail':0,'cancelled':0,'skipped':0} and result['native-readers']['report']['numPassedTests']==105 and result['python-ci-contracts']['passed']==231 and before==after and receipt['preparedTreeAfter']==tree and not receipt['unstagedTracked']
    receipt['state']='QUALIFIED' if ok else 'REVIEW_REQUIRED'
put(proof/'qualification.json',receipt);print(json.dumps({'complete':receipt}),flush=True)
raise SystemExit(0 if receipt['state']=='QUALIFIED' else 1)
