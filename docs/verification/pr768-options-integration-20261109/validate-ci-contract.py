from pathlib import Path
import subprocess,json,hashlib,os,re,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;number=650 if 'pr650-' in proof.name else 768
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
out=proof/'ci-contract-checks-r1';assert not out.exists();out.mkdir()
repair=json.loads((proof/'ci-contract-repair.json').read_text());assert repair['state']=='EXACT_CASES_RELOCATED_AND_EXISTING_BUDGET_ASSERTION_ALIGNED'
assert not(t/'.next/dev/lock').exists()
controls=['terminal/e2e/tools/optionsExposureEvidence.cases.cjs','terminal/e2e/tools/capture_ci_evidence.test.cjs','tests/test_ci_browser_setup.py','.github/workflows/ci.yml','terminal/playwright.config.ts','terminal/e2e/tools/capture_ci_evidence.cjs']
before={p:sha(repo/p) for p in controls}
assert before[controls[0]]==repair['caseModulePriorSha256'] and not(t/'e2e/tools/optionsExposureEvidence.test.cjs').exists()
env=os.environ.copy()
for key in ['TERMINAL_EVIDENCE_MODE','TERMINAL_EVIDENCE_COMPOSITION','TERMINAL_VISUAL_EVIDENCE_OPERATION','TERMINAL_PL6_EVIDENCE_OPERATION_ID','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT']:env.pop(key,None)
env['PLAYWRIGHT_BROWSERS_PATH']=str(t/'node_modules/.cache'/('pr650-ci-playwright' if number==650 else 'pr768-playwright'))
commands=[('node-ci-entrypoints',['node','--test','--test-reporter=tap','e2e/tools/capture_ci_evidence.test.cjs','e2e/tools/capture_visual_evidence.test.cjs','scripts/ci/plan-evidence-capture.test.cjs','e2e/tools/sharedShellSafeReporter.test.cjs'],t),('python-browser-setup',['python3','-m','pytest','-q','tests/test_ci_browser_setup.py'],repo),('full-playwright-collection',['node','node_modules/@playwright/test/cli.js','test','--list','--reporter=list'],t)]
if number==650:
 commands.append(('unchanged-native-consumers',['node','node_modules/vitest/vitest.mjs','run','lib/__tests__/optionsExposureEvidence.test.ts','lib/__tests__/eodHeatmapFlowdeskLoadFailureEvidence.test.ts','lib/__tests__/gexLevelsHeatmapLoadFailureEvidence.test.ts','--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'native-consumers.json')],t))
record={'schema':'terminal_ci_contract_repair_validation.v1','pr':number,'state':'RUNNING','sourceControlsBefore':before,'results':{}}
for label,command,cwd in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label,'pr':number}),flush=True)
 with log.open('x') as h:r=subprocess.run(command,cwd=cwd,env=env,stdout=h,stderr=subprocess.STDOUT)
 text=log.read_text();result={'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'command':command,'cwd':str(cwd),'logSha256':sha(log)}
 if label=='node-ci-entrypoints':
  result['totals']={k:int(re.findall(r'^# '+k+r' (\d+)$',text,re.M)[-1]) for k in ['tests','pass','fail','cancelled','skipped'] if re.findall(r'^# '+k+r' (\d+)$',text,re.M)}
 if label=='python-browser-setup':
  match=re.search(r'(\d+) passed',text);result['passed']=int(match.group(1)) if match else None
 if label=='full-playwright-collection':
  matches=re.findall(r'Total: ([\d,]+) tests? in ([\d,]+) files?',text);result['collection']=[{'tests':int(a.replace(',','')),'files':int(b.replace(',',''))} for a,b in matches]
 if label=='unchanged-native-consumers' and (out/'native-consumers.json').exists():
  d=json.loads((out/'native-consumers.json').read_text());result['report']={k:d.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 record['results'][label]=result;put(out/'execution.json',record);print(json.dumps({label:result}),flush=True)
 if r.returncode:print(text[-16000:],flush=True)
after={p:sha(repo/p) for p in controls};record['sourceControlsAfter']=after;record['sourceStable']=before==after
if number==768:
 inputs=json.loads((proof/'reviewed-input-sets.json').read_text());qual=t/'docs/verification/exposure-workspace-20261103/options-integration-20261109/qualification.json';browser=json.loads(qual.read_text())
 current={p:sha(repo/p) for p in inputs['browser']};assert current==browser['currentSources']
 native={}
 for kind,packet in [('eod','eod-heatmap-flowdesk-load-failure'),('gex','gex-levels-heatmap-load-failure')]:
  revision=t/'docs/pr-crops'/packet/'operations/exposure-source-compatibility-20261105/revisions/options-integration-20261109';observed=json.loads((revision/'capture-sources-before.json').read_text())
  assert all(sha(repo/p)==observed[p] for p in inputs[kind]);native[kind]=len(inputs[kind])
 record['renderingClosuresUnchanged']={'browser':len(current),**native,'browserQualificationSha256':sha(qual)}
node=record['results']['node-ci-entrypoints'];python=record['results']['python-browser-setup'];collection=record['results']['full-playwright-collection']
valid=all(v['exit']==0 for v in record['results'].values()) and before==after and node['totals'].get('tests',0)>100 and node['totals'].get('tests')==node['totals'].get('pass') and node['totals'].get('fail')==node['totals'].get('cancelled')==node['totals'].get('skipped')==0 and python.get('passed')==18 and len(collection['collection'])==1 and collection['collection'][0]['tests']>1000 and collection['collection'][0]['files']>100
record.update({'state':'QUALIFIED' if valid else 'FAILED','completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()});put(out/'execution.json',record)
print(json.dumps({'state':record['state'],'pr':number,'sourceStable':record['sourceStable']}),flush=True)
raise SystemExit(0 if valid else 1)
