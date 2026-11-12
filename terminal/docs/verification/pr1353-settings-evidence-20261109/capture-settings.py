from pathlib import Path
import subprocess,json,hashlib,os,re,time,datetime,struct,shutil
repo=Path('/Volumes/Mastermind 2/agent-workspaces/terminal/review/terminal-pr1353-settings-evidence-20261109');root=repo/'terminal';run=root/'test-results/pr1353-settings-evidence-20261109';proof=root/'docs/verification/pr1353-settings-evidence-20261109'
head='80e69c39e00b6c16c5fc32b5ca1e9146d31b264d';base='1c0bf028cf72539a4d3fcb17fa137ee474d764f9'
def git(*args):return subprocess.run(['git','-C',str(repo),*args],capture_output=True,text=True,check=True).stdout.strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def closed(port):return subprocess.run(['lsof','-t','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True).returncode==1
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
assert not (root/'.next/dev/lock').exists() and closed(3803) and closed(3804)
assert sha(root/'components/settings/SettingsProvider.tsx')=='fb717b94d3074bf3e7866cd399088bb0203d8e1fea0b6c18bfff46546972402b'
for packet in ['b-f08-6-alert-prefs','w9t-f08-13-targets-readout']:
 original=root/'docs/pr-crops'/packet;archive=proof/'prior'/packet;assert not archive.exists();inventory={str(p.relative_to(original)):sha(p) for p in sorted(original.rglob('*')) if p.is_file()};shutil.copytree(original,archive);assert all(sha(archive/p)==v for p,v in inventory.items());put(proof/('prior-'+packet+'-sha256.json'),inventory)
shutil.copy2(run/'initial-integration.log',proof/'initial-integration.log')
paths=set(git('ls-files','--cached','--others','--exclude-standard').splitlines())
sourcePaths=sorted(p for p in paths if p.startswith('terminal/') and not p.startswith(('terminal/docs/','terminal/test-results/','terminal/node_modules/','terminal/.next/')) and re.search(r'\.(?:ts|tsx|css|js|cjs|mjs|json)$',p))
def snapshot():return {p:sha(repo/p) for p in sourcePaths}
before=snapshot();put(proof/'source-before.json',before);put(proof/'source-contract.json',{'schema':'terminal_pr1353_settings_sources.v1','branchHead':head,'protectedMaster':base,'observedInputs':sourcePaths,'producers':{p:before[p] for p in ['terminal/e2e/tools/capture_f08_6_alert_prefs.cjs','terminal/e2e/tools/capture_w9t_f08_13_targets.cjs','terminal/e2e/tools/capture_ci_evidence.cjs']}})
git('add','-A');tree=git('write-tree');env=os.environ.copy()
for key in ['CAPTURE_ONLY','CAPTURE_HEAD']:env.pop(key,None)
env['PLAYWRIGHT_BROWSERS_PATH']=str(run/'playwright-browsers');env['PR1353_SOURCE_TREE']=tree
execution={'schema':'terminal_pr1353_settings_native.v1','branchHead':head,'protectedMaster':base,'indexTreeAtStart':tree,'sourceFiles':len(before),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'stages':[]}
put(proof/'capture-execution.json',execution)
for kind,packet,port,count,cmd in [('alerts','b-f08-6-alert-prefs',3803,16,['node','e2e/tools/capture_f08_6_alert_prefs.cjs']),('settings-targets','w9t-f08-13-targets-readout',3804,8,['node',str(proof/'settings-capture-owner.cjs')])]:
 assert closed(port) and not (root/'.next/dev/lock').exists();log=proof/(kind+'.log');assert not log.exists();env['TERMINAL_CROP_PORT']=str(port);started=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic()
 print(json.dumps({'starting':kind,'expected':count,'port':port,'sourceFiles':len(before),'sourceTree':tree}),flush=True)
 with log.open('w') as h:p=subprocess.run(cmd,cwd=root,env=env,stdout=h,stderr=subprocess.STDOUT)
 raw=log.read_text();after=snapshot();put(proof/(kind+'-source-after.json'),after);folder=root/'docs/pr-crops'/packet;manifest=folder/'EVIDENCE.yml'
 expected=sorted(f'SectionAlertDelivery-{s}-{w}{suffix}.png' for s in ['populated','quiet-hours','field-error','unavailable'] for w in [1440,390] for suffix in ['','-zh']) if kind=='alerts' else sorted(f'PortfolioTargetsSettings-{s}-{w}-{lang}.png' for s in ['empty','populated'] for w in [390,1440] for lang in ['en','zh'])
 images={}
 for name in sorted(x.name for x in folder.glob('*.png')):
  b=(folder/name).read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n';w,h=struct.unpack('>II',b[16:24]);images[name]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'width':w,'height':h}
 owner=json.loads((proof/'settings-server-owner.json').read_text()) if kind=='settings-targets' else None
 actualFiles=re.findall(r'capture (SectionAlertDelivery-[A-Za-z0-9-]+\.png) … ',raw) if kind=='alerts' else re.findall(r'^captured (PortfolioTargetsSettings-[A-Za-z0-9-]+\.png)$',raw,re.M)
 portClosed=closed(port);lockAbsent=not (root/'.next/dev/lock').exists()
 stage={'kind':kind,'packet':packet,'command':cmd,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':round(time.monotonic()-start,2),'exit':p.returncode,'port':port,'portClosed':portClosed,'nextLockAbsent':lockAbsent,'sourceStable':before==after,'expected':count,'actualFiles':actualFiles,'images':images,'manifestSha256':sha(manifest),'logSha256':sha(log)}
 if owner:stage['serverOwnerSha256']=sha(proof/'settings-server-owner.json');stage['nativeReadbacksSha256']=sha(folder/'NATIVE_READBACKS.json')
 execution['stages'].append(stage);put(proof/'capture-execution.json',execution)
 valid=p.returncode==0 and before==after and sorted(actualFiles)==expected and len(actualFiles)==count and sorted(images)==expected and portClosed and lockAbsent and (not owner or owner['serverSettled'] and owner['producerExit']=={'code':0,'signal':None})
 print(json.dumps({'finished':kind,'accepted':valid,'exit':p.returncode,'images':len(images),'sourceStable':before==after,'portClosed':portClosed,'nextLockAbsent':lockAbsent,'seconds':stage['seconds']}),flush=True)
 if not valid:print(raw[-10000:],flush=True);raise SystemExit(1)
 if kind=='alerts':assert re.findall(r'^# capturedAtHead: ([0-9a-f]{40})$',manifest.read_text(),re.M)==[head] and 'FAIL ' not in raw
 else:
  ev=json.loads(manifest.read_text());readbacks=json.loads((folder/'NATIVE_READBACKS.json').read_text());assert ev['capturedAtHead']==readbacks['capturedAtHead']==head and len(readbacks['readbacks'])==8
after=snapshot();assert before==after;put(proof/'source-after.json',after);execution.update({'sourceStable':True,'sourceBeforeSha256':sha(proof/'source-before.json'),'sourceAfterSha256':sha(proof/'source-after.json'),'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()});put(proof/'capture-execution.json',execution)
print('Both complete Settings packets captured and settled.',flush=True)
