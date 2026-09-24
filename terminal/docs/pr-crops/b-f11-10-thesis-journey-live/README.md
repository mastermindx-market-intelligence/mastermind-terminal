# B-F11-10 Thesis Journey — Live Proof | 现场证明

## What this proves | 证明内容

The signed-out gate, thesis creation, reopen, revision, conflict detection, lens,
and archive journey ran against the deployed Terminal at an exact release SHA.
The Phase A receipt proves the anonymous gate; Phase B (signed-in) runs only when
the operator provides a Playwright storage-state file that is not tracked by git.

已登录路径仅在操作员提供未被 git 追踪的 Playwright 存储状态文件时运行。

## How to run | 运行方法

### Prerequisites | 前提条件

The operator signs into their own browser at https://app.mastermind-x.com, then
exports a Playwright storage-state file:

操作员在浏览器中登录后，导出 Playwright 存储状态文件：

```bash
npx playwright codegen --save-storage=e2e/.live-state/state.json https://app.mastermind-x.com
```

The `e2e/.live-state/` directory is git-ignored — nothing in it is ever committed.

`e2e/.live-state/` 目录已被 git 忽略，其中的任何内容都不会被提交。

### Phase A only (anonymous) | 仅 A 阶段（匿名）

```bash
cd terminal
PROOF_RELEASE=$(curl -s https://app.mastermind-x.com/terminal | grep -o 'data-dpl-id="[0-9a-f]*"' | cut -d'"' -f2)
node e2e/tools/prove-thesis-journey-live.mjs
```

### Phase A + Phase B (operator's own signed-in session) | A+B 阶段（操作员自己的登录会话）

```bash
cd terminal
PROOF_RELEASE=$(curl -s https://app.mastermind-x.com/terminal | grep -o 'data-dpl-id="[0-9a-f]*"' | cut -d'"' -f2)
PROOF_STORAGE_STATE=$(pwd)/e2e/.live-state/state.json \
  node e2e/tools/prove-thesis-journey-live.mjs
```

### Environment variables | 环境变量

| Variable 变量 | Default 默认值 | Description 描述 |
|---|---|---|
| `PROOF_BASE_URL` | `https://app.mastermind-x.com` | Deployed Terminal base URL |
| `PROOF_RELEASE` | **(required 必填)** | 40-hex SHA served in `data-dpl-id` |
| `PROOF_STORAGE_STATE` | _(none 无)_ | Path to Playwright storage-state JSON |
| `PROOF_SYMBOL` | `NVDA` | Symbol for the thesis journey |
| `PROOF_LANG` | `en` | `en` or `zh` — when `zh`, reruns steps 6–8 at 390×844 |

## What the receipt proves | 收据证明内容

### Phase A (always runs, anonymous context) | A 阶段（始终运行，匿名上下文）

| Case 场景 | Expected 预期 | What is recorded 记录内容 |
|---|---|---|
| `GET /analysis?symbol=<SYM>` | 200, thesis-workspace absent, heading present | status + heading copy 状态 + 标题文字 |
| `GET /analysis?view=theses` | 200, thesis-workspace absent, heading present | status + heading copy |
| `GET /api/theses` (anonymous) | 401 `{"error":"unauthenticated"}` | status |
| `POST /api/theses` (anonymous create) | 401 | status |
| `GET /api/thesis-saved-views` (anonymous) | 401 | status |

### Phase B (only when PROOF_STORAGE_STATE is set and not git-tracked) | B 阶段（仅在设置了 PROOF_STORAGE_STATE 且未被 git 追踪时运行）

- Navigate to `/terminal?symbol=NVDA` → rail → Theses control (or URL fallback)
  导航至 → 侧边栏 → 论点控制（或 URL 回退）
- Create with title `[proof <release-8-hex>] NVDA journey <ISO timestamp>`
  创建标题为上述格式的论点
- Reopen via reload: title shown, version 1 confirmed
  重新加载：显示标题，确认版本为 1
- Revise with revision note: API confirms `currentVersion` = 2, `previousVersion` = 1
  带修订备注的修订：API 确认当前版本为 2，前一版本为 1
- Conflict: `POST /api/theses` with `expectedVersion: 1` → 409 `version_conflict`
  冲突：用 `expectedVersion: 1` 发送请求得到 409 版本冲突
- Lens: thesis row listed in Theses lens; Coverage lens opens without error
  镜头：论点行显示在论点镜头中；覆盖镜头无错误打开
- Alerts: `/alerts` → 200 + release stamp; thesis notice row recorded (informational)
  提醒：`/alerts` 返回 200 + 发布戳；论点提醒行已记录（仅供参考）
- Archive: lifecycleState confirmed as `archived`
  归档：确认 lifecycleState 为 `archived`（已归档）

## Receipt redaction | 收据脱敏

`lib/thesisJourneyReceipt.ts` exports `redactReceipt()` which strips any key or
string that looks like a cookie, token, authorization header, email, JWT, or
auth user id. The storage-state file path and contents are **never written
anywhere**. A byte-identical copy of `redactReceipt` is inlined in the `.mjs`
tool for standalone execution.

`redactReceipt()` 导出函数会剥离任何看起来像 cookie、令牌、授权头、邮箱、JWT
或认证用户 ID 的键或字符串。存储状态文件路径和内容**永远不会写入任何地方**。
`redactReceipt` 的字节相同副本被内联在 `.mjs` 工具中以供独立执行。
