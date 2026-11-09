from pathlib import Path
import hashlib,json,os,re,socket,subprocess,datetime
B=Path("/Volumes/Mastermind/agent-workspaces/terminal/web");O=B/"options-workspace-surface-flow-ux-20261103-c3";P=B/"exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree";T=O/"terminal";W=T/".next/options-source-reconcile-20261105"
FONT=P/"terminal/.next/test-fonts/google-responses-offline-20261104.cjs"
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(FONT)=="0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd"
visual=json.loads((W/"visual-source-equality-navigation-r4.json").read_text())["vi"]["paths"]
paths=set(visual)
for kind in ["gex","eod"]:paths.update(json.loads((W/("native-preview-"+kind+".json")).read_text())["source_sha256"])
for row in json.loads((W/"accepted-exposure-dependency.json").read_text())["files"]:
 if "/__tests__/" not in row["path"]:paths.add(row["path"])
for directory,names in json.loads((W/"native-source-supplement.json").read_text()).items():
 for name in names:paths.add(directory+"/"+name)
paths.update(["terminal/app/layout.tsx","terminal/app/(shell)/layout.tsx","terminal/app/(shell)/options/page.tsx"])
paths.update(json.loads((W/"options-eager-style-dependencies-navigation-r4.json").read_text())["ordered_style_sources"])
mapPath="terminal/components/exposure-map/ExposureMap.tsx";assert mapPath not in paths
excluded={"path":mapPath,"original_sha256":"52dcb7e81d556e2239454dae822458236430737f55877bb5bd3b21465aa2e349","peer_sha256":"099b71567187d5509182d9cbee9be3d44b584bf1202748df8a6f92a48e0a5c11","native_route":"/options?tab=gex","native_initial_view":"strike","excluded_view":"chart","reason":"Native GEX ladder/rail cases never select Chart; both precise source identities are retained outside the native scene qualification."}
contract={"schema":"options_exposure_native_contract.v1","protectedBase":"11531481b0a540ee96bcd86df418fd1e42715363","optionsParent":"98ffa891116ccc9e6be58a64148dbe45591e6ce8","acceptedExposureHead":"0182a45abccb9c0e77b2c8e4626431e89635b35f","visual_contract_sha256":sha(W/"visual-source-contract-navigation-r4.json"),"sources":sorted(paths),"excluded_chart_branch":excluded,"offline_font_sha256":sha(FONT),"scope":"138 visual ancestor inputs plus native declarations, accepted Exposure dependencies, and conservative imported ancestors. All33 owned styles are included. One original Options native run qualifies identical exercised source profiles; unselected Chart code remains outside native proof and requires separately bound browser journeys."}
contractPath=W/"native-source-contract-navigation-r4.json"
if contractPath.exists():assert json.loads(contractPath.read_text())==contract,"CONTRACT_CHANGED"
else:contractPath.write_text(json.dumps(contract,indent=2)+"\n")
def sources(root):return {rel:sha(root/rel) for rel in sorted(paths)}
def whole(root):
 names=subprocess.check_output(["rg","--files","terminal/app","terminal/components","terminal/lib"],cwd=root,text=True).splitlines()
 selected=sorted(p for p in names if "/__tests__/" not in p and not re.search(r"\.(?:test|spec)\.",p) and Path(p).suffix in [".ts",".tsx",".css",".js",".cjs",".mjs",".json"])
 return {rel:sha(root/rel) for rel in selected}
