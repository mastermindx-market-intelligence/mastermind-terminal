"""One attended PR707 native pair through the existing producer/supervisor."""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, time

ROOT=Path('/Volumes/Mastermind/agent-workspaces/terminal/review/terminal-pr707-warm-cache-integration-20261109')
TERMINAL=ROOT/'terminal'
AUDIT=ROOT/'docs/verification/pr707-warm-cache-integration-20261109/protected-native-r1'
COMPOSITION=Path('/tmp/pr707-original-integration-20261111-c3/conflict-resolution.json')
CAPTURE=TERMINAL/'docs/verification/exposure-workspace-20261103/warm-cache-integration-20261111'
DRIVER=ROOT/'docs/verification/pr645-expiry-successor-20261110/native-driver.cjs'
REVISION='warm-cache-integration-20261111'
PACKETS={'eod':'eod-heatmap-flowdesk-load-failure','gex':'gex-levels-heatmap-load-failure'}
EXPECTED={'eod':126,'gex':114}
PORTS={'eod':3566,'gex':3564}
HEAD='181e06a944bf892f7cb064a3aeab96ac827bc5ca'
PUBLISHED='0b48ac7f699b99fce10fd76d64d7c278cd23e9d2'
INDEX='230348fb24131907d559b48e0516ffbc268537d0'
MERGE='6c5d71ebbd797897b50f8727588bd95e834517a8'
INPUT_HEADS=['0fd27ff1dfb7e031457a4ffe4c05458587c4eb81','6c5d71ebbd797897b50f8727588bd95e834517a8']
PRIOR_ROOTS={'eod':'398ee08642c4db5eb7ee1648e5865e42146fd98aec9f96a208727bfe003d832d','gex':'0ffb688481f64075b6a07181900c709d4c58afe60cd6dce0e1e1c948bc6abf9e'}
FORBIDDEN=['CAPTURE_HEAD','CAPTURE_ONLY','UPDATE_HEATMAP_EVIDENCE','TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE',
 'TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE','TERMINAL_EXPOSURE_PAINT_PROBE','EXPOSURE_P09_CURRENT_WITNESS',
 'EXPOSURE_P09_PREVIOUS_WITNESS','EXPOSURE_NATIVE_WITNESS','TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(raw):return hashlib.sha256(raw).hexdigest()
def sha(path):return digest(path.read_bytes())
def write(path,value):path.write_text(json.dumps(value,sort_keys=True,indent=2)+'\n')
def read(path):return json.loads(path.read_text())
def git(*args):return subprocess.check_output(['git','-C',str(ROOT),*args],text=True).strip()
def identity():return {'head':git('rev-parse','HEAD'),'headTree':git('rev-parse','HEAD^{tree}'),'mergeHead':git('rev-parse','MERGE_HEAD'),'indexTree':git('write-tree')}
def query(command):
 p=subprocess.run(command,capture_output=True,text=True);return {'command':command,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
def runtime(port):
 listener=query(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'])
 lock=TERMINAL/'.next/dev/lock';handles=query(['lsof',str(lock)])
 all_cwd=query(['lsof','-nP','-a','-d','cwd','-Fpn']);holders=[];pid=None
 for line in all_cwd['stdout'].splitlines():
  if line.startswith('p'):pid=line[1:]
  if line.startswith('n') and (line[1:]==str(ROOT) or line[1:].startswith(str(ROOT)+'/')):
   holders.append({'pid':pid,'cwd':line[1:]})
 return {'port':port,'listenerReturncode':listener['exit'],'listeners':listener['stdout'],'listenerStderr':listener['stderr'],
  'nextLockPathExists':lock.exists(),'nextLockOpenHandles':handles['stdout'],'nextLockHandlesExit':handles['exit'],
  'nextLockHandlesStderr':handles['stderr'],'workspaceCwdHolders':holders}
def node_json(code,*args):
 p=subprocess.run(['node','-e',code,*map(str,args)],cwd=TERMINAL,capture_output=True,text=True)
 assert p.returncode==0,(p.returncode,p.stdout[-5000:],p.stderr[-5000:])
 return json.loads(p.stdout)
def source_snapshot(paths):
 return {path:sha(ROOT/path) for path in paths}
def main():
 assert not AUDIT.exists()
 assert sha(COMPOSITION)=='ff5f2a343bed2a56c43d5a7444684bca3e54741ac0e7ef37d026a1fd994b2116'
 observed=identity()
 assert observed=={'head':HEAD,'headTree':'28e452fbc0a1c60fb00e9de6b79e1790b69d873e','indexTree':INDEX,'mergeHead':MERGE}
 assert git('ls-files','-u')==''
 assert sha(TERMINAL/'e2e/tools/optionsExposureEvidence.cjs')=='753ff1d32da23b7e0b95268aeb20b08b2e6934f6a48cdfda08199bdb38749972'
 assert sha(TERMINAL/'components/heatmap/HeatmapView.tsx')=='bd6c828a5ee37594f07afa642f32bb075e2cff60ca37c1ee8b6ca7d12c77a926'
 assert sha(TERMINAL/'lib/dataCache.ts')=='68b570a4021a6d7519bc6a2e46658560404cf9ddad9fc4c82779797e926a922c'
 assert not CAPTURE.exists()
 env=os.environ.copy()
 for key in FORBIDDEN: assert not env.get(key),key
 for key in ['GITHUB_ACTIONS','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA','GITHUB_HEAD_REF']:assert not env.get(key),key
 cache=Path('/Users/chriswong/Library/Caches/ms-playwright')
 assert cache.is_dir()
 env.update({'PLAYWRIGHT_BROWSERS_PATH':str(cache),'HUB_REALTIME_QUOTES':'1','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
 paths=[];excluded=[]
 raw=subprocess.check_output(['git','-C',str(ROOT),'ls-files','--cached','--others','--exclude-standard','-z']).decode()
 for path in sorted(set(raw.split('\0'))):
  if not path or path.startswith(('docs/','terminal/docs/','terminal/test-results/','terminal/.next/','terminal/node_modules/')):continue
  file=ROOT/path
  if not file.is_file() or file.is_symlink():excluded.append(path);continue
  paths.append(path)
 contracts={}
 for kind,packet in PACKETS.items():
  inputs=node_json('const e=require("./e2e/tools/optionsExposureEvidence.cjs");console.log(JSON.stringify(e.optionsIntegrationInputs(process.argv[1])));',kind)
  assert len(inputs)==(32 if kind=='eod' else 29) and len(set(inputs))==len(inputs)
  assert all(path in paths for path in inputs)
  contracts[kind]={'schema':'exposure_master_capture_sources.v1','kind':kind,'currentInputs':inputs,'observedInputs':paths}
  destination=ROOT/'terminal/docs/pr-crops'/packet/'operations/exposure-source-compatibility-20261105/revisions'/REVISION
  assert not destination.exists()
  state=runtime(PORTS[kind]);assert state['listenerReturncode']==1 and not state['listeners'] and not state['listenerStderr'] and not state['workspaceCwdHolders'] and not state['nextLockOpenHandles'],state
 baseline=source_snapshot(paths)
 AUDIT.mkdir()
 (CAPTURE/'prior-roots').mkdir(parents=True)
 for family,packet in PACKETS.items():
  prior=ROOT/'terminal/docs/pr-crops'/packet/'EVIDENCE.yml'
  assert sha(prior)==PRIOR_ROOTS[family]
  (CAPTURE/'prior-roots'/(family+'.EVIDENCE.yml')).write_bytes(prior.read_bytes())
 context={'operation':'terminal-pr707-warm-cache-native-current-20261111','publishedBasis':PUBLISHED,
  'sourceLawPin':'bb2c2e4437e6ee250f9d4ee9b6b420abdfbbc178','sourceIdentity':'stable-composed-working-tree',
  'actualGit':observed,'integratedSourceHeads':INPUT_HEADS,'compositionReceiptSha256':sha(COMPOSITION),
  'driver':str(DRIVER.relative_to(ROOT)),'driverSha256':sha(DRIVER),'sourceFiles':len(paths),
  'excludedNonregularPaths':excluded,'initialLifecycle':{kind:runtime(PORTS[kind]) for kind in PACKETS}}
 write(AUDIT/'capture-context.json',context);write(AUDIT/'source-baseline.json',baseline)
 record={'state':'RUNNING','startedAt':now(),'context':context,'results':{}}
 write(AUDIT/'execution.json',record);print(json.dumps({'state':'STARTED','operation':context['operation'],'actualGit':observed,'sourceFiles':len(paths),'ports':PORTS}),flush=True)
 producers={kind:sha(TERMINAL/('e2e/tools/capture_'+('eod_heatmap_flowdesk' if kind=='eod' else 'gex_levels_heatmap')+'_load_failure.cjs')) for kind in PACKETS}
 for kind,packet in PACKETS.items():
  directory=ROOT/'terminal/docs/pr-crops'/packet/'operations/exposure-source-compatibility-20261105/revisions'/REVISION
  directory.mkdir();crop=directory/'qualified-root'
  prior=ROOT/'terminal/docs/pr-crops'/packet/'EVIDENCE.yml'
  (directory/'EVIDENCE.before.yml').write_bytes(prior.read_bytes())
  write(directory/'source-contract.json',contracts[kind]);write(directory/'capture-sources-before.json',baseline)
  assert source_snapshot(paths)==baseline and identity()==observed and sha(DRIVER)==context['driverSha256']
  initial=runtime(PORTS[kind]);assert initial['listenerReturncode']==1 and not initial['listeners'] and not initial['workspaceCwdHolders'] and not initial['nextLockOpenHandles']
  capture_id='terminal-pr707-'+kind+'-warm-cache-integration-20261111-r1'
  run_env={**env,'TERMINAL_CROP_OUTPUT_DIR':str(crop),'TERMINAL_CROP_PORT':str(PORTS[kind]),'TERMINAL_NATIVE_CAPTURE_ID':capture_id}
  command=['node',str(DRIVER),kind,str(PORTS[kind]),str(directory/'supervision.json'),str(directory/'capture.log')]
  started=now();clock=time.monotonic();write(directory/'command.json',{'command':command,'captureId':capture_id,'startedAt':started,'initialLifecycle':initial,'context':context})
  with (directory/'driver.log').open('w') as log:run=subprocess.run(command,env=run_env,stdout=log,stderr=subprocess.STDOUT)
  seconds=round(time.monotonic()-clock,3);completed=now()
  after=source_snapshot(paths);write(directory/'capture-sources-after.json',after);state=runtime(PORTS[kind])
  supervision=read(directory/'supervision.json')
  attempt={'kind':kind,'exit':run.returncode,'seconds':seconds,'sourceStable':after==baseline,'headStable':identity()==observed,
   'lifecycle':state,'supervisionState':supervision['state'],'startedAt':started,'completedAt':completed}
  write(directory/'attempt.json',attempt)
  assert run.returncode==0 and after==baseline and identity()==observed and supervision['state']=='CLOSED',attempt
  assert state['listenerReturncode']==1 and not state['listeners'] and not state['listenerStderr'] and not state['nextLockPathExists'] and not state['nextLockOpenHandles'] and not state['workspaceCwdHolders'],state
  value=supervision['result'];assert value['closed'] and value['status']==0 and value['signal'] is None and value['error'] is None and not value['timedOut'] and value['serverReportedStopped'] and value['serverSettled'] and value['serverRefused'] is None,value
  lines=(directory/'capture.log').read_text().splitlines();receipts=[]
  for line in lines:
   offset=line.find('{"nativeEvidence":')
   if offset>=0:receipts.append(json.loads(line[offset:])['nativeEvidence'])
  assert len(receipts)==1,{'nativeReceipts':len(receipts)}
  native=receipts[0];assert native['family']==kind and native['captureId']==capture_id and native['capturedAtHead']==HEAD
  validator='const path=require("node:path"),owner=require("./e2e/tools/capture_ci_evidence.cjs"),v=require("./e2e/tools/visualEvidence.cjs");const repo=path.resolve(process.cwd(),".."),d={...owner.nativeDefinition(process.argv[1]),directory:process.argv[2]};const manifest=owner.readNativePacket(repo,d),images=owner.nativeImages(repo,d,v);console.log(JSON.stringify({head:manifest.head,manifestSha256:manifest.sha256,layout:manifest.layout,files:manifest.files,images}));'
  checked=node_json(validator,kind,str(crop.relative_to(ROOT)))
  assert checked['head']==HEAD and checked['manifestSha256']==native['manifestSha256']==sha(crop/'EVIDENCE.yml')
  assert len(checked['files'])==EXPECTED[kind] and len(checked['images'])==EXPECTED[kind]
  actual={row['file']:row['sha256'] for row in checked['images']}
  assert actual=={row['file']:row['sha256'] for row in native['files']}
  assert sorted(p.name for p in crop.iterdir())==sorted(checked['files']+['EVIDENCE.yml'])
  assert all(baseline[path]==value for path,value in checked['layout'].items())
  # The producer emits nativeEvidence only after successful matrix membership and cleanup.
  # Its structured receipt stays reliable when diagnostic warnings interleave progress lines.
  frames=[{'file':row['file'],'status':'success'} for row in native['files']]
  assert len(frames)==EXPECTED[kind] and {x['file'] for x in frames}==set(checked['files'])
  history={'schema':'exposure_warm_cache_native_capture_history.v1','kind':kind,'packet':packet,'revision':REVISION,
   'operation':'exposure-source-compatibility-20261105','captureRootPreimageSha256':sha(directory/'EVIDENCE.before.yml'),
   'producerHistory':native['history'],'actualGit':observed,'publishedBasis':PUBLISHED,'integratedSourceHeads':INPUT_HEADS,
   'sourceIdentity':context['sourceIdentity'],'capturedSourceSnapshotSha256':sha(directory/'capture-sources-before.json')}
  write(directory/'history.json',history)
  execution={'schema':'exposure_master_integration_capture.v1','operation':'exposure-source-compatibility-20261105',
   'revision':REVISION,'kind':kind,'packet':packet,'branchHead':HEAD,'publishedBasis':PUBLISHED,
   'protectedMaster':MERGE,'integratedSourceHeads':INPUT_HEADS,'actualGit':observed,'sourceIdentity':context['sourceIdentity'],
   'capturedSourceSnapshotSha256':sha(directory/'capture-sources-before.json'),'command':['node',supervision['command'][1]],'actualCommand':supervision['command'],
   'port':PORTS[kind],'captureId':capture_id,'exit':0,'seconds':seconds,'expected':EXPECTED[kind],'successfulFiles':len(checked['files']),
   'sourceStable':True,'headStable':True,'sourceBeforeSha256':sha(directory/'capture-sources-before.json'),
   'sourceAfterSha256':sha(directory/'capture-sources-after.json'),'manifestSha256':checked['manifestSha256'],
   'logSha256':sha(directory/'capture.log'),'attemptReceiptSha256':sha(directory/'attempt.json'),'supervisionReceiptSha256':sha(directory/'supervision.json'),
   'nativeReceipt':native,'nativeSupervisor':value,'nativeServerEvents':supervision['events'],'lifecycle':state,
   'portClosed':True,'nextLockAbsent':True,'ownedServerStopped':True,'frames':frames,
   'images':{row['file']:{**{k:v for k,v in row.items() if k!='file'},'bytes':(crop/row['file']).stat().st_size} for row in checked['images']},
   'producerPins':{'terminal/e2e/tools/capture_'+('eod_heatmap_flowdesk' if name=='eod' else 'gex_levels_heatmap')+'_load_failure.cjs':pin for name,pin in producers.items()},
   'producerStartedAt':supervision['events'][0]['observedAt'],'producerSettledAt':supervision['events'][-1]['observedAt'],
   'timingSource':'supervisor event timestamps; seconds is outer capture duration',
   'frameInventorySource':'nativeEvidence.files emitted after successful producer matrix verification','webpack':False}
  write(directory/'capture-execution.json',execution)
  result={'state':'NATIVE_FRAMES_VERIFIED_PENDING_WARM_SUCCESSOR','frames':len(checked['files']),'manifestSha256':checked['manifestSha256'],
   'executionSha256':sha(directory/'capture-execution.json'),'sourceSnapshotSha256':execution['sourceBeforeSha256'],'seconds':seconds,
   'portClosed':True,'nextLockAbsent':True}
  record['results'][kind]=result;write(AUDIT/'execution.json',record);print(json.dumps({'kind':kind,**result}),flush=True)
 record['state']='BOTH_NATIVE_FAMILIES_VERIFIED_PENDING_WARM_READER_AND_BROWSER';record['completedAt']=now()
 write(AUDIT/'execution.json',record);print(json.dumps({'state':record['state'],'results':record['results']}),flush=True)
if __name__=='__main__':
 try:main()
 except Exception as error:
  if AUDIT.exists():write(AUDIT/'failure.json',{'state':'FAILED','at':now(),'type':type(error).__name__,'message':str(error)[:5000]})
  raise
