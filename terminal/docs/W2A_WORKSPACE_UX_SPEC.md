# W2-A Workspace Management UX Spec
Date: 2026-08-26
Authority: W2-A design spec, adjudicated 2026-08-26

STATUS: PASS

RESULT:

Complete implementation-ready design specification for the W2-A Terminal workspace management UX. Nothing was committed (spec-only commission; OWNED FILES: none).

Three governing design decisions:

1. The row unfolds; it never spawns a second popover. Five per-row actions cannot fit as icons in a 230px popover, and a nested popover has no home at ≤860px where the menu already lives inside `.toolbar-overflow-pop` as a drill-down view. A row discloses its actions as an indented stack of ordinary `.menu-row` children — fully labelled in both languages, naturally ≥44px on coarse pointers, one dismissal rule, identical in both mount sites.
2. The stale-revision conflict is a fork in the menu, not an interruption. The user is mid-session on a live chart, and neither version is wrong. It renders as a `--warn`-railed block in the existing feedback slot with two peer buttons, plus a `--warn` rail on the affected row so the object is visible where it lives. This is the signature moment.
3. Three zones, three questions. Header = make one (name + Save + assistant-dock toggle). Body = pick one (the library, the only scrolling region). Footer = bring one in (Import).

---

## 1. Component structure and CSS

### 1.1 Structure

File stays `/Users/chriswong/Documents/Cluade/charting-app/terminal/components/LayoutMenu.tsx` (renaming the file churns two call sites for nothing). Props extend the existing `layoutMenuProps` object at `TerminalShell.tsx:4189–4201`.

```tsx
export type LayoutStatus = "loading" | "auth" | "unavailable" | "ready";   // UNCHANGED (LayoutMenu.tsx:22)

// EXTENDED — every new kind maps a frozen §8 code to plain copy at the render site, never a raw code.
export type LayoutFeedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; name: string }
  | { kind: "renamed" } | { kind: "duplicated" } | { kind: "imported" }
  | { kind: "error"; message: string }                                  // existing catch-all
  | { kind: "conflict"; name: string; suggested: string; op: "save" | "rename" | "duplicate" | "import" }
  | { kind: "stale"; name: string; savedAgo: string };                  // savedAgo pre-formatted by the caller

// Per-row read state derived by the reader, NEVER by the menu.
export type RowState = "ok" | "unsupported_floor" | "unsupported_schema";
export type SavedWorkspace = SavedLayout & { rowState: RowState };
```

