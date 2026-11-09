from pathlib import Path
import datetime,gzip,hashlib,json,shutil
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");O=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree")
D=W/"production-turbopack-navigation-r4";B=W/"browser-turbopack-navigation-r4";C=D/"tree"
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
inputs=json.loads((D/"source-inputs.json").read_text())
assert len(inputs)==3124 and sha(D/"source-inputs.json")=="dd8b4c978741a32f576f08277841dbda3952aeb128c97fa76a73a8a18a38f514"
assert all(sha(C/rel)==digest for rel,digest in inputs.items())
diff={rel:{"captured":digest,"current":sha(P/rel)} for rel,digest in inputs.items() if sha(P/rel)!=digest}
assert set(diff)=={"terminal/e2e/fixtureWarmup.cjs","terminal/lib/__tests__/helpers/optionsExposureEvidence.ts","terminal/lib/__tests__/helpers/optionsVisualEvidence.ts"}
build=json.loads((D/"production-build-http-v2-receipt.json").read_text());browser=json.loads((B/"browser-receipt.json").read_text());fonts=json.loads((D/"font-server-qualification.json").read_text());emitted=json.loads((D/"production-emitted-fonts.json").read_text())
assert build["exit"]==0 and build["owned_process_completed"] and build["canonical_preview_source_unchanged"] and not build["production_browser_authentication_claimed"]
assert browser["exit"]==0 and browser["passed"]==9 and browser["expected"]==9 and not(browser["failed"] or browser["skipped"] or browser["flaky"] or browser["retries"]) and browser["source_stable"] and browser["owned_server_stopped"]
assert sha(B/"source-before.json")==sha(B/"source-after.json")==sha(D/"source-inputs.json")
assert fonts["preflight_all13_hashes_verified"] and fonts["server_closed"] and fonts["original_webpack_fixture_unchanged"]
fontfiles=sorted((D/"font-fixture").glob("*.woff2"));assert len(fontfiles)==13 and emitted["all13_exact_bytes_emitted"]
assert {sha(f) for f in fontfiles}==set(emitted["emitted_fonts"].values())
for rel,digest in emitted["emitted_fonts"].items():assert sha(C/"terminal"/rel)==digest
index=json.loads((B/"playwright-artifacts-sha256.json").read_text());assert len(index)==19 and sha(B/"playwright-artifacts-sha256.json")==browser["artifact_index_sha256"]
art=Path(browser["playwright_output"])
for rel,digest in index.items():assert sha(art/rel)==digest
stage=W/"production-proof-package-r4";assert not stage.exists();stage.mkdir()
copied=[]
def copy(source,destination):
 target=stage/destination;target.parent.mkdir(parents=True,exist_ok=True)
 raw=source.read_bytes()
 compressed=source.suffix in [".log",".ts",".tsx",".mts",".cts"]
 if compressed:
  target=target.with_name(target.name+".gz");target.write_bytes(gzip.compress(raw,mtime=0));assert gzip.decompress(target.read_bytes())==raw
 else:target.write_bytes(raw)
 copied.append({"source":str(source),"stored":str(target.relative_to(stage)),"source_sha256":hashlib.sha256(raw).hexdigest(),"stored_sha256":sha(target),"encoding":"gzip" if compressed else "identity"})