assert sources(O)==sources(P),"QUALIFIED_SOURCE_PROFILES_DIFFER"
assert sha(O/mapPath)==excluded["original_sha256"] and sha(P/mapPath)==excluded["peer_sha256"]
print("NATIVE_CONTRACT",len(paths),sha(contractPath),flush=True)
for kind,packet,expected,port in [("gex","gex-levels-heatmap-load-failure",114,3675),("eod","eod-heatmap-flowdesk-load-failure",126,3677)]:
 with socket.socket() as sock:sock.settimeout(1);assert sock.connect_ex(("127.0.0.1",port))!=0,("OWNED_PORT_ACTIVE",port)
 prefix="native-options-navigation-r4-"+kind;out=W/prefix;log=W/(prefix+".log");assert not out.exists() and not log.exists();out.mkdir()
 before=sources(O);peerBefore=sources(P);wholeBefore=whole(O);wholePeerBefore=whole(P);assert before==peerBefore
 snapshots={"source-before.json":before,"peer-source-before.json":peerBefore,"whole-original-source-before.json":wholeBefore,"whole-peer-source-before.json":wholePeerBefore}
 for name,values in snapshots.items():(out/name).write_text(json.dumps(values,indent=2)+"\n")
 harness=T/"e2e/tools"/("capture_gex_levels_heatmap_load_failure.cjs" if kind=="gex" else "capture_eod_heatmap_flowdesk_load_failure.cjs")
 match=re.search(r"const LAYOUT_FILES = \[([\s\S]*?)\];",harness.read_text());assert match
 layout=re.findall(r'"(terminal/[^"]+)"',match.group(1))
 env=os.environ.copy()
 for key in ["CAPTURE_ONLY","UPDATE_HEATMAP_EVIDENCE","TERMINAL_EVIDENCE_COMPOSITION","TERMINAL_EVIDENCE_MODE"]:env.pop(key,None)
 env.update({"NEXT_FONT_GOOGLE_MOCKED_RESPONSES":str(FONT),"NODE_OPTIONS":"--no-experimental-webstorage","TERMINAL_CROP_OUTPUT_DIR":str(out),"TERMINAL_CROP_PORT":str(port),"TERMINAL_CROP_WEBPACK":"1"})
 command=["node",str(harness)]
 print("NATIVE_START",kind,port,len(paths),flush=True)
 with log.open("x") as output:result=subprocess.run(command,cwd=T,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=1500)
 after=sources(O);peerAfter=sources(P);wholeAfter=whole(O);wholePeerAfter=whole(P)
 for name,values in {"source-after.json":after,"peer-source-after.json":peerAfter,"whole-original-source-after.json":wholeAfter,"whole-peer-source-after.json":wholePeerAfter}.items():(out/name).write_text(json.dumps(values,indent=2)+"\n")
 images=sorted(p for p in out.glob("*.png") if not p.name.startswith("FAIL-"));failed=sorted(p.name for p in out.glob("FAIL-*.png"))
 stable=before==after and peerBefore==peerAfter and wholeBefore==wholeAfter and wholePeerBefore==wholePeerAfter
 record={"schema":"options_exposure_native.v1","profile":"combined","operation":"combined-source-compatibility-20261105","capture_revision":"options-navigation-r4","captured_tree":"original Options managed workspace incorporating accepted Exposure dependency","protectedBase":contract["protectedBase"],"optionsPublishedParent":contract["optionsParent"],"exposureHead":contract["acceptedExposureHead"],"kind":kind,"packet":packet,"expected":expected,"exit":result.returncode,"successful_files":len(images),"failed_frames":failed,"source_stable":stable,"source_equal_combined":before==peerBefore and after==peerAfter,"source_sha256":after,"source_count":len(paths),"source_contract_sha256":sha(contractPath),"source_snapshot_sha256":{p.name:sha(p) for p in sorted(out.glob("*source*.json"))},"excluded_chart_branch":excluded,"offline_font_sha256":sha(FONT),"layout_sources":layout,"command":command,"output_directory":str(out),"completed_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"log_sha256":sha(log),"image_sha256":{p.name:sha(p) for p in images},"native_manifest_sha256":sha(out/"EVIDENCE.yml") if (out/"EVIDENCE.yml").exists() else None}
 (W/(prefix+".json")).write_text(json.dumps(record,indent=2)+"\n")
 print("NATIVE_RESULT",json.dumps({k:record[k] for k in ["kind","exit","successful_files","failed_frames","source_stable","source_equal_combined","source_count"]}),flush=True)
 assert result.returncode==0 and len(images)==expected and not failed and stable and record["source_equal_combined"] and record["native_manifest_sha256"],"CAPTURE_REQUIRES_RECONCILIATION"
print("ORIGINAL_OPTIONS_FULL_NATIVE_PASS",240,flush=True)
