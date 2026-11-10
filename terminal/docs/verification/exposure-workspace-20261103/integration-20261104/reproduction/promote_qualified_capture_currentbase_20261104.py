#!/usr/bin/python3
"""Original-C3 isolated-preview crop activation, preserving byte-exact root history."""
from pathlib import Path
import argparse, hashlib, json, os, re, shutil, sys

BASE=Path(__file__).resolve().parent
REPO=BASE/"tree"
REC=BASE/"paper6d6-currentbase-20261104"
SNAPSHOT=REC/"source-before-browser.json"
MASTER="cd2a335f8f8fcf4fa947aa8a47f7dbf5748b2fdc"
EXPOSURE="6d6cdc727b9e8d0d70af23d8b0caa239c6304b5b"
OPTIONS="98ffa891116ccc9e6be58a64148dbe45591e6ce8"
HISTORY_NAME="protected-before-paper6d6-currentbase-20261104"
COMPONENTS={
 "gex":{"packet":"gex-levels-heatmap-load-failure","folder":"qualification-gex-20261104","cases":114,"old_sha":"c3f3f45d1483b1cdb0b4e43b699ef23db53677a2c3d5eb5705adaca4192e0779","new_sha":"92a2ef123d820d9fb56e1e8240a8521de84beb2ebd7614514736534207eea80d"},
 "eod":{"packet":"eod-heatmap-flowdesk-load-failure","folder":"qualification-eod-20261104","cases":126,"old_sha":"a188532dcee49ff325ecd95ea129b847e1c8431938a51f7aafaab2b7b5a2144f","new_sha":"846905ca090c71708db5f58eded4a8f1dff8b4d57e0c0a3c978c59594dc2b066"},
}

def sha(f):
 h=hashlib.sha256()
 with f.open("rb") as fd:
  for block in iter(lambda:fd.read(1<<20),b""):h.update(block)
 return h.hexdigest()

def files_section(text):
 if "\nfiles:\n" not in text:raise ValueError("FILES_SECTION_MISSING")
 rows=[]
 for line in text.split("\nfiles:\n",1)[1].splitlines():
  if not line.startswith("  - "): break
  rows.append(line[4:])
 if len(set(rows))!=len(rows) or not all(re.fullmatch(r"[a-z0-9-]+-(1440|820|390)(-zh)?[.]png",x) for x in rows):
  raise ValueError("BAD_IMAGE_NAMES")
 return rows

def layout_section(text):
 token="layoutFiles:\n"
 if token not in text:raise ValueError("LAYOUT_SECTION_MISSING")
 after=text.index(token)+len(token)
 lines=[]
 for line in text[after:].splitlines(keepends=True):
  if not line.startswith("  "): break
  if not re.fullmatch(r'  (terminal/[^:]+): "[a-f0-9]{64}"\n',line):raise ValueError("BAD_LAYOUT_ROW")
  lines.append(line)
 if not lines:raise ValueError("EMPTY_LAYOUT")
 return (after,after+len("".join(lines)),lines)