```tsx
<>
  {/* ── ZONE 1 · CREATE ─────────────────────────────────────────────── */}
  {/* UNCHANGED shell — LayoutMenu.tsx:58-74. Only the placeholder copy changes (§2). */}
  <div className="menu-save" data-layout-save>
    <input placeholder={isGuest ? t("layoutSignInToSave") : t("saveCurrentAs")} … />
    <button type="button" data-layout-save-btn disabled={isGuest || saving} …>
      {saving ? t("layoutSaving") : t("save")}
    </button>
  </div>

  {/* NEW — membership of the CURRENT workspace, so it belongs with "what am I about to save",
      never on a saved row (a per-row switch would falsely imply per-row editing). */}
  <button
    type="button" className="ws-dock" role="switch" aria-checked={brainInWorkspace}
    data-ws-dock-toggle disabled={isGuest} onClick={onToggleBrainDock}
  >
    <span className="ws-dock-copy">
      <span>{t("wsIncludeBrain")}</span>
      <small>{t("wsIncludeBrainSub")}</small>
    </span>
    <StateSwitch on={brainInWorkspace} />   {/* lifted from IndicatorsModal.tsx:124 — see §1.3 */}
  </button>

  {/* UNCHANGED — LayoutMenu.tsx:76-81 */}
  {isGuest && (
    <button type="button" role="menuitem" className="menu-row layout-gate" data-layout-gate onClick={onSignUp}>
      <span>{t("gateLayouts")}</span><span className="layout-gate-cta">{t("gateSignupCta")}</span>
    </button>
  )}

  {/* ── FEEDBACK SLOT — same position as today (LayoutMenu.tsx:83-91) ── */}
  {feedback.kind === "saved"      && <div className="menu-note ok" role="status" data-layout-feedback="saved">{t("layoutSaved")}</div>}
  {feedback.kind === "renamed"    && <div className="menu-note ok" role="status" data-layout-feedback="renamed">{t("wsRenamed")}</div>}
  {feedback.kind === "duplicated" && <div className="menu-note ok" role="status" data-layout-feedback="duplicated">{t("wsDuplicated")}</div>}
  {feedback.kind === "imported"   && <div className="menu-note ok" role="status" data-layout-feedback="imported">{t("wsImported")}</div>}
  {feedback.kind === "error"      && <div className="menu-note bad" role="alert" data-layout-feedback="error">{feedback.message}</div>}

  {/* NEW — name_conflict. Inline error + the suggested free name as a one-tap action (freeze §11). */}
  {feedback.kind === "conflict" && (
    <div className="ws-suggest" role="alert" data-ws-conflict={feedback.op}>
      <span>{t("wsNameTaken")}</span>
      <button type="button" data-ws-use-suggested onClick={() => onUseSuggested(feedback)}>
        {`${t("wsUseSuggested")} “${feedback.suggested}”`}
      </button>
    </div>
  )}

  {/* NEW — stale_revision. THE SIGNATURE SURFACE. Two peers, no primary, no modal. */}
  {feedback.kind === "stale" && (
    <div className="ws-conflict" role="group" aria-labelledby="ws-stale-hd" data-ws-stale={feedback.name}>
      <b id="ws-stale-hd" role="alert">{t("wsChangedElsewhere")}</b>
      <p>{`${t("wsChangedElsewhereSub")} ${feedback.savedAgo}`}</p>
      <div className="ws-fork">
        <button type="button" data-ws-fork="reload" onClick={onReloadLatest}>{t("wsReloadLatest")}</button>
        <button type="button" data-ws-fork="copy"   onClick={onSaveAsCopy}>{t("wsSaveAsCopy")}</button>
      </div>
    </div>
  )}

  {deleteError && <div className="menu-note bad" role="alert" data-layout-delete-error>{deleteError}</div>}

  {/* ── STATUS ROWS — UNCHANGED semantics (LayoutMenu.tsx:93-102).
      `unavailable` still renders ABOVE the last-good list, never instead of it. ── */}
  {status === "loading" && <div className="menu-row empty" data-layout-status="loading">{t("layoutsLoading")}</div>}
  {status === "unavailable" && (
    <div className="menu-note bad" role="alert" data-layout-status="unavailable">
      <span>{t("layoutsUnavailable")}</span>
      <button type="button" className="menu-note-retry" data-layout-retry onClick={onRetry}>{t("layoutRetry")}</button>
    </div>
  )}
  {status === "ready" && layouts.length === 0 && (
    <div className="menu-row empty" data-layout-status="empty">{t("noSavedLayouts")}</div>
  )}

  {/* ── ZONE 2 · LIBRARY — the ONLY scrolling region (desktop only; see §1.2 nested-scroll note) ── */}
  {layouts.length > 0 && <div className="ws-hd">{t("wsSectionSaved")}</div>}
  <div className="ws-list" data-ws-list>
    {layouts.map((l) => {
      const blocked = l.rowState !== "ok";
      const open = openRow === l.id;
      return (
        <div key={l.id}
             className={`ws-item${open ? " open" : ""}${blocked ? " blocked" : ""}${staleName === l.name ? " stale" : ""}`}
             data-layout-row={l.name} data-ws-state={l.rowState}>

          {renamingId === l.id ? (
            /* ── RENAME MODE — inline, in place. Precedent: IndicatorsModal.tsx:608-623. ── */
            <div className="ws-rename">
              <input autoFocus value={draft} aria-label={t("rename")} data-ws-rename-input
                     onFocus={(e) => e.currentTarget.select()}
                     onChange={(e) => setDraft(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === "Enter") { e.preventDefault(); onRename(l, draft); }
                       else if (e.key === "Escape") { e.stopPropagation(); cancelRename(); }
                     }}
                     onBlur={cancelRename} />
              {/* mousedown-preventDefault is LOAD-BEARING: without it the input blurs (→ cancel)
                  before click fires, and the commit button can never be reached with a mouse. */}
              <button type="button" aria-label={t("wsRenameSave")} data-ws-rename-commit
                      onMouseDown={(e) => e.preventDefault()} onClick={() => onRename(l, draft)}>
                <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>
              </button>
              <button type="button" aria-label={t("wsCancel")} data-ws-rename-cancel
                      onMouseDown={(e) => e.preventDefault()} onClick={cancelRename}>
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          ) : (
            /* ── REST MODE. The whole row is still "open this workspace" — the primary job,
                 unchanged from today (LayoutMenu.tsx:104-121), now a real <button>. ── */
            <Row type="button" {...(rowAs === "button" ? { role: "menuitem" } : {})}
                 className="menu-row" disabled={blocked}
                 onClick={blocked ? undefined : () => { onLoad(l); onPicked?.(); }}>
              <span className="ws-name">{l.name}</span>
              {l.rowState === "unsupported_floor"  && <span className="ws-badge warn">{t("wsBadgeNewer")}</span>}
              {l.rowState === "unsupported_schema" && <span className="ws-badge">{t("wsBadgeUnreadable")}</span>}
              <span className="ws-more" role="button" tabIndex={0}
                    aria-label={`${t("wsRowActions")}: ${l.name}`}
                    aria-expanded={open} aria-controls={`ws-subs-${l.id}`}
                    data-ws-more={l.name}
                    onClick={(e) => { e.stopPropagation(); toggleRow(l.id); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleRow(l.id); } }}>
                <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
              </span>
            </Row>
          )}

          {/* Why a row is not openable — plain words, never hidden, never a code. */}
          {blocked && (
            <div className="ws-hint" data-ws-hint>
              {l.rowState === "unsupported_floor" ? t("wsNeedsNewer") : t("wsCantOpen")}
            </div>
          )}

          {/* ── ACTIONS — an indented stack of ordinary .menu-row children, not an icon bar. ── */}
          {open && (
            <div className="ws-subs" id={`ws-subs-${l.id}`} role="group" aria-label={l.name}>
              {!blocked && <>
                <button type="button" role="menuitem" className="menu-row" data-ws-act="open"
                        onClick={() => { onLoad(l); onPicked?.(); }}>
                  <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 9h16M9 9v10" /></svg>{t("wsOpen")}
                </button>
                <button type="button" role="menuitem" className="menu-row" data-ws-act="rename"
                        onClick={() => { setDraft(l.name); setRenamingId(l.id); }}>
                  <svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3M13.5 6.5l3 3" /></svg>{t("rename")}
                </button>
                <button type="button" role="menuitem" className="menu-row" data-ws-act="duplicate"
                        onClick={() => onDuplicate(l)}>
                  <svg viewBox="0 0 24 24"><path d="M8 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M11 21h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" /></svg>{t("wsDuplicate")}
                </button>
              </>}
              {/* Export survives on a blocked row: it is how the user rescues a payload
                  this build cannot open. The bytes are untouched (freeze §6). */}
              <button type="button" role="menuitem" className="menu-row" data-ws-act="export"
                      onClick={() => onExport(l)}>
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>{t("wsExport")}
              </button>
              <button type="button" role="menuitem" className="menu-row danger" data-ws-act="delete"
                      onClick={() => onDelete(l.id)}>
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>{t("delete")}
              </button>
            </div>
          )}
        </div>
      );
    })}
  </div>

  {/* ── ZONE 3 · BRING ONE IN — pinned below the list, outside the scroll region ── */}
  <div className="ws-sep" />
  <button type="button" role="menuitem" className="menu-row ws-import" data-ws-import
          disabled={isGuest} onClick={onImport} ref={importBtnRef}>
    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12" /></svg>
    {t("wsImport")}
  </button>
</>
```

`rowAs` semantics change (deliberate): today `rowAs="div"` renders a non-focusable `<div onClick>` on desktop (`LayoutMenu.tsx:43, 105-111`), so the desktop menu is keyboard-dead. The prop now controls only `role="menuitem"`; the element is always a `<button>`. This removes the exact divergence the file's own header comment (lines 5–7) exists to prevent.

### 1.2 New CSS — exact values

Append after the existing layout-menu block (`globals.css:1502–1521`). Every value is an existing token or a literal lifted from a cited rule.

