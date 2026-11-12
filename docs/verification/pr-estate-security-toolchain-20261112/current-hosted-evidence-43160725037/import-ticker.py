import hashlib,json,pathlib,shutil,subprocess,datetime
w=pathlib.Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-estate-security-toolchain-20261112-c3")
j=pathlib.Path("/private/tmp/terminal-pr1481-current-evidence-20261112-c3")
raw=j/"serial/ticker-news-current"
packet=w/"terminal/docs/pr-crops/ticker-news"
proof=w/"docs/verification/pr-estate-security-toolchain-20261112/current-hosted-evidence-43160725037"
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=w,text=True).strip()
assert head=="ea3eda41176e8bfb0f5421f2ab9efabb31031459"
assert subprocess.check_output(["git","status","--porcelain=v1"],cwd=w,text=True)==""
assert digest(j/"ticker-qualification.json")=="b0d709eae4a85f01c2f8106db477d860ce59745d215224af21c72d6d4f5f63b0"
c=json.loads((raw/"capture.json").read_text())
assert {p.name:digest(p) for p in packet.iterdir()}==c["prior"]
assert not proof.exists()
proof.mkdir()
shutil.copytree(raw,proof/"ticker-original")
for name in ["ticker-qualification.json","actual-checkout-github.json","original-evidence-jobs-github.json","download-result.json","13919181267.members.json","13918917251.members.json","qualify-ticker.cjs"]:
 shutil.copy2(j/name,proof/name)
assert {str(p.relative_to(proof/"ticker-original")):digest(p) for p in (proof/"ticker-original").rglob("*") if p.is_file()}=={str(p.relative_to(raw)):digest(p) for p in raw.rglob("*") if p.is_file()}
lines=[
 "# Current-package ticker-news capture: 14 passed, 7 authored skips, zero failures/flakes/retries.",
 "# Original GitHub Actions run 43160725037 attempt 1, serial job 130991417439, artifact 13918917251.",
 "# Actual runner GitHub Actions 1000589090 (ubuntu-24.04). Capture checkout is preserved below.",
 "# Original receipts, prior 11-file packet, source/runtime bindings and root image review:",
 "# docs/verification/pr-estate-security-toolchain-20261112/current-hosted-evidence-43160725037/ticker-qualification.json",
 "# Viewport dimensions differ from element PNG dimensions. No installed/production acceptance.",
 "capturedAtHead: "+c["checkout"]["commit"],"layoutFiles:"
]
for file in ["terminal/components/news/TickerNewsPanel.tsx","terminal/components/news/TickerNewsPanel.module.css","terminal/components/TerminalShell.tsx"]:
 lines.extend(["  - path: "+file,"    sha256: "+c["sources"][file]])
lines.append("crops:")
for row in c["images"]:
 p=raw/"crops"/row["file"];assert digest(p)==row["image"]["sha256"]
 shutil.copy2(p,packet/row["file"])
 lines.extend(["  - file: "+row["file"],f'    viewport: {row["viewport"]["width"]}x{row["viewport"]["height"]}',"    lang: "+row["lang"],"    state: "+row["state"],"    sha256: "+row["image"]["sha256"]])
# Promote the manifest only after every qualified original PNG is present and verified.
for row in c["images"]:assert digest(packet/row["file"])==row["image"]["sha256"]
(packet/"EVIDENCE.yml").write_text("\n".join(lines)+"\n")
for sibling,expected in c["otherPackets"].items():
 base=w/"terminal/docs/pr-crops"/sibling
 assert {str(p.relative_to(base)):digest(p) for p in base.rglob("*") if p.is_file()}==expected
result={"at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"headBeforeImport":head,"captureCheckout":c["checkout"],"importedImages":10,"manifestSha256":digest(packet/"EVIDENCE.yml"),"priorFiles":11,"siblingPacketsPreserved":list(c["otherPackets"]),"proof":str(proof)}
(j/"ticker-import-result.json").write_text(json.dumps(result,indent=2)+"\n")
shutil.copy2(j/"ticker-import-result.json",proof/"ticker-import-result.json")
print(json.dumps(result,indent=2))
print(subprocess.check_output(["git","diff","--stat"],cwd=w,text=True))
