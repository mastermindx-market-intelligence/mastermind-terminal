from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil,socket,stat
repo=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-d06-evidence-readers-20261111-c3')
t=repo/'terminal'
proof=repo/'docs/verification/pr1270-evidence-readers-20261111'
run=proof/'ticker-browser'
port=57740
node=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node')
env={k:os.environ[k] for k in ['HOME','LANG','TMPDIR','TMP','TEMP','PATH'] if k in os.environ}
env['PATH']=str(node.parent)+':'+env['PATH']
env.update({'CI':'1','TERMINAL_E2E_PORT':str(port),'PLAYWRIGHT_BROWSERS_PATH':'/Users/chriswong/Library/Caches/ms-playwright','MMX_SHARED_SHELL':'0','MMX_INVESTOR_SHELL_PREVIEW':'0','TERMINAL_CROPS':'1','TERMINAL_TICKER_NEWS_CAPTURE_PACKET':'ticker-news','PLAYWRIGHT_JSON_OUTPUT_FILE':str(run/'report.json')})
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,obj):p.write_text(json.dumps(obj,indent=2,sort_keys=True)+'\n')
def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
def observe(cmd):
 r=subprocess.run(cmd,capture_output=True,text=True)
 return {'command':cmd,'rc':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'at':now()}
def listener():
 r=observe(['lsof','-nP','-iTCP:'+str(port),'-sTCP:LISTEN'])
 assert r['rc'] in [0,1] and not r['stderr'].strip()
 return r