```css
/* ── W2-A workspace menu. Extends .pop (globals.css:1043) and the .menu-row family (1502-1521). ── */

/* Section label: promotes the inline style at TerminalShell.tsx:4573 (.menu-hd) to a real class. */
.ws-hd{padding:7px 12px 5px;font:700 var(--fs-micro)/1.2 var(--font-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)}
.ws-sep{height:1px;background:var(--line);margin:4px 7px}          /* cf. .tooldock .sp — globals.css:265 */

/* The library scrolls; header and footer stay put. Desktop ONLY: .toolbar-overflow-pop already
   scrolls itself (globals.css:246), and a scroller inside a scroller is worse than a long menu. */
.ws-list{display:flex;flex-direction:column}
.pop:not(.toolbar-overflow-pop) .ws-list{max-height:min(56dvh,420px);overflow-y:auto;overscroll-behavior:contain}

.ws-item{display:flex;flex-direction:column}
.ws-item.open{background:color-mix(in srgb,var(--brand) 6%,transparent);border-radius:var(--r)}
.ws-item.stale{box-shadow:inset 3px 0 0 var(--warn);border-radius:var(--r)}   /* cf. .wl-row.selected — 439 */
.ws-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}  /* cf. .wl-sec-nm — 416 */

.ws-more{margin-left:auto;flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:var(--r);color:var(--text-dim);cursor:pointer}
.ws-more:hover{background:var(--panel-3);color:var(--text)}         /* cf. .wl-sec-ic:hover — 424 */
.ws-more:focus-visible{outline:2px solid var(--brand-2);outline-offset:-2px}
.ws-more svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;transition:transform var(--t-fast) var(--ease-out)}
.ws-item.open .ws-more svg{transform:rotate(90deg)}

.ws-subs{display:flex;flex-direction:column;margin:0 7px 4px 20px;padding-left:6px;box-shadow:inset 2px 0 0 var(--line-3)}
.ws-subs .menu-row{width:100%;border:0;background:none;text-align:left;font-size:var(--fs-label);padding:7px 9px;gap:8px}
.ws-subs .menu-row svg{width:13px;height:13px}
/* .menu-row.danger already exists (globals.css:426) and is used here for the first time. */

.ws-badge{flex:none;display:inline-flex;align-items:center;padding:2px 7px;border:1px solid var(--line);border-radius:var(--r-pill);font:600 var(--fs-micro)/1.4 var(--font-ui);letter-spacing:.05em;text-transform:uppercase;color:var(--text-dim);white-space:nowrap}
.ws-badge.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 42%,transparent)}
/* CJK never wants tracking; uppercase is a no-op there but the letter-spacing is not. */
[data-lang="zh"] .ws-hd,[data-lang="zh"] .ws-badge{letter-spacing:0}

.ws-item.blocked .menu-row{color:var(--text-dim);cursor:default}
.ws-item.blocked .menu-row:hover{background:none;color:var(--text-dim)}
.ws-hint{margin:0 7px 5px 26px;font:400 var(--fs-label)/1.4 var(--font-ui);color:var(--muted);white-space:normal}

/* THE FORK. --warn, not --danger: nothing failed and nothing was lost — two valid versions exist.
   Shape lifted verbatim from .intel .verd (globals.css:1495). --warn:#e8a33d is not flipped by
   any locale convention (see the comment at globals.css:1515). */
.ws-conflict{margin:1px 7px 4px;padding:8px 10px;border-left:3px solid var(--warn);border-radius:0 var(--r) var(--r) 0;background:rgba(232,163,61,.09);white-space:normal}
.ws-conflict b{display:block;font:650 var(--fs-ui)/1.35 var(--font-ui);color:var(--text)}
.ws-conflict p{margin:3px 0 8px;font:400 var(--fs-label)/1.4 var(--font-ui);color:var(--text-2)}
.ws-fork{display:flex;gap:6px;flex-wrap:wrap}
/* Peers by construction: same height, same border, same weight, no filled button. */
.ws-fork button{height:28px;padding:0 11px;border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);border-radius:var(--r-pill);background:none;color:var(--warn);font:600 var(--fs-label)/1 var(--font-ui);white-space:nowrap;cursor:pointer}
.ws-fork button:hover{background:color-mix(in srgb,var(--warn) 14%,transparent)}

.ws-rename{display:flex;gap:6px;align-items:center;padding:4px 7px}
.ws-rename input{min-width:0;flex:1;height:32px;padding:0 9px;border:1px solid var(--brand);border-radius:var(--r);outline:0;background:var(--panel-2);color:var(--text);font:var(--fs-ui)/1 var(--font-ui);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 13%,transparent)}   /* = .li-rename, globals.css:900 */
.ws-rename button{flex:none;width:30px;height:30px;display:grid;place-items:center;border-radius:var(--r);color:var(--muted);cursor:pointer}  /* = .li-ic, globals.css:896 */
.ws-rename button:hover{background:var(--panel-3);color:var(--text)}
.ws-rename button svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2}

/* name_conflict: --danger, consistent with .menu-note.bad (1518) — the write did not happen. */
.ws-suggest{display:flex;align-items:center;gap:8px;margin:1px 7px 4px;padding:6px 9px;border-radius:var(--r);background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger);font:400 var(--fs-label)/1.35 var(--font-ui);white-space:normal}
.ws-suggest button{margin-left:auto;flex:none;padding:2px 9px;border:1px solid currentColor;border-radius:var(--r-pill);color:inherit;background:none;font:600 var(--fs-label)/1.5 var(--font-ui);white-space:nowrap;cursor:pointer}  /* = .menu-note-retry, globals.css:1519 */

.ws-dock{display:flex;align-items:center;gap:10px;width:100%;padding:6px 11px 8px;color:var(--text-2);font:var(--fs-ui)/1.3 var(--font-ui);text-align:left;background:none;border:0;cursor:pointer;white-space:normal}
.ws-dock:hover{color:var(--text)}
.ws-dock:disabled{opacity:.45;cursor:not-allowed}                    /* = .menu-save :disabled, 1511 */
.ws-dock-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.ws-dock small{font:400 var(--fs-label)/1.3 var(--font-ui);color:var(--muted)}

/* Touch floors. Precedent: @media (pointer:coarse){.pf-act{min-height:44px}} — globals.css:1281. */
@media (pointer:coarse){
  .ws-list .menu-row,.ws-subs .menu-row,.menu-row.ws-import{min-height:44px}
  .ws-more{width:44px;height:44px}
  .ws-fork button{height:44px;padding:0 14px}
  .ws-rename input{height:44px}
  .ws-rename button{width:44px;height:44px}
  .ws-suggest button{min-height:36px;padding:0 12px}
  .ws-dock{min-height:44px}
}
@media (prefers-reduced-motion:reduce){.ws-more svg{transition:none}}
```

One inline-style change at the desktop mount: `TerminalShell.tsx:4566` — `minWidth: 230` → `minWidth: 300`. A name (~150px ellipsized) + badge + chevron does not fit in 230.

### 1.3 One mechanical prerequisite

`StateSwitch` is currently a private function inside `IndicatorsModal.tsx:124`; its CSS (`.im-state-switch`, `globals.css:868–876`) is already global. Lift the component to `terminal/components/StateSwitch.tsx` and import it in both files. No CSS change, no visual change.

---

## 2. EN / ZH copy table

`LEX` tuples in `terminal/lib/i18n.tsx:18`, shape `key: [en, zh]`. Per that file's own comment (lines 11–15) a key name is an id, never copy — existing keys keep their ids and get new values.

### 2.1 Existing keys, value changes

| key | EN | ZH |
|---|---|---|
| `layouts` | `Workspaces` | `工作区` |
| `saveCurrentAs` | `Save this workspace as…` | `将此工作区另存为…` |
| `layoutSaved` | `Workspace saved` | `工作区已保存` |
| `noSavedLayouts` | `No saved workspaces yet. Save the current one to start.` | `还没有已保存的工作区。先保存当前的工作区。` |
| `layoutsLoading` | `Loading your workspaces…` | `正在加载您的工作区…` |
| `layoutsUnavailable` | `Your workspaces can't be reached right now. What's listed below was loaded earlier.` | `暂时无法读取您的工作区。下方列出的是此前加载的内容。` |
| `layoutSaveFailed` | `Couldn't save — nothing was stored.` | `保存失败 —— 未写入任何内容。` |
| `layoutDeleteFailed` | `Couldn't delete — it's still in your account.` | `删除失败 —— 仍保留在您的账户中。` |
| `layoutSignInToSave` | `Sign in to save workspaces` | `登录后可保存工作区` |
| `gateLayouts` | `Create a free account to save workspaces.` | `注册免费账户即可保存工作区` |

