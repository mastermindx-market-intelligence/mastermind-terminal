from pathlib import Path
import gzip,hashlib,json,re,shutil
O=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105")
BASE="11531481b0a540ee96bcd86df418fd1e42715363";PARENT="98ffa891116ccc9e6be58a64148dbe45591e6ce8";REV="options-navigation-r4"
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
font=P/"terminal/.next/test-fonts/google-responses-offline-20261104.cjs"
configs=[
 ("gex","gex-levels-heatmap-load-failure","combined-source-compatibility-20261105","native-packet.json",114,"0819582a22ef88745e0824280635d704ef9fb00448d037ce2e7c49b46471a8b1"),
 ("eod","eod-heatmap-flowdesk-load-failure","combined-source-compatibility-20261105","native-packet.json",126,"a8d20f42412e10466c5330efc64168190f062cae9075543fe73a050bc992cf52"),
 ("vi","terminal-visual-intelligence","options-source-compatibility-20261105","qualified-packet.json",30,"a1bb93635f18fd35ac838ad44adb1726ed5ca15a3b1a02dd7e9e132f25e7b697"),
 ("pl6","b-pl-6-batch-1","options-source-compatibility-20261105","qualified-packet.json",24,"682d65078275c3424e6ac4101e4737e6263f7f929bb1f9e19f773ede69ccfd55"),
]
prepared=[]
pins=json.loads((W/"navigation-r4-final-source-inputs.json").read_text())
priorPins={"gex":"c9f0aa2c43cb06d0590fb065d7b0a97f019e247c13757cc9a672f665eed12670","eod":"4515093ab9ba4915341a7e163dd4623c4b2698368f4d1988e3d3a8c89135cb42","vi":"3e32136df1246cc6d405d0fd234dc0fbd130b0be48078d07ebef3e1a8a0a9ead","pl6":"22dfe6b7a74d007351e837dd600cecee0652b05bc9d5d831c61d966dfc436381"}
for kind,packet,operation,descriptorName,count,oldDescriptor in configs:
 native=kind in ["gex","eod"]
 captured=W/(("native-options-navigation-r4-" if native else "visual-navigation-r4-warm-")+kind)
 receiptPath=W/("native-options-navigation-r4-"+kind+".json") if native else captured/"capture-receipt.json"
 log=W/("native-options-navigation-r4-"+kind+".log") if native else captured/"capture.log"
 receipt=json.loads(receiptPath.read_text())
 assert receipt["exit"]==0 and receipt["source_stable"] and receipt["capture_revision"]==REV
 assert (receipt["successful_files"]==count and not receipt["failed_frames"] and receipt["source_equal_combined"]) if native else (receipt["passed"]==count and receipt["failed"]==receipt["skipped"]==0 and receipt["source_equal_options"])
 assert receipt["source_count"]==(319 if native else 138)
 for rel,digest in receipt["source_sha256"].items():assert sha(O/rel)==sha(P/rel)==digest,(kind,rel)
 inventory=W/("prior-navigation-r2-"+kind+"-sha256.json");prior=json.loads(inventory.read_text())
 for rel,digest in prior.items():assert sha(O/rel)==sha(P/rel)==digest,(kind,"HISTORY_CHANGED",rel)
 opRel=Path("terminal/docs/pr-crops")/packet/"operations"/operation
 assert sha(O/opRel/descriptorName)==oldDescriptor and sha(P/opRel/descriptorName)==oldDescriptor
 for root in [O,P]:assert not (root/opRel/"revisions"/REV).exists()
 assert receipt["log_sha256"]==sha(log)
 driver=W/("capture-native-navigation-r4-qualified.py" if native else "capture-visual-navigation-r4-warm.py")
 contract=W/("native-source-contract-navigation-r4.json" if native else "visual-source-contract-navigation-r4.json")
 assert sha(driver)==pins["native_driver_sha256" if native else "visual_driver_sha256"]
 assert sha(contract)==pins["native_contract_sha256" if native else "visual_contract_sha256"]==receipt["source_contract_sha256"]
 assert sha(inventory)==priorPins[kind]
 images=receipt["image_sha256"] if native else receipt["images"]
 for name,digest in images.items():assert sha(captured/name)==digest,(kind,name)
 if native:
  assert sha(captured/"EVIDENCE.yml")==receipt["native_manifest_sha256"]
  for name,digest in receipt["source_snapshot_sha256"].items():assert sha(captured/name)==digest,(kind,name)
 else:
  for name in ["source-before.json","source-after.json"]:assert json.loads((captured/name).read_text())==receipt["source_sha256"]
  lex=json.loads((W/"visual-lex-projection.json").read_text());assert receipt["source_sha256"]["terminal/lib/i18n.tsx"]==lex["capturedRawSha256"]
  if kind=="vi":
   assert sha(captured/"browser-report.json")==receipt["browser_report_sha256"]
   report=json.loads((captured/"browser-report.json").read_text());stats=report["stats"]
   assert stats["expected"]==30 and not(stats["unexpected"] or stats["skipped"] or stats["flaky"]) and not report.get("errors")
  else:
   assert sha(captured/"EVIDENCE.yml")==receipt["native_manifest_sha256"]
   declarations=["# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06","# capturedAtHead is informational. The lock is layoutFiles.","capture_flag: TERMINAL_E2E_FIXTURE","viewports:","  - { name: desktop, width: 1440, height: 900 }","  - { name: mobile, width: 390, height: 844 }"]
   for line in declarations:assert line in (captured/"EVIDENCE.yml").read_text(),line
 for root in [O,P]:
  text=(root/"terminal/docs/pr-crops"/packet/"EVIDENCE.yml").read_text()
  assert text.count("operations/"+operation+"/"+descriptorName)==1 and text.count(oldDescriptor)==1
  if native:assert text.count("427c9fcec7a8c53da0c65e62190e7785aea9bd28183be474efaf991f6f558dc1")==1
 if not native:
  baseline=json.loads((O/opRel/"protected-root-sha256.json").read_text())
  for name,digest in baseline.items():
   if name!="EVIDENCE.yml":assert sha(O/"terminal/docs/pr-crops"/packet/name)==digest
 prepared.append((kind,packet,operation,descriptorName,count,oldDescriptor,native,captured,receiptPath,log,receipt,inventory,opRel))
