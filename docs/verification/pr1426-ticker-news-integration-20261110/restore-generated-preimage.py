from pathlib import Path
import datetime,hashlib,json,os,stat,subprocess
R=Path(__file__).resolve().parents[3];P=Path(__file__).resolve().parent;T=R/"terminal"
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*a):return subprocess.check_output(["git","-C",str(R),*a]).decode().strip()
capture=json.loads((P/"browser-current/execution.json").read_text())
consumers=json.loads((P/"source-consumers-current/execution.json").read_text())
assert capture["state"]=="QUALIFIED" and capture["ownedPortClosed"] and capture["nextLockAbsent"] and consumers["state"]=="QUALIFIED"
assert git("rev-parse","HEAD")==capture["head"]=="139ec0574b57ecbb59d237dc315c8276dd307794"
pre=json.loads((P/"generated-preimages.json").read_text())
assert pre["terminal/next-env.d.ts"]=={"present":False,"tracked":False}
assert sha(T/"tsconfig.json")==pre["terminal/tsconfig.json"]["sha256"]
target=T/"next-env.d.ts"
def read_owned():
 before=target.lstat()
 assert stat.S_ISREG(before.st_mode) and before.st_uid==os.getuid() and before.st_nlink==1 and before.st_size<8192
 fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  st=os.fstat(fd);body=os.read(fd,8192);after=os.fstat(fd)
 finally:os.close(fd)
 fields=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_uid,x.st_nlink)
 assert fields(before)==fields(st)==fields(after) and len(body)==st.st_size
 return {"dev":st.st_dev,"ino":st.st_ino,"size":st.st_size,"mtimeNs":st.st_mtime_ns,"uid":st.st_uid,"links":st.st_nlink,"sha256":hashlib.sha256(body).hexdigest()},body
observed,body=read_owned()
assert sha(target)==capture["generatedFiles"]["terminal/next-env.d.ts"]["sha256"]
record={"schema":"terminal.pr1426.generated-file-reconciliation.v1","state":"VALIDATING_EXACT_INSTALLED_EMITTER","sourceHead":capture["head"],"observed":observed,"originalPreimage":"ABSENT","startedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"runtimeSettlement":"browser-current/execution.json","consumerSettlement":"source-consumers-current/execution.json"}
receipt=P/"generated-reconciliation.json";assert not receipt.exists()
def save():receipt.write_text(json.dumps(record,indent=2,sort_keys=True)+"\n")
save()
emitter=T/"node_modules/next/dist/lib/typescript/writeAppTypeDeclarations.js"
assert json.loads((T/"node_modules/next/package.json").read_text())["version"]=="16.4.6"
assert (T/"app").is_dir() and not(T/"pages").exists()
expectedDir=P/"generated-emitter";expectedDir.mkdir()
options={"baseDir":str(expectedDir),"distDir":".next/dev","imageImportsEnabled":True,"hasPagesDir":False,"hasAppDir":True,"strictRouteTypes":False,"typedRoutes":False}
node=Path(json.loads((P/"dependencies.json").read_text())["nodePath"])
program="const p=JSON.parse(process.argv[1]);require(process.argv[2]).writeAppTypeDeclarations(p).catch(e=>{console.error(e.message);process.exit(1)});"
p=subprocess.run([str(node),"-e",program,json.dumps(options),str(emitter)],capture_output=True,text=True)
record["emitter"]={"path":str(emitter.relative_to(R)),"sha256":sha(emitter),"options":dict(options,baseDir="generated-emitter"),"exit":p.returncode}
save();assert p.returncode==0,"INSTALLED_EMITTER_FAILED"
expected=(expectedDir/"next-env.d.ts").read_bytes()
assert body==expected,"GENERATED_FILE_IS_NOT_EXACT_INSTALLED_DEFAULT_DEV_EMITTER"
with (P/"generated-observed-next-env.d.ts").open("xb") as f:f.write(body)
second,current=read_owned();assert second==observed and current==body
assert not git("ls-files","--","terminal/next-env.d.ts")
os.unlink(target)
assert not target.exists()
record.update({"state":"ORIGINAL_NEXT_ENV_ABSENCE_RESTORED","expectedSha256":hashlib.sha256(expected).hexdigest(),"observedArchive":"generated-observed-next-env.d.ts","trackedTsconfigUnchanged":sha(T/"tsconfig.json")==pre["terminal/tsconfig.json"]["sha256"],"completedAt":datetime.datetime.now(datetime.timezone.utc).isoformat()})
save();print(json.dumps(record),flush=True)
