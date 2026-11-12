from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,re
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'qualification-r1'
head='496ef734fafb64500bb95384770b59eb51555e00'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
def port_closed(port):
 r=subprocess.run(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True)
 assert r.returncode in [0,1] and not r.stderr.strip(),r.stderr
 return r.returncode==1
def settled(port):
 for _ in range(40):
  if port_closed(port) and not (t/'.next/dev/lock').exists():return True
  time.sleep(.25)
 return False
def sources():
 code="console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"
 return json.loads(subprocess.run(['node','-e',code],cwd=repo,capture_output=True,text=True,check=True).stdout)
def packet(folder):return {str(p.relative_to(folder)):sha(p) for p in sorted(folder.rglob('*')) if p.is_file()}
assert git('rev-parse','HEAD')==head and not git('ls-files','-u')
for port in [3805,3806,3807]:assert port_closed(port)
assert not (t/'.next/dev/lock').exists() and not out.exists()
out.mkdir()
env=os.environ.copy()
for key in ['TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_EVIDENCE_MODE']:env.pop(key,None)
env.update({'MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','PLAYWRIGHT_BROWSERS_PATH':str(t/'node_modules/.cache/pr1369-playwright')})
b4=t/'docs/pr-crops/b-mi-g10-b4t-theme-empty';b4Before=packet(b4)
for rel in ['terminal/components/fin/CompanyThemeContextCard.tsx','terminal/app/company-intelligence.css']:
 manifest=(b4/'EVIDENCE.yml').read_text();assert re.search(r'^  '+re.escape(rel)+r': "?'+sha(repo/rel)+r'"?$',manifest,re.M)
before=sources();put(out/'source-before.json',before)
git('add','-A')
record={'schema':'terminal_pr1369_combined_qualification_execution.v1','branchHead':head,'protectedMaster':'03af393ce05c12282003a3919cc473c032264922','integratedDependency':'5b4fe809fa43e164415a71ec0cc129110632e587','capturedIndexTree':git('write-tree'),'startedAt':now(),'state':'RUNNING','sourceBeforeSha256':sha(out/'source-before.json'),'sourceFiles':len(before),'retainedB4':b4Before,'stages':[]}
def save():put(out/'execution.json',record)
def stable():
 current=sources();assert current==before,'Observed source changed';assert git('rev-parse','HEAD')==head
 return current
def execute(name,args,extra=None,port=None):
 log=out/(name+'.log');assert not log.exists()
 stage={'name':name,'command':args,'startedAt':now(),'port':port,'state':'RUNNING'}
 record['stages'].append(stage);save();print(json.dumps({'starting':name,'port':port}),flush=True);start=time.monotonic()
 with log.open('x') as h:r=subprocess.run(args,cwd=t,env={**env,**(extra or {})},stdout=h,stderr=subprocess.STDOUT)
 stage.update({'exit':r.returncode,'completedAt':now(),'seconds':round(time.monotonic()-start,2),'logSha256':sha(log),'sourceStable':stable()==before})
 if port:stage['ownedServerStopped']=settled(port)
 stage['state']='CLOSED' if r.returncode==0 and (not port or stage['ownedServerStopped']) else 'FAILED'
 save();print(json.dumps(stage),flush=True)
 assert stage['state']=='CLOSED',log.read_text()[-6000:]
 return stage,log