# All four actual captures and both current source profiles are qualified before any pointer moves.
stage=W/"navigation-r4-promotion-staging";assert not stage.exists();stage.mkdir()
summary=[];stagePlans=[];rootPlans=[];rootRestores=[]
for kind,packet,operation,descriptorName,count,oldDescriptor,native,captured,receiptPath,log,receipt,inventory,opRel in prepared:
 d=stage/kind;d.mkdir();q=d/"qualified-root";q.mkdir()
 shutil.copyfile(receiptPath,d/"capture-receipt.json");shutil.copyfile(log,d/"capture.log");shutil.copyfile(inventory,d/"prior-packet-sha256.json")
 shutil.copyfile(W/("capture-native-navigation-r4-qualified.py" if native else "capture-visual-navigation-r4-warm.py"),d/"capture-driver.py")
 shutil.copyfile(W/("native-source-contract-navigation-r4.json" if native else "visual-source-contract-navigation-r4.json"),d/"source-contract.json")
 images=receipt["image_sha256"] if native else receipt["images"]
 for name,digest in images.items():assert sha(captured/name)==digest;shutil.copyfile(captured/name,q/name)
 if native:
  shutil.copyfile(captured/"EVIDENCE.yml",q/"EVIDENCE.yml");shutil.copyfile(font,d/"offline-font-responses.cjs")
  for name,digest in receipt["source_snapshot_sha256"].items():assert sha(captured/name)==digest;shutil.copyfile(captured/name,d/name)
  desc={"schema":"options_exposure_packet.v1","kind":kind,"profile":"combined","operation":operation,"captureRevision":REV,"receipt":"capture-receipt.json","receiptSha256":sha(d/"capture-receipt.json"),"manifest":"qualified-root/EVIDENCE.yml","manifestSha256":sha(q/"EVIDENCE.yml"),"previousPacketInventorySha256":sha(inventory)}
 else:
  for name in ["source-before.json","source-after.json"]:shutil.copyfile(captured/name,d/name)
  if kind=="vi":shutil.copyfile(captured/"browser-report.json",q/"browser-report.json")
  else:shutil.copyfile(captured/"EVIDENCE.yml",q/"EVIDENCE.native.yml")
  lines=["# Qualification wrapper over retained actual producer output; not a native-generated source map.",'protectedBase: "'+BASE+'"','operation: "'+operation+'"','captureRevision: "'+REV+'"',"theme: dark","languages: [en, zh]","qualificationScope: "+("30 actual named browser cases" if kind=="vi" else "20 canonical crops; four DiscoverLeaders captures are supplemental"),"layoutFiles:"]
  lines+=['  '+rel+': "'+digest+'"' for rel,digest in sorted(receipt["source_sha256"].items())]
  lines+=["cropFiles:"]+['  '+name+': "'+digest+'"' for name,digest in sorted(images.items())]
  if kind=="vi":
   lines+=["browserReportPath: browser-report.json","browserReportHashes:",'  visualReport: "'+receipt["browser_report_sha256"]+'"','  mobileCrosshairReport: "'+receipt["browser_report_sha256"]+'"']
  else:
   lines+=["nativeManifestPath: EVIDENCE.native.yml",'nativeManifestSha256: "'+receipt["native_manifest_sha256"]+'"']
   declarations=["# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06","# capturedAtHead is informational. The lock is layoutFiles.","capture_flag: TERMINAL_E2E_FIXTURE","viewports:","  - { name: desktop, width: 1440, height: 900 }","  - { name: mobile, width: 390, height: 844 }"]
   text=(q/"EVIDENCE.native.yml").read_text()
   for line in declarations:assert line in text,line
   lines+=declarations
  lex=json.loads((W/"visual-lex-projection.json").read_text());assert receipt["source_sha256"]["terminal/lib/i18n.tsx"]==lex["capturedRawSha256"]
  lines+=["lexProjection: "+json.dumps(lex,separators=(",",":"))]
  (q/"EVIDENCE.yml").write_text("\n".join(lines)+"\n")
  desc={"schema":"options_visual_packet.v1","kind":kind,"operation":operation,"captureRevision":REV,"driverSha256":sha(d/"capture-driver.py"),"receipt":"capture-receipt.json","receiptSha256":sha(d/"capture-receipt.json"),"manifest":"qualified-root/EVIDENCE.yml","manifestSha256":sha(q/"EVIDENCE.yml"),"sourceBeforeSha256":sha(d/"source-before.json"),"sourceAfterSha256":sha(d/"source-after.json"),"previousPacketInventorySha256":sha(inventory)}
 (d/descriptorName).write_text(json.dumps(desc,indent=2)+"\n")
 promotion={"schema":"options_navigation_revision_promotion.v1","revision":REV,"kind":kind,"actual_passed":count,"source_count":receipt["source_count"],"native_canonical_crop_count":20 if kind=="pl6" else None,"descriptor_sha256":sha(d/descriptorName),"preceding_descriptor_sha256":oldDescriptor,"preceding_packet_inventory_sha256":sha(inventory),"preceding_packet_bytes_unchanged":True,"original_and_combined_sources_equal_within_contract":True,"entire_application_identity_claimed":False}
 (d/"promotion.json").write_text(json.dumps(promotion,indent=2)+"\n")
 (d/"README.md").write_text("# Navigation repair qualification\n\nFresh "+REV+" capture after synchronous URL observation and eager ownership of the complete Options stylesheet closure. The original and combined sources match on the recorded "+str(receipt["source_count"])+" inputs. The old qualification remains unchanged in the parent operation and is bound by prior-packet-sha256.json. This packet does not relabel an earlier capture. The Chart code branch is excluded from this native packet and requires separately bound browser qualification in both source profiles.\n")
 stagePlans.append((d,opRel/"revisions"/REV))
 oldPointer="operations/"+operation+"/"+descriptorName;newPointer="operations/"+operation+"/revisions/"+REV+"/"+descriptorName
 rootRel=Path("terminal/docs/pr-crops")/packet
 for root in [O,P]:
  manifest=root/rootRel/"EVIDENCE.yml";text=manifest.read_text();assert text.count(oldPointer)==1 and text.count(oldDescriptor)==1
  text=text.replace(oldPointer,newPointer).replace(oldDescriptor,sha(d/descriptorName))
  if native:
   oldContract="427c9fcec7a8c53da0c65e62190e7785aea9bd28183be474efaf991f6f558dc1";assert text.count(oldContract)==1;text=text.replace(oldContract,sha(d/"source-contract.json"))
  rootPlans.append((manifest,sha(manifest),text))
 if not native:
  baseline=json.loads((O/opRel/"protected-root-sha256.json").read_text())
  for name,digest in baseline.items():
   if name!="EVIDENCE.yml":
    assert sha(O/rootRel/name)==digest
    rootRestores.append((O/rootRel/name,P/rootRel/name,digest))
  # The visual producer uses the packet root for its outputs; the protected root is restored.
 for rel,digest in json.loads(inventory.read_text()).items():assert sha(O/rel)==sha(P/rel)==digest,(kind,"HISTORY_CHANGED",rel)
 summary.append(promotion);print("STAGED",kind,sha(d/descriptorName),flush=True)