Unchanged: `save`, `layoutSaving`, `layoutRetry`, `gateSignupCta`, `delete`.
Reuse if present (used at `IndicatorsModal.tsx:613`): `rename` → `["Rename","重命名"]`; mint only if absent.

### 2.2 New keys

| key | EN | ZH |
|---|---|---|
| `wsSectionSaved` | `Saved workspaces` | `已保存的工作区` |
| `wsIncludeBrain` | `Include the assistant dock` | `包含助手面板` |
| `wsIncludeBrainSub` | `Saved as part of this workspace.` | `将作为此工作区的一部分保存。` |
| `wsRowActions` | `More actions` | `更多操作` |
| `wsOpen` | `Open` | `打开` |
| `wsDuplicate` | `Duplicate` | `创建副本` |
| `wsExport` | `Export to a file` | `导出为文件` |
| `wsImport` | `Import from a file…` | `从文件导入…` |
| `wsRenameSave` | `Save name` | `保存名称` |
| `wsCancel` | `Cancel` | `取消` |
| `wsRenamed` | `Name changed` | `名称已更改` |
| `wsDuplicated` | `Copy created` | `副本已创建` |
| `wsImported` | `Workspace imported` | `工作区已导入` |

Failures — every frozen §8 code mapped to plain words. No code ever reaches the screen.

| code (§8) | key | EN | ZH |
|---|---|---|---|
| `name_conflict` | `wsNameTaken` | `That name is already used.` | `该名称已被使用。` |
| ″ (action) | `wsUseSuggested` | `Use` | `改用` |
| `stale_revision` | `wsChangedElsewhere` | `This workspace was changed on another device.` | `此工作区已在其他设备上被修改。` |
| ″ | `wsChangedElsewhereSub` | `Nothing was overwritten. Pick which one to keep — saved` | `没有覆盖任何内容。请选择保留哪一个 —— 保存于` |
| ″ | `wsReloadLatest` | `Open the saved one` | `打开已保存的版本` |
| ″ | `wsSaveAsCopy` | `Keep mine as a copy` | `将我的另存为副本` |
| `unsupported_floor` | `wsBadgeNewer` | `Newer version` | `更新版本` |
| ″ | `wsNeedsNewer` | `Saved by a newer version of the Terminal. Update to open it.` | `由更新版本的终端保存。更新后即可打开。` |
| `unsupported_schema` | `wsBadgeUnreadable` | `Can't open` | `无法打开` |
| ″ | `wsCantOpen` | `This Terminal doesn't recognise this format. It's left exactly as it was saved — export keeps a copy.` | `此终端无法识别该格式。内容保持保存时的原样 —— 导出可保留一份副本。` |
| `invalid_import` | `wsImportBad` | `That file isn't a workspace this Terminal can open. Nothing was imported.` | `该文件不是此终端可以打开的工作区。未导入任何内容。` |
| `oversized_workspace` | `wsImportTooBig` | `That workspace file is too large to open. Nothing was imported.` | `该工作区文件过大，无法打开。未导入任何内容。` |
| `too_many_widgets` | `wsImportTooManyPanels` | `That workspace holds more panels than one workspace can. Nothing was imported.` | `该工作区包含的面板数量超出上限。未导入任何内容。` |
| `unknown_widget_type` (write) | `wsImportUnknownPanel` | `That workspace uses a panel this Terminal doesn't have. Nothing was imported.` | `该工作区使用了此终端没有的面板。未导入任何内容。` |
| `not_found` | `wsGone` | `That workspace is no longer in your account.` | `该工作区已不在您的账户中。` |
| rename failure | `wsRenameFailed` | `Couldn't rename — the old name is still in use.` | `重命名失败 —— 仍在使用原名称。` |
| duplicate failure | `wsDuplicateFailed` | `Couldn't make a copy — nothing was added.` | `创建副本失败 —— 未添加任何内容。` |
| export failure | `wsExportFailed` | `Couldn't export this workspace.` | `导出此工作区失败。` |
| `store_unavailable` | reuse `layoutsUnavailable` | | |
| `unauthenticated` | reuse `layoutSignInToSave` / `gateLayouts` | | |
| `malformed_workspace`, `invalid_widget_config`, `duplicate_widget_id`, `invalid_lane`, `invalid_port` | reuse `wsImportBad` on the import path; reuse `wsCantOpen` + `ws-badge` (no `.warn`) on the read path | | |

Unsupported-widget tile:

| key | EN | ZH |
|---|---|---|
| `wsPanelUnavailable` | `This panel isn't available in this version` | `此面板在当前版本中不可用` |
| `wsPanelUnavailableSub` | `The rest of this workspace opened normally.` | `此工作区的其余部分已正常打开。` |
| `wsPanelType` | `Panel type` | `面板类型` |

Vocabulary: "panel", never "widget" — the product already owns "pane" for a chart pane; "panel"/`面板` is distinct, plain, natural in both languages. Every failure string states what happened and what state the data is in ("nothing was imported", "left exactly as it was saved"). Freeze §11 forbids silent drops, so the copy carries the guarantee.

---

## 3. Interaction flows

### 3.1 Rename — inline, in place (not a dialog)

The codebase already ruled on this twice — `TerminalShell.tsx:3358` ("Inline input rather than window.prompt: a browser prompt is modal, unstyleable, and looks nothing like the rest of the app") and `IndicatorsModal.tsx:608–623` renaming a script with an in-row `<input className="li-rename">` — and at 390×844 the menu is already a drill-down inside a popover, where a third stacked layer has nowhere to live.

- Entering rename replaces the row with the input, autofocused, text selected (`onFocus → select()`), so typing replaces rather than appends.
- Enter commits · Escape cancels (stopPropagation, so it does not also close the popover) · blur cancels, not commits.
- Blur-cancel is a deliberate divergence from `IndicatorsModal.tsx:622`'s `onBlur={commitRename}`: a rename here can return `name_conflict`, and firing that write after focus has left means the error lands where nobody is looking. Both explicit controls carry `onMouseDown={(e) => e.preventDefault()}` so the input never blurs before their click resolves.
- On success: revision bumps once (freeze §4/§5, atomic), the list refreshes, `.menu-note ok` shows `wsRenamed`, focus returns to the row's `⋯`.
- On `name_conflict`: the `.ws-suggest` strip appears, the input stays open with the typed text intact, and `Use “<free name>”` fills the input rather than committing — the user still confirms.

### 3.2 Duplicate

One click, no naming step. The store mints the free name via the existing `nextLayoutName` collision-free naming (`TerminalShell.tsx:4125`, freeze §5); revision resets to 1; the list refreshes and the new row highlights with `.ws-item.on` for one refresh cycle. Rename is one row away if the user wants a different name — asking for a name up front turns a one-click action into a form. `wsDuplicated` on success; `wsDuplicateFailed` on failure.

### 3.3 Export