production=["source-inputs.json","build-source-after.json","copy-receipt.json","production-build-http-v2-process.json","production-build-http-v2-receipt.json","production-build-http-v2.log","production-build-process.json","production-build-receipt.json","production-build.log","production-generated-next-env.d.ts","production-emitted-fonts.json","font-fixture-inputs.json","font-preflight-reconciliation.json","font-server-binding.json","font-server-qualification.json","google-responses-turbopack.cjs","prepare-font-fixture-regex-preflight.py","turbopack-browser-driver.log"]
for name in production:copy(D/name,Path("production")/name)
for f in fontfiles:copy(f,Path("production/font-fixture")/f.name)
for name in ["browser-receipt.json","browser-report.json","browser.log","server.log","selection.log","source-before.json","source-after.json","playwright-artifacts-sha256.json","prior-flat-test-results.json"]:copy(B/name,Path("browser")/name)
for rel in index:copy(art/rel,Path("browser/playwright-artifacts")/rel)
for name in ["prepare-production-turbopack-r4.py","prepare-turbopack-http-fixture-r4.py","verify-production-turbopack-r4.py","verify-production-turbopack-http-r4.py","verify-turbopack-browser-r4.py","persist-production-proof-r4.py"]:copy(W/name,Path("drivers")/name)
record={"schema":"options_production_comparability.v1","recorded_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source_count":3124,"captured_input_map_sha256":sha(D/"source-inputs.json"),"isolated_copy_matches_recorded_inputs":True,"current_combined_preview_differences":diff,"combined_preview_production_runtime_unchanged":True,"shared_repair_sources_equal":all(sha(O/rel)==sha(P/rel)==inputs[rel] for rel in ["terminal/components/workspaces/OptionsWorkspace.tsx","terminal/components/OptionsHubView.tsx","terminal/components/exposure-map/ExposureMap.module.css","terminal/next.config.ts"]),"production_build_passed":True,"turbopack_development_browser_passed":9,"authenticated_production_browser_claimed":False,"original_options_whole_tree_equivalence_claimed":False,"raw_logs_losslessly_compressed":True,"files":copied}
(stage/"comparability.json").write_text(json.dumps(record,indent=2)+"\n")
(stage/"README.md").write_text("""# Production compiler and Turbopack navigation proof

The combined preview completed the normal `npm run build` command with Next 16.2.9's default Turbopack compiler, including typechecking and prerendering. The successful build took 87.83 seconds and produced build ID `build-TfctsWXpff2fKS`. The retained receipt binds 3,124 source inputs.

The isolated input copy and the before/after maps for the nine Turbopack development browser cases match exactly. The current combined preview differs only in the expanded chart warm-up helper and the two evidence-reader pins; its production runtime is unchanged at the recorded comparison time. The four shared Options repair files also match the original Options workspace. This packet does not claim whole-tree equivalence with that older source profile.

## Actual browser behavior

All nine cases passed with zero retries, skips or flaky results across desktop, tablet and phone: query navigation and Back/Forward retain visited desks; Structure remains accessible while Exposure assets are held; and Structure remains accessible while Research Lab assets are held. All 19 indexed trace/screenshot artifacts are retained.

These browser cases ran through the Turbopack development server with the existing fixture identity. The production authentication guards remained intact. This is production compilation proof and development browser behavior, not authenticated production browser acceptance.

## Font transport correction

The first production attempt failed because the existing webpack font mock supplies absolute filesystem paths, while Turbopack fetches the returned font URLs through HTTP. Its original failed receipt and log are retained. The corrected fixture served the same 13 WOFF2 payloads on an owned loopback-only server and changed only the transport URLs in a separate Turbopack response map. All 13 emitted production font payloads match the original inputs exactly. The existing webpack font fixture is unchanged, and the temporary HTTP server is closed.

The source maps and historical receipts retain their exact bytes. Raw logs and the generated TypeScript declaration are stored as lossless gzip files, keeping archived inputs outside the application compiler; `comparability.json` records both their original and stored hashes. The packet contains only an explicit evidence allowlist, without the source checkout, dependencies or build cache.
""")
allfiles={str(f.relative_to(stage)):sha(f) for f in sorted(stage.rglob("*")) if f.is_file()}
(stage/"sha256.json").write_text(json.dumps(allfiles,indent=2)+"\n")
rel=Path("terminal/docs/verification/options-workspace-20261103/source-compatibility-20261105/navigation-r4/production-compiler")
for root in [O,P]:assert not(root/rel).exists()
for root in [O,P]:
 shutil.copytree(stage,root/rel)
 for name,digest in allfiles.items():assert sha(root/rel/name)==digest
 assert sha(root/rel/"sha256.json")==sha(stage/"sha256.json")
print(json.dumps({"persisted":str(rel),"files":len(allfiles)+1,"bytes":sum(f.stat().st_size for f in stage.rglob("*") if f.is_file()),"index_sha256":sha(stage/"sha256.json")}),flush=True)
