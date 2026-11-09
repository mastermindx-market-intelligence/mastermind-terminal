# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: options-exposure-surface-journey.spec.ts >> synthetic exposure saved theme cold return zh
- Location: e2e/options-exposure-surface-journey.spec.ts:1413:7

# Error details

```
Error: canonical fixture account actually loaded

canonical fixture account actually loaded

expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - img [ref=e5]
        - generic [ref=e9]:
          - generic [ref=e10]: MASTERMIND
          - generic [ref=e11]: TERMINAL
      - generic [ref=e13]: 期权
      - button "设置" [ref=e14] [cursor=pointer]: R
    - navigation "Primary" [ref=e15]:
      - link "图表" [ref=e16] [cursor=pointer]:
        - /url: /terminal
        - img [ref=e17]
      - link "分析" [ref=e19] [cursor=pointer]:
        - /url: /analysis
        - img [ref=e20]
      - link "发现" [ref=e22] [cursor=pointer]:
        - /url: /discover
        - img [ref=e23]
      - link "错位" [ref=e28] [cursor=pointer]:
        - /url: /dislocations
        - img [ref=e29]
      - link "期权" [ref=e30] [cursor=pointer]:
        - /url: /options
        - img [ref=e31]
      - link "脚本" [ref=e34] [cursor=pointer]:
        - /url: /scripts
        - img [ref=e35]
      - link "投资组合" [ref=e39] [cursor=pointer]:
        - /url: /portfolio
        - img [ref=e40]
      - link "提醒" [ref=e42] [cursor=pointer]:
        - /url: /alerts
        - img [ref=e43]
      - button "Mastermind AI" [ref=e46] [cursor=pointer]:
        - img [ref=e47]
    - main [ref=e49]:
      - generic [ref=e50]:
        - generic [ref=e51]:
          - generic [ref=e52]: 类别
          - generic [ref=e53]:
            - tablist "期权类别" [ref=e54]:
              - tab "指挥台" [ref=e55] [cursor=pointer]
              - tab "资金流" [ref=e56] [cursor=pointer]
              - tab "敞口" [selected] [ref=e57] [cursor=pointer]
              - tab "结构" [ref=e58] [cursor=pointer]
              - tab "波动率" [ref=e59] [cursor=pointer]
              - tab "统计" [ref=e60] [cursor=pointer]
              - tab "Prophet" [ref=e61] [cursor=pointer]
            - link "期货深度与足迹" [ref=e62] [cursor=pointer]:
              - /url: /options/futures
              - text: 期货
            - button "打开四步期权工作流程 · 已查看 1/4" [ref=e63] [cursor=pointer]:
              - img [ref=e64]
              - generic [ref=e67]: 流程
              - generic [ref=e68]: 已查看 1/4
        - generic [ref=e69]:
          - generic [ref=e70]: 视图
          - tablist "期权子视图" [ref=e71]:
            - tab "敞口" [selected] [ref=e72] [cursor=pointer]
            - tab "持仓结构" [ref=e73] [cursor=pointer]
            - tab "价位图" [ref=e74] [cursor=pointer]
      - generic [ref=e75]:
        - generic [ref=e80]:
          - navigation "敞口工作区" [ref=e81]:
            - combobox "标的代码" [ref=e82]: SPY
            - button "结构图" [pressed] [ref=e83] [cursor=pointer]
            - button "多市场对比" [ref=e84] [cursor=pointer]
            - button "扫描" [ref=e85] [cursor=pointer]
            - generic [ref=e86]:
              - generic [ref=e87]: 数据质量 · 8
              - group [ref=e89]:
                - generic "了解此视图" [ref=e90] [cursor=pointer]: "?"
            - group [ref=e91]:
              - generic "工具" [ref=e92] [cursor=pointer]
          - generic [ref=e93]:
            - generic [ref=e94]:
              - generic [ref=e95]:
                - generic [ref=e96]: 期权 · 敞口 · SPY
                - heading "SPY 敞口地图" [level=2] [ref=e97]:
                  - text: SPY
                  - generic [ref=e98]: 敞口地图
                - paragraph [ref=e99]:
                  - code [ref=e100]: SEC:SPY · v1
                  - emphasis [ref=e101]: 逐合约覆盖
                - paragraph [ref=e102]: 参考现价 $100 · 2026-10-19T20:00:00Z · 2 个到期日 · 2 个行权价
                - paragraph [ref=e103]: 已提供逐合约覆盖信息。未知项不显示数值，全市场覆盖范围仍未知。持仓为模型假设。
              - generic [ref=e104]:
                - button "来源与覆盖 ↗" [ref=e105] [cursor=pointer]
                - link "打开调查" [ref=e106] [cursor=pointer]:
                  - /url: /analysis?view=investigations&symbol=SPY
            - generic [ref=e107]:
              - group "敞口指标" [ref=e108]:
                - button "伽马" [pressed] [ref=e109] [cursor=pointer]
                - button "Delta 扩展" [ref=e110] [cursor=pointer]:
                  - text: Delta
                  - emphasis [ref=e111]: 扩展
                - button "Vanna" [ref=e112] [cursor=pointer]
                - button "Charm" [ref=e113] [cursor=pointer]
                - button "组合" [ref=e114] [cursor=pointer]
              - generic [ref=e115]:
                - text: 到期范围
                - combobox "到期范围" [ref=e116]:
                  - option "全部已提供到期日" [selected]
                  - option "来源交易日 0DTE"
                  - option "下一个仍有效的经济到期时点"
                  - option "本交易周仍有效的到期日"
                  - option "2026-10-23"
                  - option "2026-10-30"
              - button "Gamma + Vanna 双层" [ref=e117] [cursor=pointer]
              - generic [ref=e118]:
                - button "有符号净值" [pressed] [ref=e119] [cursor=pointer]
                - button "总伽马" [ref=e120] [cursor=pointer]
          - generic [ref=e121]:
            - generic [ref=e122]:
              - generic [ref=e123]: 覆盖账簿净值
              - strong [ref=e124]: +210 M
              - generic [ref=e125]: 每 +1% 现价
            - button "覆盖范围最大净节点 103 +300M · 80.3% 占总值" [ref=e126] [cursor=pointer]:
              - generic [ref=e127]: 覆盖范围最大净节点
              - strong [ref=e128]: "103"
              - generic [ref=e129]: +300M · 80.3% 占总值
            - generic [ref=e130]:
              - generic [ref=e131]: 相近 · 第二节点
              - strong [ref=e132]:
                - text: "98"
                - generic [ref=e133]: 0.30×
              - generic [ref=e137]: 阈值 0.90 · runner-up-ratio/v1
            - generic [ref=e138]:
              - generic [ref=e139]: 合格合约
              - strong [ref=e140]:
                - text: "8"
                - generic [ref=e141]: / 8
              - generic [ref=e142]: 0 无合约标识
            - generic [ref=e143]:
              - generic [ref=e144]: 时钟
              - strong [ref=e145]: 观测 10-19 20:00Z
              - generic [ref=e146]: 持仓量截至 2026-10-19 · 发布 未提供
              - generic [ref=e147]: 来源可用 10-19 20:01Z
          - generic [ref=e148]:
            - generic [ref=e149]:
              - generic [ref=e150]:
                - generic "价格周期" [ref=e151]:
                  - button "5m" [pressed] [ref=e152] [cursor=pointer]
                  - button "30m" [ref=e153] [cursor=pointer]
                  - button "2h" [ref=e154] [cursor=pointer]
                  - button "D" [ref=e155] [cursor=pointer]
                  - button "W" [ref=e156] [cursor=pointer]
                - generic [ref=e157]:
                  - button "均线参考" [pressed] [ref=e158] [cursor=pointer]
                  - button "重置视图" [ref=e159] [cursor=pointer]
              - generic [ref=e160]:
                - generic "SMA 5 · D · 2026-10-19T16:00 ET" [ref=e161]:
                  - text: SMA 5 · D 100.3
                  - time [ref=e162]: 10-19
                - generic "EMA 21 · D · 2026-10-19T16:00 ET" [ref=e163]:
                  - text: EMA 21 · D 100.36
                  - time [ref=e164]: 10-19
                - generic "SMA 55 · D · 2026-10-19T16:00 ET" [ref=e165]:
                  - text: SMA 55 · D 100.18
                  - time [ref=e166]: 10-19
                - generic "SMA 34 · 5m · 2026-10-19T16:00 ET" [ref=e167]:
                  - text: SMA 34 · 5m 99.68
                  - time [ref=e168]: 10-19
                - generic [ref=e169]: 已收盘快照参考值
              - generic "价格图表" [ref=e170]:
                - generic [ref=e172]:
                  - generic:
                    - generic:
                      - generic:
                        - generic:
                          - generic: S
                        - generic: SPY · 5m
                      - generic:
                        - generic: O100.00H100.12L99.88C100.00
                        - generic: "-0.00 (-0.00%)"
                  - table [ref=e175]:
                    - row [ref=e176]:
                      - cell
                      - cell [ref=e177]
                      - cell [ref=e181]
                    - row [ref=e185]:
                      - cell
                      - cell [ref=e186]
                      - cell [ref=e190]
                  - img
                  - img
                  - img
                  - generic:
                    - generic: SPY
                    - generic:
                      - generic: "100.00"
                      - generic: 00:00
                - generic [ref=e193]:
                  - generic [ref=e194]: ＋ 正敞口 − 负敞口 ◆ 所选节点
                  - generic [ref=e195]: 所选快照参考 · 并非历史演变或预测
              - generic [ref=e196]:
                - generic [ref=e197]:
                  - generic [ref=e198]: 已确认的多周期背离
                  - button "刷新" [ref=e199] [cursor=pointer]
                - generic [ref=e200]:
                  - button "5m · 常规看跌 · 10 根 K 线前确认 · 2026-10-19 15:10 ET · rsi14-w2-s60-v1 · 仅常规背离" [pressed] [ref=e201] [cursor=pointer]:
                    - generic [ref=e202]: 5m
                    - strong [ref=e203]: 常规看跌
                    - generic [ref=e204]: 10 根 K 线前确认
                  - button "30m · 历史不足 · rsi14-w2-s60-v1 · 仅常规背离" [ref=e205] [cursor=pointer]:
                    - generic [ref=e206]: 30m
                    - strong [ref=e207]: 历史不足
                  - button "2h · 历史不足 · rsi14-w2-s60-v1 · 仅常规背离" [ref=e208] [cursor=pointer]:
                    - generic [ref=e209]: 2h
                    - strong [ref=e210]: 历史不足
                  - button "日线 · 常规看跌 · 8 根 K 线前确认 · 2026-10-07 16:00 ET · rsi14-w2-s60-v1 · 仅常规背离" [ref=e211] [cursor=pointer]:
                    - generic [ref=e212]: 日线
                    - strong [ref=e213]: 常规看跌
                    - generic [ref=e214]: 8 根 K 线前确认
                  - button "周线 · 常规看跌 · 0 根 K 线前确认 · 2026-10-16 16:00 ET · rsi14-w2-s60-v1 · 仅常规背离" [ref=e215] [cursor=pointer]:
                    - generic [ref=e216]: 周线
                    - strong [ref=e217]: 常规看跌
                    - generic [ref=e218]: 0 根 K 线前确认
                - generic [ref=e219]: rsi14-w2-s60-v1 · 仅常规背离
                - group [ref=e220]:
                  - generic "方法、确认时间与价格来源" [ref=e221] [cursor=pointer]
            - complementary "查看行权价" [ref=e222]:
              - text: 结构概览
              - heading "从价格到节点" [level=3] [ref=e223]
              - generic [ref=e224]:
                - generic [ref=e225]: $100
                - generic [ref=e226]: →
                - strong [ref=e227]: "103"
              - generic [ref=e228]:
                - term [ref=e229]: 相对快照现价距离
                - definition [ref=e230]: +3 · +3%
                - term [ref=e231]: 有符号净值
                - definition [ref=e232]: +300M
                - term [ref=e233]: 总伽马
                - definition [ref=e234]: 550M
                - term [ref=e235]: 占已覆盖总伽马比例
                - definition [ref=e236]: 80.29%
              - generic [ref=e237]:
                - generic [ref=e238]: 隐含波动距离
                - strong [ref=e239]: 3 σ
                - generic [ref=e240]: 1 天尺度 · 2026-10-19
                - group [ref=e241]:
                  - generic "计算依据" [ref=e242]
              - generic [ref=e243]:
                - generic [ref=e244]: 途经节点
                - paragraph [ref=e245]: 参考现价与此节点之间没有已提供的行权价。
                - generic [ref=e246]: 距离调查，不表示价格路径或到达概率。
              - generic [ref=e248]:
                - text: 已确认的多周期背离
                - heading "SPY · 5m" [level=4] [ref=e249]
                - strong [ref=e250]: 常规看跌
                - generic [ref=e251]:
                  - term [ref=e252]: RSI 参数
                  - definition [ref=e253]:
                    - text: RSI(14) · 枢轴翼宽 2 · 最大跨度 60
                    - text: rsi14-w2-s60-v1 · 仅常规背离
                  - term [ref=e254]: 最后收盘
                  - definition [ref=e255]: 2026-10-19 16:00 ET
                  - term [ref=e256]: 振荡指标枢轴
                  - definition [ref=e257]: 2026-10-19 14:55 ET
                  - term [ref=e258]: 确认时间 / 距今 K 线数
                  - definition [ref=e259]: 2026-10-19 15:10 ET · 10
              - generic [ref=e260]:
                - generic [ref=e261]: 最大净节点
                - button "01 103 +300M" [ref=e262] [cursor=pointer]:
                  - generic [ref=e263]: 01 103
                  - generic [ref=e264]: +300M
                - button "02 98 -90M" [ref=e265] [cursor=pointer]:
                  - generic [ref=e266]: 02 98
                  - generic [ref=e267]: "-90M"
              - paragraph [ref=e268]: 根据未平仓量建模。正负号来自持仓假设，并不代表价格方向。
          - generic [ref=e269]:
            - generic [ref=e270]:
              - generic [ref=e271]:
                - text: 深度分析
                - heading "到期日贡献" [level=3] [ref=e272]
              - generic [ref=e273]:
                - button "对比到期日" [pressed] [ref=e274] [cursor=pointer]
                - button "变化" [ref=e275] [cursor=pointer]
                - button "回放" [ref=e276] [cursor=pointer]
                - button "复盘" [ref=e277] [cursor=pointer]
                - button "情景" [ref=e278] [cursor=pointer]
                - button "曲面" [ref=e279] [cursor=pointer]
                - button "精确值" [ref=e280] [cursor=pointer]
            - table "行权价 × 到期日矩阵" [ref=e282]:
              - rowgroup [ref=e283]:
                - row "所选行权价 2026-10-23 +70M 主节点 103 2026-10-30 +140M 主节点 103" [ref=e284]:
                  - columnheader "所选行权价" [ref=e285]
                  - columnheader "2026-10-23 +70M 主节点 103" [ref=e286]:
                    - button "2026-10-23 +70M 主节点 103" [ref=e287] [cursor=pointer]:
                      - generic [ref=e288]: 2026-10-23
                      - strong [ref=e289]: +70M
                      - generic [ref=e290]: 主节点 103
                  - columnheader "2026-10-30 +140M 主节点 103" [ref=e291]:
                    - button "2026-10-30 +140M 主节点 103" [ref=e292] [cursor=pointer]:
                      - generic [ref=e293]: 2026-10-30
                      - strong [ref=e294]: +140M
                      - generic [ref=e295]: 主节点 103
              - rowgroup [ref=e296]:
                - row "103◆ +100 +200" [ref=e297]:
                  - rowheader "103◆" [ref=e298]:
                    - button "103◆" [ref=e299] [cursor=pointer]
                  - cell "+100" [ref=e300] [cursor=pointer]
                  - cell "+200" [ref=e301] [cursor=pointer]
                - row "98 −30 −60" [ref=e302]:
                  - rowheader "98" [ref=e303]:
                    - button "98" [ref=e304] [cursor=pointer]
                  - cell "−30" [ref=e305] [cursor=pointer]
                  - cell "−60" [ref=e306] [cursor=pointer]
            - paragraph [ref=e307]: 精确到期日单元贡献；未提供的单元不会从边际总值中推算。所有日期可在范围菜单中选择。
          - group [ref=e308]:
            - generic "历史账簿快照" [ref=e309] [cursor=pointer]
          - group [ref=e310]:
            - generic "来源与覆盖" [ref=e311] [cursor=pointer]
        - generic [ref=e312]: 标注与方向标签为启发式近似（~），仅供展示，不构成投资建议。
  - alert [ref=e313]
```

