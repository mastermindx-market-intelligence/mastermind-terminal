from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,re,stat
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent
head='20c16787dac0655dc874990e7823e5cba2cef9e6';base='33f9224f2b1e68512e38fab33d32c64a0bef6096';tree='4a1f3c9161596f8fb520b4acad626315b204d64a';port=47468
def git(*a):return subprocess.check_output(['git','-C',str(repo),*a],text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def observe(args):
 r=subprocess.run(args,capture_output=True,text=True)
 return {'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'observedAt':now()}
def closed():
 r=observe(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'])
 assert r['exit'] in (0,1) and not r['stderr'].strip()
 return r['exit']==1
def snapshot():
 d=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,text=True))
 for p in git('diff','--name-only','2fe2f02f07d1df8c855388bc556383cd74de44fd',base).splitlines():
  if p.startswith('terminal/') and '/docs/' not in p and (repo/p).is_file():d[p]=sha(repo/p)
 return dict(sorted(d.items()))
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and git('write-tree')==tree
assert json.loads((proof/'qualification.json').read_text())['state']=='QUALIFIED'
assert not(t/'.next/dev/lock').exists() and closed()
out=proof/'browser-supplement';assert not out.exists();out.mkdir()
output=t/'test-results/pr768-protected-owner-browser-supplement';assert not output.exists()
env=os.environ.copy()
overrides=['EXPOSURE_P09_CURRENT_WITNESS','EXPOSURE_P09_PREVIOUS_WITNESS','EXPOSURE_NATIVE_WITNESS','TERMINAL_EXPOSURE_LIGHT_ACCEPTANCE','TERMINAL_EXPOSURE_ACCESS_ACCEPTANCE','TERMINAL_EXPOSURE_PAINT_PROBE','TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_PL6_EVIDENCE_OPERATION_ID']
for key in overrides:env.pop(key,None)
env.update({'CI':'1','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_E2E_PORT':str(port),'TERMINAL_VISUAL_EVIDENCE_OPERATION':'terminal-pr-duty-20261110-768-owner-merge','PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr768-playwright'),'PLAYWRIGHT_JSON_OUTPUT_FILE':str(out/'browser-report.json')})
specs=['e2e/options-exposure-workspace.spec.ts','e2e/options-exposure-surface-journey.spec.ts']
titles=['Main chart rejects a book corrected during navigation','synthetic exposure surface journey en','synthetic exposure saved theme cold return en']
grep='('+'|'.join(titles)+')$'
basecmd=['node','node_modules/@playwright/test/cli.js','test',*specs,'--grep',grep,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0']
original=json.loads((t/'docs/verification/exposure-workspace-20261103/options-integration-20261109/qualification.json').read_text())
expected=sorted(p+'|'+title for p in ['desktop','tablet','mobile'] for title in titles)
assert len(expected)==9 and all(k in original['expectedPassed'] for k in expected)
listing=subprocess.run([*basecmd,'--list','--reporter=list'],cwd=t,env=env,capture_output=True,text=True)
(out/'selection.log').write_text(listing.stdout+listing.stderr)
assert listing.returncode==0 and re.search(r'Total: 9 tests in 2 files',listing.stdout),(listing.returncode,listing.stdout[-2000:],listing.stderr)
before=snapshot();put(out/'source-before.json',before)
command=[*basecmd,'--reporter=list,json','--output='+str(output)]
record={'schema':'terminal_pr768_protected_owner_consumer_supplement.v1','state':'RUNNING','branchHead':head,'protectedMaster':base,'sourceTree':tree,'startedAt':now(),'command':command,'port':port,'expectedCases':expected,'sourceEntries':len(before),'profile':{'fixture':'terminal-e2e.v1','build':'next-dev','sharedShell':'0','investorPreview':'0','source':'synthetic:options-exposure-surface-journey/v1','sourceSession':'2026-10-19','surfaceFixtureClock':'2026-10-19T20:30:00Z','themes':'Dark surface journey; Light cold return then Dark preference'},'overrides':{k:env.get(k) for k in overrides},'selectionLogSha256':sha(out/'selection.log')}
put(out/'execution.json',record);print(json.dumps({'starting':'browser-supplement','cases':9,'port':port,'sourceEntries':len(before)}),flush=True)
start=time.monotonic()
with (out/'browser.log').open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
after=snapshot();put(out/'source-after.json',after)
report=json.loads((out/'browser-report.json').read_text()) if(out/'browser-report.json').exists() else {'errors':[{'message':'missing report'}],'stats':{}}
cases=[]
def walk(s):
 for p in s.get('specs',[]):
  for c in p.get('tests',[]):cases.append({'key':c['projectName']+'|'+p['title'],'attempts':[{'status':a.get('status'),'retry':a.get('retry')} for a in c.get('results',[])]})
 for ch in s.get('suites',[]):walk(ch)
walk(report)
artifacts={}
if output.exists():
 for p in sorted(output.rglob('*')):
  if p.is_file():
   dest=out/'artifacts'/p.relative_to(output);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest);artifacts[str(dest.relative_to(out))]=sha(dest)
