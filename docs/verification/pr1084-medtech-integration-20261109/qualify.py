from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'qualification-r1'
head='00381734b54d2ada1f777b5a7b3a15b12f57981a';base='03af393ce05c12282003a3919cc473c032264922'
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
 receipt={'schema':'terminal_pr1084_integration_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base
assert not git('diff','--name-only','--diff-filter=U') and not out.exists()
assert not (t/'.next/dev/lock').exists()
for port in [3540,3541,3542]:assert port_closed(port)
sql=repo/'supabase/migrations/0037_medtech_watches.sql';applied=repo/'docs/evidence/medtech-r14-0037-production-application-20261020.json'
assert sha(sql)=='c2e4831534fe2af7f835b19210020544b56b01866109a06b965ea656d87b8406'
assert sha(applied)=='087902b037282c94aefab098839f52217342075ddf6d109e419fd00a15c6bf65'
for file in [sql,applied]:
 old=subprocess.run(['git','-C',str(repo),'show',head+':'+str(file.relative_to(repo))],capture_output=True,check=True).stdout
 assert old==file.read_bytes()
ledger=repo/'supabase/migrations/RESERVATIONS.json'
assert subprocess.run(['git','-C',str(repo),'show',base+':supabase/migrations/RESERVATIONS.json'],capture_output=True,check=True).stdout==ledger.read_bytes()
originalImages=repo/'docs/evidence/medtech-r14-ui-20261020'
assert originalImages.is_dir()
preserved=packet(originalImages)
git('add','-A');indexTree=git('write-tree')
before=sources();out.mkdir();put(out/'source-before.json',before)
env=os.environ.copy()
for key in ['TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_EVIDENCE_MODE']:env.pop(key,None)
env.update({'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr1084-playwright'),'GITHUB_EVENT_NAME':'pull_request','PR_NUMBER':'1084'})
record={'schema':'terminal_pr1084_source_qualification.v1','branchHead':head,'protectedBase':base,'startedAt':now(),'state':'RUNNING','resolvedIndexTree':indexTree,'sourceEntries':len(before),'immutableSqlSha256':sha(sql),'appliedReceiptSha256':sha(applied),'protectedLedgerSha256':sha(ledger),'preservedHistoricalImages':preserved,'stages':[],'releaseBoundary':'Migration queue ownership remains unqualified; no auto-merge admission, DDL, ledger landing stamp, activation or live authenticated acceptance is authorized by this local qualification.'}
def save():put(out/'execution.json',record)
def stable():
 current=sources();assert current==before and git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base
 assert packet(originalImages)==preserved and sha(sql)==record['immutableSqlSha256'] and sha(applied)==record['appliedReceiptSha256']
 return current
def execute(name,args,extra=None,port=None,cwd=t):
 log=out/(name+'.log');assert not log.exists();stage={'name':name,'command':args,'startedAt':now(),'port':port,'state':'RUNNING'};record['stages'].append(stage);save();start=time.monotonic();print(json.dumps({'starting':name,'port':port}),flush=True)
 with log.open('x') as h:r=subprocess.run(args,cwd=cwd,env={**env,**(extra or {})},stdout=h,stderr=subprocess.STDOUT)
 stage.update({'exit':r.returncode,'testCompletedAt':now(),'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':stable()==before})
 if port:
  stage['initialOwnedServerStopped']=port_closed(port) and not (t/'.next/dev/lock').exists();stage['lifecycle']=reconcile_lock(port,name);stage['ownedServerStopped']=True
 stage['state']='CLOSED' if r.returncode==0 else 'FAILED';save();print(json.dumps({k:v for k,v in stage.items() if k!='command'}),flush=True);assert r.returncode==0,log.read_text()[-6500:];return stage
def browser(name,file,expected,port,grep=None):
 report=out/(name+'-report.json');output=out/(name+'-artifacts')
 args=['node','node_modules/@playwright/test/cli.js','test',file,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
 if grep:args+=['--grep',grep]
 s=execute(name,args,{'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_JSON_OUTPUT_FILE':str(report)},port)
 result=json.loads(report.read_text());stats=result['stats'];assert not result.get('errors') and stats['expected']==expected and stats['skipped']==stats['unexpected']==stats['flaky']==0,stats
 cases=[]
 def walk(x):
  for q in x.get('specs',[]):
   for v in q.get('tests',[]):
    rr=v.get('results',[]);assert len(rr)==1 and rr[0].get('status')=='passed' and rr[0].get('retry')==0
    cases.append({'project':v['projectName'],'title':q['title'],'status':'passed','retry':0})
  for c in x.get('suites',[]):walk(c)
 walk(result);assert len(cases)==expected
 s.update({'passed':expected,'failed':0,'skipped':0,'flaky':0,'retries':0,'reportSha256':sha(report),'cases':cases,'artifacts':packet(output)});save()
save()
try:
 report=out/'unit-report.json'
 s=execute('medtech-unit',['node','node_modules/vitest/vitest.mjs','run','lib/__tests__/medtechServer.test.ts','lib/__tests__/medtechWatches.test.ts','--reporter=json','--outputFile='+str(report)])
 unit=json.loads(report.read_text());assert unit['success'] and unit['numFailedTests']==0
 s.update({'passed':unit['numPassedTests'],'reportSha256':sha(report)});save()
 execute('migration-namespace',['python3','-m','pytest','tests/test_supabase_migration_namespace.py','-q'],cwd=repo)
 execute('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])
 execute('affected-lint',['node','node_modules/eslint/bin/eslint.js','components/workspaces/DiscoverWorkspace.tsx','e2e/large-trades.spec.ts'])
 browser('medtech-browser','e2e/medtech-watchdesk.spec.ts',39,3540)
 browser('catalyst-browser','e2e/catalyst-opportunity.spec.ts',9,3541,'usable discovery, evidence and coverage|failed sources do not pretend')
 browser('png-export-browser','e2e/large-trades.spec.ts',3,3542,'native PNG includes visible executions, quantity labels and provenance but excludes inspection controls')
 after=stable();put(out/'source-after.json',after)
 record.update({'state':'SOURCE_QUALIFIED_AWAITING_VISUAL_REVIEW','completedAt':now(),'sourceStable':True,'sourceAfterSha256':sha(out/'source-after.json'),'browserPassed':51,'localFixtureProofOnly':True});save()
 print(json.dumps({'completed':True,'sourceEntries':len(after),'browserPassed':51,'unitPassed':unit['numPassedTests'],'sqlUnchanged':True,'appliedReceiptUnchanged':True,'historicalImagesUnchanged':True}),flush=True)
except BaseException as e:record['state']='FAILED';record['error']=str(e);record['completedAt']=now();save();raise
