from pathlib import Path
import subprocess,json,hashlib,os,datetime,time,sys,socket,re
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
browser=sys.argv[1];assert browser=='chromium','This qualification selects the incumbent Chromium engine'
out=p/'browser-chromium';assert not out.exists(),'Retain and reconcile the original browser operation; never replay'
checks=json.loads((p/'source-checks.json').read_text());assert checks['state']=='SOURCE_CHECKS_PASSED'
def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()
for file,digest in checks['sourceAfter'].items():assert sha(w/file)==digest,file
runtime=json.loads((p/'runtime.json').read_text());node=Path(runtime['node']);assert sha(node)==runtime['nodeSha256']
port=47687
with socket.socket() as probe:probe.bind(('127.0.0.1',port))
out.mkdir()
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ}
env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1',NEXT_TELEMETRY_DISABLED='1',PLAYWRIGHT_BROWSERS_PATH=runtime['browserStore'],TERMINAL_E2E_PORT=str(port),FLOW_PROJECTION_BROWSER=browser,FLOW_PROJECTION_PROOF_OUTPUT=str(out))
files=[]
for folder in ['app','components','lib','e2e','scripts','test-fixtures']:
 files.extend(f for f in (t/folder).rglob('*') if f.is_file() and f.suffix in ['.ts','.tsx','.js','.jsx','.mjs','.cjs','.css','.json','.yaml','.yml'])
for name in ['package.json','package-lock.json','next.config.ts','playwright.config.ts','tsconfig.json','vitest.config.ts','postcss.config.mjs','public/data/manifest.json','public/data/NVDA.json','public/data/NVDA.slice.json','public/data/AAPL.json','public/data/AAPL.slice.json']:
 file=t/name
 if file.exists():files.append(file)
files.extend([p/'playwright-successor.config.cjs',p/'run-browser.py']);files=sorted(set(files))
owners=['terminal/app/globals.css','terminal/app/observatory.css','terminal/components/flowdesk/FlowDeskView.tsx','terminal/components/flowdesk/FlowCard.tsx','terminal/components/flowdesk/InspectorPane.tsx','terminal/components/flowdesk/PrintInspector.tsx','terminal/lib/flowPrintInspector.ts','terminal/lib/flowStream.ts','terminal/lib/flowFreshness.ts','terminal/lib/flowdeskStrings.ts','terminal/lib/__tests__/optionsFlowBoards.test.ts','terminal/e2e/fixtures/options-r1-w3a-flow.json','terminal/playwright.config.ts']
base='b5afc7eca5c37b3e2eee25871b764807203957a6'
for file in owners:
 expected=subprocess.check_output(['git','rev-parse',base+':'+file],cwd=w,text=True).strip()
 actual=subprocess.check_output(['git','hash-object',str(w/file)],cwd=w,text=True).strip()
 assert actual==expected,file
def snapshot(items):return {str(file.relative_to(w)):sha(file) for file in items}
def save(name,value):(out/name).write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')
before=snapshot(files);owner_before=snapshot([w/file for file in owners]);save('source-before.json',before);save('protected-owners-before.json',owner_before)
nextenv=t/'next-env.d.ts';pre=nextenv.read_bytes() if nextenv.exists() else None
if pre is not None:(out/'next-env.preimage.d.ts.txt').write_bytes(pre)
argv=[str(node),'node_modules/@playwright/test/cli.js','test','--config',str(p/'playwright-successor.config.cjs'),'--workers=1','--retries=0','--max-failures=1']
state={'schema':'terminal_pr687_browser_execution.v1','state':'RUNNING','browser':browser,'port':port,'argv':argv,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceFileCount':len(files),'protectedOwnerCount':len(owners),'fixtureContract':'Unchanged protected Playwright server/warmup. Actual /options?tab=desk route, incumbent synthetic W3A feed over existing EventSource/poll consumers; non-feed routes untouched. Fixed desktop/tablet/phone viewports, EN/ZH.','retries':0,'expectedCases':12}
def save_state():save('execution.json',state)
save_state();start=time.monotonic()
with (out/'execution.log').open('x') as log:
 child=subprocess.Popen(argv,cwd=t,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
 state['pid']=child.pid;save_state();print(json.dumps({'state':'STARTED','browser':browser,'pid':child.pid,'port':port,'sourceFiles':len(files)}),flush=True)
 for line in child.stdout:
  log.write(line);log.flush();plain=re.sub(r'\x1b\[[0-9;]*m','',line)
  if any(x in plain for x in ['Running 12 tests','[desktop]','[tablet]','[mobile]','passed (','failed','[globalSetup]','Error:']):print(plain.rstrip()[:1500],flush=True)
 code=child.wait()
state.update(exitCode=code,seconds=round(time.monotonic()-start,3),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),logSha256=sha(out/'execution.log'))
if nextenv.exists():(out/'next-env.generated.d.ts.txt').write_bytes(nextenv.read_bytes())
if pre is None:
 if nextenv.exists():nextenv.unlink()
else:nextenv.write_bytes(pre)
state['generatedTypesRestored']=(nextenv.read_bytes() if nextenv.exists() else None)==pre
after=snapshot(files);owner_after=snapshot([w/file for file in owners]);save('source-after.json',after);save('protected-owners-after.json',owner_after)
state['sourceStable']=before==after;state['protectedOwnersUnchanged']=owner_before==owner_after
with socket.socket() as probe:probe.settimeout(1);state['ownedPortClosed']=probe.connect_ex(('127.0.0.1',port))!=0
if (out/'report.json').exists():
 report=json.loads((out/'report.json').read_text());state['reportSha256']=sha(out/'report.json');state['stats']=report.get('stats');state['topLevelErrors']=report.get('errors',[])
 def specs(suites):
  for suite in suites:
   yield from suite.get('specs',[]);yield from specs(suite.get('suites',[]))
 state['cases']=[{'title':spec['title'],'project':test.get('projectName'),'status':test['status'],'results':[{'status':r['status'],'retry':r.get('retry'),'error':r.get('error'),'duration':r.get('duration'),'attachments':r.get('attachments',[])} for r in test['results']]} for spec in specs(report.get('suites',[])) for test in spec['tests']]
state['images']=[{'path':str(file.relative_to(w)),'sha256':sha(file),'bytes':file.stat().st_size} for file in sorted(out.rglob('*.png'))]
stats=state.get('stats') or {}
passed=code==0 and stats.get('expected')==12 and all(stats.get(k)==0 for k in ['unexpected','flaky','skipped']) and not state.get('topLevelErrors') and state['sourceStable'] and state['protectedOwnersUnchanged'] and state['generatedTypesRestored'] and state['ownedPortClosed']
state['state']='BROWSER_MATRIX_PASSED' if passed else 'BROWSER_EXECUTION_REQUIRES_CLASSIFICATION';save_state()
print(json.dumps({k:state.get(k) for k in ['state','exitCode','seconds','stats','sourceFileCount','sourceStable','protectedOwnersUnchanged','generatedTypesRestored','ownedPortClosed']}),flush=True)
raise SystemExit(0 if passed else 1)
