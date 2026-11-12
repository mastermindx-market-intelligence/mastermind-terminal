from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[3];terminal=repo/'terminal';proof=Path(__file__).resolve().parent
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def put(path,value):path.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def snapshot():return json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True))
assert subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()=='3e376bb93c0cdd9dc55b110186fcfea62d0cd746'
before=snapshot(); modules=['terminal/components/IndicatorsModal.module.css','terminal/components/LayoutMenu.module.css']
assert all(before.get(path)==sha(repo/path) for path in modules)
assert before['terminal/app/globals.css']=='b08b6a214d214b55610500490d7ccb869ed25866e0c4c113105e942927af7517'
put(proof/'qualification-source-before.json',before)
product=['layoutRenameFocus.test.tsx','indicatorsScriptRename.test.tsx','chartObjectTree.test.tsx','layoutMenuTeamRead.test.ts','workspaceMenuOps.test.ts','workspaceMenuLex.test.ts']
guards=['b_f08_6AlertPrefsEvidence.test.ts','b_f08_8InvalidationEvidence.test.ts','b_f08_9RiskHistoryEvidence.test.ts','b_f08_b5_1TargetsEvidence.test.ts','conductorFitBadgeZhEvidence.test.ts','eodHeatmapFlowdeskLoadFailureEvidence.test.ts','gexLevelsHeatmapLoadFailureEvidence.test.ts','w9t_f08_13TargetsReadoutEvidence.test.ts']
def unit(names,report):return ['node','node_modules/vitest/vitest.mjs','run',*['lib/__tests__/'+name for name in names],'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(proof/report)]
plan=[('product-unit',unit(product,'product-unit.json')),('restored-global-guards',unit(guards,'restored-global-guards.json')),('typegen',['node','node_modules/next/dist/bin/next','typegen']),('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--pretty','false'])]
env=os.environ.copy();env['CI']='1';env['NODE_OPTIONS']=(env.get('NODE_OPTIONS','')+' --no-experimental-webstorage').strip()
receipt={'schema':'terminal_pr1407_style_qualification.v1','state':'RUNNING','sourceHead':'3e376bb93c0cdd9dc55b110186fcfea62d0cd746','startedAt':now(),'sourceEntries':len(before),'moduleMembership':{p:before[p] for p in modules},'results':{}}
put(proof/'qualification.json',receipt)
for name,cmd in plan:
    print(json.dumps({'starting':name}),flush=True);start=time.monotonic();log=proof/(name+'.log')
    with log.open('w') as out:result=subprocess.run(cmd,cwd=terminal,env=env,stdout=out,stderr=subprocess.STDOUT)
    item={'command':cmd,'exit':result.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
    report=proof/(name+'.json')
    if report.exists():
        d=json.loads(report.read_text());item['report']={k:d.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
    receipt['results'][name]=item;put(proof/'qualification.json',receipt);print(json.dumps({'finished':name,**item}),flush=True)
    if result.returncode:receipt['state']='FAILED';break
after=snapshot();put(proof/'qualification-source-after.json',after);receipt['sourceStable']=before==after;receipt['completedAt']=now()
if receipt['state']!='FAILED':receipt['state']='QUALIFIED' if before==after and len(receipt['results'])==4 else 'REVIEW_REQUIRED'
put(proof/'qualification.json',receipt);print(json.dumps({'complete':receipt}),flush=True)
raise SystemExit(0 if receipt['state']=='QUALIFIED' else 1)