Downloads the canonical envelope (freeze §11: name filled from the row, revision, provenance; never user ids, row uuids, paths). Mechanics follow `exportList` (`TerminalShell.tsx:3296–3306`): Blob → `URL.createObjectURL` → synthetic `<a download>` → click → revoke.

Filename: `` `${safeName}.workspace.json` ``, where

```
safeName = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "workspace"
```

Do not inherit `exportList`'s `replace(/[^\w.-]+/g, "_")` — `\w` is ASCII-only, so a zh workspace named `交易台` exports as `___.csv`. This version strips only filesystem-hostile characters and keeps every script. The `.workspace.json` double suffix makes the file self-identifying in a Downloads folder and gives Import a meaningful `accept` filter.

### 3.4 Import — file pick → validate → error / conflict

Mechanics follow `importList` (`TerminalShell.tsx:3312–3346`): a programmatic, never-rendered `<input type="file">`, `accept=".json,application/json"`, `input.click()`.

1. No file chosen (picker cancelled) → nothing happens, no note, no state change.
2. File read → validate schema → vocabulary → limits → per-widget config (freeze §11).
3. Any failure → the specific inner code maps to its plain-word string from §2.2 and renders in the existing `.menu-note bad` slot. Every one of those strings ends in "Nothing was imported." — §11 forbids partial success reported as success, so the copy carries the guarantee.
4. Success → a NEW workspace (new identity, revision 1, `migration.source = "import"`), list refreshes, `.menu-note ok` shows `wsImported`, the new row highlights.
5. `name_conflict` → the `.ws-suggest` strip with `Use “<free name>”`. The import is held, not discarded: one click on the suggested name completes it. No re-pick of the file.
6. Guest → the Import row is `disabled`; the gate row above already explains why, so no second explanation.

### 3.5 Stale revision — the fork

Triggered when a save-over returns `stale_revision` (freeze §4: 0 rows updated, follow-up read distinguishes it from `not_found`).

- The `.ws-conflict` block occupies the feedback slot; the affected row simultaneously gains `.ws-item.stale` (a `--warn` inset rail) so the object is identifiable in the list.
- Copy names the fact and the state: "This workspace was changed on another device." / "Nothing was overwritten. Pick which one to keep — saved 3 minutes ago." The word revision never appears, and neither does "conflict".
- Two peers, no primary. `Open the saved one` re-reads and applies the stored workspace, discarding the on-screen arrangement. `Keep mine as a copy` performs a create with a free name derived from the current one. Identical geometry, identical weight — the product genuinely does not know which is right, and a filled primary button would be a lie about that.
- Either choice clears the block and the row rail. Escape does not dismiss it (an unresolved decision, not a notification); closing the popover does, and the state is re-derived on the next save attempt.

### 3.6 Brain-dock toggle

Lives in Zone 1, directly under the name+Save row — a property of the workspace you are about to save, not of any stored row. Copy: "Include the assistant dock" / `包含助手面板`, sub-line "Saved as part of this workspace." / `将作为此工作区的一部分保存。`

- `role="switch"`, `aria-checked`, reusing `StateSwitch` / `.im-state-switch` (`globals.css:868`).
- It reflects live state: loading a workspace whose `widgets` include `brain` turns it on; loading one without turns it off. It is therefore both control and honest readout — no separate indicator needed.
- Toggling it adds/removes the `brain-dock` widget from the live workspace immediately (the Brain dock appears/disappears), so the switch is never a promise about a future save.
- Disabled for guests, like Save.

### 3.7 Unreadable-settings disclosure

Added post-launch (reviewer ruling B1/B2, Amendment A3's direction-scoped lossless law): reading a workspace is now TOLERANT (`migrateLegacy(config, false)`) rather than strict — a legacy or otherwise-degraded row that has exactly one bad chart-config field opens anyway, with that ONE field silently no-claimed (never invented, never blocking the row). The freeze forbids a silent drop from ever going unmentioned to the user (§11's "never silently drops... and reports success" law extends here even though this is a load, not an import), so the drop surfaces as a durable disclosure rather than nothing at all.

- **Surface**: the existing feedback slot, `<div className="menu-note" role="status" data-ws-unclaimed>` — the SAME visual family as `layoutSaved`/`wsRenamed`/etc. (`.menu-note`), but independent of the `feedback` transient-state machine: it does not compete with, replace, or get replaced by whatever `feedback.kind` is currently showing.
- **Copy**: `wsUnclaimedNote` — "Some settings in this workspace couldn't be read. They'll be left out if you save it." / "此工作区的部分设置无法读取。保存时这些设置将不会保留。" States the fact (some settings unreadable) and the consequence (a save would drop them) — never a field name, never a raw §8 code.
- **Lifecycle**: appears the moment a workspace whose tolerant migration returned a non-empty `unclaimed` list finishes loading; persists for as long as THAT workspace stays the loaded one (surviving renames, rename-conflict retries, the stale-revision fork — anything that does not load a DIFFERENT workspace); clears the instant a different workspace is loaded, the current one is deleted, or a fresh capture is successfully saved (a save always captures the LIVE in-memory state through the strict/lossless path, so post-save the workspace is clean by construction — see §M4 below). Never a toast, never auto-dismissing.
- **Interaction with export** (§3.3): an "ok" row whose tolerant migration still has a non-empty `unclaimed` exports the RAW stored bytes, not the migrated envelope — the migrated envelope is deliberately missing the field(s) tolerant mode dropped, so it is the WORSE of the two artifacts to hand the user for a rescue. A genuinely clean "ok" row still exports the (byte-identical) migrated envelope as before.
- **Interaction with save (M4)**: `captureWorkspace` (the capture of the LIVE, currently-rendered workspace — not the stored row) is a completely separate operation from the disclosure above; a corrupted/hostile LIVE state that captureWorkspace itself cannot cleanly capture is refused outright (`wsSaveUnreadable`, never a silent narrower save) rather than surfaced as this note. The two failure modes look similar in one sentence each but are checked at different moments: load-time tolerance (this section) vs. save-time refusal (M4).

**Unsupported-panel disclosure (reviewer ruling M5b).** M5's own tolerant-read fix (a widget whose `type` this build does not recognize opens the row anyway, degrading to a `WorkspaceTile` fallback) creates a second, DIFFERENT silent-drop risk: a save re-captures only the widgets this build knows how to render (the primary chart, the Brain dock), so saving over a row carrying an unrecognized-type widget would remove that widget with no warning at all — the row would open clean, look intact, and lose a panel on the very next save. §11's "never silently drops" law applies here exactly as it does to the field-level case above, so this gets its OWN, separate disclosure rather than being folded into `unclaimedFields`'s field-name list (a widget id is not a field name, and a reader should never have to guess which kind of loss a single note is warning about):