assert git('rev-parse','HEAD')=='75a390d6891830a8bfa47a43a804e4dfe8d939df'
assert git('rev-parse','MERGE_HEAD')=='c13976bf86fb066e69cab399200a07ca63431521'
assert not git('diff','--name-only','--diff-filter=U')
assert listener()['rc']==1 and not(t/'.next/dev/lock').exists()
with socket.socket() as s:s.bind(('127.0.0.1',port))
assert not run.exists()
run.mkdir(parents=True)
source_changes=git('diff','--name-only').splitlines()
assert len(source_changes)==10 and all(p.startswith('terminal/lib/__tests__/') for p in source_changes)
subprocess.run(['git','-C',str(repo),'add','--',*source_changes,'terminal/lib/__tests__/fixtures/d06CaptureDependency'],check=True)
packet=t/'docs/pr-crops/ticker-news'
expected=sorted([size+'-'+lang+'-dark.png' for size in ['desktop','tablet','mobile'] for lang in ['en','zh']]+['unavailable-'+size+'-'+lang+'-dark.png' for size in ['desktop','mobile'] for lang in ['en','zh']])
assert sorted(p.name for p in packet.glob('*.png'))==expected
prior={p.name:{'bytes':p.stat().st_size,'sha256':sha(p)} for p in packet.iterdir() if p.is_file()}
assert len(prior)==11 and 'EVIDENCE.yml' in prior
prior_dir=proof/'ticker-prior'
shutil.copytree(packet,prior_dir)
assert {p.name:sha(p) for p in prior_dir.iterdir() if p.is_file()}=={k:v['sha256'] for k,v in prior.items()}
put(run/'prior-files.json',prior)
families=['ticker-news-editorial-views','ticker-news-recovery','ticker-news-cn-hk']
def neighbors():return {str(p.relative_to(repo)):sha(p) for family in families for p in (t/'docs/pr-crops'/family).rglob('*') if p.is_file()}
neighbor_before=neighbors();assert neighbor_before
put(run/'neighbor-before.json',neighbor_before)
extra={'terminal/e2e/ticker-news.spec.ts','terminal/e2e/watchlistStore.ts','terminal/e2e/presentationControls.ts','terminal/playwright.config.ts','terminal/next.config.ts','terminal/package.json','terminal/package-lock.json','terminal/lib/__tests__/tickerNewsEvidence.test.ts','terminal/lib/__tests__/fixtures/newsEditorial.ts','terminal/docs/specimens/news-flow.light.css','terminal/components/news/TickerNewsPanel.tsx','terminal/components/news/TickerNewsPanel.module.css','terminal/components/TerminalShell.tsx','terminal/e2e/globalSetup.ts','terminal/e2e/tools/visualEvidence.cjs','terminal/tsconfig.json'}
def snapshot():
 paths=set(json.loads(subprocess.check_output([str(node),'-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,env=env,text=True)))|extra
 assert all((repo/p).is_file() and not(repo/p).is_symlink() for p in paths)
 return {p:sha(repo/p) for p in sorted(paths)}
before=snapshot();put(run/'source-before.json',before)
command=[str(node),'node_modules/@playwright/test/cli.js','test','e2e/ticker-news.spec.ts','--project=desktop','--project=tablet','--project=mobile','--workers=1','--retries=0','--reporter=list,json','--output='+str(run/'artifacts')]
record={'schema':'terminal.pr1270_ticker_capture.v1','state':'STARTED','started_at':now(),'head':git('rev-parse','HEAD'),'head_tree':git('rev-parse','HEAD^{tree}'),'merge_head':git('rev-parse','MERGE_HEAD'),'index_tree':git('write-tree'),'source_count':len(before),'source_snapshot_sha256':sha(run/'source-before.json'),'prior_files':len(prior),'neighbor_files':len(neighbor_before),'command':command,'port':port,'listener_before':listener(),'node_version':subprocess.check_output([str(node),'--version'],text=True).strip(),'browser_preflight':'Chromium 149.0.7827.55 launched and closed through installed @playwright/test','expected_counts':{'expected':14,'skipped':7,'unexpected':0,'flaky':0},'expected_pngs':expected,'fixture_scope':'Local original route and spec with authored news/quote fixtures; no production login or production writes.'}
put(run/'execution.json',record)
print(json.dumps({'state':'STARTED','at':record['started_at'],'source_count':len(before),'neighbor_files':len(neighbor_before),'index_tree':record['index_tree'],'port':port}),flush=True)
start_ns=time.time_ns();start=time.monotonic()
with (run/'browser.log').open('xb') as log:
 proc=subprocess.Popen(command,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT)
 record['producer_pid']=proc.pid;record['observer_pid']=os.getpid();put(run/'execution.json',record)
 rc=proc.wait()
record.update({'exit':rc,'elapsed_seconds':round(time.monotonic()-start,3),'log_sha256':sha(run/'browser.log'),'completed_at':now()})
after=snapshot();put(run/'source-after.json',after)
record['source_unchanged']=before==after
record['source_after_sha256']=sha(run/'source-after.json')
record['neighbors_unchanged']=neighbors()==neighbor_before
record['prior_preserved']=all(sha(prior_dir/name)==v['sha256'] for name,v in prior.items())
record['manifest_unchanged']=sha(packet/'EVIDENCE.yml')==prior['EVIDENCE.yml']['sha256']
report=json.loads((run/'report.json').read_text()) if (run/'report.json').is_file() else {'errors':['missing report'],'stats':{}}
cases=[]
def walk(suite):
 for spec in suite.get('specs',[]):
  for test in spec.get('tests',[]):
   cases.append({'file':spec['file'],'title':spec['title'],'project':test['projectName'],'status':test.get('status'),'expected_status':test.get('expectedStatus'),'results':[{'status':r.get('status'),'retry':r.get('retry')} for r in test.get('results',[])]})
 for child in suite.get('suites',[]):walk(child)
for suite in report.get('suites',[]):walk(suite)
record['stats']=report.get('stats',{});record['cases']=cases;record['report_errors']=report.get('errors',[])
record['report_sha256']=sha(run/'report.json') if (run/'report.json').exists() else None
# Observe the original invocation and its own runtime; never kill or re-home it.
for _ in range(40):
 observed=listener()
 if observed['rc']==1:break
 time.sleep(.25)
record['listener_after']=observed
record['producer_after']=observe(['ps','-p',str(proc.pid),'-o','pid=,ppid=,comm='])
lock=t/'.next/dev/lock'
record['next_lock_present']=lock.exists()
if lock.exists():
 st=lock.lstat();assert stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid()
 lock_record={'device':st.st_dev,'inode':st.st_ino,'bytes':st.st_size,'sha256':sha(lock)}
 try:
  content=json.loads(lock.read_text());lock_record['content']=content
  if isinstance(content.get('pid'),int):lock_record['server_after']=observe(['ps','-p',str(content['pid']),'-o','pid=,ppid=,comm='])
 except (ValueError,UnicodeDecodeError):lock_record['content']='NON_JSON'
 lock_record['holders']=observe(['lsof',str(lock)])
 record['next_lock']=lock_record
record['runtime_closed']=observed['rc']==1 and record['producer_after']['rc']==1 and (not lock.exists() or (record['next_lock']['holders']['rc']==1 and record['next_lock'].get('server_after',{}).get('rc')==1))
images={}
if rc==0:
 decode="const fs=require('fs');const {PNG}=require('pngjs');const names=JSON.parse(process.argv[1]);const root=process.argv[2];const rows={};for(const name of names){const b=fs.readFileSync(root+'/'+name);const p=PNG.sync.read(b,{checkCRC:true});let varied=false;for(let i=4;i<p.data.length;i+=4){if(p.data.readUInt32BE(i)!==p.data.readUInt32BE(0)){varied=true;break;}}if(!varied)throw Error('blank '+name);rows[name]={width:p.width,height:p.height,pixel_bytes:p.data.length,crc_valid:true,varied:true};}console.log(JSON.stringify(rows));"
 decoded=json.loads(subprocess.check_output([str(node),'-e',decode,json.dumps(expected),str(packet)],cwd=t,env=env,text=True))
 for name in expected:
  p=packet/name
  images[name]={**decoded[name],'bytes':p.stat().st_size,'sha256':sha(p),'fresh':p.stat().st_mtime_ns>=start_ns}
record['images']=images
good=rc==0 and record['source_unchanged'] and record['neighbors_unchanged'] and record['prior_preserved'] and record['manifest_unchanged'] and record['runtime_closed']
good=good and not record['report_errors'] and len(cases)==21 and len({(c['project'],c['title']) for c in cases})==21
good=good and all(record['stats'].get(k)==v for k,v in record['expected_counts'].items()) and all(r['retry']==0 for c in cases for r in c['results'])
good=good and len(images)==10 and all(v['fresh'] for v in images.values()) and sorted(p.name for p in packet.glob('*.png'))==expected
record['state']='MECHANICALLY_QUALIFIED_PENDING_VISUAL_INSPECTION' if good else 'FAILED_REQUIRES_DIAGNOSIS'
put(run/'execution.json',record)
print(json.dumps({'state':record['state'],'exit':rc,'stats':record['stats'],'source_unchanged':record['source_unchanged'],'neighbors_unchanged':record['neighbors_unchanged'],'images':len(images),'runtime_closed':record['runtime_closed'],'log_sha256':record['log_sha256']}),flush=True)
raise SystemExit(0 if good else 1)
