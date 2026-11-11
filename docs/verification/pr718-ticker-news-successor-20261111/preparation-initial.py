from pathlib import Path
import ast,datetime,hashlib,json,os,shutil,socket,subprocess
w=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-718-compare-successor');t=w/'terminal'
p=w/'docs/verification/pr718-ticker-news-successor-20261111'
control=Path('/tmp/terminal-pr718-news-composition-20261111-c3')
node=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node')
template=Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-experience-refinement-20261109-sol-01/docs/verification/pr1407-ticker-news-successor-20261111/capture-news.py')
head='01550eaca9e1e1f8d816e6fef785b38998710b43';base='18fabe9d3c1439c4185559ba5ce491518fe999c9';dep='59f101192d6b48d72b850f98c2428f27a04652bf'
parents=['26862a671763d6eea4a1ea3b93f3bfc79114b6e1',base,dep];tree='e2cf25126668a68cdf585be25092e52a589eb849'
def git(*a):return subprocess.check_output(['git','-C',str(w),*a]).decode().strip()
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def put(rel,x):f=p/rel;assert not f.exists();f.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
assert not p.exists()
assert git('rev-parse','HEAD')==head and git('rev-parse','HEAD^{tree}')==tree and git('show','-s','--format=%P',head).split()==parents and not git('status','--porcelain=v1')
x=json.loads((control/'native-objects/continuation-ledger.json').read_text());assert x['state']=='IMMUTABLE_SOURCE_READY_FOR_CAPTURE_REF_UNCHANGED' and x['localCaptureHead']==head and x['branchMutation'] is False
assert sha(template)=='6b98a2eb2a35724848c337f2a7c8735b3674afdf4c835df3bbe6ad32da21769b'
assert sha(node)=='2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0'
nodeVersion=subprocess.check_output([str(node),'--version']).decode().strip();assert nodeVersion=='v22.23.4'
lock=json.loads((t/'package-lock.json').read_text());packages={}
for n in ['next','@playwright/test','vitest']:
 inst=json.loads((t/'node_modules'/n/'package.json').read_text())['version'];locked=lock['packages']['node_modules/'+n]['version'];assert inst==locked;packages[n]={'installed':inst,'locked':locked}
registry=t/'node_modules/playwright-core/lib/server/registry/index.js';assert registry.exists()
js="const {registry}=require("+json.dumps(str(registry))+");const x=registry.findExecutable('chromium-headless-shell');console.log(JSON.stringify({name:x.name,path:x.executablePath()}));"
env=os.environ.copy();env['PLAYWRIGHT_BROWSERS_PATH']='/Users/chriswong/Library/Caches/ms-playwright';env['PATH']=str(node.parent)+':'+env['PATH']
browser=json.loads(subprocess.check_output([str(node),'-e',js],cwd=t,env=env).decode());binary=Path(browser['path']);assert binary.is_file() and os.access(binary,os.X_OK)
browser.update(sha256=sha(binary),bytes=binary.stat().st_size)
assert not(t/'.next/dev/lock').exists()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
p.mkdir()
packet=t/'docs/pr-crops/ticker-news';oldfiles={f.name:{'sha256':sha(f),'bytes':f.stat().st_size} for f in packet.iterdir() if f.is_file()};assert len(oldfiles)==11
shutil.copytree(packet,p/'prior-packet')
assert all(sha(p/'prior-packet'/n)==v['sha256'] for n,v in oldfiles.items())
put('prior-packet-preservation.json',{'schema':'terminal.pr718.news-prior-packet.v1','sourceHead':head,'inheritedFrom':dep,'activePacket':'terminal/docs/pr-crops/ticker-news','files':oldfiles,'readback':'MATCH'})
families=['ticker-news-editorial-views','ticker-news-recovery','ticker-news-cn-hk']
modern={str(f.relative_to(w)):{'sha256':sha(f),'bytes':f.stat().st_size} for name in families for f in (t/'docs/pr-crops'/name).rglob('*') if f.is_file()}
assert len(modern)==103;put('newer-packets-before.json',modern)
archive='docs/verification/pr1426-ticker-news-integration-20261110/prior-packet'
assert git('rev-parse',base+':'+archive)==git('rev-parse',head+':'+archive)
archived={f.name:sha(f) for f in (w/archive).iterdir() if f.is_file()};assert len(archived)==11
compare='docs/verification/pr718-compare-successor-20261110'
assert git('rev-parse',parents[0]+':'+compare)==git('rev-parse',head+':'+compare)
put('accepted-proof-preservation.json',{'historicalNewsArchive':archive,'protectedArchiveTree':git('rev-parse',base+':'+archive),'files':archived,'acceptedComparePacket':compare,'acceptedCompareTree':git('rev-parse',head+':'+compare),'oldAndComposedTreesMatch':True,'acceptedCompareTests':64,'acceptedCompareBrowserJourneys':12,'state':'ACCEPTED_PROOF_UNCHANGED_NOT_RERUN'})
pre={}
(p/'generated-preimages').mkdir()
for rel in ['terminal/next-env.d.ts','terminal/tsconfig.json']:
 f=w/rel;v={'present':f.exists()}
 if f.exists():
  backup='generated-preimages/'+f.name;shutil.copy2(f,p/backup);v.update(sha256=sha(f),bytes=f.stat().st_size,backup=backup)
 pre[rel]=v
