from pathlib import Path
import hashlib,json,os,shutil,subprocess,sys
import yaml
P=Path(__file__).resolve().parent
mode=sys.argv[1];assert mode in ("original","preview")
T=P.parents[1] if mode=="original" else P/"tree/terminal"
R=P/("original-lab-integration-20261104" if mode=="original" else "protected4df-20261104")
OP="exposure-1243-lab-source-gate-20261104" if mode=="original" else "options-combined-4df-lab-source-gate-20261104"
KEY="labSourceGateRecapture20261104"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def section(text,key):
 marker="\n"+key+":\n";assert text.count(marker)==1,key
 tail=key+":\n"+text.split(marker,1)[1];lines=tail.splitlines(keepends=True)
 import re
 end=next((i for i,l in enumerate(lines) if i>0 and re.match(r"^[A-Za-z][\w-]*:",l)),len(lines))
 return "".join(lines[:end])
def header_replace(text,mapping):
 start=text.index("layoutFiles:\n")+len("layoutFiles:\n");lines=[]
 for line in text[start:].splitlines(keepends=True):
  if not line.startswith("  "):break
  lines.append(line)
 old="".join(lines);new=""
 for line in lines:
  key=line.strip().split(": ",1)[0];assert key in mapping,key
  new+='  '+key+': "'+mapping[key]+'"\n'
 return text[:start]+new+text[start+len(old):]
def source_map(d):return {x:sha(T.parent/x) for x in d}
head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=P.parents[1],text=True).strip()
assert head=="04afd94cb11649820688912cf23df2f3b0a5b2c3",("HEAD_MOVED",head)
records=json.loads((R/"gate-fixed-capture-results.json").read_text())
assert len(records)==2
plans=[]
for rec in records:
 kind=rec["kind"];packet=T/"docs/pr-crops"/rec["packet"];manifest=packet/"EVIDENCE.yml";before=manifest.read_text();doc=yaml.safe_load(before)
 assert "\n"+KEY+":\n" not in before,"ALREADY_PROMOTED"
 assert rec["mode"]==mode and rec["exit"]==0 and rec["source_stable"] and not rec["failed_frames"]
 expected=54 if kind=="gex" else 42
 assert rec["successful_files"]==expected==rec["expected"]
 assert rec["source_sha256"]==source_map(rec["source_sha256"]),"POST_CAPTURE_SOURCE_DRIFT"
 out=R/("gate-fixed-capture-"+kind)
 names=sorted(n for n in doc["files"] if n.startswith(kind+"-"))
 assert len(names)==expected and sorted(rec["image_sha256"])==names
 for name in names:
  assert sha(out/name)==rec["image_sha256"][name]
  assert (out/name).read_bytes()[:8]==bytes.fromhex("89504e470d0a1a0a")
  assert (out/name).stat().st_size>1000
 oldroot={n:sha(packet/n) for n in sorted(doc["files"])}
 op=packet/"operations"/OP;assert not op.exists(),("EXISTING_OPERATION_RECONCILE",op)
 layout=source_map(doc["layoutFiles"])
 drift={k:(doc["layoutFiles"][k],layout[k]) for k in layout if doc["layoutFiles"][k]!=layout[k]}
 assert set(drift)=={"terminal/components/gexdesk/GexDeskView.tsx"},("UNEXPECTED_ACTIVE_HEADER_DRIFT",drift)
 harness="terminal/e2e/tools/"+("capture_gex_levels_heatmap_load_failure.cjs" if kind=="gex" else "capture_eod_heatmap_flowdesk_load_failure.cjs")
 baseline=None
 if mode=="preview":
  baseline=json.loads((R/("capture-"+kind+".json")).read_text())
  assert baseline["exit"]==0 and baseline["source_stable"] and not baseline["failed_frames"]
  assert sorted(baseline["image_sha256"])==sorted(doc["files"])
  changed=[k for k,v in baseline["source_sha256"].items() if sha(T.parent/k)!=v]
  assert changed==["terminal/components/gexdesk/GexDeskView.tsx"],("UNEXPECTED_BASELINE_SOURCE_DRIFT",changed)
  for n,h in baseline["image_sha256"].items():assert sha(R/("capture-"+kind)/n)==h
 plans.append((rec,packet,manifest,before,doc,op,layout,harness,names,oldroot,baseline))
