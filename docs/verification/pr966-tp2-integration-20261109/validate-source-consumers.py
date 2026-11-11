from pathlib import Path
import subprocess,json,hashlib,os,time,datetime
repo=Path(__file__).resolve().parents[3];t=repo/'terminal';proof=Path(__file__).resolve().parent;out=proof/'source-consumers-r1'
head='46394e371a34ef9cda9ffd09b1ba115e3729c441';base='03af393ce05c12282003a3919cc473c032264922'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def git(*a):return subprocess.run(['git','-C',str(repo),*a],capture_output=True,text=True,check=True).stdout.strip()
assert git('rev-parse','HEAD')==head and git('rev-parse','MERGE_HEAD')==base and not git('diff','--name-only','--diff-filter=U')
prep=json.loads((proof/'integration-preparation.json').read_text());assert prep['state']=='CLEAN_REAL_PROTECTED_MERGE_TEN_ACCEPTED_BLOBS_UNCHANGED'
assert all(git('hash-object',p)==h for p,h in prep['acceptedTenBlobs'].items())
paths=set(json.loads(subprocess.run(['node','-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,capture_output=True,text=True,check=True).stdout))|set(prep['acceptedTenBlobs'])
def snapshot():return {p:sha(repo/p) for p in sorted(paths)}
assert not out.exists();out.mkdir();before=snapshot();put(out/'source-before.json',before)
tests=['lib/__tests__/'+n+'.test.ts' for n in ['tp2PrivateEvidence','tp2ResearchReadout','tp1Nanoseconds','tp1PrivateEvidence']]
lint=['lib/tp2PrivateEvidence.ts','lib/__tests__/tp2PrivateEvidence.test.ts','components/offexchange/Tp2ResearchReadout.tsx','lib/__tests__/tp2ResearchReadout.test.ts']
commands=[('units',['node','node_modules/vitest/vitest.mjs','run',*tests,'--pool=forks','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(out/'units.json')]),('typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false']),('lint',['node','node_modules/eslint/bin/eslint.js',*lint,'--max-warnings=0']),('offline-browser',['node','scripts/verify-tp2-readout-browser.mjs'])]
env=os.environ.copy();env.pop('TP2_BROWSER_SCREENSHOT_DIR',None);env['PLAYWRIGHT_BROWSERS_PATH']=str(t/'node_modules/.cache/pr966-playwright')
record={'schema':'terminal_pr966_source_consumer_qualification.v1','state':'RUNNING','sourceEntries':len(before),'startedAt':now(),'results':{}}
for label,command in commands:
 log=out/(label+'.log');start=time.monotonic();print(json.dumps({'starting':label}),flush=True)
 if label=='offline-browser':
  r=subprocess.run(command,cwd=t,env=env,capture_output=True,text=True);log.write_text(r.stdout);(out/'offline-browser-stderr.log').write_text(r.stderr)
 else:
  with log.open('x') as h:r=subprocess.run(command,cwd=t,env=env,stdout=h,stderr=subprocess.STDOUT)
 result={'command':command,'exit':r.returncode,'seconds':round(time.monotonic()-start,2),'logSha256':sha(log)}
 if label=='units' and (out/'units.json').exists():
  d=json.loads((out/'units.json').read_text());result['report']={k:d.get(k) for k in ['success','numTotalTests','numPassedTests','numFailedTests','numPendingTests']}
 if label=='offline-browser' and r.returncode==0:
  d=json.loads(r.stdout);put(out/'offline-browser.json',d);result['browser']={'status':d['status'],'scenarios':len(d['scenarios']),'stateCases':d['stateCases'],'unauthorizedDom':d['unauthorizedDom'],'productionAccepted':d['productionAccepted'],'lightMode':d['lightMode'],'chrome':d['chrome']};result['stderrSha256']=sha(out/'offline-browser-stderr.log')
 record['results'][label]=result;record['sourceStable']=snapshot()==before;put(out/'execution.json',record);print(json.dumps({label:result,'sourceStable':record['sourceStable']}),flush=True)
 if r.returncode:print(log.read_text()[-10000:],flush=True)
after=snapshot();put(out/'source-after.json',after)
good=all(x['exit']==0 for x in record['results'].values()) and after==before
u=record['results']['units'].get('report',{});b=record['results']['offline-browser'].get('browser',{})
good=good and u=={'success':True,'numTotalTests':151,'numPassedTests':151,'numFailedTests':0,'numPendingTests':0} and b.get('status')=='OFFLINE_TP2_RESPONSIVE_BROWSER_FIXTURE_PASS' and b.get('scenarios')==10 and len(b.get('stateCases',[]))==5 and b.get('unauthorizedDom')=='WITHHELD' and b.get('productionAccepted') is False
assert all(git('hash-object',p)==h for p,h in prep['acceptedTenBlobs'].items())
record.update({'state':'QUALIFIED' if good else 'FAILED','completedAt':now(),'sourceStable':before==after,'acceptedTenBlobsUnchanged':True});put(out/'execution.json',record)
raise SystemExit(0 if good else 1)
