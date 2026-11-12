from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,re,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;prior=proof/'qualification-r1';out=proof/'qualification-r1-continuation'
head='496ef734fafb64500bb95384770b59eb51555e00'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
def inspect(args):
 r=subprocess.run(args,capture_output=True,text=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'observedAt':now()}
def port_closed(port):
 r=inspect(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in [0,1] and not r['stderr'].strip();return r['exit']==1
def sources():return json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
def packet(folder):return {str(p.relative_to(folder)):sha(p) for p in sorted(folder.rglob('*')) if p.is_file()}
def reconcile_lock(port,label,extraPids=[]):
 lock=t/'.next/dev/lock'
 for _ in range(40):
  if port_closed(port):break
  time.sleep(.25)
 assert port_closed(port),'Owned listener remains live'
 if not lock.exists():return {'initialLockPresent':False,'serverAbsenceVerifiedAt':now()}
 def identity():
  st=lock.lstat();assert stat.S_ISREG(st.st_mode) and st.st_uid==501
  return {'dev':st.st_dev,'ino':st.st_ino,'size':st.st_size,'mtimeNs':st.st_mtime_ns,'sha256':sha(lock),'content':json.loads(lock.read_text())}
 initial=identity();assert initial['content']['port']==port
 pids=[initial['content']['pid'],*extraPids]
 def observations(withFd):
  checks={}
  for name,args in [('listener',['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']),('recordedProcesses',['ps','-p',','.join(str(x) for x in pids),'-o','pid=,ppid=,comm='])]:
   r=inspect(args);checks[name]=r;assert r['exit']==1 and not r['stdout'].strip() and not r['stderr'].strip(),checks
  if withFd:
   r=inspect(['lsof',str(lock)]);checks['lockDescriptors']=r;assert r['exit']==1 and not r['stdout'].strip() and not r['stderr'].strip()
  else:assert not lock.exists();checks['lockDescriptors']={'state':'fileAbsent','observedAt':now()}
  r=inspect(['lsof','-a','-u','chriswong','-d','cwd','-F','pcn']);cur=[];records=[]
  for line in r['stdout'].splitlines():
   if line.startswith('p'):
    if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
    cur=[line]
   else:cur.append(line)
  if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
  checks['ownedWorkspaceCwds']={k:v for k,v in r.items() if k!='stdout'};checks['ownedWorkspaceCwds']['records']=records
  assert r['exit']==0 and not r['stderr'].strip() and not records
  return checks
 receipt={'schema':'terminal_pr1369_owned_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}
assert git('rev-parse','HEAD')==head and not out.exists()
initialFile=prior/'execution.json';original=json.loads(initialFile.read_text());assert original['state']=='FAILED' and original['stages'][0]['state']=='CLOSED' and original['stages'][1]['exit']==0
skipReport=json.loads((prior/'browser-lifetime.json').read_text());assert skipReport['stats']['expected']==0 and skipReport['stats']['skipped']==6 and not skipReport.get('errors')
out.mkdir();put(out/'unqualified-first-browser-attempt.json',{'originalExecution':str(initialFile.relative_to(repo)),'originalExecutionSha256':sha(initialFile),'reportSha256':sha(prior/'browser-lifetime.json'),'passed':0,'skipped':6,'reason':'Existing spec explicitly skips unless MMX_SHARED_SHELL=1; initial local driver supplied0. No lifetime behavior was accepted from this attempt.'})
cleanup=reconcile_lock(3806,'initial-skipped-browser',[12650])
before=json.loads((prior/'source-before.json').read_text());assert sources()==before
put(out/'source-before.json',before)
env=os.environ.copy()
for key in ['TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_EVIDENCE_MODE']:env.pop(key,None)
env.update({'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr1369-playwright')})
record={'schema':'terminal_pr1369_combined_qualification_continuation.v1','branchHead':head,'protectedMaster':original['protectedMaster'],'integratedDependency':original['integratedDependency'],'capturedIndexTree':original['capturedIndexTree'],'startedAt':now(),'state':'RUNNING','priorExecution':{'path':str(initialFile.relative_to(repo)),'sha256':sha(initialFile)},'initialCleanup':cleanup,'retainedNativeStage':original['stages'][0],'retainedB4':original['retainedB4'],'sourceFiles':len(before),'stages':[]}
def save():put(out/'execution.json',record)
def stable():
 current=sources();assert current==before and git('rev-parse','HEAD')==head;return current
def execute(name,args,extra=None,port=None):
 log=out/(name+'.log');assert not log.exists();stage={'name':name,'command':args,'startedAt':now(),'port':port,'state':'RUNNING','sharedShell':(extra or {}).get('MMX_SHARED_SHELL',env['MMX_SHARED_SHELL'])};record['stages'].append(stage);save();start=time.monotonic();print(json.dumps({'starting':name,'port':port,'sharedShell':stage['sharedShell']}),flush=True)
 with log.open('x') as h:r=subprocess.run(args,cwd=t,env={**env,**(extra or {})},stdout=h,stderr=subprocess.STDOUT)
 stage.update({'exit':r.returncode,'testCompletedAt':now(),'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':stable()==before})
 if port:
  stage['initialOwnedServerStopped']=port_closed(port) and not (t/'.next/dev/lock').exists()
  stage['lifecycle']=reconcile_lock(port,name);stage['ownedServerStopped']=True
 stage['state']='CLOSED' if r.returncode==0 else 'FAILED';save();print(json.dumps({k:v for k,v in stage.items() if k!='command'}),flush=True);assert r.returncode==0,log.read_text()[-6000:]
 return stage
save()
try:
 root=t/'docs/pr-crops/b-f11-10-analysis-theses-entry';native=record['retainedNativeStage'];assert native['actualCases']==6 and all(sha(root/f)==v for f,v in native['images'].items()) and sha(root/'EVIDENCE.yml')==native['manifestSha256']
 suites=[
 ('browser-lifetime-beta',['e2e/analysis-company-read-lifetime.spec.ts'],None,3806,6,0,'1'),
 ('browser-navigation',['e2e/investigation-workspace.spec.ts','e2e/thesis-workspace.spec.ts','e2e/market-ontology-context.spec.ts'],'mobile Analysis research actions|Analysis research entries retain|the context-bar theses link|J1 saves A',3807,10,2,'0')]
 for name,specs,grep,port,passed,skipped,shared in suites:
  assert port_closed(port) and not (t/'.next/dev/lock').exists()
  report=out/(name+'.json');output=out/(name+'-artifacts')
  args=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
  if grep:args+=['--grep',grep]
  s=execute(name,args,{'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_JSON_OUTPUT_FILE':str(report),'MMX_SHARED_SHELL':shared},port)
  r=json.loads(report.read_text());stats=r['stats'];assert not r.get('errors') and stats['expected']==passed and stats['skipped']==skipped and stats['unexpected']==stats['flaky']==0,(name,stats)
  cases=[]
  def walk(x):
   for spec in x.get('specs',[]):
    for test in spec.get('tests',[]):cases.append({'project':test['projectName'],'title':spec['title'],'results':[{'status':q.get('status'),'retry':q.get('retry')} for q in test.get('results',[])]})
   for child in x.get('suites',[]):walk(child)
  walk(r);assert len(cases)==passed+skipped and all(len(c['results'])==1 and c['results'][0]['retry']==0 and c['results'][0]['status'] in ['passed','skipped'] for c in cases)
  s.update({'passed':passed,'skipped':skipped,'failed':0,'flaky':0,'retries':0,'reportSha256':sha(report),'cases':cases,'artifacts':packet(output)});save()
 tests=['lib/__tests__/analysisCompanyReadLifetime.test.tsx','lib/__tests__/megaPaneFundamentalLoading.test.tsx','lib/__tests__/analysisWorkspaceNavigation.test.tsx','lib/__tests__/b_f11_10AnalysisThesesEntryEvidence.test.ts','lib/__tests__/b_mi_g10_b4tThemeEmptyEvidence.test.ts']
 execute('unit-and-native-readers',['node','node_modules/vitest/vitest.mjs','run',*tests,'--reporter=default','--reporter=json','--outputFile='+str(out/'unit-report.json')])
 r=json.loads((out/'unit-report.json').read_text());assert r['success'] and r['numFailedTests']==r['numPendingTests']==0
 execute('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])
 execute('producer-syntax',['node','--check','e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs'])
 execute('affected-lint',['node','node_modules/eslint/bin/eslint.js','components/workspaces/AnalysisWorkspace.tsx','components/fin/MegaPane.tsx','e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs'])
 assert packet(t/'docs/pr-crops/b-mi-g10-b4t-theme-empty')==record['retainedB4'];after=stable();put(out/'source-after.json',after)
 record.update({'state':'QUALIFIED_AWAITING_VISUAL_REVIEW','completedAt':now(),'sourceStable':True,'sourceAfterSha256':sha(out/'source-after.json'),'unitTestsPassed':r['numPassedTests'],'actualNativeCases':6,'browserPassed':16,'browserSkipped':2});save()
 print(json.dumps({'completed':True,'sourceFiles':len(before),'nativeCases':6,'browserPassed':16,'browserSkipped':2,'unitTests':r['numPassedTests']}),flush=True)
except BaseException as e:record['state']='FAILED';record['error']=str(e);record['completedAt']=now();save();raise