print("PROMOTION_PREFLIGHT",mode,len(plans),flush=True)
applied=[]
for rec,packet,manifest,before,doc,op,layout,harness,names,oldroot,baseline in plans:
 kind=rec["kind"];op.mkdir()
 (op/"EVIDENCE.before.yml").write_text(before)
 assert sha(op/"EVIDENCE.before.yml")==hashlib.sha256(before.encode()).hexdigest()
 (op/"prior-root-sha256.json").write_text(json.dumps(oldroot,indent=2)+"\n")
 shutil.copytree(R/("gate-fixed-capture-"+kind),op/"gate-fixed")
 shutil.copy2(R/("gate-fixed-capture-"+kind+".json"),op/"capture-receipt.json")
 shutil.copy2(R/("gate-fixed-capture-"+kind+".log"),op/"capture.log")
 active=dict(oldroot)
 if mode=="preview":
  prior=op/"prior-root";prior.mkdir()
  for name in oldroot:shutil.copy2(packet/name,prior/name)
  shutil.copytree(R/("capture-"+kind),op/"baseline-before-gate")
  shutil.copy2(R/("capture-"+kind+".json"),op/"baseline-receipt.json")
  shutil.copy2(R/("capture-"+kind+".log"),op/"baseline.log")
  active=dict(baseline["image_sha256"]);active.update(rec["image_sha256"])
  for name in active:
   src=op/("gate-fixed" if name in rec["image_sha256"] else "baseline-before-gate")/name
   shutil.copy2(src,packet/name)
  assert all(sha(packet/n)==h for n,h in active.items())
  assert all(sha(prior/n)==h for n,h in oldroot.items())
 rel="operations/"+OP
 lines=[KEY+":",
 '  scope: "'+("original-exposure-branch" if mode=="original" else "source-composed-preview-not-released")+'"',
 '  originalParentHead: "'+head+'"',
 '  protectedBase: "4df7aad16ea775ad8112858a5095210c076efe08"',
 '  optionsHead: "98ffa891116ccc9e6be58a64148dbe45591e6ce8"',
 '  outputDir: "'+rel+'/gate-fixed"',
 '  priorManifestPath: "'+rel+'/EVIDENCE.before.yml"',
 '  priorManifestSha256: "'+sha(op/"EVIDENCE.before.yml")+'"',
 '  captureReceiptSha256: "'+sha(op/"capture-receipt.json")+'"',
 '  captureLogSha256: "'+sha(op/"capture.log")+'"',
 '  currentCaptureHarnessSha256: "'+sha(T.parent/harness)+'"',
 '  captureSelector: "^'+kind+'-"',
 '  actualCases: '+str(len(names)),
 '  failedCases: 0',
 '  sourceStableAcrossCapture: true',
 '  packetRootCrops: "'+("preserved at prior committed bytes" if mode=="original" else "composed from the full 4df baseline and the affected gate-fixed recapture")+'"',
 '  captureSourceSha256:',
 *['    '+k+': "'+v+'"' for k,v in sorted(rec["source_sha256"].items())],
 '  cropSha256:',
 *['    '+k+': "'+v+'"' for k,v in sorted(rec["image_sha256"].items())],
 ]
 if mode=="preview":
  unaffected={k:v for k,v in baseline["image_sha256"].items() if k not in rec["image_sha256"]}
  lines+=['  baselineManifestPath: "'+rel+'/baseline-before-gate/EVIDENCE.yml"',
  '  baselineReceiptSha256: "'+sha(op/"baseline-receipt.json")+'"',
  '  priorRootArchive: "'+rel+'/prior-root"',
  '  priorRootImageCount: '+str(len(oldroot)),
  '  unaffectedImageCount: '+str(len(unaffected)),
  '  unaffectedSourceDecision: "Only GexDeskView changed after the full baseline; Levels, Chain Heat, Flow Desk and Heatmap source families are unchanged."',
  '  activeCropSha256:',*['    '+k+': "'+v+'"' for k,v in sorted(active.items())]]
 updated=header_replace(before,layout).rstrip("\n")+"\n\n"+"\n".join(lines)+"\n"
 for k in doc:
  if k in ["exposureHierarchyRecapture","currentBaseCapture20261104","commandChainHeatFollowup","integratedSourceQualification20261104"]:
   assert section(updated,k)==section(before,k),("HISTORICAL_SECTION_CHANGED",k)
 manifest.write_text(updated)
 assert yaml.safe_load(updated)["layoutFiles"]==layout
 assert sha(op/"EVIDENCE.before.yml")==hashlib.sha256(before.encode()).hexdigest()
 if mode=="original":assert oldroot=={n:sha(packet/n) for n in oldroot}
 result={"mode":mode,"kind":kind,"operation":str(op),"priorManifestSha256":sha(op/"EVIDENCE.before.yml"),"manifestSha256":sha(manifest),"nativeAffectedImages":len(names),"activeRootImages":len(active),"historicalSectionsUnchanged":True}
 applied.append(result);print("PROMOTED",json.dumps(result),flush=True)
(R/"gate-capture-promotion.json").write_text(json.dumps(applied,indent=2)+"\n")