- **Surface**: a SECOND `<div className="menu-note" role="status" data-ws-unsupported-panels>` in the same feedback slot, rendered independently of (and possibly alongside) the `data-ws-unclaimed` note above — a workspace can have unclaimed fields, unsupported panels, both, or neither.
- **Copy**: `wsUnclaimedPanels` — "This workspace holds a panel this version can't open. Saving will remove that panel." / "此工作区包含当前版本无法打开的面板。保存将移除该面板。"
- **Lifecycle**: identical to the field-level note — appears the moment a load's tolerant migration reports a non-empty `unsupportedWidgets` list (the ids of the dropped widgets, from `migrateLegacy`'s `strict=false` result), persists while that workspace stays loaded, clears on loading a different workspace, on delete, or on a fresh successful save (a save that survived is, by construction, a re-capture holding only widgets this build renders — the unsupported panel is genuinely gone, and the note correctly stops warning about it).
- **Interaction with the M5 tile**: the note and the `WorkspaceTile` fallback are not redundant — the tile is a per-widget RENDER affordance (shows the unknown type inline, where that widget would sit), while the note is a workspace-level WARNING that the render is a preview of something a save will erase. A user can see both, see neither (a clean workspace), or see the tile with no note only if they are looking at a row `exportWorkspaceAction` (§3.3) would have to serve raw for other reasons — in the normal "ok" load path the two always appear together for the same dropped widget.

---

## 4. Keyboard and focus

