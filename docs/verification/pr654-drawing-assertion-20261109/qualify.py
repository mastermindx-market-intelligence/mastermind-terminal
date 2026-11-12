from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'qualification-r1'
head='bf47f5429a2395bf9fcf1e2e5a69ffeae00ae16f';spec='terminal/e2e/drawing-save-concurrency.spec.ts'
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
 receipt={'schema':'terminal_pr654_drawing_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and not out.exists() and not (t/'.next/dev/lock').exists() and port_closed(3561)
original=subprocess.run(['git','-C',str(repo),'show',head+':'+spec],capture_output=True,check=True).stdout
old=' }else{\n  await lines.click({timeout:20_000});\n }\n await expect(lines).toHaveAttribute("aria-pressed","false",{timeout:20_000});\n expect(puts).toBe(0);'
new=old.replace('await lines.click({timeout:20_000});','await expect(lines).toBeDisabled({timeout:20_000});')
assert original.decode().count(old)==1 and (repo/spec).read_text()==original.decode().replace(old,new)
navPaths=[p for p in git('ls-tree','-r','--name-only',head).splitlines() if p.endswith('/MobileNav.tsx')];assert len(navPaths)==1
nav=navPaths[0];navBlob=git('rev-parse',head+':'+nav);assert navBlob=='d0e118418c9a187420fb71384f0756fefb9557bc'
repair={'schema':'terminal_pr654_negative_read_assertion_repair.v1','head':head,'originalFailureRun':42628721274,'originalFailureJob':129210622048,'takeoverComment':'https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/654#issuecomment-6744327025','beforeSha256':hashlib.sha256(original).hexdigest(),'afterSha256':sha(repo/spec),'diff':git('diff','--',spec),'runtimeChanged':False,'preservedNavigation':{'path':nav,'blob':navBlob},'preparedAt':now(),'preparationNote':'Initial metadata-record attempt used an incorrect MobileNav path and exited128 after the single source edit/dependency clone. This readback uses the actual tracked path; no source edit or clone was replayed.'}
put(proof/'repair.json',repair)
assert (t/'node_modules/.cache/pr654-playwright/chromium_headless_shell-1228').is_dir()
before=sources();out.mkdir();put(out/'source-before.json',before)
env=os.environ.copy()
for key in ['MMX_SHARED_SHELL','MMX_INVESTOR_SHELL_PREVIEW','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_EVIDENCE_MODE']:env.pop(key,None)
env.update({'PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr654-playwright')})
record={'schema':'terminal_pr654_drawing_assertion_validation.v1','branchHead':head,'startedAt':now(),'state':'RUNNING','sourceEntries':len(before),'repairSha256':sha(proof/'repair.json'),'runtimeChanged':False,'stages':[]}
def save():put(out/'execution.json',record)
def stable():
 current=sources();assert current==before and git('rev-parse','HEAD')==head
 assert git('hash-object',str(repo/nav))==navBlob
 return current
def execute(name,args,extra=None,port=None):
 log=out/(name+'.log');assert not log.exists();stage={'name':name,'command':args,'startedAt':now(),'port':port,'state':'RUNNING'};record['stages'].append(stage);save();start=time.monotonic();print(json.dumps({'starting':name,'port':port}),flush=True)
 with log.open('x') as h:r=subprocess.run(args,cwd=t,env={**env,**(extra or {})},stdout=h,stderr=subprocess.STDOUT)
 stage.update({'exit':r.returncode,'testCompletedAt':now(),'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':stable()==before});save()
 if port:
  stage['initialOwnedServerStopped']=port_closed(port) and not (t/'.next/dev/lock').exists();stage['lifecycle']=reconcile_lock(port,name);stage['ownedServerStopped']=True
 stage['state']='CLOSED' if r.returncode==0 else 'FAILED';save();print(json.dumps({k:v for k,v in stage.items() if k!='command'}),flush=True);assert r.returncode==0,log.read_text()[-6500:];return stage
save()
try:
 report=out/'browser-report.json';output=out/'browser-artifacts'
 args=['node','node_modules/@playwright/test/cli.js','test','e2e/drawing-save-concurrency.spec.ts','--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
 s=execute('drawing-save-concurrency',args,{'CI':'1','TERMINAL_E2E_PORT':'3561','PLAYWRIGHT_JSON_OUTPUT_FILE':str(report)},3561)
 result=json.loads(report.read_text());stats=result['stats'];assert not result.get('errors') and stats['expected']==72 and stats['skipped']==18 and stats['unexpected']==stats['flaky']==0,stats
 cases=[]
 def walk(x):
  for q in x.get('specs',[]):
   for v in q.get('tests',[]):
    rr=v.get('results',[]);assert len(rr)==1 and rr[0].get('status') in ['passed','skipped'] and rr[0].get('retry')==0
    cases.append({'project':v['projectName'],'title':q['title'],'status':rr[0]['status'],'retry':0})
  for c in x.get('suites',[]):walk(c)
 walk(result);assert len(cases)==90
 fixed=[c for c in cases if c['title']=='a failed drawings read is shown and keeps drawing disabled'];assert len(fixed)==3 and all(c['status']=='passed' for c in fixed)
 skipped=[c for c in cases if c['status']=='skipped'];assert len(skipped)==18 and {c['project'] for c in skipped}=={'tablet','mobile'} and len({c['title'] for c in skipped})==9
 s.update({'passed':72,'failed':0,'skipped':18,'flaky':0,'retries':0,'reportSha256':sha(report),'cases':cases,'artifacts':packet(output),'repairedCasePassed':3});save()
 execute('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])
 after=stable();put(out/'source-after.json',after);git('diff','--check')
 record.update({'state':'QUALIFIED','completedAt':now(),'sourceStable':True,'sourceAfterSha256':sha(out/'source-after.json'),'retainedPriorNavigationUnits':15,'newBrowserPassed':72,'existingDesktopOnlySkips':18});save()
 print(json.dumps({'completed':True,'passed':72,'skipped':18,'repairedCasePassed':3,'sourceEntries':len(after),'navigationBlobPreserved':True}),flush=True)
except BaseException as e:record['state']='FAILED';record['error']=str(e);record['completedAt']=now();save();raise
