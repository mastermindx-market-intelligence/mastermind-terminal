from pathlib import Path
import hashlib,json,shutil,subprocess,yaml
ROOT=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3")
R=ROOT/"terminal/.next/options-source-reconcile-20261105"
BASE="11531481b0a540ee96bcd86df418fd1e42715363"
OP="exposure-source-compatibility-20261105"
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def blob(path):return subprocess.check_output(["git","-C",str(ROOT),"show",BASE+":"+path])
records=json.loads((R/"native-capture-results.json").read_text())
assert len(records)==2
for rec in records:
    assert rec["exit"]==0 and rec["source_stable"] and not rec["failed_frames"]
    assert rec["successful_files"]==rec["expected"]==({"gex":114,"eod":126}[rec["kind"]])
    for rel,digest in rec["source_sha256"].items():assert sha(ROOT/rel)==digest,("SOURCE_DRIFT",rel)
    source=R/("native-"+rec["kind"])
    assert sha(source/"EVIDENCE.yml")==rec["native_manifest_sha256"]
    assert sorted(yaml.safe_load((source/"EVIDENCE.yml").read_text())["files"])==sorted(rec["image_sha256"])
    for name,digest in rec["image_sha256"].items():assert sha(source/name)==digest
for rec in records:
    family=rec["packet"];packet=ROOT/"terminal/docs/pr-crops"/family;op=packet/"operations"/OP
    assert not (op/"qualified-root").exists()
    assert (packet/"EVIDENCE.yml").read_bytes()==(op/"EVIDENCE.before.yml").read_bytes()
    protected=(op/"EVIDENCE.protected.yml").read_bytes()
    protected_hashes=json.loads((op/"protected-root-sha256.json").read_text())
    shutil.copytree(R/("native-"+rec["kind"]),op/"qualified-root")
    shutil.copyfile(R/("native-"+rec["kind"]+".json"),op/"capture-receipt.json")
    shutil.copyfile(R/("native-"+rec["kind"]+".log"),op/"capture.log")
    candidate=(R/(family+"-manifest.ours")).read_bytes()
    assert candidate.endswith(protected)
    prefix=candidate[:-len(protected)].decode().rstrip()+"\n"
    prefix+='  activeManifestSha256: "'+sha(op/"qualified-root/EVIDENCE.yml")+'"\n'
    prefix+='  captureReceiptSha256: "'+sha(op/"capture-receipt.json")+'"\n\n'
    candidate=prefix.encode()+protected
    temp=R/(family+"-manifest.final");temp.write_bytes(candidate)
    merge=subprocess.run(["git","merge-file","-p",str(temp),str(R/(family+"-manifest.base")),str(R/(family+"-manifest.theirs"))],capture_output=True)
    assert merge.returncode==0 and merge.stdout==candidate
    for name,digest in protected_hashes.items():
        data=blob("terminal/docs/pr-crops/"+family+"/"+name)
        assert hashlib.sha256(data).hexdigest()==digest
        (packet/name).write_bytes(data)
    (packet/"EVIDENCE.yml").write_bytes(candidate)
    record={"operation":OP,"kind":rec["kind"],"current_native_images":rec["successful_files"],"prior_images_preserved":len(json.loads((op/"prior-root-sha256.json").read_text())),"protected_baseline_images":len(protected_hashes),"root_manifest_sha256":sha(packet/"EVIDENCE.yml"),"active_manifest_sha256":sha(op/"qualified-root/EVIDENCE.yml"),"manifest_diff3_rc":merge.returncode}
    (op/"promotion.json").write_text(json.dumps(record,indent=2)+"\n")
    print("CURRENT_EVIDENCE_PROMOTED",json.dumps(record),flush=True)
print("ALL_CURRENT_EVIDENCE_PROMOTED",flush=True)
