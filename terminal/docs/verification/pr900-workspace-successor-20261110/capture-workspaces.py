from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,stat,struct,yaml
repo=Path(__file__).resolve().parents[4];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof
port=47900;head='90ed31ba6e5ddbc39d58913b3416159b7c511874';base='d0578d1237a818e554d2ac52dc54e371f02c2770';sourceTree='04d0d4ebb0c2b8ca0b0d4dd421ea92f23977f96c'
def git(*a):return subprocess.check_output(['git','-C',str(repo),*a]).decode().strip()
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
 receipt={'schema':'terminal_pr900_browser_lifecycle_reconciliation.v1','label':label,'startedAt':now(),'initialLockPresent':True,'initialLock':initial,'before':observations(True),'state':'ABSENCE_VERIFIED_PENDING_UNLINK'}
 file=out/(label+'-lifecycle.json');assert not file.exists();put(file,receipt)
 assert identity()==initial;receipt['immediatelyBeforeUnlink']=observations(True);assert identity()==initial;put(file,receipt)
 lock.unlink();assert not lock.exists();receipt['after']=observations(False);receipt['state']='STALE_OWNED_LOCK_REMOVED_SERVER_ABSENCE_VERIFIED';receipt['completedAt']=now();put(file,receipt)
 return {'initialLockPresent':True,'reconciliation':str(file.relative_to(repo)),'sha256':sha(file),'serverAbsenceVerifiedAt':receipt['completedAt']}

assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and git('write-tree')==sourceTree
assert not git('ls-files','-u') and not git('diff','--name-only')
runtime=json.loads((proof/'dependencies.json').read_text());tests=json.loads((proof/'lifecycle-tests.json').read_text())
producer=t/'e2e/tools/capture_f12_b5_2_team_workspaces.cjs'
assert tests['exit']==0 and sha(producer)==tests['producerSha256']=='77a12e4a132ca1674c5e3c6fbb9a5de893ca12ca13a031201849a8d2e1ff4925'
assert port_closed(port) and not (t/'.next/dev/lock').exists()
run=proof/'workspace-current';assert not run.exists();run.mkdir()
packet=t/'docs/pr-crops/b-f12-b5-2-team-workspaces'
families=['b-f12-b5-1-grants','w9t_f13_9-team-rollup-no-rank']
def preserved_snapshot():return {str(p.relative_to(repo)):sha(p) for name in families for p in (t/'docs/pr-crops'/name).rglob('*') if p.is_file()}
preserved=preserved_snapshot();put(run/'preserved-packets-before.json',preserved)
drift=[]
for family in [*families,'b-f12-b5-2-team-workspaces']:
 y=yaml.safe_load((t/'docs/pr-crops'/family/'EVIDENCE.yml').read_text())
 for path,expectedHash in y['layoutFiles'].items():
  actual=sha(repo/path)
  if actual!=expectedHash:drift.append({'packet':family,'path':path,'before':expectedHash,'actual':actual})
