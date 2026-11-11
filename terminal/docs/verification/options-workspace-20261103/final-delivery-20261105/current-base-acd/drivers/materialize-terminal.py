from pathlib import Path
import json,hashlib,subprocess,datetime
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");O=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree")
rec=json.loads((W/"source-composition-current-master-r4.json").read_text());tree=rec["latest_checked_composed_tree"]
assert tree=="76427bdc7a98c00f0936eca9641ac444a040b8ab" and rec["rows"][0]["all_clean"] and rec["rows"][0]["both_orders_same_tree"]
R=W/"preview-current-master-r4";assert not R.exists();R.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest()
blob=lambda b:hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
changes=rec["preview_tracked_application_scope"]["mismatches"];assert len(changes)==7
for row in changes:
 path=row["path"];p=P/path;current=p.read_bytes() if p.exists() else None
 assert (blob(current) if current is not None else None)==row["preview_git_blob"]
 raw=subprocess.run(["git","show",tree+":"+path],cwd=O,capture_output=True,check=True).stdout
 assert blob(raw)==row["expected_git_blob"]
 stage=R/"after"/path;stage.parent.mkdir(parents=True,exist_ok=True);stage.write_bytes(raw)
 if current is not None:
  before=R/"before"/path;before.parent.mkdir(parents=True,exist_ok=True);before.write_bytes(current)
 row["before_sha256"]=sha(current) if current is not None else None;row["after_sha256"]=sha(raw)
plan={"state":"STAGED","combined_tree":tree,"base":"acd173eae60e1559c87603aee8fa70e35e661b65","changes":changes,"effects":"Only seven exact protected/composed source files in non-Git preview; no managed branch source changes."}
(R/"plan.json").write_text(json.dumps(plan,indent=2)+"\n")
for row in changes:
 p=P/row["path"];current=p.read_bytes() if p.exists() else None
 assert (sha(current) if current is not None else None)==row["before_sha256"]
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((R/"after"/row["path"]).read_bytes())
entries=subprocess.run(["git","ls-tree","-rz",tree,"terminal"],cwd=O,capture_output=True,text=True,check=True).stdout.split("\0")
verified={}
for item in entries:
 if not item:continue
 meta,path=item.split("\t",1);mode,kind,expected=meta.split(" ")
 if kind!="blob" or path.startswith(("terminal/docs/","terminal/design_refs/")):continue
 raw=(P/path).read_bytes();assert blob(raw)==expected,path;verified[path]={"git_blob":expected,"sha256":sha(raw)}
(R/"source-manifest-after.json").write_text(json.dumps(verified,indent=2)+"\n")
plan.update(state="APPLIED",verified_files=len(verified),applied_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),source_manifest_sha256=sha((R/"source-manifest-after.json").read_bytes()))
(R/"plan.json").write_text(json.dumps(plan,indent=2)+"\n");print(json.dumps(plan,indent=2))
