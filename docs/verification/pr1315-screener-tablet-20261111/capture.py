from pathlib import Path
import ast,datetime,hashlib,json,os,subprocess,time,socket,shutil,stat
repo=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-718-compare-successor');t=repo/'terminal'
out=Path('/tmp/terminal-pr1315-screener-tablet-20261111-c3');port=61888
node=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node')
head='297d2f7ed2abc3310b5eda40059743059b5f100e';tree='29a1161fc738e240267d0ccc8fa316ddd7678ffa'
def git(*a):return subprocess.check_output(['git','-C',str(repo),*a]).decode().strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
assert not out.exists(),'Existing tablet attempt requires reconciliation'
assert git('rev-parse','HEAD')==head and git('rev-parse','HEAD^{tree}')==tree and not git('status','--porcelain')
assert git('hash-object','terminal/playwright.config.ts')=='a6a0f8d5938b92af3744a4ee9a8945bbb9ecfcd6'
assert git('hash-object','terminal/e2e/screener-cross-market.spec.ts')=='63bee8256a49cb0468d81c12074510b906c93cb7'
assert git('hash-object','terminal/components/screener/CrossMarketStrip.module.css')=='86555e1b58b1af6679b4f1e9229f2d1e6214aac4'
assert git('hash-object','scripts/ci_e2e_scope.py')=='2c0ccac181e6bf96952bef3327a8543c210a5f07'
assert not(t/'.next/dev/lock').exists()
assert sha(node)=='2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0'
with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as s:s.bind(('127.0.0.1',port))
out.mkdir()
helper=repo/'docs/verification/pr718-ticker-news-successor-20261111/capture-news.py'
functions=[n for n in ast.parse(helper.read_text()).body if isinstance(n,ast.FunctionDef) and n.name in ['inspect','port_closed','reconcile_lock']]
assert len(functions)==3
lifecycle=ast.unparse(ast.Module(body=functions,type_ignores=[]))
assert lifecycle.count('file.relative_to(repo)')==2
lifecycle=lifecycle.replace('file.relative_to(repo)','file.relative_to(out)')
exec(compile(lifecycle,str(helper),'exec'))
assert port_closed(port)
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ}
env['PATH']=str(node.parent)+':'+env.get('PATH','')
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'TERMINAL_VISUAL_EVIDENCE_OPERATION':'pr1315-screener-tablet-20261111','PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0'})
specs=['e2e/screener-fundamental.spec.ts','e2e/screener-cross-market.spec.ts','e2e/screener-technical-scan.spec.ts','e2e/screener-failure-state.spec.ts']
extra={'terminal/'+x for x in specs}|{'terminal/e2e/tapTarget.ts','terminal/e2e/smartScreensFixture.ts','terminal/e2e/globalSetup.ts','terminal/playwright.config.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json','terminal/tsconfig.json','terminal/e2e/tools/visualEvidence.cjs','scripts/ci_e2e_scope.py','.github/workflows/ci.yml','.github/scripts/terminal_e2e_lane.sh','tests/fixtures/classification/manifest.json','terminal/lib/__tests__/fixtures/screenerScan/classification.producer.json'}
def snapshot():
 r=subprocess.run([str(node),'-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,env=env,capture_output=True,text=True,check=True)
 members=set(json.loads(r.stdout))|extra
 return {x:sha(repo/x) for x in sorted(members)}
before=snapshot();put(out/'source-before.json',before)
pre={}
for rel in ['terminal/next-env.d.ts','terminal/tsconfig.json']:
 f=repo/rel;d={'present':f.exists()}
 if f.exists():
  d.update(sha256=sha(f),bytes=f.stat().st_size);(out/(f.name+'.preimage')).write_bytes(f.read_bytes())
 pre[rel]=d
put(out/'generated-preimages.json',pre)
listenv=env.copy();listenv['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(out/'discovery-report.json')
base=[str(node),'node_modules/@playwright/test/cli.js','test','--project=tablet',*specs,'--workers=1','--retries=0']
listed=subprocess.run([*base,'--list','--reporter=json'],cwd=t,env=listenv,capture_output=True,text=True,timeout=60)
(out/'discovery.stdout').write_text(listed.stdout);(out/'discovery.stderr').write_text(listed.stderr);assert listed.returncode==0
discovery=json.loads((out/'discovery-report.json').read_text())
def cases(report):
 found=[]
 def walk(s):
  for spec in s.get('specs',[]):
   for test in spec.get('tests',[]):
    found.append({'file':spec['file'],'title':spec['title'],'project':test['projectName'],'status':test.get('status'),'expectedStatus':test.get('expectedStatus'),'results':[{'status':r.get('status'),'retry':r.get('retry'),'duration':r.get('duration'),'errors':r.get('errors',[])} for r in test.get('results',[])]})
  for c in s.get('suites',[]):walk(c)
 for s in report.get('suites',[]):walk(s)
 return found
discovered=cases(discovery);assert len(discovered)==21 and all(c['project']=='tablet' for c in discovered)
assert not discovery.get('errors')
put(out/'discovery.json',{'state':'DISCOVERY_ONLY_NOT_A_PASS','count':len(discovered),'cases':discovered})
env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(out/'browser-report.json')
command=[*base,'--reporter=list,json','--output='+str(out/'artifacts')]
record={'schema':'terminal.pr1315.screener-tablet-consumer.v1','state':'RUNNING','sourceHead':head,'sourceTree':tree,'protectedSelectorBlob':'2c0ccac181e6bf96952bef3327a8543c210a5f07','sourceConfigBlob':'a6a0f8d5938b92af3744a4ee9a8945bbb9ecfcd6','crossMarketSpecBlob':'63bee8256a49cb0468d81c12074510b906c93cb7','stripCssBlob':'86555e1b58b1af6679b4f1e9229f2d1e6214aac4','viewport':{'width':820,'height':1180,'hasTouch':True},'command':command,'port':port,'startedAt':now(),'sourceEntries':len(before),'sourceBeforeSha256':sha(out/'source-before.json'),'nodeSha256':sha(node),'nodeVersion':subprocess.check_output([str(node),'--version'],text=True).strip(),'lifecycleHelperSourceSha256':sha(helper),'lifecycleAdapter':'Only receipt path presentation changes from relative-to-repo to relative-to-output; absence/lock checks unchanged.','discoveredCases':21,'scope':'Real local fixture-backed tablet consumer using the original project and four spec files. Does not claim hosted selector main() admission, CI latency percentiles, physical tablet, authenticated live Screener acceptance, or a screenshot review.','generatedPreimages':pre}
put(out/'execution.json',record);print(json.dumps({'state':'RUNNING','head':head,'tabletCases':21,'sourceEntries':len(before),'port':port}),flush=True)
start=time.monotonic()
with (out/'browser.log').open('x') as log:
 child=subprocess.Popen(command,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
 record['producerPid']=child.pid;put(out/'execution.json',record);child.wait()
report=json.loads((out/'browser-report.json').read_text()) if (out/'browser-report.json').exists() else {'errors':['missing report'],'stats':{}}
actual=cases(report);after=snapshot();put(out/'source-after-test.json',after)
record.update(exit=child.returncode,seconds=round(time.monotonic()-start,2),cases=actual,stats=report.get('stats',{}),reportErrors=report.get('errors',[]),sourceStableDuringRun=before==after,sourceAfterTestSha256=sha(out/'source-after-test.json'),logSha256=sha(out/'browser.log'))
if child.returncode:
 record.update(state='TEST_FAILED_CLASSIFY_BEFORE_RETRY',completedAt=now());put(out/'execution.json',record)
 print(json.dumps({'state':record['state'],'exit':child.returncode,'stats':record['stats'],'sourceStable':before==after}),flush=True)
 print((out/'browser.log').read_text()[-13000:],flush=True);raise SystemExit(child.returncode)
record['generatedPostimages']={rel:{'sha256':sha(repo/rel),'bytes':(repo/rel).stat().st_size} for rel in pre if (repo/rel).exists()}
record['lifecycle']=reconcile_lock(port,'screener-tablet',[child.pid]);record['portClosed']=port_closed(port);record['nextLockAbsent']=not(t/'.next/dev/lock').exists()
put(out/'execution.json',record)
# Restore only the exact compiler-generated file to its proven absent preimage.
for rel,d in pre.items():
 f=repo/rel
 if d['present']:
  assert f.exists() and sha(f)==d['sha256'],'Generated tracked input changed; explicit reconciliation required'
 elif f.exists():
  assert rel=='terminal/next-env.d.ts' and sha(f)=='0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc'
  st=f.lstat();assert stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1
  (out/(f.name+'.generated')).write_bytes(f.read_bytes())
  ident=(st.st_dev,st.st_ino,st.st_mtime_ns,sha(f));s=f.lstat();assert (s.st_dev,s.st_ino,s.st_mtime_ns,sha(f))==ident
  f.unlink();assert not f.exists()
final=snapshot();put(out/'source-after-reconciliation.json',final)
assert git('rev-parse','HEAD')==head and not git('status','--porcelain') and before==final
stats=record['stats'];good=child.returncode==0 and not record['reportErrors'] and len(actual)==21 and all(c['project']=='tablet' and c['expectedStatus']=='passed' and c['status']=='expected' and len(c['results'])==1 and c['results'][0]['status']=='passed' and c['results'][0]['retry']==0 for c in actual) and {k:stats.get(k) for k in ['expected','skipped','unexpected','flaky']}=={'expected':21,'skipped':0,'unexpected':0,'flaky':0} and before==after==final and record['portClosed'] and record['nextLockAbsent']
record.update(state='QUALIFIED' if good else 'UNQUALIFIED_RESULT_REQUIRES_REVIEW',completedAt=now(),generatedPreimagesRestored=True,sourceFinalSha256=sha(out/'source-after-reconciliation.json'),workspaceClean=True,originalHeadPreserved=True,reportSha256=sha(out/'browser-report.json'))
put(out/'execution.json',record);print(json.dumps({k:record[k] for k in ['state','exit','seconds','stats','sourceEntries','sourceStableDuringRun','portClosed','nextLockAbsent','workspaceClean','generatedPreimagesRestored','reportSha256']},indent=2),flush=True)
raise SystemExit(0 if good else 1)