assert len(drift)==1 and drift[0]['path']=='terminal/components/LayoutMenu.tsx' and drift[0]['packet']=='b-f12-b5-2-team-workspaces'
put(run/'packet-source-drift.json',drift)
expected=sorted(size+'-'+lang+'-'+state+'.png' for size in ['desktop','mobile'] for lang in ['en','zh'] for state in ['team-grouped','share-confirm','member-read-only'])
assert sorted(p.name for p in packet.glob('*.png'))==expected
old_manifest=yaml.safe_load((packet/'EVIDENCE.yml').read_text())
historyHash=sha(packet/'CAPTURE_HISTORY.md')
env=os.environ.copy();env['PATH']=str(Path(runtime['node']).parent)+':'+env['PATH']
for key in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_CROPS','TERMINAL_TICKER_NEWS_CAPTURE_PACKET','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_EVIDENCE_UPDATE','PLAYWRIGHT_JSON_OUTPUT_FILE']:env.pop(key,None)
chosen={'TERMINAL_CROP_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':runtime['browserStore'],'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','NEXT_TELEMETRY_DISABLED':'1'}
env.update(chosen)
paths=set(json.loads(subprocess.check_output([runtime['node'],'-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,env=env,text=True)))
paths|={'terminal/e2e/tools/capture_f12_b5_2_team_workspaces.cjs','terminal/e2e/tools/capture_f12_b5_2_team_workspaces.test.cjs','terminal/lib/__tests__/b_f12_b5_1GrantsEvidence.test.ts','terminal/lib/__tests__/b_f12_b5_2TeamWorkspacesEvidence.test.ts','terminal/lib/__tests__/w9t_f13_9TeamRollupEvidence.test.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json'}
for family in [*families,'b-f12-b5-2-team-workspaces']:paths.update(yaml.safe_load((t/'docs/pr-crops'/family/'EVIDENCE.yml').read_text())['layoutFiles'])
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
before=snapshot();put(run/'source-before.json',before)
command=[runtime['node'],'e2e/tools/capture_f12_b5_2_team_workspaces.cjs']
record={'schema':'terminal.pr900.current-workspace-capture.v1','state':'RUNNING','startedAt':now(),'head':head,'protectedBase':base,'sourceTree':sourceTree,'command':command,'runtime':runtime['versions'],'environment':chosen,'producerSha256':sha(producer),'port':port,'sourceEntries':len(before),'expectedImages':expected,'priorManifestSha256':sha(packet/'EVIDENCE.yml'),'lifecycleTestReceiptSha256':sha(proof/'lifecycle-tests.json')}
put(run/'execution.json',record)
print(json.dumps({'state':'RUNNING','port':port,'sourceEntries':len(before),'expectedImages':12,'unchangedPackets':families}),flush=True)
log=run/'capture.log';started=time.monotonic();startedNs=time.time_ns()
with log.open('x') as stream:
 proc=subprocess.Popen(command,cwd=t,env=env,stdout=stream,stderr=subprocess.STDOUT)
 record['producerPid']=proc.pid;put(run/'execution.json',record)
 code=proc.wait()
after=snapshot();put(run/'source-after.json',after)
record.update(exit=code,seconds=round(time.monotonic()-started,3),logSha256=sha(log),sourceStable=before==after,preservedPacketsUnchanged=preserved_snapshot()==preserved,captureHistoryUnchanged=sha(packet/'CAPTURE_HISTORY.md')==historyHash)
events=[]
for line in log.read_text().splitlines():
 try:
  row=json.loads(line)
  if isinstance(row,dict) and row.get('event')=='owned-server-closed':events.append(row)
 except json.JSONDecodeError:pass
record['ownedCloseEvents']=events
images={}
for name in expected:
 f=packet/name;data=f.read_bytes()
 assert data[:8]==b'\x89PNG\r\n\x1a\n'
 width,height=struct.unpack('>II',data[16:24])
 images[name]={'sha256':sha(f),'bytes':len(data),'width':width,'height':height,'modifiedDuringCapture':f.stat().st_mtime_ns>=startedNs}
record['images']=images
record['readOnlyPortAfter']=inspect(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'])
record['nextLockPresentAfterProducer']=(t/'.next/dev/lock').exists()
if code!=0 or len(events)!=1:
 record.update(state='FAILED_NO_LIFECYCLE_REPLAY',completedAt=now())
 put(run/'execution.json',record)
 print(json.dumps({'state':record['state'],'exit':code,'events':events,'seconds':record['seconds'],'logTail':log.read_text()[-9000:]}),flush=True)
 raise SystemExit(1)
event=events[0];assert event['port']==port and isinstance(event['pid'],int) and event['pid']>0
record['recordedChildAfter']=inspect(['ps','-p',str(event['pid']),'-o','pid=,ppid=,comm='])
assert record['recordedChildAfter']['exit']==1 and not record['recordedChildAfter']['stdout'].strip() and not record['recordedChildAfter']['stderr'].strip()
record['lifecycle']=reconcile_lock(port,'workspace-current',extraPids=[event['pid']])
record['ownedPortClosed']=port_closed(port);record['nextLockAbsent']=not(t/'.next/dev/lock').exists()
manifest=yaml.safe_load((packet/'EVIDENCE.yml').read_text())
record['manifestSha256']=sha(packet/'EVIDENCE.yml')
record['sourceLocksMatch']=all(sha(repo/path)==digest for path,digest in manifest['layoutFiles'].items())
record['measurementsMatchPriorIntendedStates']=manifest['measurements']==old_manifest['measurements']
record['manifestFilesMatch']=sorted(manifest['files'])==expected
record['manifestCaptureHeadCorrect']=('# capturedAtHead: '+head) in (packet/'EVIDENCE.yml').read_text()
good=record['sourceStable'] and record['preservedPacketsUnchanged'] and record['captureHistoryUnchanged'] and record['ownedPortClosed'] and record['nextLockAbsent'] and record['sourceLocksMatch'] and record['measurementsMatchPriorIntendedStates'] and record['manifestFilesMatch'] and record['manifestCaptureHeadCorrect']
good=good and all(v['modifiedDuringCapture'] and v['bytes']>0 and ((v['width'],v['height'])==(1440,900) if name.startswith('desktop') else (v['width'],v['height'])==(390,844)) for name,v in images.items())
record.update(state='QUALIFIED' if good else 'FAILED',completedAt=now())
put(run/'execution.json',record)
print(json.dumps({'state':record['state'],'exit':code,'seconds':record['seconds'],'freshImages':sum(v['modifiedDuringCapture'] for v in images.values()),'sourceEntries':len(before),'sourceStable':record['sourceStable'],'preservedPacketFiles':len(preserved),'preservedPacketsUnchanged':record['preservedPacketsUnchanged'],'ownedClose':event,'ownedPortClosed':record['ownedPortClosed'],'nextLockAbsent':record['nextLockAbsent'],'measurementsMatch':record['measurementsMatchPriorIntendedStates']}),flush=True)
raise SystemExit(0 if good else 1)
