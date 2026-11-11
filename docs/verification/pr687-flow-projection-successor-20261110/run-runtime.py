import pathlib,subprocess,json,os,hashlib,datetime,time
w=pathlib.Path('/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-687-flow-projection-successor');t=w/'terminal';p=w/'docs/verification/pr687-flow-projection-successor-20261110'
node=pathlib.Path('/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1275-conflict-successor/.pr1275-conflict-runtime/node-v22.23.4-darwin-arm64/bin/node')
def h(f):return hashlib.sha256(f.read_bytes()).hexdigest()
assert h(node)=='2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0'
assert not (p/'runtime.json').exists() and not (t/'node_modules').exists()
packages={x:h(t/x) for x in ['package.json','package-lock.json']}
assert packages=={'package.json':'fb90e0a4948732f326dc197b57495c949f585407c83934b0a554d0fcc5e514cf','package-lock.json':'ba5effb6ceb68fd277281ccb7cd8e15dd94fccdc317285f68eb49f4e59388cd4'}
env=dict(os.environ);env['PATH']=str(node.parent)+os.pathsep+env['PATH'];env['PLAYWRIGHT_BROWSERS_PATH']='/Users/chriswong/Library/Caches/ms-playwright'
cmd=[str(node),str(node.parent.parent/'lib/node_modules/npm/bin/npm-cli.js'),'ci','--prefer-offline','--no-audit','--no-fund']
state={'schema':'terminal_pr687_runtime.v1','state':'INSTALL_RUNNING','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':str(node),'nodeSha256':h(node),'nodeVersion':subprocess.check_output([str(node),'--version']).decode().strip(),'packageFiles':packages,'argv':cmd,'browserStore':env['PLAYWRIGHT_BROWSERS_PATH']}
def save():(p/'runtime.json').write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
save();start=time.monotonic()
with (p/'npm-ci.log').open('x') as log:
 process=subprocess.Popen(cmd,cwd=t,env=env,stdout=log,stderr=subprocess.STDOUT);state['pid']=process.pid;save();rc=process.wait()
state.update(exitCode=rc,seconds=round(time.monotonic()-start,3),finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),logSha256=h(p/'npm-ci.log'),packageFilesUnchanged=packages=={x:h(t/x) for x in packages})
state['state']='LOCKED_DEPENDENCIES_READY' if rc==0 and state['packageFilesUnchanged'] else 'RUNTIME_SETUP_FAILED';save()
print(json.dumps(state,indent=2),flush=True)
raise SystemExit(rc if rc else 0 if state['packageFilesUnchanged'] else 1)
