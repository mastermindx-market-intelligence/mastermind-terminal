from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'handoff-fixture-repair/validation-r1'
head='797e8fed41963c6757dd35db8d77dd71e5d58fba';spec='terminal/e2e/options-lab-plan-handoff.spec.ts'
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
 receipt={'schema':'terminal_pr1291_handoff_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and not out.exists() and port_closed(3539) and not (t/'.next/dev/lock').exists()
before=sources();old=json.loads((proof/'capture-r1/source-before.json').read_text());delta=[p for p in sorted(set(old)|set(before)) if old.get(p)!=before.get(p)];assert delta==[spec] and before[spec]=='15a7f20057a376cff41c2d50263ad0bd59bc362d8c8b9bdeb5b671730d089910'
originalReport=proof/'post-capture-validation/browser-report.json';original=json.loads(originalReport.read_text())
def cases(report):
 result=[]
 def walk(x):
  for s in x.get('specs',[]):
   for v in s.get('tests',[]):result.append({'key':v['projectName']+'|'+s['title'],'results':[{'status':q.get('status'),'retry':q.get('retry')} for q in v.get('results',[])]})
  for c in x.get('suites',[]):walk(c)
 walk(report);return result
originalCases=cases(original);kept=[c for c in originalCases if c['results']==[{'status':'passed','retry':0}]];failed=[c for c in originalCases if c['results']!=[{'status':'passed','retry':0}]];assert len(kept)==15 and len(failed)==12
out.mkdir();put(out/'source-before.json',before)
env=os.environ.copy()
for key in ['TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_EVIDENCE_MODE','TERMINAL_CI_OPTIONS_AXIS_CAPTURE','TERMINAL_CI_OPTIONS_CAPTURE_ID']:env.pop(key,None)
env.update({'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr1291-playwright')})
record={'schema':'terminal_pr1291_handoff_fixture_validation.v1','branchHead':head,'startedAt':now(),'state':'RUNNING','changedObservedSources':delta,'retainedOriginalPassedCases':kept,'originalFailedCases':failed,'originalReport':str(originalReport.relative_to(repo)),'originalReportSha256':sha(originalReport),'stages':[]}
def save():put(out/'execution.json',record)
def stable():
 current=sources();assert current==before and git('rev-parse','HEAD')==head;return current
def execute(name,args,extra=None,port=None):
 log=out/(name+'.log');assert not log.exists();stage={'name':name,'command':args,'startedAt':now(),'port':port,'state':'RUNNING'};record['stages'].append(stage);save();start=time.monotonic();print(json.dumps({'starting':name,'port':port}),flush=True)
 with log.open('x') as h:r=subprocess.run(args,cwd=t,env={**env,**(extra or {})},stdout=h,stderr=subprocess.STDOUT)
 stage.update({'exit':r.returncode,'testCompletedAt':now(),'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':stable()==before})
 if port:
  stage['initialOwnedServerStopped']=port_closed(port) and not (t/'.next/dev/lock').exists();stage['lifecycle']=reconcile_lock(port,name);stage['ownedServerStopped']=True
 stage['state']='CLOSED' if r.returncode==0 else 'FAILED';save();print(json.dumps({k:v for k,v in stage.items() if k!='command'}),flush=True);assert r.returncode==0,log.read_text()[-6500:];return stage
save()
try:
 report=out/'browser-report.json';output=out/'browser-artifacts'
 args=['node','node_modules/@playwright/test/cli.js','test','e2e/options-lab-plan-handoff.spec.ts','--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
 s=execute('handoff-browser',args,{'CI':'1','TERMINAL_E2E_PORT':'3539','PLAYWRIGHT_JSON_OUTPUT_FILE':str(report)},3539)
 result=json.loads(report.read_text());stats=result['stats'];assert not result.get('errors') and stats['expected']==12 and stats['skipped']==stats['unexpected']==stats['flaky']==0,stats
 accepted=cases(result);assert sorted(c['key'] for c in accepted)==sorted(c['key'] for c in failed) and all(c['results']==[{'status':'passed','retry':0}] for c in accepted)
 s.update({'passed':12,'failed':0,'skipped':0,'flaky':0,'retries':0,'reportSha256':sha(report),'cases':accepted,'artifacts':packet(output)});save()
 execute('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])
 execute('affected-lint',['node','node_modules/eslint/bin/eslint.js','e2e/options-lab-plan-handoff.spec.ts'])
 after=stable();put(out/'source-after.json',after)
 record.update({'state':'HANDOFF_QUALIFIED_FRESH_IMMUTABLE_REVISION_REQUIRED','completedAt':now(),'sourceStable':True,'sourceAfterSha256':sha(out/'source-after.json'),'repairedHandoffPassed':12,'retainedOriginalPassed':15,'finalAcceptedCaseIdentities':sorted(c['key'] for c in kept+accepted),'scope':'15 accepted original cases retained against unchanged runtime; 12 repaired fixture cases passed separately. Original12 failures remain preserved. A fresh PL6/VI revision is still owed because its full source maps bind the edited spec.'});save()
 print(json.dumps({'completed':True,'retainedOriginalPassed':15,'repairedHandoffPassed':12,'acceptedCaseIdentities':len(record['finalAcceptedCaseIdentities'])}),flush=True)
except BaseException as e:record['state']='FAILED';record['error']=str(e);record['completedAt']=now();save();raise
