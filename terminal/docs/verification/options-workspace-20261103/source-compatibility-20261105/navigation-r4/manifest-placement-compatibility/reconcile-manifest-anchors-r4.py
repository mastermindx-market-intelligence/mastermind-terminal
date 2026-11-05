from pathlib import Path
import datetime,gzip,hashlib,json,subprocess
O=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");E=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3");W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105")
R=W/"manifest-anchor-compatibility-r4";assert not R.exists()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
nativeRel="terminal/lib/__tests__/helpers/optionsExposureEvidence.ts";visualRel="terminal/lib/__tests__/helpers/optionsVisualEvidence.ts";testRel="terminal/lib/__tests__/optionsExposureEvidence.test.ts"
native=(O/nativeRel).read_text();visual=(O/visualRel).read_text();test=(O/testRel).read_text()
assert all((root/nativeRel).read_text()==native for root in [O,P,E]) and sha(O/nativeRel)=="f78863fb9d4d65a1ca4c6bf6d0b604e8ff20148d3319614163f8377ed2c4a836"
assert (P/visualRel).read_text()==visual and sha(O/visualRel)=="b2248fe06eca6cfb0e6ffd67a6cd12c02f0e0da4c8cd318b4ab71cb3a9e680f5"
assert all((root/testRel).read_text()==test for root in [O,P,E])
captured="bb09d98f2bf2647a1975dac07a0e85ab673473986145a1db0d30f22d38e5c076";successor="de74d9150283eb9dd5243b57c4ee597171d50f328be749d6c43ba8287a6f4525"
config=(O/"terminal/playwright.config.ts").read_bytes();protectedConfig=subprocess.check_output(["git","-C",str(O),"cat-file","blob","a6a0f8d5938b92af3744a4ee9a8945bbb9ecfcd6"])
assert hashlib.sha256(config).hexdigest()==captured and hashlib.sha256(protectedConfig).hexdigest()==successor
needle=b'      FLOW_FIXTURE: "1",\n';addition=b'      // The Investigation API admission gate (lib/investigationApiAdmission.ts) reads the\n      // exact literal "open" per request. This dev-server-only env block opts the fixture\n      // origin in; production never receives the value, so the unset default stays closed.\n      INVESTIGATION_API_ADMISSION: "open",\n'
assert config.count(needle)==1 and config.replace(needle,needle+addition)==protectedConfig
captureMaps=[]
for kind in ["gex","eod"]:
 receipt=json.loads((W/("native-options-navigation-r4-"+kind+".json")).read_text());assert receipt["exit"]==0;captureMaps.append(receipt["source_sha256"])
for kind in ["vi","pl6"]:
 receipt=json.loads((W/("visual-navigation-r4-warm-"+kind)/"capture-receipt.json").read_text());assert receipt["exit"]==0;captureMaps.append(receipt["source_sha256"])
for sources in captureMaps:
 assert sources["terminal/playwright.config.ts"]==captured
 assert all(rel not in sources for rel in [nativeRel,visualRel,testRel])
def replace_once(text,before,after):
 assert text.count(before)==1,before
 return text.replace(before,after,1)
native=replace_once(native,"protected baseline above is retained.","protected baseline is retained.")
native=replace_once(native,'  check(text === prefix + readFileSync(protectedPath, "utf8") + suffix, "ROOT_MANIFEST_RECONSTRUCTION");','''  const protectedText = readFileSync(protectedPath, "utf8");
  const anchor = "theme: dark\\n";
  if (options) check(protectedText.split(anchor).length === 2, "ROOT_MANIFEST_ANCHOR");
  const body = options ? protectedText.replace(anchor, suffix + "\\n" + anchor) : protectedText;
  check(text === prefix + body, "ROOT_MANIFEST_RECONSTRUCTION");''')
projection='''/** The pinned r4 executions are equivalent under this exact protected fixture-server default.
 * VI already supplied the value; the native runners do not use Playwright's webServer config.
 * Recorded maps remain immutable and every non-config input still matches the whole capture.
 */
export function projectR4CaptureHarness(recorded: SourceMap, current: SourceMap): SourceMap {
  const path = "terminal/playwright.config.ts";
  const captured = "bb09d98f2bf2647a1975dac07a0e85ab673473986145a1db0d30f22d38e5c076";
  const protectedSuccessor = "de74d9150283eb9dd5243b57c4ee597171d50f328be749d6c43ba8287a6f4525";
  check(recorded[path] === captured, "CAPTURE_HARNESS_RECORDED_SOURCE");
  check(current[path] === captured || current[path] === protectedSuccessor, "CAPTURE_HARNESS_CURRENT_SOURCE");
  return { ...recorded, [path]: current[path] };
}
'''
native=replace_once(native,"export function layoutSources(kind: EvidenceKind, profile: EvidenceProfile): string[] {",projection+"export function layoutSources(kind: EvidenceKind, profile: EvidenceProfile): string[] {")
native=replace_once(native,"  const selected = selectWholeFingerprint(candidates, current);",'''  const qualified = candidates.map(candidate => candidate.profile === "combined"
    ? { ...candidate, sources: projectR4CaptureHarness(candidate.sources, current) } : candidate);
  const selected = selectWholeFingerprint(qualified, current);''')
