from pathlib import Path
import subprocess,json,hashlib,os,time,datetime,shutil
repo=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4")
t=repo/"terminal";out=repo/"docs/verification/pr1422-next-20261110/ci-recovery"
head="1aec81f3c6d378cb9edc2b9ecb8bda5ff12a90df";port=34231
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2,sort_keys=True)+"\n")
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
runtime=repo/".pr1422-qualification/runtime/node-v22.23.4-darwin-arm64/bin"
env={**os.environ,"PATH":str(runtime)+":"+os.environ["PATH"],"TERMINAL_CROP_PORT":str(port),"MMX_SHARED_SHELL":"0","MMX_INVESTOR_SHELL_PREVIEW":"0","PLAYWRIGHT_BROWSERS_PATH":str(Path.home()/"Library/Caches/ms-playwright")}
assert subprocess.check_output(["git","rev-parse","HEAD"],cwd=repo,text=True).strip()==head
assert not (t/".next/dev/lock").exists()
p=subprocess.run(["lsof","-nP","-iTCP:"+str(port),"-sTCP:LISTEN"],capture_output=True,text=True)
assert p.returncode==1 and not p.stdout.strip() and not p.stderr.strip()
out.mkdir(exist_ok=False)
packet=t/"docs/pr-crops/b-f08-8-invalidation";prior=out/"prior-b-f08-8";prior.mkdir()
original={}
for p in sorted(packet.iterdir()):
 if p.is_file():
  shutil.copy2(p,prior/p.name);assert sha(p)==sha(prior/p.name);original[p.name]=sha(p)
assert len([p for p in original if p.endswith(".png")])==8
put(out/"prior-b-f08-8.json",{"source_packet":str(packet.relative_to(repo)),"files":original})
for name in ["controls","workspace-reconcile"]:
 src=Path("/tmp/mastermind-terminal-pr1422-"+("ci-repair-controls" if name=="controls" else name)+"-20261110.json")
 shutil.copy2(src,out/(name+".json"))
def snapshot():
 p=subprocess.run(["node","-e","console.log(JSON.stringify(require('./terminal/e2e/tools/visualEvidence.cjs').sourceSnapshot(process.cwd())))"],cwd=repo,env=env,capture_output=True,text=True)
 assert p.returncode==0,p.stderr;return json.loads(p.stdout)
before=snapshot();put(out/"bf08-source-before.json",before)
command=["node","e2e/tools/capture_b_f08_8_invalidation.cjs"];log=out/"bf08-capture.log"
rec={"source":head,"command":command,"port":port,"startedAt":now(),"node":subprocess.check_output(["node","--version"],env=env,text=True).strip(),"prior_packet":original}
put(out/"bf08-execution.json",rec);start=time.monotonic()
with log.open("xb") as f:r=subprocess.run(command,cwd=t,env=env,stdout=f,stderr=subprocess.STDOUT)
rec.update(exit=r.returncode,seconds=round(time.monotonic()-start,3),completedAt=now(),logSha256=sha(log))
after=snapshot();put(out/"bf08-source-after.json",after);rec["sourceStable"]=before==after;rec["sourceCount"]=len(before)
put(out/"bf08-execution.json",rec)
if r.returncode:
 rec["qualification"]="FAILED_NO_EXTRA_RUNTIME_PROBE";put(out/"bf08-execution.json",rec)
 print(json.dumps(rec),flush=True);raise SystemExit(r.returncode)
p=subprocess.run(["lsof","-nP","-iTCP:"+str(port),"-sTCP:LISTEN"],capture_output=True,text=True)
rec["portClosed"]=p.returncode==1 and not p.stdout.strip() and not p.stderr.strip()
rec["nextLockAbsent"]=not(t/".next/dev/lock").exists()
rec["packet"]={p.name:sha(p) for p in sorted(packet.iterdir()) if p.is_file()}
rec["qualification"]="PRODUCER_PASSED_AWAITING_VISUAL_REVIEW"
put(out/"bf08-execution.json",rec)
assert rec["sourceStable"] and rec["portClosed"] and rec["nextLockAbsent"],rec
assert len([x for x in rec["packet"] if x.endswith(".png")])==8
print(json.dumps({k:v for k,v in rec.items() if k not in ["prior_packet","packet"]}),flush=True)
