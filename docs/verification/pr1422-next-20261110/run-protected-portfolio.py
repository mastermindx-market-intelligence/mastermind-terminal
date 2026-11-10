from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,stat,re,pwd
repo=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4')
t=repo/'terminal';out=repo/'docs/verification/pr1422-next-20261110'
head='3f6a75b7d5f82802c010edc0e42b7ffd501c9cf0';port=34229
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,data):p.write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')
def put(p,x):write(p,x)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
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
  st=lock.lstat();assert stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid()
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
  r=inspect(['lsof','-a','-u',pwd.getpwuid(os.getuid()).pw_name,'-d','cwd','-F','pcn']);cur=[];records=[]
  for line in r['stdout'].splitlines():
   if line.startswith('p'):
    if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
    cur=[line]
   else:cur.append(line)
  if any(x.startswith('n'+str(repo)) for x in cur):records.append(cur)
  checks['ownedWorkspaceCwds']={k:v for k,v in r.items() if k!='stdout'};checks['ownedWorkspaceCwds']['records']=records
  assert r['exit']==0 and not r['stderr'].strip() and not records
  return checks
 receipt={'schema':'terminal_pr1422_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()==head
assert port_closed(port) and not (t/'.next/dev/lock').exists()
archive=out/'prior-portfolio-before-protected-join';archive.mkdir()
packet=t/'docs/verification/portfolio-event-refresh-20261102/browser'
inventory={}
for p in packet.glob('*.png'):
 shutil.copy2(p,archive/p.name);inventory[p.name]=sha(p)
assert len(inventory)==8,inventory
put(out/'prior-portfolio-before-protected-join.json',inventory)
keys=set(json.loads((out/'portfolio-source-before.json').read_text()).keys())
keys.update(p for p in subprocess.check_output(['git','diff','--name-only','6694f9bab28fa3c950c7bd5ec0a5957e736a4708',head],cwd=repo,text=True).splitlines() if p.startswith('terminal/') and not p.startswith('terminal/docs/'))
def current_sources():return {p:sha(repo/p) for p in sorted(keys)}
before=current_sources();put(out/'portfolio-protected-source-before.json',before)
old=json.loads((out/'portfolio-browser-execution.json').read_text())
command=old['command'];command[-1]='--output='+str(repo/'.pr1422-qualification/portfolio-protected-artifacts')
assert not (repo/'.pr1422-qualification/portfolio-protected-artifacts').exists()
command.insert(4,'e2e/sector-leadership-dossier.spec.ts')
dossierTitles=['a withdrawn access clears every figure and leaves the rest of the overview intact','a withdrawn access clears the companion and leaves the rest of the overview intact']
command+=['--grep','(?:Portfolio event panel refreshes after a holding edit|'+'|'.join(re.escape(title)+'$' for title in dossierTitles)+')']
runtime=repo/'.pr1422-qualification/runtime/node-v22.23.4-darwin-arm64/bin'
env={**os.environ,'PATH':str(runtime)+':'+os.environ['PATH'],'CI':'1','TERMINAL_E2E_PORT':str(port),'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','PLAYWRIGHT_BROWSERS_PATH':str(Path.home()/'Library/Caches/ms-playwright'),'PLAYWRIGHT_JSON_OUTPUT_FILE':str(out/'portfolio-protected-report.json')}
log=out/'portfolio-protected-browser.log';started=now();start=time.monotonic()
with log.open('xb') as f:r=subprocess.run(command,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
after=current_sources();put(out/'portfolio-protected-source-after.json',after)
record={'source':head,'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,3),'startedAt':started,'completedAt':now(),'port':port,'sourceStable':before==after,'sourceCount':len(before),'logSha256':sha(log)}
put(out/'portfolio-protected-execution.json',record)
record['lifecycle']=reconcile_lock(port,'portfolio-protected')
record['portClosed']=port_closed(port);record['nextLockAbsent']=not (t/'.next/dev/lock').exists()
report=json.loads((out/'portfolio-protected-report.json').read_text())
record['stats']=report.get('stats');record['reportErrors']=report.get('errors',[])
def cases(report):
 found=[]
 def walk(suite):
  for spec in suite.get('specs',[]):
   for test in spec.get('tests',[]):
    found.append({'key':test['projectName']+'|'+spec['title'],'expectedStatus':test.get('expectedStatus'),'attempts':[{'status':x['status'],'retry':x['retry']} for x in test.get('results',[])]})
  for s in suite.get('suites',[]):walk(s)
 walk(report);return sorted(found,key=lambda x:x['key'])
record['cases']=cases(report)
prior=cases(json.loads((out/'portfolio-browser-report.json').read_text()))
portfolioCases=[x for x in record['cases'] if x['key'].split('|',1)[1] not in dossierTitles]
dossierCases=[x for x in record['cases'] if x['key'].split('|',1)[1] in dossierTitles]
assert portfolioCases==prior,(portfolioCases,prior)
assert len(dossierCases)==6 and sorted(x['key'] for x in dossierCases)==sorted(p+'|'+title for p in ['desktop','tablet','mobile'] for title in dossierTitles)
assert all(x['attempts']==[{'status':'passed','retry':0}] for x in dossierCases)
assert record['stats']['expected']==14 and record['stats']['skipped']==4 and record['stats']['unexpected']==0 and record['stats']['flaky']==0
assert r.returncode==0 and record['sourceStable'] and record['portClosed'] and record['nextLockAbsent'] and not record['reportErrors']
record['images']={p.name:sha(p) for p in packet.glob('*.png')}
put(out/'portfolio-protected-execution.json',record)
print(json.dumps({'step':'portfolio-current-runtime','source':head,'exit':r.returncode,'stats':record['stats'],'sourceStable':record['sourceStable'],'portClosed':record['portClosed'],'nextLockAbsent':record['nextLockAbsent']}),flush=True)
typegen=['node','node_modules/next/dist/bin/next','typegen']
with (out/'typegen-protected.log').open('xb') as f:tg=subprocess.run(typegen,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
put(out/'typegen-protected-execution.json',{'source':head,'command':typegen,'exit':tg.returncode,'logSha256':sha(out/'typegen-protected.log')})
assert tg.returncode==0
cmd=['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']
log=out/'full-typecheck-protected.log';start=time.monotonic()
with log.open('xb') as f:r=subprocess.run(cmd,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
rec={'source':head,'command':cmd,'exit':r.returncode,'seconds':round(time.monotonic()-start,3),'logSha256':sha(log)}
put(out/'full-typecheck-protected-execution.json',rec);print(json.dumps({'step':'full-typecheck-protected',**rec}),flush=True)
raise SystemExit(r.returncode)