| element | behavior |
|---|---|
| menu opens | focus → `.menu-save input` (the primary action). Guest → focus the `.layout-gate` row, since the input is disabled. |
| workspace row | real `<button>` in both mounts (removes today's keyboard-dead desktop rows). Enter/Space = open the workspace. `disabled` on a blocked row, so Tab skips it. |
| `.ws-more` | `tabIndex={0}`, `aria-expanded`, `aria-controls="ws-subs-<id>"`. Enter/Space toggles. It sits inside the row button, so its handlers call `stopPropagation` on click and keydown. |
| unfold | opening focuses the first sub-row (`Open`). Accordion: opening one row closes any other. Collapsing returns focus to `.ws-more`. |
| sub-rows | `role="menuitem"`, natural tab order. |
| rename input | autofocus + select-all. Enter commits · Escape cancels (stopPropagation) · blur cancels. `wsRenameSave` / `wsCancel` buttons carry `onMouseDown → preventDefault`. |
| Escape (two-stage) | 1st: exits rename, else collapses the open row. 2nd: closes the popover via existing `closeAll`. Inner handlers `stopPropagation` only when they consumed it. |
| `.ws-conflict` | `role="group"` + `aria-labelledby`; heading carries `role="alert"` so the fact is announced once. Both fork buttons in tab order, neither autofocused — autofocusing one would imply a default. |
| `.ws-suggest` | `role="alert"`; the `Use “…”` button is tabbable and does not steal focus from the rename input. |
| Import | real button; the file input is synthetic and never focusable. On picker resolution or cancellation, `importBtnRef.current?.focus()` — a synthesized element's dismissal does not reliably restore focus. |
| dock toggle | `role="switch"`, `aria-checked`, Enter/Space. |
| focus ring | inherited global `:focus-visible{outline:2px solid var(--brand-2);outline-offset:2px}` (`globals.css:141`); `.ws-more` overrides to `outline-offset:-2px` so the ring is not clipped by the row edge (precedent `.wl-row.selected:focus-visible`, `globals.css:439`). |
| menu closes | open row, rename draft, and accordion state all reset; a stale/conflict block does not persist across a close. |

Not specified (see GAPS): roving-tabindex arrow navigation.

---

## 5. Responsive

`globals.css:2328` — `@media (max-width:860px){.chart-tabs .pop:not(.toolbar-overflow-pop){display:none!important}}`. So 1440 is the only viewport that uses the toolbar popover; both 820 and 390 use the `.toolbar-overflow-pop` drill-down (`TerminalShell.tsx:4671–4673`, `toolbarMoreView === "layouts"`).

| | 1440×900 | 820×1180 | 390×844 |
|---|---|---|---|
| chrome | `.pop`, `top:32 right:0`, `minWidth:300` | `.toolbar-overflow-pop`: `width:280`, `max-width:calc(100vw−20px)`, `max-height:min(70dvh,620px)` (`globals.css:246`) | same, `max-width` resolves to 370 |
| header | `Workspaces` toolbar button | `.toolbar-overflow-head` with back chevron (`globals.css:247`) | same |
| scrolling | `.ws-list` scrolls at `min(56dvh,420px)`; header+footer pinned | the pop scrolls; `.ws-list` unbounded (no nested scroller) | same |
| row height | ~33px (`.menu-row` 8/11 padding) | ≥44px via `@media (pointer:coarse)` | ≥44px |
| `.ws-more` | 26×26 | 44×44 | 44×44 |
| fork buttons | 28px tall, side by side | 44px, side by side | 44px, wrap to two lines via `.ws-fork{flex-wrap:wrap}` — both labels stay fully readable, neither truncates |
| rename input / buttons | 32px / 30px | 44px / 44px | 44px / 44px |

Never changes at any viewport: the three-zone order; the set of states; that the row click opens the workspace; that actions unfold in place; every string; the `unavailable ≠ empty` behavior; that a blocked row is visible and marked.

Overflow guards: `.ws-name` ellipsizes (`min-width:0` + `text-overflow`); every wrapping surface (`.ws-hint`, `.ws-conflict`, `.ws-suggest`, `.ws-dock`) sets `white-space:normal` against `.menu-row`'s inherited `nowrap` (`globals.css:1503`); `.ws-tile-type` ellipsizes. Zero horizontal document overflow at all three widths, per the Responsive product contract in `terminal/AGENTS.md`.

---

## 6. Unsupported-widget tile

Renders in the widget's lane slot when a stored workspace names a `type` this build does not know (freeze §2: the workspace still opens; only that slot degrades). The type name is plain text, never HTML — freeze §3 forbids strings interpreted as markup.

```tsx
<div className="ws-tile-missing" role="note" data-ws-missing-widget={widget.type}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="M9 12h6" /></svg>
  <b>{t("wsPanelUnavailable")}</b>
  <span className="ws-tile-type">
    <span>{t("wsPanelType")}</span>
    {String(widget.type)}          {/* React escapes by construction — never dangerouslySetInnerHTML */}
  </span>
  <p>{t("wsPanelUnavailableSub")}</p>
</div>
```

```css
.ws-tile-missing{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:120px;height:100%;padding:18px 16px;border:1px dashed var(--line-3);border-radius:var(--r-lg);background:var(--panel);text-align:center}
.ws-tile-missing svg{width:22px;height:22px;stroke:var(--text-dim);fill:none;stroke-width:1.6}
.ws-tile-missing b{font:650 var(--fs-body)/1.35 var(--font-ui);color:var(--text-2);max-width:34ch}
.ws-tile-missing p{margin:0;font:400 var(--fs-label)/1.4 var(--font-ui);color:var(--muted);max-width:38ch}
.ws-tile-type{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 9px;border:1px solid var(--line);border-radius:var(--r-pill);background:var(--panel-3);font:500 var(--fs-label)/1.4 var(--font-code);color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-tile-type>span{flex:none;font:600 var(--fs-micro)/1.4 var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim)}
[data-lang="zh"] .ws-tile-type>span{letter-spacing:0}
@media (max-width:860px){.ws-tile-missing{min-height:96px;padding:14px 12px}}
```

Three judgments worth naming:

- Dashed border, not solid. `1px dashed var(--line-3)` reads as reserved space with nothing in it — which is exactly true. A solid panel would read as a rendered widget that failed.
- Never `--danger`. Nothing failed and nothing is at risk; the workspace opened. A red tile inside a chart workspace reads as a data error and would send the user hunting for a market problem. `--text-2` / `--muted` on `--panel`.
- `--font-code` for the type name only. `globals.css:37–40` documents that face as reserved for character-cell surfaces and inline code — a machine identifier is exactly that, and the face change is itself the signal that this token came from the file, not from the product's vocabulary. The `Panel type` label beside it is `--font-ui`, so the two never blur together.

The tile obeys the lane realizer's minimum usable height (freeze §9 — zero-usable-height is a failure state); `min-height:120px` is its own floor beneath that.

---

## 7. Builder screenshot checklist

Terminal is dark-only (frozen constraint), so `terminal/AGENTS.md`'s "light + dark + zh" reduces to dark + zh here — the builder must state that in the PR body rather than silently shipping half the matrix.

Path convention follows the existing `terminal/e2e/proof/e3b-aapl-qa/<viewport>-<lang>-<state>.png`. Use `terminal/e2e/proof/w2a-workspaces/`.

Harness already exists in `terminal/e2e/layoutStore.ts`: `isolateLayoutStore`, `injectLayoutFault(page, "list"|"save"|"delete"|"all")`, `renderAsGuest`, `useLang`. The builder must extend the fault vocabulary with `"stale"`, `"conflict"`, and a fixture row carrying an unreadable payload — without them three of the states below are unreachable and the PR cannot prove them.

Required shots (25 total):

1440×900 — EN, every state (10): `1440-en-ready.png` · `1440-en-empty.png` · `1440-en-loading.png` · `1440-en-guest.png` · `1440-en-unavailable.png` (banner above a populated last-good list — this shot is the `unavailable ≠ empty` proof) · `1440-en-row-open.png` (unfolded actions) · `1440-en-renaming.png` (input focused, text selected) · `1440-en-name-conflict.png` (`.ws-suggest` with the suggested name) · `1440-en-stale.png` (fork block and the `--warn` row rail in one frame) · `1440-en-unsupported-rows.png` (both `Newer version` and `Can't open` rows visible with their hints)

1440×900 — ZH (3), the states where copy is longest and wrapping breaks first: `1440-zh-ready.png` · `1440-zh-unavailable.png` · `1440-zh-stale.png`

820×1180 (3), proving the drill-down mount: `820-en-ready.png` (inside `.toolbar-overflow-pop`, back chevron visible) · `820-en-row-open.png` · `820-zh-stale.png`

390×844 (5): `390-en-ready.png` · `390-en-row-open.png` · `390-en-stale.png` (fork buttons wrapped to two lines, both labels complete) · `390-zh-row-open.png` · `390-zh-import-error.png`

Unsupported-widget tile (3), each showing the tile beside a working chart since "the workspace still opened" is the claim being proved: `1440-en-tile.png` · `390-en-tile.png` · `1440-zh-tile.png`

Non-screenshot assertions required in the same spec file:

1. `expectTapTarget` (`terminal/e2e/tapTarget.ts`) at 390 and 820 on: a workspace row, `.ws-more`, each of the five sub-rows, both `.ws-fork` buttons, both `.ws-rename` buttons, `.ws-import`, `.ws-dock`. Floor 44×44.
2. Zero horizontal document overflow at all three widths with the menu open and a row unfolded.
3. No raw failure code appears in the DOM. Assert the rendered menu text matches none of `/malformed_workspace|unsupported_schema|unsupported_floor|unknown_widget_type|invalid_widget_config|duplicate_widget_id|invalid_lane|invalid_port|name_conflict|stale_revision|store_unavailable|unauthenticated|not_found|invalid_import|oversized_workspace|too_many_widgets/`. This makes the frozen "raw codes are NEVER shown" law testable.
4. EN/ZH leakage both ways: no CJK in the `en` render of the menu, no ASCII-only new-key strings in the `zh` render (per `terminal/AGENTS.md` verification law and the existing `lib/__tests__/feedFreshness.test.ts` key-parity pattern — add the new keys to it).
5. Keyboard: Tab from the name input reaches every control in visual order; Escape twice closes the menu from an unfolded row; rename commits on Enter and cancels on Escape; focus returns to `.ws-more` after collapse.
6. An unreadable row is present and marked — assert `[data-ws-state="unsupported_schema"]` is visible and its `.menu-row` is `disabled`; assert no write request fires on click.

EVIDENCE:

All Terminal reads were read-only via `git show origin/master:` against `/Users/chriswong/Documents/Cluade/charting-app`; the working tree was never touched.

Base component — `/Users/chriswong/Documents/Cluade/charting-app/terminal/components/LayoutMenu.tsx`: `:9-20` header comment establishing each state as a distinct fact · `:22` `LayoutStatus` union · `:23-27` `LayoutFeedback` union · `:43` `rowAs` prop rationale · `:58-74` `.menu-save` block · `:76-81` guest gate row · `:83-91` feedback slot · `:93-102` status rows (loading / unavailable+retry / empty) · `:104-121` row map + `.rm` delete affordance.

Handlers and mounts — `/Users/chriswong/Documents/Cluade/charting-app/terminal/components/TerminalShell.tsx`: `:4106-4139` `saveLayout` (create-vs-overwrite, 409 retry, `nextLayoutName`) · `:4146-4162` `loadLayout` · `:4167-4179` optimistic delete + rollback · `:4181-4186` `promptLayoutSignup` · `:4189-4201` `layoutMenuProps` · `:4564-4569` desktop popover mount (`minWidth: 230`, changed to 300) · `:4671-4673` overflow drill-down mount · `:4573` `.menu-hd` inline style promoted to `.ws-hd` · `:3296-3306` `exportList` download mechanics (its `[^\w.-]` regex rejected for CJK) · `:3312-3346` `importList` programmatic file input · `:3358-3360` the standing "inline input rather than window.prompt" ruling.

Inline-rename precedent — `/Users/chriswong/Documents/Cluade/charting-app/terminal/components/IndicatorsModal.tsx`: `:124` `StateSwitch` definition · `:608-623` rename input with Enter/Escape/autoFocus and `onBlur={commitRename}` · `:625-643` `role="switch"` + `aria-checked` + `StateSwitch` usage · `:646-659` `.li-ic` rename affordance.

CSS — `/Users/chriswong/Documents/Cluade/charting-app/terminal/app/globals.css`: `:4-58` token block (`--text:#d6dae3`, `--text-2:#9ba3b4`, `--muted:#717a8e`, `--text-dim:#4a5468`, `--panel:#0d0f13`, `--panel-2:#15171d`, `--panel-3:#1f222b`, `--inset:#08090c`, `--line:#23262f`, `--line-3:#33373f`, `--brand:#2962ff`, `--brand-2:#4d82ff`, `--warn:#e8a33d`, `--danger:#f0566b`, `--r:4px`, `--r-lg:8px`, `--r-pill:999px`, `--font-ui`, `--font-code`, `--t-fast:120ms`, `--ease-out`) · `:37-40` `--font-code` reserved for character-cell surfaces and inline code · `:75-82` type ramp (`--fs-micro:10px`, `--fs-label:11px`, `--fs-ui:12.5px`, `--fs-body:13px`) · `:141` global `:focus-visible` ring · `:246-257` `.toolbar-overflow-pop` geometry and its `.menu-row` overrides · `:265` `.tooldock .sp` separator · `:416` `.wl-sec-nm` ellipsis · `:422-426` `.wl-sec-ic` and `.menu-row.danger` · `:439` `.wl-row.selected` inset rail · `:868-876` `.im-state-switch` · `:895-900` `.li-acts` / `.li-ic` / `.li-rename` · `:1043` `.pop` · `:1281` the `@media (pointer:coarse){min-height:44px}` precedent · `:1495-1497` `.intel .verd` (the `--warn` left-rail block shape) · `:1502-1521` the entire existing layout-menu block · `:1515-1516` the comment establishing `--brand-2`/`--danger` as locale-safe where `--buy`/`--sell` are not · `:1524` `.livebadge` badge shape · `:2302-2340` the ≤860px block, including `:2328` hiding all non-overflow pops.

i18n — `/Users/chriswong/Documents/Cluade/charting-app/terminal/lib/i18n.tsx`: `:4` `Lang` type · `:11-15` "read a key name as an id, never as copy" · `:18` `LEX: Record<string,[string,string]>` · `:64, 126-139, 615, 669-670` the existing layout keys being revalued.

E2E harness — `/Users/chriswong/Documents/Cluade/charting-app/terminal/e2e/layoutStore.ts:17-45` (`isolateLayoutStore`, `injectLayoutFault`, `renderAsGuest`, `useLang`) · `/Users/chriswong/Documents/Cluade/charting-app/terminal/e2e/tapTarget.ts:23-35` `expectTapTarget` · `/Users/chriswong/Documents/Cluade/charting-app/terminal/e2e/proof/e3b-aapl-qa/*.png` naming convention · `/Users/chriswong/Documents/Cluade/charting-app/terminal/package.json:13` `test:e2e:responsive`.

Frozen contract — `/Users/chriswong/Documents/Cluade/Macro Dashboard/.claude/worktrees/deepvue-w1c-context-compiler-4ce47a/research/DEEPVUE_W2A_WORKSPACE_LAYOUT_CONTRACT_2026-08-26.md`: §2 widget/lane vocabulary and the `unknown_widget_type` read-vs-write split · §3 limits and the no-executable-payloads law · §4 revision law and the `stale_revision` offer (reload latest / save-as-copy) · §5 name identity, atomic rename, duplicate resets revision to 1 · §6 migrate-on-write, original bytes left in place · §7 Brain-dock membership as real new capability · §8 the frozen failure vocabulary and the binding `unavailable ≠ empty` law · §9 responsive lanes, the three contract viewports, minimum usable height · §11 export/import (never silently drops widgets; suggested free name offered) · §12 W2-B non-goals (no group color/name UI — respected; nothing in this spec surfaces `link_groups`).

Law read before design — `frontend-design:frontend-design` skill invoked via the Skill tool; `/Users/chriswong/Documents/Cluade/charting-app/terminal/AGENTS.md` (design direction, verification law, responsive product contract). Macro `docs/DESIGN_DOCTRINE.md` and `research/MASTER_PRODUCT_DESIGN_SYSTEM_V1.md` govern the Macro site; this surface lives in the Terminal repo, whose own AGENTS.md names `app/globals.css` as the token/primitive base and directs layout and structure to follow the product target. Doctrine applied accordingly: plain-word glance tier, no jargon, failures printed rather than hidden, and no falsifier/refutation vocabulary anywhere in the copy.

Visual verification: not executable at spec stage — nothing is built. Discharged by the §7 checklist per the commission's VISUAL VERIFICATION clause.

GAPS:

1. No roving-tabindex arrow navigation. The existing `role="menu"` overflow popover (`TerminalShell.tsx:4619`) has none; adding it for this menu alone would be inconsistent, and adding it globally is outside SCOPE. Tab order is fully specified; ↑/↓ is not. Flagged for a follow-up that owns the whole overflow menu.
2. `stale_revision` relative-time formatting is not specified. The row carries only `updated_at`, and no bilingual relative-time helper exists in the cited files. The menu takes a pre-formatted `savedAgo` string from the caller. If no such formatter exists, the builder should surface an absolute local time and flag it back rather than minting a formatter inside this component.
3. `rename` LEX key existence unverified. It is used at `IndicatorsModal.tsx:613/649`, but I did not confirm its row in `LEX`. Builder: reuse if present, mint `["Rename","重命名"]` if absent.
4. `injectLayoutFault` cannot currently reach three specified states (`stale`, `conflict`, unreadable row). The builder must extend the fixture fault vocabulary, or those states ship unproven.
5. No screenshot was captured; the design is unmeasured against real rendered geometry. §7 is the instrument that closes this at build time.

DEVIATIONS:

1. Product noun changed from "Layouts" to "Workspaces" / 工作区 (§2.1 — ten existing LEX values; all key ids preserved per `i18n.tsx:11-15`). Reason: after W2-A the object declares assistant-dock membership (freeze §7), so "layout" under-describes it and a Brain toggle inside a menu titled "Layouts" reads as a bug. Copy-only and fully reversible — reverting §2.1 to today's values leaves every structure, class, and flow in this spec intact. Flagged explicitly so the commissioning session can veto it at zero cost.
2. Rename blur cancels rather than commits, diverging from `IndicatorsModal.tsx:622`'s `onBlur={commitRename}`. Reason: a workspace rename can return `name_conflict`, and committing on blur fires that write after focus has left, so the error lands where nobody is looking. Mitigated with explicit commit/cancel controls carrying `onMouseDown → preventDefault`.
3. Export filename does not inherit `exportList`'s `replace(/[^\w.-]+/g,"_")` (`TerminalShell.tsx:3304`). Reason: `\w` is ASCII-only, so every Chinese workspace name would export as `___`. The replacement strips only filesystem-hostile characters. The existing watchlist CSV export carries the same latent bug; I did not fix it (out of scope) — recorded here as a separate observation for the commissioning session.
4. Desktop rows become real `<button>` elements, changing `rowAs` from an element switch to a role switch. This makes the desktop menu keyboard-operable for the first time and removes the two-mount divergence `LayoutMenu.tsx:5-7` exists to prevent. Behavioral improvement, not a redesign.
5. Delete moves from a one-click hover ✕ on the row (`LayoutMenu.tsx:113-119`) to a labelled row behind the unfold. Strictly safer (two deliberate steps instead of one hover-target click), so no confirmation dialog was added and today's optimistic-delete-with-rollback behavior is preserved unchanged.