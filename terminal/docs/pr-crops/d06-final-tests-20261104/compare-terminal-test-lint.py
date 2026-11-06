from pathlib import Path
import json,subprocess,hashlib
r=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/d06-terminal-reader-resilience-20261103-c4");a=r/"terminal";t=Path("/tmp/d06-macro-c4-11l44i0i")
results=[]
for rel in ["e2e/portfolio-event-refresh.spec.ts","e2e/shell-mode.spec.ts"]:
 text=(a/rel).read_text();base=subprocess.check_output(["git","show","9d1d8549a3d5f77208de385631e10c31c7d16c4f:terminal/"+rel],cwd=r,text=True)
 pair={}
 for label,source in [("current",text),("base",base)]:
  p=subprocess.run(["npx","--no-install","eslint","--stdin","--stdin-filename",rel,"--format","json"],cwd=a,input=source,text=True,capture_output=True)
  parsed=json.loads(p.stdout)
  pair[label]={"exit_code":p.returncode,"messages":parsed[0]["messages"],"source_sha256":hashlib.sha256(source.encode()).hexdigest()}
 from collections import Counter
 def signature(label,source):
  lines=source.splitlines()
  return Counter((m.get("ruleId"),m["severity"],m["message"],lines[m["line"]-1].strip(),m.get("column"),m.get("endColumn")) for m in pair[label]["messages"])
 same=signature("current",text)==signature("base",base)
 results.append({"path":"terminal/"+rel,"baseline":pair["base"],"current":pair["current"],"identical_findings_ignoring_shifted_line_numbers":same})
 assert same,rel
receipt={"schema":"d06.lint_baseline_comparison.v1","base":"9d1d8549a3d5f77208de385631e10c31c7d16c4f","files":results,"new_findings":0,"full_file_lint_clean":False}
(t/"terminal-lint-baseline-comparison.json").write_text(json.dumps(receipt,indent=2)+"\n")
print(json.dumps({"new_findings":0,"files":[{"path":x["path"],"messages":len(x["current"]["messages"]),"identical":x["identical_findings_ignoring_shifted_line_numbers"]} for x in results]}))
print(json.dumps({"screenshots":[str(p) for p in sorted((t/"terminal-portfolio-clean").rglob("*.png"))]}))
