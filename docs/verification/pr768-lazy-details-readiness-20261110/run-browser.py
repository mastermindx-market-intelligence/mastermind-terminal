from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,re,stat
repo=Path(__file__).resolve().parents[3];terminal=repo/'terminal';proof=Path(__file__).resolve().parent
config=json.loads((proof/'config.json').read_text());port=config['port']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def put(path,value):path.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
def observe(args):
    r=subprocess.run(args,text=True,capture_output=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
def closed():
    r=observe(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN']);assert r['exit'] in (0,1) and not r['stderr'].strip();return r['exit']==1
def snapshot():
    values=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True))
    for path in [config['target'],'terminal/playwright.config.ts','terminal/package.json','terminal/package-lock.json']:values[path]=sha(repo/path)
    return dict(sorted(values.items()))
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

assert subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()==config['validationHead']
assert closed() and not (terminal/'.next/dev/lock').exists()
before=snapshot();put(proof/'source-before.json',before)
env=os.environ.copy()
for key in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','PLAYWRIGHT_JSON_OUTPUT_FILE','EXPOSURE_P09_CURRENT_WITNESS','EXPOSURE_P09_PREVIOUS_WITNESS','EXPOSURE_NATIVE_WITNESS','TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE','TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE','TERMINAL_EXPOSURE_PAINT_PROBE']:env.pop(key,None)
env.update({'CI':'1','MMX_SHARED_SHELL':str(config['sharedShell']),'MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_E2E_PORT':str(port),'TERMINAL_VISUAL_EVIDENCE_OPERATION':proof.name,'PLAYWRIGHT_JSON_OUTPUT_FILE':str(proof/'browser-report.json'),'PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright'})
output=terminal/('test-results/'+proof.name);assert not output.exists()
cmd=['node','node_modules/@playwright/test/cli.js','test',config['target'].removeprefix('terminal/'),'--grep',config['grep'],*['--project='+p for p in config['projects']],'--workers=1','--retries=0','--max-failures=1','--trace=on']
listed=subprocess.run([*cmd,'--list','--reporter=list'],cwd=terminal,env=env,capture_output=True,text=True)
(proof/'selection.log').write_text(listed.stdout+listed.stderr)
assert listed.returncode==0 and re.search(r'Total: '+str(config['expected'])+r' tests? in ',listed.stdout),(listed.returncode,listed.stdout,listed.stderr)
cmd.extend(['--reporter=list,json','--output='+str(output)])
record={'schema':'terminal_pr_test_readiness_browser.v1','state':'RUNNING','pr':config['pr'],'validationHead':config['validationHead'],'publishedParent':config['publishedParent'],'target':config['target'],'targetSha256':sha(repo/config['target']),'command':cmd,'port':port,'sharedShell':config['sharedShell'],'investorPreview':0,'retries':0,'sourceEntries':len(before),'startedAt':now(),'expected':config['expected']}
put(proof/'execution.json',record);print(json.dumps(record),flush=True);start=time.monotonic()
with (proof/'browser.log').open('w') as log:r=subprocess.run(cmd,cwd=terminal,env=env,stdout=log,stderr=subprocess.STDOUT)
after=snapshot();put(proof/'source-after.json',after);lifecycle=settle(proof)
report=json.loads((proof/'browser-report.json').read_text()) if (proof/'browser-report.json').exists() else {'errors':[{'message':'missing report'}],'stats':{}}
cases=[]
def walk(value):
 for spec in value.get('specs',[]):
  for test in spec.get('tests',[]):cases.append({'project':test['projectName'],'title':spec['title'],'expectedStatus':test.get('expectedStatus'),'attempts':[{'status':x.get('status'),'retry':x.get('retry')} for x in test.get('results',[])]})
 for child in value.get('suites',[]):walk(child)
walk(report)
artifacts={}
for file in sorted(output.rglob('*')):
 if file.is_file():
  dest=proof/'artifacts'/file.relative_to(output);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,dest);artifacts[str(dest.relative_to(proof))]=sha(dest)
stats=report.get('stats',{})
valid=r.returncode==0 and before==after and not report.get('errors') and stats.get('expected')==config['expected'] and stats.get('skipped',0)==0 and stats.get('unexpected',0)==0 and stats.get('flaky',0)==0 and len(cases)==config['expected'] and all(c['attempts']==[{'status':'passed','retry':0}] for c in cases) and len([p for p in artifacts if p.endswith('/trace.zip')])==config['expected']
record.update({'state':'QUALIFIED' if valid else 'FAILED','exit':r.returncode,'stats':stats,'cases':cases,'errors':report.get('errors',[]),'sourceStable':before==after,'ownedServerStopped':closed() and not (terminal/'.next/dev/lock').exists(),'seconds':round(time.monotonic()-start,2),'completedAt':now(),'logSha256':sha(proof/'browser.log'),'reportSha256':sha(proof/'browser-report.json') if (proof/'browser-report.json').exists() else None,'lifecycleSha256':sha(proof/'lifecycle.json'),'artifacts':artifacts})
put(proof/'execution.json',record)
print(json.dumps({k:record[k] for k in ['pr','state','exit','stats','sourceStable','ownedServerStopped','seconds']}),flush=True)
if not valid:print((proof/'browser.log').read_text()[-12000:],flush=True)
raise SystemExit(0 if valid else 1)
