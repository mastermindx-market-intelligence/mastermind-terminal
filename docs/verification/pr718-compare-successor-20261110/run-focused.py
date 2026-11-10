from pathlib import Path
import subprocess,json,hashlib,os,datetime,time,sys
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
mode=sys.argv[1];assert mode in ['red','green']
assert not (p/(mode+'-execution.json')).exists() and not (p/(mode+'-report.json')).exists()
runtime=json.loads((p/'runtime.json').read_text());assert runtime['state']=='LOCKED_DEPENDENCIES_READY'
node=Path(runtime['node']);env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ};env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1')
files=['terminal/components/CompareSettings.tsx','terminal/components/CompareSettings.module.css','terminal/components/TerminalShell.tsx','terminal/components/IndicatorSettings.module.css','terminal/lib/chartSettingsUi.ts','terminal/lib/chart-engine/canvas/priceAxis.ts','terminal/lib/__tests__/compareSettingsUx.test.tsx','terminal/lib/__tests__/compareSettingsAccessibility.test.tsx','terminal/lib/__tests__/chartSettingsUi.test.ts','terminal/package.json','terminal/package-lock.json','terminal/vitest.config.ts']
def digest(f):return hashlib.sha256((w/f).read_bytes()).hexdigest()
def save(n,v):(p/n).write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
before={f:digest(f) for f in files};save('source-before-'+mode+'.json',before)
if mode=='red':
 for f,blob in [('terminal/components/CompareSettings.tsx','2473026814624d15ee866402377f4b7609c4a057'),('terminal/components/CompareSettings.module.css','6b5127851b05f5c47f619392fc2a931cbaea2d7c')]:
  assert subprocess.check_output(['git','-C',str(w),'hash-object',str(w/f)],text=True).strip()==blob
argv=[str(node),'node_modules/vitest/vitest.mjs','run','lib/__tests__/compareSettingsUx.test.tsx','lib/__tests__/compareSettingsAccessibility.test.tsx','lib/__tests__/chartSettingsUi.test.ts','--reporter=default','--reporter=json','--outputFile='+str(p/(mode+'-report.json'))]
record={'mode':mode,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'argv':argv,'state':'RUNNING'};save(mode+'-execution.json',record);start=time.monotonic()
with (p/(mode+'.log')).open('xb') as log:
 child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);record['pid']=child.pid;save(mode+'-execution.json',record);code=child.wait()
report=json.loads((p/(mode+'-report.json')).read_text());after={f:digest(f) for f in files};save('source-after-'+mode+'.json',after);assert before==after
failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
record.update(exitCode=code,seconds=round(time.monotonic()-start,3),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceStable=True,counts={k:report[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']},failedTests=failed,logSha256=hashlib.sha256((p/(mode+'.log')).read_bytes()).hexdigest())
if mode=='red':
 assert code==1 and report['numFailedTests']==5 and report['numPendingTests']==0
 assert all(any(fragment in title for title in failed) for fragment in ['allows clearing thickness','withholds out-of-range widths','withholds fractional widths','withholds negative drafts','does not carry an uncommitted draft'])
 record['state']='COUNTEREXAMPLES_REPRODUCED'
else:
 assert code==0 and report['numFailedTests']==report['numPendingTests']==0
 record['state']='AFFECTED_CONTRACTS_PASSED'
save(mode+'-execution.json',record);print(json.dumps(record),flush=True)
