from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,stat,re,struct
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';run=Path(__file__).resolve().parent;out=run
head='cb3b9a937c9eeb8d8cb2b10c9f1a0d1e8510bfa0';base='03af393ce05c12282003a3919cc473c032264922';port=3868
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def inspect(args):
 r=subprocess.run(args,capture_output=True,text=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'observedAt':now()}
def port_closed(port):
 r=inspect(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in [0,1] and not r['stderr'].strip();return r['exit']==1
def sources():return json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout)
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
 receipt={'schema':'terminal_pr896_capture_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
assert port_closed(port) and not (t/'.next/dev/lock').exists()
packet=t/'docs/pr-crops/b-f08-b5-3-collisions'
files=sorted(f'{state}-{width}'+('-zh' if lang=='zh' else '')+'.png' for state in ['watching','suite-degraded','suite-never-ran','unresolved'] for width in [1440,390] for lang in ['en','zh'])
assert len(files)==16 and not list(packet.glob('FAIL-*'))
proof=run/'capture-r1';assert not proof.exists();proof.mkdir()
before=sources();put(proof/'source-before.json',before)
env=os.environ.copy()
for key in ['CAPTURE_ONLY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION']:env.pop(key,None)
env.update({'TERMINAL_CROP_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr896-playwright'),'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
command=['node','e2e/tools/capture_b_f08_b5_3_collisions.cjs'];log=proof/'capture.log'
record={'schema':'terminal_pr896_collisions_capture.v1','head':head,'protectedMaster':base,'command':command,'port':port,'captureOnly':env.get('CAPTURE_ONLY'),'expectedImages':files,'sourceEntries':len(before),'producerSha256':sha(t/'e2e/tools/capture_b_f08_b5_3_collisions.cjs'),'startedAt':now(),'state':'RUNNING'}
def save():put(proof/'execution.json',record)
save();print(json.dumps({'starting':'original full Alerts collisions producer','expected':16,'port':port,'sources':len(before)}),flush=True)
startNs=time.time_ns();start=time.monotonic();observed=[]
with log.open('x') as h:
 child=subprocess.Popen(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 record['producerPid']=child.pid;save()
 while child.poll() is None:
  lock=t/'.next/dev/lock'
  if not observed and lock.exists():
   try:
    value=json.loads(lock.read_text())
    if value.get('port')==port and isinstance(value.get('pid'),int):
     observed.append(value);record['observedNativeNextLocks']=observed;save()
   except (ValueError,FileNotFoundError):pass
  time.sleep(.25)
 exitCode=child.wait()
after=sources();put(proof/'source-after.json',after)
record.update({'exit':exitCode,'seconds':round(time.monotonic()-start,2),'sourceStable':before==after,'logSha256':sha(log),'observedNativeNextLocks':observed,'state':'CAPTURE_EXITED_PENDING_VALIDATION'});save()
record['lifecycle']=reconcile_lock(port,'collisions-r1',[v['pid'] for v in observed])
pids=sorted({child.pid,*[v['pid'] for v in observed]})
absence=inspect(['ps','-p',','.join(map(str,pids)),'-o','pid=,ppid=,comm='])
assert absence['exit']==1 and not absence['stdout'].strip() and not absence['stderr'].strip(),absence
record['ownedRecordedProcessesAbsent']=absence
cwd=inspect(['lsof','-a','-u','chriswong','-d','cwd','-F','pcn']);assert cwd['exit']==0 and not cwd['stderr'].strip()
assert not any(line.startswith('n'+str(repo)) for line in cwd['stdout'].splitlines())
record['ownedWorkspaceCwdsAbsent']={'observedAt':cwd['observedAt'],'exit':cwd['exit']}
manifest=(packet/'EVIDENCE.yml').read_text()
entries=re.findall(r'^  (terminal/\S+): "?([0-9a-f]{64})"?$',manifest,re.M)
assert len(entries)==7 and all(sha(repo/p)==digest for p,digest in entries)
assert sorted(re.findall(r'^  - (\S+\.png)$',manifest,re.M))==files
assert re.search(r'^# capturedAtHead: '+head+r'$',manifest,re.M)
text=log.read_text();captures=re.findall(r'capture ([a-z0-9-]+\.png) … ',text)
assert sorted(captures)==files and text.count('\nok\n')+text.count('… ok\n')==16
assert not list(packet.glob('FAIL-*')) and 'wrote 16 crops + EVIDENCE.yml capturedAtHead='+head in text
images={}
for name in files:
 p=packet/name;data=p.read_bytes();assert p.stat().st_mtime_ns>=startNs and data[:8]==b'\x89PNG\r\n\x1a\n'
 width,height=struct.unpack('>II',data[16:24]);expected=(390,844) if '-390' in name else (1440,900);assert (width,height)==expected
 images[name]={'sha256':sha(p),'bytes':len(data),'width':width,'height':height}
assert exitCode==0 and before==after and observed and port_closed(port) and not(t/'.next/dev/lock').exists()
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base
record.update({'state':'FULL_16_CAPTURE_QUALIFIED','successfulImages':len(images),'images':images,'layoutSources':dict(entries),'manifestSha256':sha(packet/'EVIDENCE.yml'),'sourceBeforeSha256':sha(proof/'source-before.json'),'sourceAfterSha256':sha(proof/'source-after.json'),'ownedPortClosed':True,'nextLockAbsent':True,'completedAt':now()});save()
print(json.dumps({'state':record['state'],'images':len(images),'sourceStable':True,'ownedPortClosed':True,'nextLockAbsent':True,'seconds':record['seconds']}),flush=True)
