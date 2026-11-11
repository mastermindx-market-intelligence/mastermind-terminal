from pathlib import Path
import hashlib,json,re,subprocess,tempfile,socket,yaml
P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i");T=P/"tree";R=P/"protected4df-20261104";REPO=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")
OLD="cd2a335f8f8fcf4fa947aa8a47f7dbf5748b2fdc";NEW="4df7aad16ea775ad8112858a5095210c076efe08"
def git(*args):return subprocess.check_output(["git","-C",str(REPO),*args])
TREES={}
def raw(ref,path):
 if ref not in TREES:
  rows=git("ls-tree","-r","-z",ref).split(b"\0");TREES[ref]={}
  for row in rows:
   if row:
    meta,name=row.split(b"\t",1);TREES[ref][name.decode()]=meta.split()[2].decode()
 blob=TREES[ref].get(path)
 return git("cat-file","blob",blob) if blob else None
def sha(b):return hashlib.sha256(b).hexdigest()
def sections(blob):
 s=blob.decode();ms=list(re.finditer(r"^([A-Za-z][\w]*):",s,re.M));return {m.group(1):s[m.start():ms[i+1].start() if i+1<len(ms) else len(s)] for i,m in enumerate(ms)}
assert not (R/"revision.json").exists(),"RECONCILE_EXISTING_REVISION"
for saved in (R/"before").rglob("*") if (R/"before").exists() else []:
 if saved.is_file():assert (T/saved.relative_to(R/"before")).read_bytes()==saved.read_bytes(),"PREPARED_PREIMAGE_MOVED"
assert json.loads((P/"inputs.json").read_text())["protected"]==OLD
for port in range(3641,3647):
 with socket.socket() as s:
  s.settimeout(1);assert s.connect_ex(("127.0.0.1",port))!=0,("ACTIVE_SERVER",port)
R.mkdir(exist_ok=True);plans=[];conflicts=[];deferred=[]
packets=["gex-levels-heatmap-load-failure","eod-heatmap-flowdesk-load-failure"]
for path in git("diff","--name-only",OLD,NEW).decode().splitlines():
 target=T/path;current=target.read_bytes() if target.is_file() else None
 base=raw(OLD,path);incoming=raw(NEW,path);proposal=incoming;rule="exact-protected-delta"
 if current==incoming:continue
 if any(path.startswith("terminal/docs/pr-crops/"+p+"/") for p in packets) and path.endswith(".png"):
  deferred.append({"path":path,"rule":"Keep qualified cd2 preview pixels until next native capture; protected pixels retained separately"});continue
 if path.endswith("/EVIDENCE.yml") and any("/"+p+"/" in path for p in packets):
  old,inc,cur=sections(base),sections(incoming),sections(current);add=[]
  for key,value in inc.items():
   if key not in old:
    assert key not in cur;add.append(value)
   elif yaml.safe_load(value)!=yaml.safe_load(old[key]):assert key=="layoutFiles",("UNEXPECTED_HISTORY_CHANGE",path,key)
  proposal=current.rstrip()+b"\n\n"+("\n".join(add)).encode();rule="append-protected-history-defer-active-source-lock"
 elif current!=base:
  assert current is not None and incoming is not None and b"\0" not in current+(base or b"")+incoming,("NON_TEXT_CONFLICT",path)
  with tempfile.TemporaryDirectory(dir=R) as tmp:
   paths=[]
   for name,data in [("current",current),("base",base or b""),("incoming",incoming)]:
    f=Path(tmp)/name;f.write_bytes(data);paths.append(str(f))
   m=subprocess.run(["git","merge-file","-p","-L","CURRENT","-L","BASE","-L","INCOMING",*paths],capture_output=True)
  proposal=m.stdout;rule="three-way-text-composition"
  if m.returncode:conflicts.append(path)
 if current is not None:
  f=R/"before"/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(current)
 if proposal is not None:
  f=R/"proposed"/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(proposal)
 plans.append({"path":path,"beforeSha256":sha(current) if current is not None else None,"afterSha256":sha(proposal) if proposal is not None else None,"rule":rule})
report={"schema":"terminal.protected_preview_delta.v1","beforeProtected":OLD,"afterProtected":NEW,"status":"PREPARED_NOT_APPLIED","files":plans,"deferredPixels":deferred,"conflicts":conflicts,"sourceLaw":"700eef54bca4a2dc4e30d94a6b30dcfa733ad57c","noGitRefOrIndexMutation":True}
(R/"revision.json").write_text(json.dumps(report,indent=2)+"\n")
assert not conflicts,("RECONCILE_TEXT_CONFLICTS",conflicts)
# Re-read every preimage before first preview mutation.
for item in plans:
 f=T/item["path"];now=f.read_bytes() if f.is_file() else None
 assert (sha(now) if now is not None else None)==item["beforeSha256"],("PREIMAGE_MOVED",item["path"])
for item in plans:
 dst=T/item["path"]
 if item["afterSha256"] is None:dst.unlink()
 else:dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes((R/"proposed"/item["path"]).read_bytes())
 assert (sha(dst.read_bytes()) if dst.is_file() else None)==item["afterSha256"]
# Preserve exact new protected root images and their source receipts as history.
for packet,count in [(packets[0],114),(packets[1],126)]:
 prefix="terminal/docs/pr-crops/"+packet
 frozen=raw(NEW,prefix+"/EVIDENCE.yml");data=yaml.safe_load(frozen)
 hist=T/prefix/"operations/protected-lab-gamma-4df7aad-20261104";assert not hist.exists();hist.mkdir(parents=True)
 (hist/"EVIDENCE.protected-4df.yml").write_bytes(frozen)
 images={}
 for name in data["files"]:
  blob=raw(NEW,prefix+"/"+name);assert blob is not None;(hist/name).write_bytes(blob);images[name]=sha(blob)
 assert len(images)==count
 receipt={"schema":"terminal.protected_root_preservation.v1","protected":NEW,"sourceManifestSha256":sha(frozen),"images":images,"reason":"Original protected packet-root pixels for historical labGammaMountedRecapture20261104; separate from composed capture"}
 (hist/"preservation.json").write_text(json.dumps(receipt,sort_keys=True,indent=2)+"\n")
 manifest=T/prefix/"EVIDENCE.yml";s=manifest.read_text()
 manifest.write_text(s.rstrip()+"\n\nprotectedLabGammaRootPreservation20261104:\n"+'  protected: "'+NEW+'"\n'+
 '  folder: "operations/protected-lab-gamma-4df7aad-20261104"\n'+
 '  receiptSha256: "'+sha((hist/"preservation.json").read_bytes())+'"\n'+
 '  scope: "Historical protected pixels; current composed UI awaits separate native capture."\n')
for filename in ["inputs.json","composition.json"]:
 f=P/filename;(R/("before-"+filename)).write_bytes(f.read_bytes());v=json.loads(f.read_text())
 v["protected"]=NEW;v["status"]="SOURCE_COMPOSED_AWAITING_4DF_QUALIFICATION";v["latest_revision"]="protected4df-20261104/revision.json"
 f.write_text(json.dumps(v,sort_keys=True,indent=2)+"\n")
report["status"]="APPLIED_PREVIEW_ONLY_AWAITING_QUALIFICATION";(R/"revision.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({"status":report["status"],"sourceFilesApplied":len(plans),"protectedPixelChangesPreserved":len(deferred),"conflicts":conflicts,"revisionSha256":sha((R/"revision.json").read_bytes())}))
