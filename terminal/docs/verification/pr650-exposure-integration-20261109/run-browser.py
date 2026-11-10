from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil
repo=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/review/terminal-pr650-exposure-integration-20261109')
root=repo/'terminal';run=root/'test-results/pr650-exposure-integration-20261109'
head='282ea2c40d839fecbe5ae5dc53de9c29a02850f6';base='b387616013f38cce9e467cc7da7b87fd2672718c';dependency='663983edd16fc64e86003b420e97d557982b1bf2';port=3802
def git(*args):return subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True,check=True).stdout.strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,data):p.write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
assert not (root/'.next/dev/lock').exists()
assert subprocess.run(['lsof','-t','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True).returncode==1
inputs=json.loads((run/'reviewed-input-sets.json').read_text());assert len(inputs['browser'])==68 and len(inputs['specs'])==5
for kind,packet,count in [('gex','gex-levels-heatmap-load-failure',114),('eod','eod-heatmap-flowdesk-load-failure',126)]:
 revision=root/'docs/pr-crops'/packet/'operations/exposure-source-compatibility-20261105/revisions'/('indicator-guard-20261109' if kind=='gex' else 'ui-copy-integration-20261109')
 receipt=json.loads((revision/'capture-execution.json').read_text())
 assert receipt['exit']==0 and receipt['expected']==count and receipt['successfulFiles']==count and receipt['sourceStable'] and len(receipt['frames'])==count and all(f['status']=='success' for f in receipt['frames'])
observed=json.loads((root/'docs/pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-source-compatibility-20261105/revisions/ui-copy-integration-20261109/capture-sources-before.json').read_text())
sourcePaths=sorted(set(observed)|set(inputs['browser']))
def snapshot():return {p:sha(repo/p) for p in sourcePaths}
proof=root/'docs/verification/exposure-workspace-20261103/ui-copy-integration-20261109'
output=run/'browser-raw';prior=run/'prior-browser-root'
assert not proof.exists() and not output.exists() and not prior.exists()
proof.mkdir(parents=True);prior.mkdir()
priorInventory={}
for p in sorted((root/'test-results').iterdir()):
 if p.is_file() and p.suffix in ['.png','.json']:
  shutil.copy2(p,prior/p.name);priorInventory[p.name]={'sha256':sha(p),'mtimeNs':p.stat().st_mtime_ns,'bytes':p.stat().st_size}
write(run/'prior-browser-root.json',priorInventory)
before=snapshot();write(proof/'source-before.json',before)
env=os.environ.copy()
env["PLAYWRIGHT_BROWSERS_PATH"]=str(root/"test-results/pr650-exposure-integration-20261109/playwright-browsers")
overrideKeys=['EXPOSURE_P09_CURRENT_WITNESS','EXPOSURE_P09_PREVIOUS_WITNESS','EXPOSURE_NATIVE_WITNESS','TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE','TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE','TERMINAL_EXPOSURE_PAINT_PROBE']
for key in overrideKeys:env.pop(key,None)
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'TERMINAL_VISUAL_EVIDENCE_OPERATION':'pr650-exposure-ui-copy-integration-20261109','PLAYWRIGHT_JSON_OUTPUT_FILE':str(proof/'browser-report.json')})
specs=[p.removeprefix('terminal/') for p in inputs['specs']]
cmd=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
expected=[{'key':k} for k in json.loads((root/'docs/verification/exposure-workspace-20261103/master-integration-20261109/qualification.json').read_text())['expectedPassed']];assert len(expected)==123 and len({c['key'] for c in expected})==123
log=proof/'browser.log';assert not log.exists()
started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic();startNs=time.time_ns()
print(json.dumps({'starting':'browser','tests':123,'specs':specs,'projects':['desktop','tablet','mobile'],'sourceFiles':len(before),'port':port,'retries':0,'priorRootFilesPreserved':len(priorInventory)}),flush=True)
with log.open('w') as h:r=subprocess.run(cmd,cwd=root,env=env,stdout=h,stderr=subprocess.STDOUT)
after=snapshot();write(proof/'source-after.json',after)
ownedServerStopped=subprocess.run(['lsof','-t','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True).returncode==1 and not (root/'.next/dev/lock').exists()
report=json.loads((proof/'browser-report.json').read_text()) if (proof/'browser-report.json').exists() else {'errors':[{'message':'missing native JSON report'}],'stats':{}}
cases=[]
def walk(s):
 for p in s.get('specs',[]):
  for t in p.get('tests',[]):cases.append({'key':t['projectName']+'|'+p['title'],'expectedStatus':t.get('expectedStatus'),'attempts':[{'status':v.get('status'),'retry':v.get('retry')} for v in t.get('results',[])]})
 for ch in s.get('suites',[]):walk(ch)
walk(report)
artifacts={}
def retain(src,relative):
 dest=proof/'browser-artifacts'/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest);artifacts[str(dest.relative_to(proof))]=sha(dest)
if output.exists():
 for p in sorted(output.rglob('*')):
  if p.is_file():retain(p,Path('playwright')/p.relative_to(output))
for p in sorted((root/'test-results').iterdir()):
 if p.is_file() and p.suffix in ['.png','.json'] and p.stat().st_mtime_ns>=startNs:retain(p,Path('direct')/p.name)
stats=report.get('stats',{});execution={'schema':'exposure_master_integration_browser_execution.v1','branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'command':cmd,'port':port,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':round(time.monotonic()-start,2),'exit':r.returncode,'retries':0,'sourceStable':before==after,'ownedServerStopped':ownedServerStopped,'passed':stats.get('expected',0),'failed':stats.get('unexpected',0),'skipped':stats.get('skipped',0),'flaky':stats.get('flaky',0),'fixtureOverrides':{k:env.get(k) for k in overrideKeys},'artifactFiles':artifacts,'logSha256':sha(log),'node':subprocess.run(['node','--version'],capture_output=True,text=True,check=True).stdout.strip()}
write(proof/'browser-execution.json',execution)
valid=r.returncode==0 and before==after and ownedServerStopped and not report.get('errors') and execution['passed']==123 and execution['failed']==0 and execution['skipped']==0 and execution['flaky']==0 and sorted(c['key'] for c in cases)==sorted(c['key'] for c in expected) and all(c['attempts']==[{'status':'passed','retry':0}] for c in cases) and bool(artifacts)
print(json.dumps({'finished':'browser','accepted':valid,'exit':r.returncode,'passed':execution['passed'],'failed':execution['failed'],'skipped':execution['skipped'],'flaky':execution['flaky'],'sourceStable':before==after,'ownedServerStopped':ownedServerStopped,'artifacts':len(artifacts),'seconds':execution['seconds']}),flush=True)
if not valid:print(log.read_text()[-16000:],flush=True);raise SystemExit(1)
files=['browser-report.json','browser-execution.json','source-before.json','source-after.json','browser.log']
qualification={'schema':'exposure_master_integration_browser.v1','branchHead':head,'protectedMaster':base,'integratedDependency':dependency,'files':{p:sha(proof/p) for p in files},'currentSources':{p:before[p] for p in inputs['browser']},'expectedPassed':sorted(c['key'] for c in cases),'expectedSkipped':[]}
write(proof/'qualification.json',qualification)
print(json.dumps({'browserQualificationSha256':sha(proof/'qualification.json'),'currentInputs':len(qualification['currentSources'])}),flush=True)