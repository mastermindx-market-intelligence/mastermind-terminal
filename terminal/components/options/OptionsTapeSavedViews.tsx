"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { decodeTapeView, encodeTapeView, type TapeViewState } from "@/lib/optionsTapeView";
import { decodeTapeFilterGroups, encodeTapeFilterGroups, MAX_TAPE_FILTER_GROUPS } from "@/lib/optionsTapeFilterGroups";
import { addSavedTapeView, decodeSavedTapeViews, encodeSavedTapeViews, removeSavedTapeView,
  renameSavedTapeView, SAVED_TAPE_VIEWS_KEY, type SavedTapeView } from "@/lib/optionsTapeSavedViews";
import s from "./OptionsTapeViewLink.module.css";

const COPY = {
  save: ["Save screen", "保存筛选视图"], views: ["Saved screens", "已存筛选视图"],
  title: ["Your Tape screens", "你的期权流筛选视图"], close: ["Close saved screens", "关闭已存筛选视图"],
  local: ["Saved on this browser. Opens your filters with the latest available feed; no snapshot or account save.", "仅保存在此浏览器。使用最新可用的数据恢复筛选条件；不保存快照，也不会保存到账户。"],
  empty: ["No saved screens yet. Set your Tape filters, then save a screen to use again.", "尚未保存筛选视图。设置期权流筛选条件后，保存以便再次使用。"],
  name: ["Screen name", "视图名称"], cancel: ["Cancel", "取消"], rename: ["Rename", "重命名"], remove: ["Delete", "删除"],
  saved: ["Screen saved on this browser.", "筛选视图已保存在此浏览器。"], renamed: ["Screen renamed.", "视图已重命名。"], deleted: ["Saved screen deleted. Current filters are unchanged.", "已删除保存的视图。当前筛选条件保持不变。"],
  nameError: ["Use a name of 1–60 characters on one line.", "请输入1–60个字符的单行名称。"], duplicate: ["That name is already used. Choose another name.", "名称已存在，请使用其他名称。"],
  full: ["You can save up to 20 screens. Delete a screen before adding another.", "最多可保存20个视图。请删除一个视图后再添加。"],
  invalid: ["Saved screens could not be read. Your current Tape still works; stored screens have not been replaced.", "无法读取已存视图。当前期权流仍可使用；原有保存内容未被覆盖。"],
  storage: ["This browser could not store the change. Your Tape filters still work; the change was not saved.", "此浏览器无法保存更改。期权流筛选仍可使用；更改尚未保存。"],
  clear: ["Clear unreadable saved screens", "清除无法读取的已存视图"], cleared: ["Unreadable saved screens cleared. Your Tape filters are unchanged.", "已清除无法读取的视图。期权流筛选条件保持不变。"],
  missing: ["This saved screen changed in another tab. Open the list again.", "此已存视图已在其他标签页更改。请重新打开列表。"],
  allRoots: ["All tickers", "全部代码"], allExpiry: ["All expiries", "全部期限"], allMny: ["All moneyness", "全部价内外程度"],
  minimum: ["Minimum premium", "最低权利金"], side: ["Inferred side", "推断方向"], flags: ["Activity filter", "活动筛选"],
  buy: ["Leans buy (approximate)", "偏买入（近似）"], sell: ["Leans sell (approximate)", "偏卖出（近似）"], mixed: ["Mixed", "混合"],
  repeated: ["Repeat-root", "重复代码"], put_buy: ["Puts on strength", "上涨时偏买看跌"], swept: ["Swept", "扫单"],
  sorted: ["Sort", "排序"], ts: ["Time", "时间"], premium: ["Premium", "权利金"],
  showAll: ["See all", "查看全部"], fewer: ["Show fewer", "收起"], open: ["Open", "打开"],
  combine: ["Combine selected", "组合所选视图"], select: ["Select for combination", "选择以组合"],
  combineHint: ["Select 2–4 single screens to match any of them. Conditions within each screen must all match. Current filters can refine the combined results.", "选择2–4个单独视图，匹配其中任一视图；每个视图内的条件须全部满足。当前筛选可进一步缩小组合结果。"],
  combined: ["Combined screen", "组合视图"], any: ["Match any", "匹配任一"],
  changed: ["A selected screen changed. Select the screens again; current filters have not changed.", "所选视图已更改。请重新选择；当前筛选条件保持不变。"],
  frozenFilters: ["Combined screens keep a copy of their filter definitions, not market data.", "组合视图保留筛选条件的副本，不保存市场数据。"],
} as const;