# The complete payloads, metadata and all root replacements are validated in scratch first.
plan={"schema":"options_navigation_promotion_plan.v1","phase":"PREPARED","revision":REV,"staged_packets":[{"source":str(d),"destination":str(rel),"files":{str(f.relative_to(d)):sha(f) for f in sorted(d.rglob("*")) if f.is_file()}} for d,rel in stagePlans],"root_manifests":[{"path":str(path),"old_sha256":old,"new_sha256":hashlib.sha256(text.encode()).hexdigest()} for path,old,text in rootPlans]}
(W/"navigation-r4-promotion-plan.json").write_text(json.dumps(plan,indent=2)+"\n")
for path,old,text in rootPlans:assert sha(path)==old,("ROOT_CHANGED",path)
for d,rel in stagePlans:
 files={str(f.relative_to(d)):sha(f) for f in sorted(d.rglob("*")) if f.is_file()}
 for root in [O,P]:
  shutil.copytree(d,root/rel)
  for name,digest in files.items():assert sha(root/rel/name)==digest
for source,target,digest in rootRestores:
 assert sha(source)==digest;shutil.copyfile(source,target);assert sha(target)==digest
for path,old,text in rootPlans:
 assert sha(path)==old;path.write_text(text);assert sha(path)==hashlib.sha256(text.encode()).hexdigest()