visual=replace_once(visual,'import { requireSourceKeys } from "./optionsExposureEvidence";','import { projectR4CaptureHarness, requireSourceKeys } from "./optionsExposureEvidence";')
visual=replace_once(visual,"protected baseline above is retained.","protected baseline is retained.")
visual=replace_once(visual,'  check(readFileSync(join(root, "EVIDENCE.yml"), "utf8") === protectedText + footer, "ROOT_RECONSTRUCTION");','''  const anchor = "\\ncurrentLocalGates:\\n";
  check(protectedText.split(anchor).length === 2, "ROOT_ANCHOR");
  check(readFileSync(join(root, "EVIDENCE.yml"), "utf8") ===
    protectedText.replace(anchor, footer + anchor), "ROOT_RECONSTRUCTION");''')
visual=replace_once(visual,'  for (const [path, digest] of Object.entries(receipt.source_sha256)) check(sha(join(repo, path)) === digest, "CURRENT_SOURCE:" + path);','''  const current = Object.fromEntries(Object.keys(receipt.source_sha256).map(path => [path, sha(join(repo, path))]));
  const qualifiedSources = projectR4CaptureHarness(receipt.source_sha256, current);
  for (const [path, digest] of Object.entries(qualifiedSources)) check(current[path] === digest, "CURRENT_SOURCE:" + path);''')
test=replace_once(test,"{ layoutSources, requireSourceKeys, selectWholeFingerprint }","{ layoutSources, projectR4CaptureHarness, requireSourceKeys, selectWholeFingerprint }")
test+='''

describe("the recorded r4 fixture-server configuration transition", () => {
  const path = "terminal/playwright.config.ts";
  const captured = "bb09d98f2bf2647a1975dac07a0e85ab673473986145a1db0d30f22d38e5c076";
  const successor = "de74d9150283eb9dd5243b57c4ee597171d50f328be749d6c43ba8287a6f4525";
  const recorded = Object.freeze({ "Gex.tsx": a, [path]: captured });
  it("preserves the actual recorded configuration and source map", () => {
    expect(projectR4CaptureHarness(recorded, recorded)).toEqual(recorded);
  });
  it("admits only the protected fixture default without rewriting historical inputs", () => {
    const current = { ...recorded, [path]: successor };
    const sources = projectR4CaptureHarness(recorded, current);
    expect(selectWholeFingerprint([{ sources }], current).sources).toEqual(current);
    expect(recorded[path]).toBe(captured);
  });
  it("rejects a third current configuration", () => {
    expect(() => projectR4CaptureHarness(recorded, { ...recorded, [path]: c }))
      .toThrow("CAPTURE_HARNESS_CURRENT_SOURCE");
  });
  it("rejects a changed or missing recorded configuration", () => {
    expect(() => projectR4CaptureHarness({ ...recorded, [path]: successor }, recorded))
      .toThrow("CAPTURE_HARNESS_RECORDED_SOURCE");
    expect(() => projectR4CaptureHarness({ "Gex.tsx": a }, recorded))
      .toThrow("CAPTURE_HARNESS_RECORDED_SOURCE");
  });
  it("does not accept a successor at another path or a missing current key", () => {
    expect(() => projectR4CaptureHarness(recorded, { "Gex.tsx": a, "other.config.ts": successor }))
      .toThrow("CAPTURE_HARNESS_CURRENT_SOURCE");
  });
  it("still rejects changed runtime inputs after the exact harness transition", () => {
    const current = { ...recorded, [path]: successor, "Gex.tsx": b };
    const sources = projectR4CaptureHarness(recorded, current);
    expect(() => selectWholeFingerprint([{ sources }], current)).toThrow("NO_QUALIFIED_CAPTURE");
  });
});
'''
mutations=[]
for root in [O,P,E]:
 mutations.append((root/nativeRel,native))
 mutations.append((root/testRel,test))