try:
 packetRoot=t/'docs/pr-crops/b-f11-10-analysis-theses-entry'
 nativeStart=time.time_ns()
 s,log=execute('native-bf11',['node','e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs'],{'TERMINAL_CROP_PORT':'3805'},3805)
 expected=['desktop-en.png','desktop-zh.png','tablet-en.png','tablet-zh.png','mobile-en.png','mobile-zh.png']
 text=log.read_text();assert len(re.findall(r'^capture .+\.png … ok$',text,re.M))==6 and 'wrote 6 crops + EVIDENCE.yml at '+head in text
 assert all((packetRoot/f).stat().st_mtime_ns>=nativeStart for f in expected)
 s['images']={f:sha(packetRoot/f) for f in expected};s['manifestSha256']=sha(packetRoot/'EVIDENCE.yml');s['actualCases']=6
 appendix=(packetRoot/'EVIDENCE.yml').read_text().split('  - mobile-zh.png\n',1)[1]
 s['preservedAppendixSha256']=hashlib.sha256(appendix.encode()).hexdigest();assert s['preservedAppendixSha256']=='71f6291ecebb133db4058933a5164355414ac0ca3a493f49db9bf0dbd7324903';save()
 suites=[
 ('browser-lifetime',['e2e/analysis-company-read-lifetime.spec.ts'],None,3806,6,0),
 ('browser-navigation',['e2e/investigation-workspace.spec.ts','e2e/thesis-workspace.spec.ts','e2e/market-ontology-context.spec.ts'],'mobile Analysis research actions|Analysis research entries retain|the context-bar theses link|J1 saves A',3807,10,2)]
 for name,specs,grep,port,passed,skipped in suites:
  report=out/(name+'.json');output=out/(name+'-artifacts')
  args=['node','node_modules/@playwright/test/cli.js','test',*specs,'--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(output)]
  if grep:args+=['--grep',grep]
  s,log=execute(name,args,{'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_JSON_OUTPUT_FILE':str(report)},port)
  r=json.loads(report.read_text());stats=r['stats'];assert not r.get('errors') and stats['expected']==passed and stats['skipped']==skipped and stats['unexpected']==stats['flaky']==0,(name,stats)
  cases=[]
  def walk(x):
   for spec in x.get('specs',[]):
    for test in spec.get('tests',[]):cases.append({'project':test['projectName'],'title':spec['title'],'results':[{'status':q.get('status'),'retry':q.get('retry')} for q in test.get('results',[])]})
   for child in x.get('suites',[]):walk(child)
  walk(r)
  assert len(cases)==passed+skipped and all(len(c['results'])==1 and c['results'][0]['retry']==0 and c['results'][0]['status'] in ['passed','skipped'] for c in cases)
  s.update({'passed':passed,'skipped':skipped,'failed':0,'flaky':0,'retries':0,'reportSha256':sha(report),'cases':cases,'artifacts':packet(output)});save()
 tests=['lib/__tests__/analysisCompanyReadLifetime.test.tsx','lib/__tests__/megaPaneFundamentalLoading.test.tsx','lib/__tests__/analysisWorkspaceNavigation.test.tsx','lib/__tests__/b_f11_10AnalysisThesesEntryEvidence.test.ts','lib/__tests__/b_mi_g10_b4tThemeEmptyEvidence.test.ts']
 execute('unit-and-native-readers',['node','node_modules/vitest/vitest.mjs','run',*tests,'--reporter=default','--reporter=json','--outputFile='+str(out/'unit-report.json')])
 r=json.loads((out/'unit-report.json').read_text());assert r['success'] and r['numFailedTests']==r['numPendingTests']==0
 execute('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])
 execute('producer-syntax',['node','--check','e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs'])
 execute('affected-lint',['node','node_modules/eslint/bin/eslint.js','components/workspaces/AnalysisWorkspace.tsx','components/fin/MegaPane.tsx','e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs'])
 assert packet(b4)==b4Before,'Retained B4 packet changed'
 after=stable();put(out/'source-after.json',after)
 record.update({'state':'QUALIFIED_AWAITING_VISUAL_REVIEW','completedAt':now(),'sourceStable':True,'sourceAfterSha256':sha(out/'source-after.json'),'unitTestsPassed':r['numPassedTests'],'actualNativeCases':6,'browserPassed':16,'browserSkipped':2})
 save();print(json.dumps({'completed':True,'sourceFiles':len(before),'nativeCases':6,'browserPassed':16,'browserSkipped':2,'unitTests':r['numPassedTests']}),flush=True)
except BaseException as e:
 record['state']='FAILED';record['error']=str(e);record['completedAt']=now();save();raise
