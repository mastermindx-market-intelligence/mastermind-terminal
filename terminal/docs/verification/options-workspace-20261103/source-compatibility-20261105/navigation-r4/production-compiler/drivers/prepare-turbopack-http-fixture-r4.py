from pathlib import Path
import subprocess,json,hashlib,re,shutil,py_compile
W=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/options-workspace-surface-flow-ux-20261103-c3/terminal/.next/options-source-reconcile-20261105");P=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/exposure-strike-workspace-ux-20261103-c3/terminal/.next/options-completion-preview-0vgroh6i/tree");R=W/"production-turbopack-navigation-r4";C=R/"tree";sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
old=P/"terminal/.next/test-fonts/google-responses-offline-20261104.cjs";assert sha(old)=="0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd"
css=json.loads(subprocess.check_output(["node","-e","process.stdout.write(JSON.stringify(require(process.argv[1])))",str(old)],text=True))
fonts={};mapped={};port=3702;D=R/"font-fixture";assert not D.exists() or not any(D.iterdir());D.mkdir(exist_ok=True)
for key,value in css.items():
 def replace(m):
  src=Path(m.group(1));assert src.parent==old.parent and src.suffix==".woff2" and src.is_file()
  fonts[src.name]={"source":str(src),"sha256":sha(src),"bytes":src.stat().st_size};shutil.copyfile(src,D/src.name)
  return "url(http://127.0.0.1:"+str(port)+"/"+src.name+")"
 mapped[key]=re.sub(r"url\((/[^)]+\.woff2)\)",replace,value)
assert len(fonts)==13 and len(css)==len(mapped)==2
assert all(mapped[k].replace("http://127.0.0.1:"+str(port)+"/",str(old.parent)+"/")==css[k] for k in css)
mock=R/"google-responses-turbopack.cjs";mock.write_text("module.exports = "+json.dumps(mapped,ensure_ascii=False,indent=2)+";\n")
record={"schema":"turbopack_font_transport_fixture.v1","port":port,"bind":"127.0.0.1","original_response_map_sha256":sha(old),"turbopack_response_map_sha256":sha(mock),"font_files":fonts,"font_count":13,"css_changes":"Only13srcURLs; sameCSSkeys,families,weights,display,Unicodeandfontbytes","webpack_fixture_unchanged":True,"source_basis":["https://github.com/vercel/next.js/blob/v16.2.9/crates/next-core/src/next_font/google/mod.rs","https://github.com/vercel/next.js/blob/v16.2.9/turbopack/crates/turbo-tasks-fetch/src/client.rs"]}
(R/"font-fixture-inputs.json").write_text(json.dumps(record,indent=2)+"\n")
# The browser driver uses the copied source and default deployment compiler.
s=(W/"verify-style-ownership-gate-r4.py").read_text()
line='mode=sys.argv[1];assert mode in ["original","preview"];ROOT=O if mode=="original" else P;T=ROOT/"terminal";port=3691 if mode=="original" else 3693'
assert line in s;s=s.replace(line,'mode="turbopack";ROOT=W/"production-turbopack-navigation-r4/tree";T=ROOT/"terminal";port=3694',1)
s=s.replace('R=W/("navigation-style-gate-"+mode+"-r4")','R=W/"browser-turbopack-navigation-r4"')
s=s.replace('FONT=P/"terminal/.next/test-fonts/google-responses-offline-20261104.cjs"','FONT=W/"production-turbopack-navigation-r4/google-responses-turbopack.cjs"')
s=s.replace('0863e9151dab6e278d9eacf5d1560163b6fbe3bf2cac59e369199d7e4ba962fd',sha(mock))
s=s.replace('"--webpack"','"--turbopack"')
start=s.index('  manifest=T/".next/dev/react-loadable-manifest.json"');end=s.index('  print("JOURNEYS_START",mode,9,flush=True)')
s=s[:start]+s[end:]
s=s.replace('".next/options-style-gate-"+mode+"-r4-20261105"','".next/options-turbopack-gate-r4-20261105"')
p=W/"verify-turbopack-browser-r4.py";p.write_text(s);py_compile.compile(str(p),doraise=True)
print(json.dumps({"font_count":13,"mock_sha256":sha(mock),"browser_driver_sha256":sha(p),"port":3702},indent=2))
