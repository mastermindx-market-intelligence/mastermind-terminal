from pathlib import Path
import datetime,hashlib,json,os,subprocess,time
ROOT=Path("/Volumes/Mastermind/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1419-mobile-readiness-web4")
BASE="ceab6184a492911b1dd224430b1c6a0e66f9b0a2"
OUT=ROOT/"docs/verification/pr1419-mobile-readiness-20261110"
NODEBIN=Path("/Volumes/Mastermind 2/agent-workspaces/terminal/web/terminal-pr-duty-20261110-1422-next-proof-web4/.pr1422-qualification/runtime/node-v22.23.4-darwin-arm64/bin")
def git(*args):
    return subprocess.run(["git","-C",str(ROOT),*args],capture_output=True,text=True,check=True).stdout.strip()
def sha(data):return hashlib.sha256(data).hexdigest()
def put(name,value):(OUT/name).write_text(json.dumps(value,indent=2)+"\n")
assert git("rev-parse","HEAD")==BASE
assert git("status","--porcelain=v1")==""
path=ROOT/"terminal/e2e/sector-retained-depth.spec.ts"
before=path.read_bytes()
assert git("hash-object",str(path))=="ec7c915f04b942d12d3140233c70246ceb0c5fed"
source=before.decode()
old1='''  if (!(await showMore.isVisible())) {
    const soonHead = section
      .locator('[data-lane="buy_soon"]')
      .getByRole("button", { name: /Almost ready|接近就绪/i });
    await soonHead.focus();
    await page.keyboard.press("Enter");
  }'''
new1='''  if (mobile(page)) {
    // Initial server markup keeps every column open. Wait for the real
    // phone state before deciding which control to open or focus.
    const soon = section.locator('[data-lane="buy_soon"]');
    await expect(soon).toHaveAttribute("data-open", "false");
    const soonHead = soon.getByRole("button", { name: /Almost ready|接近就绪/i });
    await soonHead.focus();
    await page.keyboard.press("Enter");
    await expect(soon).toHaveAttribute("data-open", "true");
  }'''
old2='''  if ((await blocks.count()) < 2) {
    await section
      .locator('[data-lane="stand_aside"]')
      .getByRole("button", { name: /Stand aside|观望/i })
      .click();
  }'''
new2='''  if (mobile(page)) {
    // Both blocks exist in the initial markup; the non-primary one then
    // unmounts when the phone layout settles. Observe that transition first.
    const aside = section.locator('[data-lane="stand_aside"]');
    await expect(aside).toHaveAttribute("data-open", "false");
    await aside.getByRole("button", { name: /Stand aside|观望/i }).click();
    await expect(aside).toHaveAttribute("data-open", "true");
  }'''
assert source.count(old1)==1 and source.count(old2)==1
source=source.replace(old1,new1).replace(old2,new2)
path.write_text(source)
OUT.mkdir(parents=True,exist_ok=False)
put("source-edit.json",{"base":BASE,"path":str(path.relative_to(ROOT)),"beforeBlob":"ec7c915f04b942d12d3140233c70246ceb0c5fed","beforeSha256":sha(before),"afterBlob":git("hash-object",str(path)),"afterSha256":sha(path.read_bytes()),"replacementCount":2,"productionSourceChanged":False})
(OUT/"source.patch").write_text(git("diff","--","terminal/e2e/sector-retained-depth.spec.ts")+"\n")
env=os.environ.copy()
env["PATH"]=str(NODEBIN)+os.pathsep+env["PATH"]
env["PLAYWRIGHT_BROWSERS_PATH"]="/Users/chriswong/Library/Caches/ms-playwright"
versions={name:subprocess.run([str(NODEBIN/name),"--version"],capture_output=True,text=True,check=True,env=env).stdout.strip() for name in ("node","npm")}
assert versions["node"]=="v22.23.4"
locks={p:sha((ROOT/"terminal"/p).read_bytes()) for p in ("package.json","package-lock.json")}
start=time.monotonic()
with (OUT/"dependencies.log").open("wb") as log:
    result=subprocess.run([str(NODEBIN/"npm"),"ci","--no-audit","--no-fund"],cwd=ROOT/"terminal",env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
record={"versions":versions,"command":["npm","ci","--no-audit","--no-fund"],"exit":result.returncode,"durationSeconds":round(time.monotonic()-start,3),"lockBefore":locks,"lockAfter":{p:sha((ROOT/"terminal"/p).read_bytes()) for p in locks}}
put("dependencies.json",record)
(OUT/"prepare.py").write_bytes(Path(__file__).read_bytes())
print(json.dumps({"source":json.loads((OUT/"source-edit.json").read_text()),"dependencies":record}),flush=True)
assert record["exit"]==0 and record["lockBefore"]==record["lockAfter"]
