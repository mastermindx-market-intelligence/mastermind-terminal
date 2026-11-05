from pathlib import Path
import hashlib,json,subprocess,shutil
B=Path("/Volumes/Mastermind/agent-workspaces/terminal/web");O=B/"options-workspace-surface-flow-ux-20261103-c3";E=B/"exposure-strike-workspace-ux-20261103-c3";P=E/"terminal/.next/options-completion-preview-0vgroh6i/tree";W=O/"terminal/.next/options-source-reconcile-20261105"
HEAD="0182a45abccb9c0e77b2c8e4626431e89635b35f";OLD="98ffa891116ccc9e6be58a64148dbe45591e6ce8";BASE="11531481b0a540ee96bcd86df418fd1e42715363"
sha=lambda b:hashlib.sha256(b).hexdigest()
def blob(root,ref,rel,required=True):
 p=subprocess.run(["git","cat-file","blob",ref+":"+rel],cwd=root,capture_output=True)
 if required:assert p.returncode==0,(ref,rel)
 return p.stdout if p.returncode==0 else None
assert subprocess.check_output(["git","rev-parse","HEAD"],cwd=O,text=True).strip()==OLD
runtime={
"terminal/components/gexdesk/GexDeskView.tsx":"770ddedbe67516359a1f8d29f1ce28a7cc89b63e16dba87071b84609fc04b544",
"terminal/components/gexdesk/ExposureWorkspace.module.css":"bf8a7d85fc594d9666e97445fde47e36cd64c4f6fc6883a75102d25115666158",
"terminal/components/gexdesk/GexHistory.tsx":"98cee19d83f754a4c6afb7b152576cfb9c1a52e7532e937bd52e8600a98bcdc9",
"terminal/components/gexdesk/MarketStateCard.tsx":"d197f5d243c3c998d6550717ddf18fa4f74658ec877ac0178139b0a6b894f09f",
"terminal/components/gexdesk/StrikeLadder.tsx":"d5e73cded2c40be7566af46bd6314c8938f9acdd2fdd9bd4c7575cba5e8a7b33",
"terminal/components/gexdesk/gexStrings.ts":"76ae4a42bdd91378006315e4c1b972d8548aa771843aae1fcc4aa5ca069b3637",
"terminal/components/eodcontext/EodContextBelt.tsx":"7be644f8b402b36a0e6bf066a3f0c8bf7e8b4ffc743b6393ac3edf4f94003060",
"terminal/components/researchlab/AdmittedOptionsResearchLab.tsx":"b5d53a1a443cd81e7598826181327777fec1d3fd52879b75a23fd6fceeaba6f8",
"terminal/lib/useMediaQuery.ts":"ed7b4262fefaa2a9e4aba12916fdfe23224612f5523a3eefd5649b10a65e9eaf"}
harness={
"terminal/e2e/tools/capture_gex_levels_heatmap_load_failure.cjs":"f6c52d0666cee5a497d0836ec8e9c8eb05a9ba51fad63ba9f443d623ad99bc28",
"terminal/e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs":"53aa8d13b25e9d2a6051a4ec79ef23ffb79ba5673b4bfdba4407b15b075cb094"}
test={"terminal/lib/__tests__/researchLabSourceAvailability.test.tsx":"12093c6d15f90b3d3bfe9b37e31308508bd2d9df6305ca8cd802621b6f3792ea"}
changes={}
for rel,digest in {**runtime,**test}.items():
 data=blob(E,HEAD,rel);assert sha(data)==digest==sha((P/rel).read_bytes())
 current=(O/rel).read_bytes() if (O/rel).exists() else None
 allowed=[blob(O,ref,rel,False) for ref in [OLD,BASE]]
 assert current in allowed,("UNEXPECTED_CURRENT_SOURCE",rel)
 changes[rel]=(data,current)
for rel,digest in harness.items():
 data=(P/rel).read_bytes();assert sha(data)==digest
 changes[rel]=(data,(O/rel).read_bytes())
visual=json.loads((W/"visual-vi/source-before.json").read_text())
for rel,digest in visual.items():assert sha((O/rel).read_bytes())==sha((P/rel).read_bytes())==digest,rel
backup=W/"accepted-exposure-dependency-before";assert not backup.exists();backup.mkdir()
record={"schema":"options_exposure_dependency_port.v1","reason":"Six real mobile Retry visibility/interception failures with older Gex and the Options header; integrate accepted compatible Exposure implementation.","accepted_head":HEAD,"options_parent":OLD,"protected_base":BASE,"files":[],"visual_117_unchanged":True}
for rel,(data,current) in changes.items():
 if current is not None:
  target=backup/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(current)
 (O/rel).parent.mkdir(parents=True,exist_ok=True);(O/rel).write_bytes(data)
 record["files"].append({"path":rel,"before_sha256":sha(current) if current is not None else None,"after_sha256":sha(data),"source":"combined native harness" if rel in harness else "accepted Exposure018"})
for rel,digest in visual.items():assert sha((O/rel).read_bytes())==sha((P/rel).read_bytes())==digest,rel
assert sha((O/"terminal/components/OptionsHubView.tsx").read_bytes())=="44b4889738d258d69af37b0a00ad9e152290a3aa950bd076b1e829972666d7a3"
(W/"accepted-exposure-dependency.json").write_text(json.dumps(record,indent=2)+"\n")
print(json.dumps({"runtime_ports":len(runtime),"native_harness_ports":len(harness),"source_availability_test":len(test),"visual_source_contract_unchanged":True,"receipt_sha256":sha((W/"accepted-exposure-dependency.json").read_bytes())}))
