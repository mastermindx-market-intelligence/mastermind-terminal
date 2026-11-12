from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,re,stat,struct
repo=Path(__file__).resolve().parents[3];terminal=repo/'terminal';proof=Path(__file__).resolve().parent;port=47283
def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def put(path,value):path.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
def observe(args):
    r=subprocess.run(args,text=True,capture_output=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
def closed():
    r=observe(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in (0,1) and not r['stderr'].strip();return r['exit']==1
def snapshot():
    paths=set(git('ls-files','--cached','--others','--exclude-standard').splitlines())
    selected={p for p in paths if p.startswith('terminal/') and not p.startswith(('terminal/docs/','terminal/test-results/','terminal/node_modules/','terminal/.next/')) and re.search(r'\.(?:ts|tsx|css|js|cjs|mjs|json)$',p)}
    incumbent=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True))
    selected.update(incumbent);selected.update(layout)
    return {p:sha(repo/p) for p in sorted(selected)}
def settle(out):
    for _ in range(20):
        if closed():break
        time.sleep(.25)
    assert closed(),'owned listener remains'
    lock=terminal/'.next/dev/lock';receipt={'at':now(),'port':port,'listenerClosed':True,'lockPresent':lock.exists()}
    if lock.exists():
        initial=lock.read_bytes();data=json.loads(initial);st=lock.lstat()
        assert data['port']==port and stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid()
        checks={}
        for key,args in [('pid',['ps','-p',str(data['pid']),'-o','pid=,ppid=,comm=']),('lock',['lsof',str(lock)])]:
            checks[key]=observe(args);assert checks[key]['exit']==1 and not checks[key]['stdout'].strip() and not checks[key]['stderr'].strip(),checks
        cwd=observe(['lsof','-a','-u',str(os.getuid()),'-d','cwd','-F','pcn'])
        assert cwd['exit']==0 and not cwd['stderr'].strip() and not any(x.startswith('n'+str(repo)) for x in cwd['stdout'].splitlines())
        receipt.update({'lock':data,'lockSha256':hashlib.sha256(initial).hexdigest(),'checks':checks,'workspaceCwdHolders':[]})
        put(out/'lifecycle.json',receipt);assert lock.read_bytes()==initial and lock.lstat().st_ino==st.st_ino and closed();lock.unlink()
    receipt['state']='OWNED_SERVER_STOPPED';receipt['completedAt']=now();put(out/'lifecycle.json',receipt)
    return receipt

head='33d55577356a55ed2839d38c507b568b3caafed2';dependency='9ef372c8086ceaac8bcb153bd2d2d71b5b63d62c';base='d15741d452403594a4ddb540a97b9a981c2a62ca'
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==dependency and not git('diff','--name-only','--diff-filter=U')
assert json.loads((proof/'composition.json').read_text())['state']=='COMPOSED'
assert closed() and not (terminal/'.next/dev/lock').exists()
layout=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/capture_e18_alert_management.cjs').LAYOUT_FILES))"],cwd=repo,text=True));assert len(layout)==7
packet=terminal/'docs/pr-crops/e18-alert-management'
names=[state+'-'+vp+'-'+lang+'.png' for state in ['review','results'] for vp in ['desktop','tablet','mobile'] for lang in ['en','zh']]
expected={'EVIDENCE.yml',*names};assert set(p.name for p in packet.iterdir())==expected
prior=proof/'prior-e18-packet';assert not prior.exists();shutil.copytree(packet,prior)
priorFiles={p.name:sha(p) for p in sorted(prior.iterdir())}
put(proof/'prior-e18-inventory.json',{'schema':'terminal_pr1346_prior_e18_inventory.v1','capturedSourceHead':head,'files':priorFiles})
before=snapshot();put(proof/'source-before.json',before)
env=os.environ.copy()
clear=['TERMINAL_CAPTURE_ONLY','TERMINAL_UPDATE_HEATMAP_EVIDENCE','TERMINAL_CAPTURE_HEAD','TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_CROP_OUTPUT_DIR']
for key in clear:env.pop(key,None)
captureId='terminal-pr1346-e18-successor-20261110-r1'
env.update({'CI':'1','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_CROP_PORT':str(port),'TERMINAL_LEGACY_CAPTURE_ID':captureId,'PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright'})
cmd=['node',str(proof/'legacy-driver.cjs')]
record={'schema':'terminal_pr1346_e18_native_capture.v1','state':'RUNNING','head':head,'protectedMaster':base,'integratedDependency':dependency,'sourceTree':git('write-tree'),'captureId':captureId,'sourceEntries':len(before),'layoutInputs':{p:before[p] for p in layout},'port':port,'command':['node','e2e/tools/capture_e18_alert_management.cjs'],'supervisionCommand':cmd,'startedAt':now(),'fixtureOverrides':{k:env.get(k) for k in clear}}
put(proof/'native-capture.json',record);print(json.dumps({k:record[k] for k in ['state','head','protectedMaster','integratedDependency','sourceTree','captureId','sourceEntries','port','startedAt']}),flush=True);start=time.monotonic()
r=subprocess.run(cmd,env=env,capture_output=True,text=True)
(proof/'driver.log').write_text(r.stdout+r.stderr)
after=snapshot();put(proof/'source-after.json',after)
supervised=json.loads((proof/'legacy-supervision.json').read_text()) if (proof/'legacy-supervision.json').exists() else {}
result=supervised.get('result',{});raw=(proof/'native-capture.log').read_text()
matches=re.findall(r'^capture stage (.+)$',raw,re.M);stage=None;stageFiles={}
if len(matches)==1:
 stage=Path(matches[0]);assert stage.is_dir() and stage.name.startswith('mmx-capture_e18_alert_management-') and stage.stat().st_uid==os.getuid()
 dest=proof/'native-stage';assert not dest.exists();shutil.copytree(stage,dest)
 stageFiles={str(p.relative_to(dest)):sha(p) for p in sorted(dest.rglob('*')) if p.is_file()}
