from pathlib import Path
import hashlib,json,shutil
ROOT=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")
T=ROOT/"terminal";R=T/".next/options-source-reconcile-20261105";P=T/".next/options-completion-preview-0vgroh6i/tree/terminal"
D=T/"docs/verification/exposure-workspace-20261103/source-compatibility-20261105"
assert not D.exists();D.mkdir()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def copy(src,dest):
    dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest);assert sha(src)==sha(dest)
def sources(base):return {"terminal/"+str(f.relative_to(base)):sha(f) for folder in ("app","components","lib","e2e") for f in sorted((base/folder).rglob("*")) if f.is_file()}
for mode,source in [("original",T),("preview",P)]:
    run=R if mode=="original" else R/"preview"
    receipt=json.loads((run/"browser-receipt.json").read_text())
    assert receipt["exit"]==0 and receipt["source_stable"] and receipt["retries"]==0
    assert sources(source)==json.loads((run/"browser-source-after.json").read_text()),("POST_BROWSER_SOURCE_DRIFT",mode)
    for name in ("browser-receipt.json","browser.log","browser-server.log","browser-source-before.json","browser-source-after.json"):
        copy(run/name,D/mode/name)
    out=source/(".next/source-availability-"+mode+"-20261105")
    inventory=[]
    for path in sorted(out.rglob("*")):
        if path.is_file() and path.suffix in (".png",".zip"):
            dest=D/"browser-artifacts"/mode/path.relative_to(out)
            copy(path,dest)
            inventory.append({"path":str(dest.relative_to(D)),"sha256":sha(dest),"bytes":dest.stat().st_size})
    (D/mode/"browser-artifacts.json").write_text(json.dumps(inventory,indent=2)+"\n")
    print("BROWSER_ARTIFACTS_PACKAGED",mode,len(inventory),sum(x["bytes"] for x in inventory),flush=True)
for name in ("candidate.json","dependency-integration.json","mounted-unit.log","focused-unit.log","focused-unit.json","typescript-initial.log","typescript-after-idb.log","final-evidence.log","final-lint.log","final-typescript.log","final-static.json","authored-lint.log","lint-scope.json"):
    copy(R/name,D/"original"/name)
for name in ("affected-upstream-unit.log","affected-upstream-unit.json","composition-update.json"):
    copy(R/"preview"/name,D/"preview"/name)
for name in ("capture-original.py","verify-browser.py","promote-evidence.py"):
    copy(R/name,D/"reproduction"/name)
runtime=["components/gexdesk/GexDeskView.tsx","components/researchlab/OptionsResearchLab.tsx","components/options-companion/GexMarketMemory.tsx","components/researchlab/ResearchReportedGammaPanel.tsx","components/researchlab/researchReportedGamma.ts","lib/dataCache.ts","lib/idbJsonStore.ts"]
hashes={"terminal/"+x:sha(T/x) for x in runtime}
assert all(sha(P/x)==hashes["terminal/"+x] for x in runtime)
capture=[]
for family in ("gex-levels-heatmap-load-failure","eod-heatmap-flowdesk-load-failure"):
    op=T/"docs/pr-crops"/family/"operations/exposure-source-compatibility-20261105"
    native=json.loads((op/"capture-receipt.json").read_text())
    assert native["exit"]==0 and native["source_stable"] and not native["failed_frames"]
    capture.append({"packet":family,"operation_path":str(op.relative_to(T)),"current_images":native["successful_files"],"capture_receipt_sha256":sha(op/"capture-receipt.json"),"current_manifest_sha256":sha(op/"qualified-root/EVIDENCE.yml"),"prior_manifest_sha256":sha(op/"EVIDENCE.before.yml"),"preserved_prior_images":len(json.loads((op/"prior-root-sha256.json").read_text()))})
qualification={"schema":"options_exposure_source_compatibility.v1","status":"SOURCE_AND_BROWSER_QUALIFIED_PENDING_TYPED_PUBLICATION","source_law":"70187bb1660e8a7c3038271bb9f8924b5e525cb0","protected_terminal":"11531481b0a540ee96bcd86df418fd1e42715363","original_operation":"exposure-strike-workspace-ux-20261103-c3","original_parent":"e9fa843122ac0eee36d607b8313e0bb264bed840","options_head":"98ffa891116ccc9e6be58a64148dbe45591e6ce8","paper":"Six accepted boards preserved; no design mutation.","runtime_sha256":hashes,"runtime_identical_original_and_preview":True,"original":{"browser_passed":12,"browser_retries":0,"focused_unit_passed":210,"evidence_passed":23,"source_typescript_exit":0,"authored_lint_exit":0,"broader_lint_scope":"61 errors and10 warnings remain in three byte-identical protected dependency files; complete diagnostics retained, no suppression."},"preview":{"browser_passed":18,"browser_retries":0,"source_files":3113,"affected_unit_passed":338,"source_map_sha256":sha(R/"preview/browser-source-after.json"),"capture_scope":"Prior4df capture matrices retain their historical identities; this phase claims new combined browser proof only."},"native_captures":capture,"conflict_repair":{"known_original_conflict_paths":15,"gex_diff3_exit":0,"manifest_diff3_exits":[0,0],"root_png_resolution":"Protected baseline restored exactly; every former original root PNG preserved under its original packet operation.","ancestry_effect":"None. Ordinary source repair uses the original single-parent publisher. Exact committed-tree composition is recorded in the PR after publication."},"effect_reconciliation":{"transient_network_error":"Original evidence-preservation call returned connection failure; original targets were verified absent on the same unchanged gateway generation before one same-carrier continuation. Both preserved sets then completed and were hash-verified.","owned_test_ports_closed":[3661,3663,3671,3673]},"release_holds":["no merge","no enqueue","no Ready or undraft action","no labels","no deployment","no purchases","no alternate publisher"],"next_action":"Commit and push this qualified source repair through the original C3 operation, read exact GitHub head/native checks, then resolve Options PR1248 remaining four evidence conflicts and joint proof."}
(D/"qualification.json").write_text(json.dumps(qualification,indent=2)+"\n")
print("QUALIFICATION_PACKAGED",str(D),sha(D/"qualification.json"),flush=True)
