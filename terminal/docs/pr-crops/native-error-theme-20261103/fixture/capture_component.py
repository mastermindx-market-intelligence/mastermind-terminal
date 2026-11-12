"""P12.T21.S2 independent offline component fixture. Run only under root's OS deny-all-network profile."""
import hashlib, json, mimetypes, re, sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit, unquote
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).parent
PHASE = sys.argv[1]
assert PHASE in ("before", "after")
SRC = ROOT / PHASE
receipt = json.loads((SRC / "source-receipt.json").read_text())
for rel, expected in receipt["localResources"].items():
    assert hashlib.sha256((SRC / rel).read_bytes()).hexdigest() == expected
OUT = ROOT / ("captures-" + PHASE)
OUT.mkdir(exist_ok=True)
TARGET = "https://www.mastermind-x.com/portfolio?case=error-theme&view=holdings#fixture-AAPL"
cells = [(1440, "light", "en"), (390, "light", "zh")] if PHASE == "before" else [(w, t, l) for w in (1440, 390) for t in ("dark", "light") for l in ("en", "zh")] + [(820, "light", "zh")]
records = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    try:
        for width, theme, lang in cells:
            context = browser.new_context(viewport={"width": width, "height": 1180 if width == 820 else 844 if width == 390 else 900}, has_touch=width != 1440, is_mobile=width == 390, reduced_motion="reduce", color_scheme=theme)
            fulfilled, blocked, errors = [], [], []
            def route(request):
                u = urlsplit(request.request.url)
                if u.scheme == "file":
                    p = Path(unquote(u.path)).resolve()
                    try:
                        rel = p.relative_to(SRC).as_posix()
                    except ValueError:
                        rel = ""
                    if rel in receipt["localResources"]:
                        raw = p.read_bytes()
                        assert hashlib.sha256(raw).hexdigest() == receipt["localResources"][rel]
                        fulfilled.append({"kind": "local-file", "resource": rel})
                        request.fulfill(status=200, content_type=mimetypes.guess_type(p.name)[0] or "application/octet-stream", body=raw)
                        return
                if request.request.url == TARGET.split("#")[0]:
                    raw = (SRC / "return.html").read_bytes()
                    assert hashlib.sha256(raw).hexdigest() == receipt["localResources"]["return.html"]
                    fulfilled.append({"kind": "local-return-preimage", "url": request.request.url})
                    request.fulfill(status=200, content_type="text/html", body=raw)
                    return
                blocked.append(request.request.url)
                request.abort()
            context.route("**/*", route)
            page = context.new_page()
            page.on("pageerror", lambda err: errors.append(str(err)))
            url = (SRC / "fixture.html").as_uri() + "?" + urlencode({"theme": theme, "lang": lang, "ret": TARGET})
            page.goto(url, wait_until="load")
            page.evaluate("document.fonts.ready")
            expect(page.locator("html")).to_have_attribute("data-theme", theme)
            healthy = page.evaluate("({theme:document.documentElement.dataset.theme,owner:document.documentElement.dataset.mmxSharedShell,background:getComputedStyle(document.body).backgroundColor})")
            trigger = page.locator("#show-error")
            if width == 1440:
                trigger.focus()
                trigger.press("Enter")
            else:
                trigger.tap()
            expect(page.get_by_role("heading", name="出现错误" if lang == "zh" else "Something went wrong", exact=True)).to_be_visible()
            back = page.get_by_role("button", name="返回投资组合" if lang == "zh" else "Back to Portfolio", exact=True)
            expect(back).to_be_focused()
            page.evaluate("document.fonts.ready")
            metrics = page.locator("main").evaluate("e=>({rootTheme:document.documentElement.dataset.theme,rootOwner:document.documentElement.dataset.mmxSharedShell||null,theme:e.dataset.errorTheme||null,background:getComputedStyle(e).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(e).color,overflow:document.documentElement.scrollWidth>innerWidth,actions:[...e.querySelectorAll('button,a')].map(b=>({text:b.textContent,label:b.getAttribute('aria-label'),href:b.getAttribute('href'),width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,animation:getComputedStyle(b).animationName,outline:getComputedStyle(b).outline,color:getComputedStyle(b).color,background:getComputedStyle(b).backgroundColor})),snapshot:window.fixture.observations})")
            assert metrics["rootTheme"] == "dark" and metrics["rootOwner"] is None
            assert not metrics["overflow"] and not errors
            if PHASE == "before":
                assert theme == "light" and metrics["bodyBackground"] == "rgb(10, 11, 14)"
                outcome = "REPRODUCED_LIGHT_PRESENTATION_LOSS"
            else:
                assert metrics["theme"] == theme
                assert all(action["height"] >= 44 for action in metrics["actions"])
                assert metrics["background"] == ("rgb(247, 248, 250)" if theme == "light" else "rgb(15, 17, 21)")
                assert metrics["actions"][0]["animation"] == "none"
                outcome = "PASS_SCOPED"
            shot = OUT / f"{width}-{theme}-{lang}-error.png"
            page.screenshot(path=str(shot))
            row = {"width": width, "theme": theme, "lang": lang, "outcome": outcome, "healthy": healthy, "metrics": metrics, "screenshot": str(shot), "screenshot_sha256": hashlib.sha256(shot.read_bytes()).hexdigest()}
            if PHASE == "after":
                retry = page.get_by_role("button", name="重试" if lang == "zh" else "Try again", exact=True)
                retry.focus()
                retry.press("Enter")
                expect(trigger).to_be_visible()
                expect(page.locator("html")).to_have_attribute("data-theme", theme)
                assert page.evaluate("window.fixture.retries") == 1
                if width == 1440:
                    trigger.focus(); trigger.press("Enter")
                else:
                    trigger.tap()
                expect(back).to_be_focused()
                if width == 1440:
                    back.press("Enter")
                else:
                    back.tap()
                expect(page).to_have_url(TARGET)
                expect(page.get_by_role("heading", name="Controlled local return preimage")).to_be_visible()
                row["return"] = {"exact_url": page.url, "focus_tag": page.evaluate("document.activeElement.tagName"), "fulfilled_from_local_preimage": True, "portfolio_owner_mounted": False}
                assert row["return"]["focus_tag"] == "BODY"
                row["retry_callback_and_reentry"] = True
            row["fulfilled_local_resources"] = fulfilled
            row["blocked_requests"] = blocked
            row["page_errors"] = errors
            assert not blocked and not errors
            records.append(row)
            context.close()
    finally:
        browser.close()
        (OUT / "result.json").write_text(json.dumps({"phase": PHASE, "os_profile": "(version 1)(allow default)(deny network*)", "source_receipt": receipt, "scope": "Actual React error/owner/CSS component fixture, pure preference seam, hashed local resources and local fulfilled return; not Next/inShell/normal principal/Portfolio persistence/runtime/production proof", "cells": records}, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"phase": PHASE, "cells": len(records), "outcomes": sorted(set(r["outcome"] for r in records)), "blocked": sum(len(r["blocked_requests"]) for r in records), "page_errors": sum(len(r["page_errors"]) for r in records)}))
