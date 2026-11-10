from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof;port=3910
head='230b0f9db6f37f5b37e260d5ce2a1108918fca3e';base='156c4b3ecfa27b9137c64068b3ed969e07efbe49';dependency=base
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def inspect(args):
 r=subprocess.run(args,capture_output=True,text=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'observedAt':now()}
def port_closed(port):
 r=inspect(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in [0,1] and not r['stderr'].strip();return r['exit']==1
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
 receipt={'schema':'terminal_pr1369_protected_sync_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
integration=json.loads((proof/'source-integration.json').read_text());assert integration['state']=='SOURCE_COMPOSED_PENDING_CURRENT_CHECKS'
deps=json.loads((proof/'dependencies.json').read_text());assert deps['state']=='EXACT_DEPENDENCIES_READY'
assert port_closed(port) and not(t/'.next/dev/lock').exists()
run=proof/'qualification-r1';assert not run.exists();run.mkdir()
paths=set(json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout))
paths|={'terminal/e2e/analysis-company-read-lifetime.spec.ts','terminal/playwright.config.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json'}
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
def packets():return {str(p.relative_to(repo)):sha(p) for name in ['b-f11-10-analysis-theses-entry','b-mi-g10-b4t-theme-empty'] for p in sorted((t/'docs/pr-crops'/name).rglob('*')) if p.is_file()}
before=snapshot();retained=packets();put(run/'source-before.json',before);put(run/'retained-packets.json',retained)
env=os.environ.copy()
for key in ['TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_EVIDENCE_MODE','PLAYWRIGHT_JSON_OUTPUT_FILE']:env.pop(key,None)
env.update({'MMX_SHARED_SHELL':'1','MMX_INVESTOR_SHELL_PREVIEW':'0','PLAYWRIGHT_BROWSERS_PATH':deps['browserCache']})
record={'schema':'terminal_pr1369_protected_sync_qualification.v1','branchHead':head,'protectedMaster':base,'parents':[head,base],'startedAt':now(),'state':'RUNNING','nativeRecapturePerformed':False,'sourceEntries':len(before),'stages':[]}
def save():put(run/'execution.json',record)
def execute(label,command,extra=None):
 log=run/(label+'.log');stage={'label':label,'command':command,'startedAt':now(),'state':'RUNNING'};record['stages'].append(stage);save();start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=t,env={**env,**(extra or {})},stdout=h,stderr=subprocess.STDOUT)
 stage.update({'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':before==snapshot(),'packetsUnchanged':packets()==retained,'state':'CLOSED' if r.returncode==0 else 'FAILED'});save();print(json.dumps({k:v for k,v in stage.items() if k!='command'}),flush=True)
 if r.returncode:print(log.read_text()[-12000:],flush=True)
 return r,stage
save()
try:
 report=run/'browser-report.json';output=t/'test-results/pr1369-protected-beta-r1';assert not output.exists()
 command=['node','node_modules/@playwright/test/cli.js','test','e2e/analysis-company-read-lifetime.spec.ts','--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
 r,stage=execute('beta-company-lifetime',command,{'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_JSON_OUTPUT_FILE':str(report)})
 result=json.loads(report.read_text()) if report.exists() else {'errors':['missing report'],'stats':{}};stats=result.get('stats',{})
 cases=[]
 def walk(s):
  for spec in s.get('specs',[]):
   for v in spec.get('tests',[]):cases.append({'title':spec['title'],'project':v['projectName'],'expectedStatus':v.get('expectedStatus'),'attempts':[{'status':a.get('status'),'retry':a.get('retry'),'error':a.get('error')} for a in v.get('results',[])]})
  for child in s.get('suites',[]):walk(child)
 walk(result)
 stage.update({'stats':stats,'cases':cases,'reportErrors':result.get('errors',[]),'sharedShell':'1','lifecycle':reconcile_lock(port,'protected-beta-r1'),'portClosed':port_closed(port),'nextLockAbsent':not(t/'.next/dev/lock').exists()})
 if output.exists():
  shutil.copytree(output,run/'browser-artifacts');stage['artifacts']={str(p.relative_to(run/'browser-artifacts')):sha(p) for p in (run/'browser-artifacts').rglob('*') if p.is_file()}
 save()
 assert r.returncode==0 and {k:stats.get(k) for k in ['expected','unexpected','skipped','flaky']}=={'expected':6,'unexpected':0,'skipped':0,'flaky':0} and not result.get('errors') and len(cases)==6 and all(c['attempts']==[{'status':'passed','retry':0,'error':None}] for c in cases) and stage['portClosed'] and stage['nextLockAbsent'],stage
 names=['analysisCompanyReadLifetime.test.tsx','megaPaneFundamentalLoading.test.tsx','analysisWorkspaceNavigation.test.tsx','b_f11_10AnalysisThesesEntryEvidence.test.ts','b_mi_g10_b4tThemeEmptyEvidence.test.ts','sharedShellMetadata.test.ts']
 r,_=execute('affected-unit-and-evidence-readers',['node','node_modules/vitest/vitest.mjs','run',*['lib/__tests__/'+n for n in names],'--reporter=json','--outputFile='+str(run/'unit-report.json')],{'MMX_SHARED_SHELL':'0'})
 unit=json.loads((run/'unit-report.json').read_text());assert r.returncode==0 and unit['success'] and unit['numFailedTests']==unit['numPendingTests']==0;record['unitTestsPassed']=unit['numPassedTests'];save()
 r,_=execute('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']);assert r.returncode==0
 for p in integration['qualifiedBranchFilesUnchanged']:assert (repo/p).read_bytes()==subprocess.run(['git','-C',str(repo),'show',head+':'+p],capture_output=True,check=True).stdout,p
 for p in integration['protectedMetadataFilesUnchanged']:assert (repo/p).read_bytes()==subprocess.run(['git','-C',str(repo),'show',base+':'+p],capture_output=True,check=True).stdout,p
 after=snapshot();put(run/'source-after.json',after);assert before==after and packets()==retained
 record.update({'state':'QUALIFIED','completedAt':now(),'sourceStable':True,'packetsUnchanged':True,'browserPassed':6,'browserSkipped':0,'browserFailed':0,'browserRetries':0,'portsClosed':True,'nextLockAbsent':True});save();print(json.dumps({'state':record['state'],'unitTestsPassed':record['unitTestsPassed'],'browserPassed':6,'sourceEntries':len(before),'packetsUnchanged':True}),flush=True)
except Exception as e:
 record.update({'state':'FAILED','error':str(e),'completedAt':now()});save();raise