# Test source

```ts
  1408 | // A separate cold-navigation contract. The original journey deliberately applies
  1409 | // Light on each leg; that does not establish persistence across a document load.
  1410 | // This fixture has no live account service: it qualifies the incumbent local
  1411 | // preference/identity consumer, never real-account or production persistence.
  1412 | for (const lang of ["en", "zh"] as const) {
  1413 |   test(`synthetic exposure saved theme cold return ${lang}`, async ({ page, baseURL }, info) => {
  1414 |     test.setTimeout(90_000);
  1415 |     const origin = new URL(baseURL!).origin;
  1416 |     const outside: string[] = [];
  1417 |     await page.context().route("**/*", route => {
  1418 |       const url = new URL(route.request().url());
  1419 |       if (url.origin === origin) return route.continue();
  1420 |       outside.push(`${url.origin}${url.pathname}`);
  1421 |       return route.abort("blockedbyclient");
  1422 |     });
  1423 |     // Reuse options-shortlist-plan's opaque LOCAL session-cookie pattern and
  1424 |     // the canonical fixture principal. Only this Node-owned auth fixture keeps
  1425 |     // the acknowledged metadata between documents; no live account is used.
  1426 |     const user = { id: fixtureUserId("default"), aud: "authenticated", role: "authenticated",
  1427 |       email: "responsive@example.com", app_metadata: {}, created_at: "2026-10-19T00:00:00Z",
  1428 |       user_metadata: { theme: "dark", theme_auto: "0", lang,
  1429 |         prefs: { theme: "dark", themeAuto: "0", lang } } as Record<string, unknown> };
  1430 |     const session = { access_token: "local-exposure-theme-fixture-only",
  1431 |       refresh_token: "local-exposure-theme-fixture-only", token_type: "bearer",
  1432 |       expires_in: 86_400, expires_at: Math.floor(Date.now() / 1000) + 86_400, user };
  1433 |     await page.context().addCookies([
  1434 |       { name: "mm_e2e_rs30", value: "1", url: baseURL! },
  1435 |       { name: "sb-127-auth-token.0", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL! },
  1436 |     ]);
  1437 |     // Opposite to the saved explicit Light choice: auto-mode fallback must not
  1438 |     // make a lost preference appear to survive a cold document load.
  1439 |     await page.emulateMedia({ colorScheme: "dark" });
  1440 |     await page.clock.install({ time: new Date(FIXED_NOW) });
  1441 |     await page.addInitScript(locale => {
  1442 |       // Locale is part of the declared fixture. Theme is NEVER seeded here,
  1443 |       // including after reload: only the reader's Settings action selects it.
  1444 |       (window as unknown as { exposureColdDocumentId: string }).exposureColdDocumentId = crypto.randomUUID();
  1445 |       localStorage.setItem("mm.lang", locale);
  1446 |       Reflect.deleteProperty(window, "EventSource");
  1447 |     }, lang);
  1448 |     expectFixtureInvariants();
  1449 |     await installSyntheticRoutes(page);
  1450 |     let authReads = 0;
  1451 |     const acknowledged: Record<string, unknown>[] = [];
  1452 |     // Reuse the existing options-shortlist-plan in-memory SDK transport seam.
  1453 |     // CSP correctly refuses a real loopback auth connection. This binding never
  1454 |     // requests that connection and changes no policy, cookie guard or app code.
  1455 |     await page.exposeBinding("exposureLocalAccountFixture", async (_source, method: string, body: string | null) => {
  1456 |       if (method === "GET") authReads++;
  1457 |       else if (method === "PUT") {
  1458 |         const patch = JSON.parse(body || "{}").data as Record<string, unknown>;
  1459 |         expect(Object.keys(patch).every(key => ["theme", "theme_auto", "lang", "prefs"].includes(key))).toBe(true);
  1460 |         user.user_metadata = { ...user.user_metadata, ...patch };
  1461 |         acknowledged.push(patch);
  1462 |       } else throw new Error("Unexpected in-memory preference fixture operation");
  1463 |       return user;
  1464 |     });
  1465 |     await page.addInitScript(() => {
  1466 |       const originalFetch = window.fetch.bind(window);
  1467 |       window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  1468 |         const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), location.href);
  1469 |         if (url.pathname.startsWith("/auth/v1/")) {
  1470 |           if (url.origin !== "http://127.0.0.1:54321" || url.pathname !== "/auth/v1/user") throw new Error("Unexpected fixture Auth operation");
  1471 |           const request = input instanceof Request ? input : null;
  1472 |           const method = init?.method ?? request?.method ?? "GET";
  1473 |           const body = typeof init?.body === "string" ? init.body : request ? await request.clone().text() : null;
  1474 |           const fixture = window as unknown as { exposureLocalAccountFixture: (method: string, body: string | null) => Promise<unknown> };
  1475 |           return new Response(JSON.stringify(await fixture.exposureLocalAccountFixture(method, body)), { headers: { "content-type": "application/json" } });
  1476 |         }
  1477 |         return originalFetch(input, init);
  1478 |       };
  1479 |     });
  1480 |     const mt = exposureMapT(lang);
  1481 |     const map = page.getByTestId("exposure-map");
  1482 |     const inspector = page.getByTestId("exposure-node-inspector");
  1483 |     const witness: Record<string, unknown>[] = [];
  1484 |     const record = async (stage: string) => {
  1485 |       const observed = await page.evaluate(() => ({
  1486 |         theme: document.documentElement.dataset.theme,
  1487 |         bodyBackground: getComputedStyle(document.body).backgroundColor,
  1488 |         osPrefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
  1489 |         appearanceOwner: document.documentElement.dataset.terminalAppearance ?? null,
  1490 |         documentId: (window as unknown as { exposureColdDocumentId: string }).exposureColdDocumentId,
  1491 |       }));
  1492 |       witness.push({ stage, ...observed });
  1493 |       return observed;
  1494 |     };
  1495 |     const expectLight = async (stage: string) => {
  1496 |       await expect(page.locator("html"), `saved Light intent survives ${stage}`)
  1497 |         .toHaveAttribute("data-theme", "light");
  1498 |       const observed = await record(stage);
  1499 |       expect(observed.osPrefersDark, `explicit Light is independent of dark OS at ${stage}`).toBe(true);
  1500 |       const rgb = observed.bodyBackground.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
  1501 |       expect(rgb, `computed body background at ${stage}`).toHaveLength(3);
  1502 |       expect(Math.min(...rgb), `Light body background at ${stage}`).toBeGreaterThan(200);
  1503 |     };
  1504 |     try {
  1505 |       await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  1506 |       await expect(map).toHaveAttribute("data-source-session", SESSION);
  1507 |       await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
> 1508 |       await expect.poll(() => authReads, { message: "canonical fixture account actually loaded" }).toBeGreaterThan(0);
       |                                                                                                    ^ Error: canonical fixture account actually loaded
  1509 |       await selectActualLight(page, lang, "s14-first-intent");
  1510 |       await expect.poll(() => user.user_metadata.theme, { message: "Settings preference write acknowledged by local fixture" }).toBe("light");
  1511 |       expect(user.user_metadata.theme_auto, "explicit Settings choice is acknowledged, not auto mode").toBe("0");
  1512 |       await expectLight("initial Settings choice");
  1513 |       await map.getByLabel(mt("scope"), { exact: true }).selectOption(SELECTED_EXPIRY);
  1514 |       const leader = map.getByRole("button", {
  1515 |         name: lang === "en" ? /Largest covered net node/ : /覆盖范围最大净节点/,
  1516 |       });
  1517 |       await expect(leader.locator("strong")).toContainText(String(SELECTED_STRIKE));
  1518 |       await leader.click();
  1519 |       await expect(inspector).toContainText("+200M");
  1520 |       await inspector.getByRole("button", { name: mt("openOnMainChart"), exact: true }).click();
  1521 |       await expect(page).toHaveURL(/\/terminal\?symbol=SPY#exposure=/);
  1522 |       const request = parseExposureChartRequest(new URL(page.url()).hash);
  1523 |       expect(request).toMatchObject({ root: "SPY", session: SESSION, strike: SELECTED_STRIKE,
  1524 |         metric: "gamma", lens: { kind: "one", exp: SELECTED_EXPIRY } });
  1525 |       const reference = page.getByTestId("exposure-chart-reference");
  1526 |       await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  1527 |       await expectLight("main-chart handoff without another Settings action");
  1528 |       const beforeMainReload = await record("before main reload");
  1529 |       const beforeMainReads = authReads;
  1530 |       const mainResponse = await page.reload();
  1531 |       expect(mainResponse?.request().isNavigationRequest()).toBe(true);
  1532 |       expect(mainResponse?.request().resourceType()).toBe("document");
  1533 |       await expect.poll(() => authReads).toBeGreaterThan(beforeMainReads);
  1534 |       await expect(reference).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  1535 |       expect(parseExposureChartRequest(new URL(page.url()).hash)).toEqual(request);
  1536 |       await expectLight("main-chart document reload");
  1537 |       expect((await record("reload witness")).documentId).not.toBe(beforeMainReload.documentId);
  1538 |       await page.screenshot({ path: info.outputPath("saved-theme-main-reloaded.png") });
  1539 |       await reference.getByRole("link", { name: mt("returnToExposure"), exact: true }).click();
  1540 |       await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  1541 |       await expect(map).toHaveAttribute("data-source-session", SESSION);
  1542 |       await expect(map.getByLabel(mt("scope"), { exact: true })).toHaveValue(SELECTED_EXPIRY);
  1543 |       await expect(inspector).toContainText("+200M");
  1544 |       await expect(inspector).not.toContainText("+300M");
  1545 |       await expectLight("exact investigation return");
  1546 |       const beforeReturnReload = await record("before return reload");
  1547 |       const beforeReturnReads = authReads;
  1548 |       const returnResponse = await page.reload();
  1549 |       expect(returnResponse?.request().isNavigationRequest()).toBe(true);
  1550 |       expect(returnResponse?.request().resourceType()).toBe("document");
  1551 |       await expect.poll(() => authReads).toBeGreaterThan(beforeReturnReads);
  1552 |       await expect(page.getByTestId("exposure-return-check")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  1553 |       await expectLight("returned investigation document reload");
  1554 |       expect((await record("return reload witness")).documentId).not.toBe(beforeReturnReload.documentId);
  1555 |       await page.screenshot({ path: info.outputPath("saved-theme-return-reloaded.png") });
  1556 |       // The explicit Dark control must remain usable after the retained Light
  1557 |       // choice; neither this test nor the application rewrites custom settings.
  1558 |       if (info.project.name === "mobile") {
  1559 |         await inspector.getByRole("button", { name: mt("close"), exact: true }).click();
  1560 |         await expect(page.locator(".msheet-scrim")).toHaveCount(0);
  1561 |       }
  1562 |       await selectActualLight(page, lang, "s14-dark-control", "dark");
  1563 |       await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  1564 |     } finally {
  1565 |       await retainSyntheticJson("saved-theme-cold-return.json", {
  1566 |         classification: "SYNTHETIC LOCAL — no live account or production claim",
  1567 |         source: SOURCE_REF, session: SESSION, expiry: SELECTED_EXPIRY,
  1568 |         sourceVersion: "existing coherent four-cell fixture", witness, blockedOutside: outside,
  1569 |         authReads, acknowledgedMetadataWrites: acknowledged,
  1570 |       });
  1571 |     }
  1572 |   });
  1573 | }
  1574 | 
```