function tapeViewSummary(encoded: string, lang: string, includeSort = true): string {
  const t = (key: keyof typeof COPY) => COPY[key][lang === "zh" ? 1 : 0];
  const dteLabel = (bucket: string) => ({
    "0d": lang === "zh" ? "当日到期" : "0DTE", "1_7d": lang === "zh" ? "1–7天" : "1–7d",
    "8_30d": lang === "zh" ? "8–30天" : "8–30d", "31_90d": lang === "zh" ? "31–90天" : "31–90d",
    "90p": lang === "zh" ? "90天以上" : "90d+",
  })[bucket] ?? bucket;
  const mnyLabel = (bucket: string) => ({ itm: lang === "zh" ? "价内" : "ITM", atm: lang === "zh" ? "平值" : "ATM",
    near_otm: lang === "zh" ? "近虚值" : "Near OTM", far_otm: lang === "zh" ? "深虚值" : "Far OTM" })[bucket] ?? bucket;
  const summary = (encoded: string) => {
    const view = decodeTapeView(encoded);
    if (!view) return t("invalid");
    const parts = [view.drillTicker || view.tapeTickerSearch || view.groupFilter || t("allRoots"),
      `${t("minimum")} $${view.minPrem.toLocaleString("en-US")}`,
      view.dteBuckets.length ? view.dteBuckets.map(dteLabel).join(" / ") : t("allExpiry"),
      view.mnyBuckets.length ? view.mnyBuckets.map(mnyLabel).join(" / ") : t("allMny")];
    if (view.groupFilter && (view.drillTicker || view.tapeTickerSearch)) parts.push(view.groupFilter);
    if (view.tapeTickerSearch && view.drillTicker) parts.push(view.tapeTickerSearch);
    if (view.sideFilter) parts.push(`${t("side")}: ${t(view.sideFilter === "~buy" ? "buy" : view.sideFilter === "~sell" ? "sell" : "mixed")}`);
    if (view.flagFilter) parts.push(`${t("flags")}: ${t(view.flagFilter as "repeated" | "put_buy" | "swept")}`);
    if (includeSort) parts.push(`${t("sorted")}: ${t(view.sortKey)} ${view.sortDir === 1 ? "↑" : "↓"}`);
    return parts.join(" · ");
  };

  return summary(encoded);
}

export function OptionsTapeGroupDetails({ groups }: { groups: readonly TapeViewState[] }) {
  const { lang } = useLang();
  return <details><summary>{lang === "zh" ? "查看组合条件" : "View combined conditions"}</summary>
    <ol>{groups.map((group, index) => <li key={index} style={{ overflowWrap: "anywhere" }}>{tapeViewSummary(encodeTapeView(group), lang, false)}</li>)}</ol>
  </details>;
}

