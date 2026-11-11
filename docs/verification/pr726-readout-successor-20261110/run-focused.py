from pathlib import Path
import subprocess,json,hashlib,os,datetime,time,sys
w=Path(__file__).resolve().parents[3];p=Path(__file__).resolve().parent;t=w/'terminal'
mode=sys.argv[1];assert mode in ['red','green']
runtime=json.loads((p/'runtime.json').read_text());assert runtime['state']=='LOCKED_DEPENDENCIES_READY'
node=Path(runtime['node']);env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP'] if k in os.environ};env.update(PATH=str(node.parent)+':'+os.environ['PATH'],CI='1')
files=['terminal/lib/precisionEntryReadout.ts','terminal/components/PrecisionEntryStrip.tsx','terminal/components/PrecisionEntryStrip.module.css','terminal/lib/__tests__/precisionEntryReadout.test.ts','terminal/lib/__tests__/precisionEntryStrip.test.tsx','terminal/package.json','terminal/package-lock.json','terminal/vitest.config.ts']
def digest(f):return hashlib.sha256((w/f).read_bytes()).hexdigest()
def save(n,v):(p/n).write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
before={f:digest(f) for f in files};save('source-before-'+mode+'.json',before)
if mode=='red':
 for f,blob in [('terminal/lib/precisionEntryReadout.ts','e432c0f9e540daeb15bd0c2a27192ed4fdbefc60'),('terminal/components/PrecisionEntryStrip.tsx','5119e3c66e9f3d14c10358b24728ff81d49f16d3')]:
  assert subprocess.check_output(['git','-C',str(w),'hash-object',str(w/f)],text=True).strip()==blob
argv=[str(node),'node_modules/vitest/vitest.mjs','run','lib/__tests__/precisionEntryReadout.test.ts','lib/__tests__/precisionEntryStrip.test.tsx','--reporter=default','--reporter=json','--outputFile='+str(p/(mode+'-report.json'))]
record={'mode':mode,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'argv':argv,'state':'RUNNING'};save(mode+'-execution.json',record);start=time.monotonic()
with (p/(mode+'.log')).open('xb') as log:
 child=subprocess.Popen(argv,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);record['pid']=child.pid;save(mode+'-execution.json',record);code=child.wait()
report=json.loads((p/(mode+'-report.json')).read_text());after={f:digest(f) for f in files};save('source-after-'+mode+'.json',after);assert before==after
failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
record.update(exitCode=code,seconds=round(time.monotonic()-start,3),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceStable=True,counts={k:report[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests']},failedTests=failed,logSha256=hashlib.sha256((p/(mode+'.log')).read_bytes()).hexdigest())
if mode=='red':
 assert code==1 and report['numFailedTests']>0 and report['numPendingTests']==0
 assert all(any(fragment in title for title in failed) for fragment in ['omits absent en posture','omits absent zh posture','keeps empty containers unavailable','keeps metadata-only containers unavailable'])
 record['state']='COUNTEREXAMPLES_REPRODUCED'
else:
 assert code==0 and report['numFailedTests']==report['numPendingTests']==0
 record['state']='AFFECTED_CONTRACTS_PASSED'
save(mode+'-execution.json',record);print(json.dumps(record),flush=True)