put('generated-preimages.json',pre)
for label,source in [('source-local-alignment.json',control/'source-local-alignment/receipt.json'),('source-composition-publication.json',control/'native-objects/continuation-ledger.json'),('source-composition.json',control/'owned-merge.json')]:shutil.copy2(source,p/label)
(p/'source-publication').mkdir()
for f in (control/'native-objects').iterdir():
 if f.is_file() and f.name!='continuation-ledger.json':shutil.copy2(f,p/'source-publication'/f.name)
originalTemplate=template.read_text();body=originalTemplate.replace('port=61981','port='+str(port)).replace("head='5338557e44e2a8b5ca789aac7cd295037db9692d';base='74c007125129090cc762f2bc4b1b152123326444';compositionParents=['c6f876e325a7c06160caf61f0d0f335e0c69a951'];sourceTree='df6f2dfeb5587acd42d83847ea8582a9e1da0a39'","head="+repr(head)+";base="+repr(base)+";compositionParents="+repr(parents)+";sourceTree="+repr(tree)).replace('pr1407','pr718')
assert body!=originalTemplate and head in body and '5338557e44e2a8b5ca789aac7cd295037db9692d' not in body
(p/'capture-news.py').write_text(body)
extra=next(ast.literal_eval(n.value) for n in ast.parse(body).body if isinstance(n,ast.Assign) and any(isinstance(a,ast.Name) and a.id=='extraPaths' for a in n.targets))
discovered=json.loads(subprocess.check_output([str(node),'-e',"console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=w,env=env).decode())
source={rel:sha(w/rel) for rel in sorted(set(discovered)|set(extra))}
put('preparation-source.json',source)
assert git('hash-object','terminal/e2e/ticker-news.spec.ts')=='09edca20e9d77e26306936f125a73305d67fc71a'
assert source['terminal/components/TerminalShell.tsx']=='bc6a6138369de95c86aaefec90f63e6a1a6fde835f9e285fbebf9604410d9075'
put('dependencies.json',{'state':'MATCHING_DEPENDENCIES_AND_EXISTING_BROWSER_CACHE_READY','node':str(node),'nodeVersion':nodeVersion,'nodeSha256':sha(node),'packages':packages,'browser':browser,'freshReadAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'dependencyInstallPerformed':False})
put('preparation.json',{'schema':'terminal.pr718.news-preparation.v1','state':'PREPARED','head':head,'sourceTree':tree,'parents':parents,'protectedMaster':base,'sourceEntries':len(source),'port':port,'captureWrapperSha256':sha(p/'capture-news.py'),'templateSha256':sha(template),'sourceProducerBlob':'09edca20e9d77e26306936f125a73305d67fc71a','remoteRefStillExpectedAt':parents[0],'branchMutation':False,'expectedPassed':14,'expectedAuthoredSkips':7,'expectedImages':10,'newerPacketFiles':103})
print(json.dumps({'state':'PREPARED','head':head,'sourceTree':tree,'sourceEntries':len(source),'port':port,'packages':packages,'browser':browser,'wrapperSha256':sha(p/'capture-news.py'),'priorPacketFiles':11,'historicalArchivePreserved':11,'acceptedComparePacketTree':git('rev-parse',head+':'+compare),'neighbors':103}),flush=True)