export function OptionsTapeSavedViews({ state, groups, onApply, onCombine }: {
  state: TapeViewState; groups?: readonly TapeViewState[];
  onApply: (encoded: string, encodedGroups?: string) => void;
  onCombine?: (groups: TapeViewState[]) => void;
}) {
  const { lang } = useLang();
  const t = (key: keyof typeof COPY) => COPY[key][lang === "zh" ? 1 : 0];
  const panelId = useId();
  const [views, setViews] = useState<SavedTapeView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<"new" | string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<keyof typeof COPY | null>(null);
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<SavedTapeView[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLElement>(null);

  const refresh = () => {
    try {
      const result = decodeSavedTapeViews(localStorage.getItem(SAVED_TAPE_VIEWS_KEY));
      setUnreadable(!result.ok);
      setViews(result.ok ? result.views : []);
      return result;
    } catch {
      setUnreadable(true);
      setViews([]);
      return { ok: false as const, reason: "invalid" as const };
    }
  };

  useEffect(() => {
    const frame = requestAnimationFrame(() => { refresh(); setLoaded(true); });
    const changed = (event: StorageEvent) => { if (event.key === SAVED_TAPE_VIEWS_KEY || event.key === null) refresh(); };
    window.addEventListener("storage", changed);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", changed); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => editor ? input.current?.focus() : panel.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, editor]);

  const close = () => { setOpen(false); setEditor(null); setSelected([]); launcher.current?.focus(); };
  const editNew = () => {
    refresh(); setOpen(true); setEditor("new"); setMessage(null);
    setName([...([state.drillTicker || state.tapeTickerSearch || state.groupFilter || t("allRoots"),
      state.dteBuckets.length ? state.dteBuckets.join(" / ") : t("allExpiry")].join(" · "))].slice(0, 60).join(""));
  };

  const persist = (action: (latest: SavedTapeView[]) => SavedTapeView[], success: keyof typeof COPY) => {
    // Read at the actual write boundary so another tab's latest preference is retained.
    const latest = refresh();
    if (!latest.ok) { setMessage("invalid"); return; }
    let next: SavedTapeView[];
    try { next = action(latest.views); } catch (error) {
      const code = error instanceof Error ? error.message : "invalid";
      setMessage(code === "name" ? "nameError" : code === "duplicate" || code === "full" || code === "missing" ? code : "invalid");
      return;
    }
    try {
      localStorage.setItem(SAVED_TAPE_VIEWS_KEY, encodeSavedTapeViews(next));
      setViews(next); setMessage(success); setEditor(null);
      requestAnimationFrame(() => panel.current?.focus());
    } catch { setMessage("storage"); }
  };

  let activeName: string | undefined;
  try { activeName = views.find((view) => view.state === encodeTapeView(state)
    && view.groups === (groups === undefined ? undefined : encodeTapeFilterGroups(groups)))?.name; } catch { /* no active saved screen */ }
  const summary = (encoded: string) => tapeViewSummary(encoded, lang);

  return <>
    <button type="button" className={`chip ${s.launch} ${s.savedControl}`} disabled={!loaded} onClick={(event) => { launcher.current = event.currentTarget; editNew(); }}
      data-options-saved-view="save" aria-controls={panelId}>{t("save")}</button>
    <button type="button" className={`chip ${s.launch} ${s.savedControl}`} disabled={!loaded}
      aria-controls={panelId} aria-expanded={open} data-options-saved-view="list"
      onClick={(event) => { if (open) close(); else { launcher.current = event.currentTarget; refresh(); setMessage(null); setOpen(true); setEditor(null); } }}>
      {t("views")} {loaded && !unreadable ? `(${views.length})` : ""}
      {activeName && <bdi style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}> · {activeName}</bdi>}
    </button>
    {open && <section ref={panel} id={panelId} tabIndex={-1} className={s.panel}
      aria-label={t("title")} data-options-saved-view="panel" style={{ maxHeight: "min(60dvh, 580px)", overflowY: "auto" }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <div className={s.controls}><strong className={s.label} style={{ flex: 1 }}>{t("title")}</strong>
        <button type="button" className={`chip ${s.action} ${s.savedControl}`} onClick={close}>{t("close")}</button></div>
      <p className={s.note}>{t("local")}</p>
      {unreadable ? <div role="status"><p className={s.note}>{t("invalid")}</p>
        <button type="button" className={`chip ${s.action} ${s.savedControl}`} onClick={() => {
          try { localStorage.removeItem(SAVED_TAPE_VIEWS_KEY); refresh(); setMessage("cleared"); }
          catch { setMessage("storage"); }
        }}>{t("clear")}</button></div> : <>
        {editor !== null && <form onSubmit={(event) => { event.preventDefault(); persist((latest) => editor === "new"
          ? addSavedTapeView(latest, crypto.randomUUID(), name, state, groups)
          : renameSavedTapeView(latest, editor, name), editor === "new" ? "saved" : "renamed"); }}>
          <label htmlFor={`${panelId}-name`} className={s.label} style={{ marginTop: 12 }}>{t("name")}</label>
          <div className={s.controls}><input id={`${panelId}-name`} ref={input} className={s.input} value={name}
            onChange={(event) => setName(event.target.value)} autoComplete="off" />
            <button type="submit" className={`chip ${s.action} ${s.savedControl}`}>{t(editor === "new" ? "save" : "rename")}</button>
            <button type="button" className={`chip ${s.action} ${s.savedControl}`} onClick={() => { setEditor(null); setMessage(null); }}>{t("cancel")}</button></div>
        </form>}
        {onCombine && views.filter((view) => !view.groups).length >= 2 && <div data-options-saved-view="combine">
          <p className={s.note}>{t("combineHint")}</p>
          <button type="button" className={`chip ${s.action} ${s.savedControl}`} disabled={selected.length < 2}
            onClick={() => {
              const latest = refresh();
              if (!latest.ok || selected.some((selection) => !latest.views.some((view) => view.id === selection.id
                && view.state === selection.state && view.groups === undefined))) {
                setSelected([]); setMessage("changed"); return;
              }
              const combined = selected.map((view) => decodeTapeView(view.state));
              if (combined.some((view) => !view)) { setMessage("invalid"); return; }
              onCombine(combined as TapeViewState[]); close();
            }}>{t("combine")} ({selected.length}/{MAX_TAPE_FILTER_GROUPS})</button>
        </div>}
        {views.length === 0 ? <p className={s.note}>{t("empty")}</p> : <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
          {(all ? views : views.slice(0, 8)).map((view) => <li key={view.id} style={{ padding: "12px 0", borderTop: "1px solid var(--line)" }}>
            <div className={s.controls}><bdi style={{ flex: "1 1 160px", overflowWrap: "anywhere", color: "var(--text)" }}>{view.name}</bdi>
              {onCombine && !view.groups && <label className={`${s.note} ${s.groupChoice}`}>
                <input type="checkbox" checked={selected.some((item) => item.id === view.id)}
                  disabled={selected.length >= MAX_TAPE_FILTER_GROUPS && !selected.some((item) => item.id === view.id)}
                  aria-label={`${t("select")} ${view.name}`} onChange={(event) => {
                    setSelected((prior) => event.target.checked ? [...prior, view] : prior.filter((item) => item.id !== view.id));
                  }} />{t("select")}
              </label>}
              <button type="button" className={`chip ${s.action} ${s.savedControl}`} aria-label={`${t("open")} ${view.name}`} onClick={() => {
                const latest = refresh();
                const selected = latest.ok && latest.views.find((item) => item.id === view.id);
                if (!selected) { setMessage("missing"); return; }
                onApply(selected.state, selected.groups); close();
              }}>{t("open")}</button>
              <button type="button" className={`chip ${s.action} ${s.savedControl}`} aria-label={`${t("rename")} ${view.name}`} onClick={() => { setName(view.name); setEditor(view.id); setMessage(null); }}>{t("rename")}</button>
              <button type="button" className={`chip ${s.action} ${s.savedControl}`} aria-label={`${t("remove")} ${view.name}`} onClick={() => persist((latest) => removeSavedTapeView(latest, view.id), "deleted")}>{t("remove")}</button>
            </div><p className={s.note} style={{ overflowWrap: "anywhere" }}>{summary(view.state)}</p>
            {view.groups && <details className={s.note} data-options-saved-view="group-summary">
              <summary>{t("combined")} · {t("any")} ({decodeTapeFilterGroups(view.groups)?.length})</summary>
              <ol>{decodeTapeFilterGroups(view.groups)?.map((group, index) => <li key={index} style={{ overflowWrap: "anywhere" }}>{tapeViewSummary(encodeTapeView(group), lang, false)}</li>)}</ol>
              <p>{t("frozenFilters")}</p>
            </details>}
          </li>)}
        </ul>}
        {views.length > 8 && <button type="button" className={`chip ${s.action} ${s.savedControl}`} onClick={() => setAll((value) => !value)}>{all ? t("fewer") : `${t("showAll")} ${views.length}`}</button>}
      </>}
      <p role="status" className={s.note}>{message ? t(message) : ""}</p>
    </section>}
  </>;
}