lifecycle=settle(proof)
pids=[str(result[k]) for k in ['pid','serverPid'] if isinstance(result.get(k),int)]
pidCheck=observe(['ps','-p',','.join(pids),'-o','pid=,ppid=,comm=']) if pids else {'exit':None}
images={}
for name in names:
 p=packet/name
 if p.exists():
  b=p.read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n';width,height=struct.unpack('>II',b[16:24]);images[name]={'sha256':sha(p),'bytes':len(b),'width':width,'height':height}
captures=json.loads((proof/'native-stage/capture-proof.json').read_text()) if (proof/'native-stage/capture-proof.json').exists() else []
manifest=(packet/'EVIDENCE.yml').read_text()
recorded=dict(re.findall(r'^  (terminal/\S+): "([0-9a-f]{64})"$',manifest,re.M))
dimensions={'desktop':(1440,900),'tablet':(820,1180),'mobile':(390,844)}
valid=r.returncode==0 and result.get('status')==0 and result.get('closed') is True and result.get('serverReportedStopped') is True and result.get('serverSettled') is True and not result.get('serverRefused') and not result.get('timedOut') and not result.get('error') and before==after and pidCheck.get('exit')==1 and not pidCheck.get('stdout','').strip() and not pidCheck.get('stderr','').strip() and len(captures)==12 and sorted(x['file'] for x in captures)==sorted(names) and recorded=={p:before[p] for p in layout} and all((images[name]['width'],images[name]['height'])==dimensions[name.split('-')[1]] for name in names) and set(p.name for p in packet.iterdir())==expected and all(sha(prior/p)==v for p,v in priorFiles.items())
record.update({'state':'NATIVE_CAPTURE_QUALIFIED' if valid else 'FAILED','exit':r.returncode,'supervisor':result,'sourceStable':before==after,'ownedServerStopped':closed() and not (terminal/'.next/dev/lock').exists(),'pidReadback':pidCheck,'captured':len(captures),'images':images,'manifestSha256':sha(packet/'EVIDENCE.yml'),'stage':str(stage) if stage else None,'stageFiles':stageFiles,'priorPacketPreserved':all(sha(prior/p)==v for p,v in priorFiles.items()),'logSha256':sha(proof/'native-capture.log'),'supervisionSha256':sha(proof/'legacy-supervision.json') if (proof/'legacy-supervision.json').exists() else None,'lifecycleSha256':sha(proof/'lifecycle.json'),'seconds':round(time.monotonic()-start,2),'completedAt':now()})
put(proof/'native-capture.json',record);print(json.dumps({k:record[k] for k in ['state','exit','captured','sourceStable','ownedServerStopped','priorPacketPreserved','seconds','manifestSha256']}),flush=True)
if not valid:print(raw[-12000:],flush=True)
raise SystemExit(0 if valid else 1)
