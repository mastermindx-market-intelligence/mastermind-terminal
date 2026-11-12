"""P12.T21.S2 independent offline component fixture. Run only under root's OS deny-all-network profile."""
import hashlib, json, mimetypes, re, sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit, unquote
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).parent

SRC = ROOT / "details"
OUT = ROOT / "captures-details"
OUT.mkdir(exist_ok=True)
receipt = json.loads((SRC / "source-receipt.json").read_text())
for rel, expected in receipt["localResources"].items():
    assert hashlib.sha256((SRC / rel).read_bytes()).hexdigest() == expected
records = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    try:
        for name, width, theme, lang, extra in [("dark-contrast",1440,"dark","en",{}),("light-long-reference",390,"light","zh",{"long":"1"}),("no-owner",390,"light","zh",{"noowner":"1"}),("unsafe-return",390,"light","en",{"ret":"https://untrusted.invalid/portfolio"})]:
            context = browser.new_context(viewport={"width":width,"height":900 if width==1440 else 844},has_touch=width==390,is_mobile=width==390,reduced_motion="reduce",color_scheme=theme)
            errors, blocked = [], []
            def route(r):
                u=urlsplit(r.request.url)
                file=Path(unquote(u.path)).resolve()
                try: rel=file.relative_to(SRC).as_posix()
                except ValueError: rel=""
                if u.scheme=="file" and rel in receipt["localResources"]:
                    raw=file.read_bytes()
                    assert hashlib.sha256(raw).hexdigest()==receipt["localResources"][rel]
                    r.fulfill(status=200,content_type=mimetypes.guess_type(file.name)[0] or "application/octet-stream",body=raw)
                else:
                    blocked.append(r.request.url);r.abort()
            context.route("**/*",route)
            page=context.new_page(); page.on("pageerror",lambda e:errors.append(str(e)))
            q={"theme":theme,"lang":lang,"ret":"https://www.mastermind-x.com/portfolio?case=error-theme#fixture-AAPL",**extra}
            page.goto((SRC/"fixture.html").as_uri()+"?"+urlencode(q),wait_until="load")
            if name!="no-owner":
                trigger=page.locator("#show-error")
                expect(page.locator("html")).to_have_attribute("data-theme",theme)
                if width==1440:trigger.focus();trigger.press("Enter")
                else:trigger.tap()
            expect(page.get_by_role("heading",name="出现错误" if lang=="zh" else "Something went wrong",exact=True)).to_be_visible()
            page.evaluate("document.fonts.ready")
            if name!="unsafe-return":expect(page.locator(".m-back-prom")).to_be_focused()
            metrics=page.locator("main").evaluate(r"""e=>{
              const bg=n=>{for(let x=n;x;x=x.parentElement){const c=getComputedStyle(x).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;}return 'rgb(255,255,255)';};
              const sample=n=>({text:n.textContent,color:getComputedStyle(n).color,background:bg(n),outline:getComputedStyle(n).outline,height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width});
              return {theme:e.dataset.errorTheme,rootTheme:document.documentElement.dataset.theme,rootOwner:document.documentElement.dataset.mmxSharedShell||null,overflow:document.documentElement.scrollWidth>innerWidth,samples:[...e.querySelectorAll('h1,.tag,span,button,a')].filter(n=>n.textContent.trim()).map(sample),reference:e.querySelector('p span')?sample(e.querySelector('p span')):null,returnCount:e.querySelectorAll('.m-back-prom').length};
            }""")
            def lum(s):
                nums=[float(v)/255 for v in re.findall(r"[\d.]+",s)[:3]]
                vals=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in nums]
                return .2126*vals[0]+.7152*vals[1]+.0722*vals[2]
            for item in metrics["samples"]:
                a,b=sorted([lum(item["color"]),lum(item["background"])])
                item["contrast"]=(b+.05)/(a+.05)
                assert item["contrast"]>=4.5,(name,item)
            assert not metrics["overflow"] and not errors and not blocked
            assert metrics["rootTheme"]=="dark" and metrics["rootOwner"] is None
            assert metrics["theme"]==("dark" if name=="no-owner" else theme)
            if name=="light-long-reference":
                assert len(metrics["reference"]["text"])>500 and metrics["reference"]["height"]>20
            if name=="unsafe-return":assert metrics["returnCount"]==0
            shot=OUT/(name+".png");page.screenshot(path=str(shot))
            records.append({"case":name,"outcome":"PASS_SCOPED","metrics":metrics,"errors":errors,"blocked":blocked,"screenshot":str(shot),"sha256":hashlib.sha256(shot.read_bytes()).hexdigest()})
            context.close()
    finally:
        browser.close()
        (OUT/"result.json").write_text(json.dumps({"scope":"Four new component detail inputs only; no matrix repetition or live service", "os_profile":"(version 1)(allow default)(deny network*)","receipt":receipt,"cells":records},indent=2,ensure_ascii=False)+"\n")
print(json.dumps({"cells":len(records),"outcomes":sorted(set(r["outcome"] for r in records))}))
