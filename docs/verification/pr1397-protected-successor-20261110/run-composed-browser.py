from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,re,stat
repo=Path(__file__).resolve().parents[3];terminal=repo/'terminal';proof=Path(__file__).resolve().parent;port=47497
head='e5a11c73e05809ea84c84464ce5a14f9b4f483d4';base='d15741d452403594a4ddb540a97b9a981c2a62ca'
def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def put(path,value):path.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
def observe(args):
 r=subprocess.run(args,text=True,capture_output=True);return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
def closed():
 r=observe(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'])
 assert r['exit'] in (0,1) and not r['stderr'].strip();return r['exit']==1
def snapshot():
 paths=set(git('ls-files','--cached','--others','--exclude-standard').splitlines())
 selected={p for p in paths if p.startswith('terminal/') and not p.startswith(('terminal/docs/','terminal/test-results/','terminal/node_modules/','terminal/.next/')) and re.search(r'\.(?:ts|tsx|css|js|cjs|mjs|json)$',p)}
 incumbent=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True))
 selected.update(incumbent)
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
def cases(report):
 result=[]
 def visit(suite):
  for spec in suite.get('specs',[]):
   for test in spec.get('tests',[]):
    result.append({'key':test['projectName']+'|'+spec['title'],'attempts':[{'status':r['status'],'retry':r.get('retry',0)} for r in test.get('results',[])]})
  for child in suite.get('suites',[]):visit(child)
 visit(report);return result
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
assert closed() and not (terminal/'.next/dev/lock').exists()
validation=json.loads((proof/'focused-validation.json').read_text());assert len(validation['checks'])==3 and all(x['exitCode']==0 for x in validation['checks'])
baseline=snapshot();baseEnv=os.environ.copy()
overrides=['EXPOSURE_P09_CURRENT_WITNESS','EXPOSURE_P09_PREVIOUS_WITNESS','EXPOSURE_NATIVE_WITNESS','TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE','TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE','TERMINAL_EXPOSURE_PAINT_PROBE']
for key in [*overrides,'PLAYWRIGHT_JSON_OUTPUT_FILE','TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID']:baseEnv.pop(key,None)
baseEnv.update({'CI':'1','MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_E2E_PORT':str(port),'TERMINAL_VISUAL_EVIDENCE_OPERATION':'terminal-pr-duty-20261110-1397-protected-successor','PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright'})
specs=['e2e/statistics-basis-controls.spec.ts','e2e/statistics-current-tables.spec.ts']
overall={'schema':'terminal_pr1397_composed_browser_validation.v1','state':'RUNNING','head':head,'protectedMaster':base,'startedAt':now(),'sourceEntries':len(baseline),'results':{}}
put(proof/'browser-validation.json',overall)
for mode,flag in [('beta','1'),('ordinary','0')]:
 out=proof/('browser-'+mode);assert not out.exists();out.mkdir()
 assert closed() and not (terminal/'.next/dev/lock').exists()
 env=baseEnv.copy();env['MMX_SHARED_SHELL']=flag
 env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(out/'selection.json')
 cmd=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--trace=on','--reporter=list,json','--output='+str(out/'artifacts')]
 listed=subprocess.run([*cmd,'--list','--reporter=json'],cwd=terminal,env=env,capture_output=True,text=True)
 (out/'selection.log').write_text(listed.stdout+listed.stderr)
 assert listed.returncode==0,(listed.stdout,listed.stderr)
 expected=sorted(c['key'] for c in cases(json.loads((out/'selection.json').read_text())))
 assert len(expected)==len(set(expected))==30 and all(sum(k.startswith(project+'|') for k in expected)==10 for project in ['desktop','tablet','mobile']),expected
 env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(out/'browser-report.json')
 before=snapshot();assert before==baseline;put(out/'source-before.json',before)
 started=now();t=time.monotonic();log=out/'browser.log'
 print(json.dumps({'starting':mode,'expected':30,'sourceEntries':len(before),'port':port,'workers':1,'retries':0}),flush=True)
 with log.open('w') as h:r=subprocess.run(cmd,cwd=terminal,env=env,stdout=h,stderr=subprocess.STDOUT)
 after=snapshot();put(out/'source-after.json',after);settle(out)
 report=json.loads((out/'browser-report.json').read_text());actual=cases(report);stats=report['stats']
 artifacts={str(f.relative_to(out)):sha(f) for f in sorted((out/'artifacts').rglob('*')) if f.is_file()}
 result={'schema':'terminal_pr1397_composed_browser_execution.v1','head':head,'protectedMaster':base,'mode':mode,'sharedShell':flag,'command':cmd,'startedAt':started,'completedAt':now(),'seconds':round(time.monotonic()-t,2),'exit':r.returncode,'passed':stats.get('expected',0),'failed':stats.get('unexpected',0),'skipped':stats.get('skipped',0),'flaky':stats.get('flaky',0),'retries':0,'sourceStable':before==after,'ownedServerStopped':closed() and not (terminal/'.next/dev/lock').exists(),'fixtureOverrides':{k:env.get(k) for k in overrides},'expectedCases':expected,'actualCases':actual,'artifactFiles':artifacts,'logSha256':sha(log),'lifecycleSha256':sha(out/'lifecycle.json')}
 valid=r.returncode==0 and result['passed']==30 and result['failed']==result['skipped']==result['flaky']==0 and not report.get('errors') and before==after and result['ownedServerStopped'] and sorted(c['key'] for c in actual)==expected and all(c['attempts']==[{'status':'passed','retry':0}] for c in actual)
 result['state']='QUALIFIED' if valid else 'FAILED';put(out/'execution.json',result)
 summary={k:result[k] for k in ['state','passed','failed','skipped','flaky','sourceStable','ownedServerStopped','seconds']};summary['executionSha256']=sha(out/'execution.json')
 overall['results'][mode]=summary;put(proof/'browser-validation.json',overall);print(json.dumps({'finished':mode,**summary}),flush=True)
 if not valid:
  overall['state']='FAILED';overall['completedAt']=now();put(proof/'browser-validation.json',overall);print(log.read_text()[-12000:],flush=True);raise SystemExit(1)
overall.update({'state':'QUALIFIED','completedAt':now(),'sourceStable':snapshot()==baseline});put(proof/'browser-validation.json',overall);print(json.dumps(overall),flush=True)