def prove_old_and_new(label,config):
 packet=REPO/"terminal"/"docs"/"pr-crops"/config["packet"]
 capture=REC/config["folder"]
 assert packet.is_dir() and capture.is_dir()
 prior_manifest=packet/"EVIDENCE.yml"
 new_manifest=capture/"EVIDENCE.yml"
 old=prior_manifest.read_text()
 new=new_manifest.read_text()
 if sha(prior_manifest)!=config["old_sha"] or sha(new_manifest)!=config["new_sha"]:raise ValueError("MANIFEST_SHA_DRIFT")
 if "\ncurrentBaseCapture20261104:\n" in old:raise ValueError("ALREADY_PROMOTED")
 old_names=files_section(old);new_names=files_section(new)
 if len(old_names)!=config["cases"] or set(old_names)!=set(new_names):raise ValueError("CROP_SET_DISAGREES")
 if len(list(packet.glob("*.png")))!=config["cases"]:raise ValueError("OLD_ROOT_COUNT_DRIFT")
 if len(list(capture.glob("*.png")))!=config["cases"] or list(capture.glob("FAIL-*.png")):raise ValueError("NEW_CAPTURE_COUNT_DRIFT")
 start,end,old_rows=layout_section(old)
 ns,ne,new_rows=layout_section(new)
 old_keys=[x.split(": ",1)[0] for x in old_rows]
 new_keys=[x.split(": ",1)[0] for x in new_rows]
 if old_keys!=new_keys:raise ValueError("SOURCE_LAYOUT_KEY_DRIFT")
 for row in new_rows:
  name,h=row.strip().split(": ",1)
  rel=name.strip()
  want=h.strip('"')
  source=REPO/rel
  if not source.is_file() or sha(source)!=want:raise ValueError("CURRENT_SOURCE_HASH_MISMATCH "+rel)
 before={}
 after={}
 for name in old_names:
  prior=packet/name;now=capture/name
  if not prior.is_file() or not now.is_file() or prior.is_symlink() or now.is_symlink():raise ValueError("CROP_MISSING_OR_LINK")
  if prior.stat().st_size<1000 or now.stat().st_size<1000:raise ValueError("CROP_TOO_SMALL")
  if now.open("rb").read(8)!=bytes.fromhex("89504e470d0a1a0a"):raise ValueError("CROP_INVALID_PNG")
  before[name]=sha(prior);after[name]=sha(now)
 backup=packet/"operations"/HISTORY_NAME
 if backup.exists():raise ValueError("BACKUP_ALREADY_EXISTS_RECONCILE")
 # Preserve every old historical receipt byte; activate only new verified layout/crops.
 section=[
   "currentBaseCapture20261104:",
   '  status: "SOURCE_COMPOSED_PREVIEW_NOT_RELEASED"',
   f'  protectedBase: "{MASTER}"',
   f'  exposureHead: "{EXPOSURE}"',
   f'  optionsHead: "{OPTIONS}"',
   '  gitHeadOnCapture: "original-exposure-worktree; not a merged commit"',
   f'  captureManifestSha256: "{config["new_sha"]}"',
   f'  priorManifestSha256: "{config["old_sha"]}"',
   f'  oldRootArchive: "operations/{HISTORY_NAME}"',
   f'  oldRootImageCount: {len(before)}',
   f'  capturedImageCount: {len(after)}',
   '  captureSourceSha256:',
   *[line.rstrip("\n").replace("  terminal/","    terminal/",1) for line in new_rows],
   '  cropSha256:',
   *[f'    {name}: "{after[name]}"' for name in sorted(after)],
   "",
 ]
 updated=old[:start]+"".join(new_rows)+old[end:]
 updated=updated.rstrip("\n")+"\n\n"+"\n".join(section)
 if updated.count("\ncurrentBaseCapture20261104:\n")!=1:raise ValueError("NEW_SECTION_NOT_UNIQUE")
 plan={"label":label,"packet":str(packet),"archive":str(backup),"cases":len(before),"old_manifest_sha":config["old_sha"],"new_manifest_sha":hashlib.sha256(updated.encode()).hexdigest(),"different_pixels":sum(before[n]!=after[n] for n in before),"source_files":len(new_rows),"images":list(sorted(after))}
 return packet,capture,prior_manifest,backup,updated,before,after,plan

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--packet",choices=sorted(COMPONENTS),required=True)
 parser.add_argument("--mode",choices=["preflight","apply"],required=True)
 args=parser.parse_args()
 packet,capture,manifest,backup,updated,before,after,plan=prove_old_and_new(args.packet,COMPONENTS[args.packet])
 print(json.dumps({"stage":"PREQUALIFIED",**{k:v for k,v in plan.items() if k!="images"}},sort_keys=True),flush=True)
 if args.mode=="preflight":return
 backup.mkdir(mode=0o700)
 try:
  with (backup/"EVIDENCE.protected-original.yml").open("xb") as stream:stream.write(manifest.read_bytes())
  for name in sorted(before):
   with (backup/name).open("xb") as target,(packet/name).open("rb") as original:
    shutil.copyfileobj(original,target)
   if sha(backup/name)!=before[name]:raise ValueError("HISTORICAL_BACKUP_SHA_DRIFT "+name)
  with (backup/"PRIOR_ROOT_SHA256.json").open("xb") as stream:
   stream.write((json.dumps({"schema":"terminal.currentbase.root-preservation.v1","manifest_sha256":plan["old_manifest_sha"],"images":before},sort_keys=True,indent=2)+"\n").encode())
  if sha(backup/"EVIDENCE.protected-original.yml")!=plan["old_manifest_sha"]:raise ValueError("MANIFEST_BACKUP_MISMATCH")
  for name in sorted(after):
   tmp=packet/(name+".paper6d6-tmp")
   if tmp.exists():raise ValueError("STALE_STAGING "+name)
   with tmp.open("xb") as stream,(capture/name).open("rb") as source:
    shutil.copyfileobj(source,stream)
   if sha(tmp)!=after[name]:raise ValueError("STAGED_CROP_MISMATCH "+name)
  staged=packet/"EVIDENCE.yml.paper6d6-tmp"
  with staged.open("xb") as stream:stream.write(updated.encode())
  if sha(staged)!=plan["new_manifest_sha"]:raise ValueError("MANIFEST_STAGE_MISMATCH")
  # Promote with preserved preimages; no active test server at the same time.
  for name in sorted(after):os.replace(packet/(name+".paper6d6-tmp"),packet/name)
  os.replace(staged,manifest)
  if sha(manifest)!=plan["new_manifest_sha"]:raise ValueError("POST_MANIFEST_DRIFT")
  if any(sha(packet/name)!=after[name] for name in after):raise ValueError("POST_CROP_DRIFT")
  if any(sha(backup/name)!=before[name] for name in before):raise ValueError("POST_HISTORY_DRIFT")
  print(json.dumps({"stage":"APPLIED_AND_VERIFIED",**{k:v for k,v in plan.items() if k!="images"}},sort_keys=True),flush=True)
 except BaseException:
  print("EFFECT_UNKNOWN_RECONCILE_ORIGINAL_C3_PACKET="+args.packet,flush=True)
  raise

if __name__=="__main__":main()