for root in [O,P]:mutations.append((root/visualRel,visual))
packets=[("gex","gex-levels-heatmap-load-failure",True),("eod","eod-heatmap-flowdesk-load-failure",True),("vi","terminal-visual-intelligence",False),("pl6","b-pl-6-batch-1",False)]
manifestPlans=[]
for kind,packet,isNative in packets:
 rel="terminal/docs/pr-crops/"+packet+"/EVIDENCE.yml"
 protected=subprocess.check_output(["git","-C",str(O),"cat-file","blob","11531481b0a540ee96bcd86df418fd1e42715363:"+rel]).decode()
 ancestor=subprocess.check_output(["git","-C",str(O),"cat-file","blob","ac3762717ad150fd4f18614afd78072115a7c80a:"+rel]).decode()
 anchor="theme: dark\n" if isNative else "\ncurrentLocalGates:\n";assert protected.count(anchor)==ancestor.count(anchor)==1
 for root in [O,P]:
  text=(root/rel).read_text();assert text.count(protected)==1
  at=text.index(protected);prefix=text[:at];suffix=text[at+len(protected):]
  expected="# Qualified Options and combined source compositions;" if isNative else "# Current Options visual qualification;"
  assert suffix.startswith("\n"+expected) and suffix.count("protected baseline above is retained.")==1 and "revisions/options-navigation-r4/" in suffix
  suffix=suffix.replace("protected baseline above is retained.","protected baseline is retained.")
  updated=prefix+protected.replace(anchor,suffix+("\n" if isNative else "")+anchor)
  mutations.append((root/rel,updated))
  if root==O:manifestPlans.append((kind,rel,ancestor,protected,updated))
R.mkdir();checks=[]
for kind,rel,ancestor,protected,updated in manifestPlans:
 d=R/"merge-file"/kind;d.mkdir(parents=True)
 for name,value in [("ancestor.yml",ancestor),("protected.yml",protected),("candidate.yml",updated)]: (d/name).write_text(value)
 result=subprocess.run(["git","merge-file","-p",str(d/"candidate.yml"),str(d/"ancestor.yml"),str(d/"protected.yml")],capture_output=True,text=True)
 (d/"merge-output.yml").write_text(result.stdout);(d/"merge-stderr.txt").write_text(result.stderr)
 checks.append({"kind":kind,"exit":result.returncode,"merged_equals_candidate":result.stdout==updated})
 assert result.returncode==0 and result.stdout==updated,(kind,"ANCHOR_NOT_MERGE_CLEAN")
(R/"playwright.captured.ts.gz").write_bytes(gzip.compress(config,mtime=0));(R/"playwright.protected.ts.gz").write_bytes(gzip.compress(protectedConfig,mtime=0))
plan={"schema":"options_evidence_placement_and_harness_compatibility.v1","phase":"PREPARED","recorded_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"protected_base":"11531481b0a540ee96bcd86df418fd1e42715363","options_local_source_head":"d00295f149d24914c78fae06140e6a8d4df30ab1","merge_file_checks":checks,"captured_playwright_sha256":captured,"protected_playwright_sha256":successor,"configuration_difference":"Only webServer.env default INVESTIGATION_API_ADMISSION=open plus its three-line comment.","capture_equivalence":"VI supplied this exact environment to its already owned server; PL6 inherited it from the pinned visual driver. GEX/EOD launch Next and Chromium directly and do not consume Playwright webServer configuration.","capture_contracts_receipts_and_images_unchanged":True,"runtime_source_changed":False,"live_config_changed":False,"mutations":[]}
for index,(path,updated) in enumerate(mutations):
 before=path.read_bytes();old=R/"before"/(str(index)+"-"+path.name+".gz");old.parent.mkdir(parents=True,exist_ok=True);old.write_bytes(gzip.compress(before,mtime=0))
 plan["mutations"].append({"path":str(path),"before_sha256":hashlib.sha256(before).hexdigest(),"after_sha256":hashlib.sha256(updated.encode()).hexdigest(),"retained_before":str(old.relative_to(R))})
(R/"qualification.json").write_text(json.dumps(plan,indent=2)+"\n")
for (path,updated),row in zip(mutations,plan["mutations"]):
 assert sha(path)==row["before_sha256"];path.write_text(updated);assert sha(path)==row["after_sha256"]
plan["phase"]="APPLIED";plan["native_reader_sha256"]=sha(O/nativeRel);plan["visual_reader_sha256"]=sha(O/visualRel);plan["selector_tests_sha256"]=sha(O/testRel)
(R/"qualification.json").write_text(json.dumps(plan,indent=2)+"\n")
print(json.dumps({k:v for k,v in plan.items() if k not in ["mutations"]}),flush=True)
