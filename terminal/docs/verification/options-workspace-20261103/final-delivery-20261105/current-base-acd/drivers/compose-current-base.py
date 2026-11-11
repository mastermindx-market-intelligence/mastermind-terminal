from pathlib import Path
import subprocess,json,hashlib,datetime
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");O=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3");E=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree")
OH="0ead3e18f4029500d7f31e3d199c64849bada79c";EH="bd4d1cec5ad2b8025558672482ee7b7d39429fc0"
OM="ac3762717ad150fd4f18614afd78072115a7c80a";EM="350a61f9bae0ae61b2ab188ec99cc73552496ad2"
out=W/"source-composition-current-master-r4.json";assert not out.exists()
def git(args,root=O,check=True):return subprocess.run(["git",*args],cwd=root,capture_output=True,text=True,check=check,timeout=120)
def state(root):
 ip=Path(git(["rev-parse","--path-format=absolute","--git-path","index"],root).stdout.strip())
 return {"head":git(["rev-parse","HEAD"],root).stdout.strip(),"status":git(["status","--porcelain=v1","-uno"],root).stdout,"index_sha256":hashlib.sha256(ip.read_bytes()).hexdigest()}
before={"options":state(O),"exposure":state(E)}
assert before["options"]["head"]==OH and before["exposure"]["head"]==EH
assert not before["options"]["status"] and not before["exposure"]["status"]
bases=["acd173eae60e1559c87603aee8fa70e35e661b65"]
def merge(left,right,base):
 cmd=["merge-tree","--write-tree","--merge-base="+base,left,right]
 p=git(cmd,check=False);tree=p.stdout.splitlines()[0] if p.stdout else None
 return {"exit":p.returncode,"tree":tree,"command":["git",*cmd],"stdout":p.stdout,"stderr":p.stderr}
rows=[]
for base in bases:
 assert git(["merge-base",base,OH]).stdout.strip()==OM
 assert git(["merge-base",base,EH]).stdout.strip()==EM
 bo=merge(base,OH,OM);be=merge(base,EH,EM)
 row={"base":base,"base_options":bo,"base_exposure":be}
 if bo["exit"]==be["exit"]==0:
  oe=merge(bo["tree"],EH,EM);eo=merge(be["tree"],OH,OM)
  row.update(options_then_exposure=oe,exposure_then_options=eo,all_clean=oe["exit"]==eo["exit"]==0,both_orders_same_tree=oe["tree"]==eo["tree"])
 else:row.update(all_clean=False,both_orders_same_tree=False)
 rows.append(row);print("COMPOSITION",base,json.dumps({k:row[k] for k in ["all_clean","both_orders_same_tree"]}),flush=True)
 if not row["all_clean"]:break
after={"options":state(O),"exposure":state(E)};assert before==after
record={"schema":"options_source_composition_analysis.v3","recorded_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"options_head":OH,"exposure_head":EH,"options_merge_base":OM,"exposure_merge_base":EM,"effect":"Result objects only; no branch, HEAD, index, working-tree changes or synthetic commits.","index_and_status_unchanged":True,"rows":rows}
if len(rows)==1 and all(r["all_clean"] and r["both_orders_same_tree"] for r in rows):
 tree=rows[-1]["options_then_exposure"]["tree"];record["latest_checked_composed_tree"]=tree
 entries=git(["ls-tree","-rz",tree,"terminal"]).stdout.split("\0")
 bad=[];checked={}
 for item in entries:
  if not item:continue
  meta,path=item.split("\t",1);mode,kind,blob=meta.split(" ")
  if kind!="blob" or path.startswith(("terminal/docs/","terminal/design_refs/")):continue
  p=P/path
  raw=p.read_bytes() if p.exists() else None
  actual=hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest() if raw is not None else None
  checked[path]=blob
  if actual!=blob:bad.append({"path":path,"expected_git_blob":blob,"preview_git_blob":actual})
 record["preview_tracked_application_scope"]={"files":len(checked),"mismatches":bad,"exact":not bad}
 for rel in ["terminal/components/exposure-map/ExposureMap.tsx","terminal/e2e/options-exposure-workspace.spec.ts"]:
  raw=subprocess.run(["git","show",tree+":"+rel],cwd=O,capture_output=True,check=True).stdout
  record.setdefault("key_final_source_sha256",{})[rel]=hashlib.sha256(raw).hexdigest()
out.write_text(json.dumps(record,indent=2)+"\n")
print(json.dumps({k:v for k,v in record.items() if k!="rows"},indent=2),flush=True)