for row in prepared:
 for rel,digest in json.loads(row[11].read_text()).items():assert sha(O/rel)==sha(P/rel)==digest,("HISTORY_CHANGED",rel)
plan["phase"]="APPLIED";(W/"navigation-r4-promotion-plan.json").write_text(json.dumps(plan,indent=2)+"\n")
def archive_history(source,target):
 assert not target.exists();target.mkdir(parents=True)
 rows=[]
 for path in sorted(source.rglob("*")):
  if not path.is_file():continue
  relative=path.relative_to(source);out=target/relative;out.parent.mkdir(parents=True,exist_ok=True);raw=path.read_bytes()
  compressed=path.suffix in [".log",".ts",".tsx",".mts",".cts",".js",".jsx",".mjs",".cjs",".css"]
  if compressed:
   out=out.with_name(out.name+".gz");out.write_bytes(gzip.compress(raw,mtime=0));assert gzip.decompress(out.read_bytes())==raw
  else:out.write_bytes(raw)
  rows.append({"source":str(relative),"stored":str(out.relative_to(target)),"source_sha256":hashlib.sha256(raw).hexdigest(),"stored_sha256":sha(out),"encoding":"gzip" if compressed else "identity"})
 (target/"archive-index.json").write_text(json.dumps(rows,indent=2)+"\n")
proofRel=Path("terminal/docs/verification/options-workspace-20261103/source-compatibility-20261105/navigation-r4")
proof=O/proofRel;proof.mkdir(parents=True,exist_ok=True)
names=["capture-native-navigation-r4-qualified.py","capture-visual-navigation-r4-warm.py","verify-final-journeys-navigation-r4.py","native-source-contract-navigation-r4.json","visual-source-contract-navigation-r4.json","visual-source-equality-navigation-r4.json","options-eager-style-dependencies-navigation-r4.json","visual-lex-projection.json","promote-navigation-r4.py","native-visual-review-r4.json"]
for name in names:shutil.copyfile(W/name,proof/name)
archive_history(W/"navigation-race-repair",proof/"repair-history")
archive_history(W/"lazy-style-completion",proof/"style-closure-history")
archive_history(W/"chart-warmup-repair",proof/"chart-warmup-repair")
archive_history(W/"native-r4-preflight-reconciliation",proof/"native-preflight-reconciliation")
archive_history(W/"visual-warm-attempt1-reconciliation",proof/"visual-warm-attempt1-reconciliation")
archive_history(W/"promotion-packaging-reconciliation",proof/"promotion-packaging-reconciliation")
shutil.copyfile(W/"navigation-r4-final-source-inputs.json",proof/"final-source-inputs.json")
(proof/"promotion.json").write_text(json.dumps(summary,indent=2)+"\n")
shutil.copytree(proof,P/proofRel,dirs_exist_ok=True)
(W/"navigation-r4-promotion.json").write_text(json.dumps(summary,indent=2)+"\n")
print("FRESH_NAVIGATION_PACKETS_PROMOTED",flush=True)