record.update({'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'sourceStable':before==after,'cases':cases,'stats':report.get('stats',{}),'reportErrors':report.get('errors',[]),'artifacts':artifacts,'logSha256':sha(out/'browser.log'),'completedAt':now(),'state':'EXECUTED_PENDING_LIFECYCLE'})
put(out/'execution.json',record)
for _ in range(20):
 if closed():break
 time.sleep(.25)
assert closed(),'owned listener remains'
lock=t/'.next/dev/lock';lifecycle={'listenerClosed':True,'lockInitiallyPresent':lock.exists(),'observedAt':now()}
if lock.exists():
 def identity():
  st=lock.lstat();assert stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid()
  return {'dev':st.st_dev,'ino':st.st_ino,'size':st.st_size,'mtimeNs':st.st_mtime_ns,'sha256':sha(lock),'content':json.loads(lock.read_text())}
 initial=identity();assert initial['content']['port']==port
 checks={}
 for name,args in [('recordedPid',['ps','-p',str(initial['content']['pid']),'-o','pid=,ppid=,comm=']),('lockDescriptors',['lsof',str(lock)])]:
  checks[name]=observe(args);assert checks[name]['exit']==1 and not checks[name]['stdout'].strip() and not checks[name]['stderr'].strip(),checks
 cwd=observe(['lsof','-a','-u',str(os.getuid()),'-d','cwd','-F','pcn']);assert cwd['exit']==0 and not cwd['stderr'].strip()
 assert not any(line.startswith('n'+str(repo)) for line in cwd['stdout'].splitlines()),'workspace cwd holder remains'
 lifecycle.update({'initialLock':initial,'checks':checks,'workspaceCwdHolders':[]})
 put(out/'lifecycle.json',lifecycle);assert identity()==initial and closed()
 lock.unlink();assert not lock.exists();lifecycle['state']='STALE_OWNED_LOCK_RECONCILED'
else:lifecycle['state']='OWNED_SERVER_STOPPED'
lifecycle['completedAt']=now();put(out/'lifecycle.json',lifecycle)
valid=r.returncode==0 and before==after and not report.get('errors') and sorted(c['key'] for c in cases)==expected and all(c['attempts']==[{'status':'passed','retry':0}] for c in cases) and report.get('stats',{}).get('expected')==9 and all(report.get('stats',{}).get(k,0)==0 for k in ['unexpected','flaky','skipped']) and closed() and not lock.exists()
record.update({'state':'QUALIFIED' if valid else 'FAILED','ownedServerStopped':closed() and not lock.exists(),'lifecycleSha256':sha(out/'lifecycle.json')})
put(out/'execution.json',record)
print(json.dumps({'state':record['state'],'stats':record['stats'],'sourceStable':record['sourceStable'],'sourceEntries':len(before),'ownedServerStopped':record['ownedServerStopped'],'artifacts':len(artifacts),'seconds':record['seconds'],'failures':[c for c in cases if c['attempts']!=[{'status':'passed','retry':0}]]}),flush=True)
if not valid:print((out/'browser.log').read_text()[-18000:],flush=True)
raise SystemExit(0 if valid else 1)
