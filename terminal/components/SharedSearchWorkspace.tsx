"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import { pick } from "@/lib/finFormat";
import { useSharedShellT } from "@/lib/sharedShellCopy";
import { directoryEntryTitle, directorySection, searchDirectoryEntries } from "@/lib/sharedShellDirectorySearch";
import { loadSharedSearchCatalog, type SharedSearchCatalog } from "@/lib/sharedShellSearchCatalog";
import { revealListOption } from "@/lib/revealListOption";
import styles from "./SharedSearchWorkspace.module.css";

type State = "loading" | "ready" | "unavailable";

type Company = { symbol: string; name: string; venue?: string };
export type SharedSearchScope = "companies" | "tools";
export type SharedSearchResume = { scope: SharedSearchScope; query: string; selected?: string };
export type SharedSearchOptions = {
  scope?: SharedSearchScope;
  selectedTool?: string;
  onOpenTool: (href: string, query: string) => void;
  onDraftChange?: (draft: SharedSearchResume) => void;
};

/** One presentation inside SearchModal's existing focus owner. Services never share a result state. */
export default function SharedSearchWorkspace({ query, onQueryChange, companies, companyState, onRetryCompanies,
  selectedCompany, activeCompanyIndex, revealCompanySelection, companyResultsCurrent = true, onSelectCompany, onCompanyKey, listingDetail, options, marketDescription, marketDisclosure, onClose,
}: {
  query: string; onQueryChange: (query: string) => void; companies: Company[]; companyState: State;
  onRetryCompanies?: () => void; selectedCompany: string | null; activeCompanyIndex: number;
  revealCompanySelection?: { index: number } | null; companyResultsCurrent?: boolean;
  onSelectCompany: (symbol: string) => void; onCompanyKey: (event: KeyboardEvent<HTMLInputElement>) => void;
  listingDetail: ReactNode; options: SharedSearchOptions; marketDescription?: string; marketDisclosure?: ReactNode; onClose?: () => void;
}) {
  const { lang } = useLang(); const zh = lang === "zh"; const t = useSharedShellT();
  const [scope, setScope] = useState<SharedSearchScope>(options.scope ?? "companies");
  const [catalog, setCatalog] = useState<SharedSearchCatalog | null>(null);
  const [toolState, setToolState] = useState<State>("loading");
  const [revision, setRevision] = useState(0);
  const [selectedTool, setSelectedTool] = useState(options.selectedTool ?? "");
  const input = useRef<HTMLInputElement>(null); const toolResults = useRef<HTMLDivElement>(null); const uid = useId();
  const companyResults = useRef<HTMLDivElement>(null);
  const revealedCompanySelection = useRef<typeof revealCompanySelection>(null);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => { if (current) { current = false; setToolState("unavailable"); } }, 10000);
    // Type-only Catalog above is erased. The finite projection arrives only inside an opened dialog.
    loadSharedSearchCatalog().then(value => {
      if (!current) return; window.clearTimeout(timer); setCatalog(value); setToolState("ready");
    }, () => { if (current) { window.clearTimeout(timer); setToolState("unavailable"); } });
    return () => { current = false; window.clearTimeout(timer); };
  }, [revision]);
  const tools = useMemo(() => catalog ? searchDirectoryEntries(catalog.sharedShellDirectory, catalog.sharedShellCatalog.legacyPaths, query) : [], [catalog, query]);
  const shownTools = tools.slice(0, 30);
  const tool = shownTools.find(row => row.href === selectedTool);
  const selected = companies.find(row => row.symbol === selectedCompany);
  const retryTools = () => { setToolState("loading"); setRevision(value => value + 1); };
  const selectScope = (next: SharedSearchScope) => { setScope(next); input.current?.focus({ preventScroll: true }); };
  const draftChange = options.onDraftChange;
  useEffect(() => { draftChange?.({ scope, query, selected: scope === "companies" ? selectedCompany ?? undefined : selectedTool || undefined }); }, [scope, query, selectedCompany, selectedTool, draftChange]);
  const companyList = `${uid}-companies`; const toolList = `${uid}-tools`;
  const companyPending = companyState !== "ready";
  const currentRows = scope === "companies" ? companies.length : shownTools.length;
  const activeId = scope === "companies"
    ? companies[activeCompanyIndex] ? `${companyList}-${activeCompanyIndex}` : undefined
    : tool ? `${toolList}-${shownTools.indexOf(tool)}` : undefined;
  useLayoutEffect(() => {
    if (scope !== "companies") { revealedCompanySelection.current = null; return; }
    if (companyPending || !companyResultsCurrent || !revealCompanySelection || revealedCompanySelection.current === revealCompanySelection) return;
    if (revealListOption(companyResults.current, `${companyList}-${revealCompanySelection.index}`)) {
      revealedCompanySelection.current = revealCompanySelection;
    }
  }, [scope, companyPending, companyResultsCurrent, revealCompanySelection, companies, companyList]);
  useEffect(() => {
    if (scope !== "tools" || toolState !== "ready" || !activeId) return;
    revealListOption(toolResults.current, activeId);
  }, [scope, toolState, activeId, query]);
  const toolKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const at = shownTools.findIndex(row => row.href === selectedTool);
      const next = event.key === "ArrowDown" ? Math.min(at + 1, shownTools.length - 1) : Math.max(at - 1, 0);
      if (shownTools[next]) setSelectedTool(shownTools[next].href);
    } else if (event.key === "Enter" && tool) { event.preventDefault(); options.onOpenTool(tool.href, query); }
  };
  const stateText = (state: State) => state === "loading" ? pick(zh, "Loading", "读取中") : state === "unavailable" ? pick(zh, "Unavailable", "暂不可用") : "";
  return <div className={styles.workspace} data-shared-search-scope={scope}>
    <div className={styles.intro}><div><h2>{pick(zh, "Find your next step", "找到下一步")}</h2><p>{pick(zh, "Search companies and tools. Choose a listing before opening Analysis.", "搜索公司和工具。选择上市标的后再打开分析。")}</p></div>{onClose && <button type="button" className={styles.phoneClose} aria-label={pick(zh, "Close search", "关闭搜索")} onClick={onClose}>×</button>}</div>
    <div className={styles.search}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
      <input ref={input} data-autofocus value={query} maxLength={160} autoComplete="off"
        placeholder={pick(zh, "Search companies & tools", "搜索公司和工具")}
        aria-label={pick(zh, "Search companies and tools", "搜索公司和工具")}
        role="combobox" aria-expanded={currentRows > 0} aria-controls={scope === "companies" ? companyList : toolList}
        aria-haspopup="listbox" aria-autocomplete="list" aria-activedescendant={activeId}
        onChange={event => onQueryChange(event.target.value)} onKeyDown={scope === "companies" ? onCompanyKey : toolKey}/>
      {query && <button type="button" onClick={() => { onQueryChange(""); input.current?.focus(); }}>{pick(zh, "Clear", "清除")}</button>}
    </div>
    <div className={styles.scopes} role="group" aria-label={pick(zh, "Search scope", "搜索范围")}>
      <button type="button" aria-pressed={scope === "companies"} onClick={() => selectScope("companies")}>{pick(zh, "Companies", "公司")} <span>{companyPending ? stateText(companyState) : companies.length}</span></button>
      <button type="button" aria-pressed={scope === "tools"} onClick={() => selectScope("tools")}>{pick(zh, "Tools", "工具")} <span>{toolState === "ready" ? tools.length : stateText(toolState)}</span></button>
      <p>{scope === "companies" ? marketDescription : pick(zh, "Published pages and tools", "已发布页面和工具")}</p>
    </div>
    {scope === "companies" ? <div className={styles.columns}>
      <section className={styles.results} aria-label={pick(zh, "Company results", "公司结果")}>
        {companyState === "loading" && <p role="status">{pick(zh, "Loading company search…", "正在读取公司搜索…")}</p>}
        {companyState === "unavailable" && <div role="status"><h3>{pick(zh, "Company search could not be loaded.", "公司搜索暂时无法读取。")}</h3><p>{pick(zh, "Tools has its own status. Retry companies without clearing your query.", "工具搜索单独显示其状态。重试公司搜索不会清除查询。")}</p>{onRetryCompanies && <button type="button" className={styles.secondary} onClick={onRetryCompanies}>{pick(zh, "Retry companies", "重试公司搜索")}</button>}</div>}
        <div ref={companyResults} id={companyList} role="listbox" aria-label={pick(zh, "Company listings", "公司上市标的")} aria-busy={!companyResultsCurrent}>
          {companies.map((row, index) => <button type="button" key={row.symbol} data-company-symbol={row.symbol} id={`${companyList}-${index}`} role="option"
            aria-selected={selectedCompany === row.symbol} className={`${styles.result}${activeCompanyIndex === index ? ` ${styles.active}` : ""}`}
            onClick={() => { if (companyResultsCurrent) onSelectCompany(row.symbol); }}>
            <span className={styles.monogram} aria-hidden="true">{row.symbol.slice(0, 2)}</span>
            <span><strong>{row.name}</strong><small>{row.symbol} · {row.venue || pick(zh, "Venue unavailable", "交易场所未知")}</small></span><span aria-hidden="true">↵</span>
          </button>)}
        </div>
        {companyState === "ready" && !companies.length && <p role="status" aria-hidden={!companyResultsCurrent} style={companyResultsCurrent ? undefined : { visibility: "hidden" }}>{query ? pick(zh, "No company listings match this query in your enabled markets.", "所启用市场中没有符合此查询的公司标的。") : pick(zh, "Type a company name or symbol to find a listing.", "输入公司名称或代码以查找上市标的。")}</p>}
        {marketDisclosure}
        <p className={styles.hint}>{pick(zh, "↑ ↓ Select a result · Enter select, then open · Esc return to your page", "↑ ↓ 选择结果 · 回车选择，再打开 · Esc 返回原页面")}</p>
      </section>
      <aside className={styles.detail} aria-label={pick(zh, "Selected listing", "所选上市标的")}>
        {selected ? <><span className={styles.eyebrow}>{pick(zh, "Selected company listing", "所选公司标的")}</span><h3>{selected.name}</h3>{listingDetail}<p>{pick(zh, "Previewing keeps your page in place. Open uses this exact listing.", "预览会保留当前页面。打开时使用此确切上市标的。")}</p></> : <><h3>{pick(zh, "Choose a listing", "选择上市标的")}</h3><p>{pick(zh, "Review its venue and trading currency before opening company analysis.", "打开公司分析前，先核对交易场所与交易货币。")}</p></>}
      </aside>
    </div> : <div className={styles.columns}>
      <section className={styles.results} aria-label={pick(zh, "Tool results", "工具结果")}>
        {toolState === "loading" && <p role="status">{pick(zh, "Loading the tool directory…", "正在读取工具目录…")}</p>}
        {toolState === "unavailable" && <div role="status"><h3>{pick(zh, "The tool directory could not be searched.", "工具目录暂时无法搜索。")}</h3><p>{pick(zh, "Companies has its own status. Retry tools without clearing your query.", "公司搜索单独显示其状态。重试工具不会清除查询。")}</p><button className={styles.secondary} type="button" onClick={retryTools}>{pick(zh, "Retry tools", "重试工具")}</button></div>}
        <div ref={toolResults} id={toolList} role="listbox" aria-label={pick(zh, "Published tools and pages", "已发布工具和页面")}>
          {toolState === "ready" && shownTools.map((row, index) => <button type="button" key={row.href} id={`${toolList}-${index}`} role="option" aria-selected={row.href === selectedTool}
            className={`${styles.result}${row.href === selectedTool ? ` ${styles.active}` : ""}`} onClick={() => setSelectedTool(row.href)}>
            <span aria-hidden="true" className={styles.monogram}>↗</span><span><strong>{directoryEntryTitle(row, lang, t)}</strong><small>{t("shellSection_" + directorySection(row))}</small></span><span aria-hidden="true">↵</span>
          </button>)}
        </div>
        {toolState === "ready" && !tools.length && <p role="status">{pick(zh, "No published tools or pages match this query.", "没有符合此查询的已发布工具或页面。")}</p>}
        {tools.length > 30 && <p>{pick(zh, `Showing 30 of ${tools.length} matches. Narrow your query to find a page.`, `显示 ${tools.length} 个匹配中的前 30 个。请细化查询以查找页面。`)}</p>}
      </section>
      <aside className={styles.detail} aria-label={pick(zh, "Selected tool", "所选工具")}>
        {tool ? <><span className={styles.eyebrow}>{t("shellSection_" + directorySection(tool))}</span><h3>{directoryEntryTitle(tool, lang, t)}</h3><p>{tool.href}</p><button type="button" className={styles.primary} onClick={() => options.onOpenTool(tool.href, query)}>{pick(zh, "Open tool", "打开工具")} →</button><p>{pick(zh, "Open this published destination in your workspace.", "在工作区中打开此已发布页面。")}</p></> : <><h3>{pick(zh, "Choose a tool or page", "选择工具或页面")}</h3><p>{pick(zh, "Only published destinations from the existing directory are searchable here.", "此处仅搜索现有目录中的已发布页面。")}</p></>}
      </aside>
    </div>}
    {scope === "companies" && toolState === "unavailable" && <div className={styles.notice} role="status"><div><strong>{pick(zh, "The tool directory could not be searched.", "工具目录暂时无法搜索。")}</strong><p>{pick(zh, "Company search keeps its own state. Retry tools without clearing your query.", "公司搜索保留其自身状态。重试工具不会清除查询。")}</p></div><button type="button" className={styles.secondary} onClick={retryTools}>{pick(zh, "Retry tools", "重试工具")}</button></div>}
    {scope === "tools" && companyState === "unavailable" && <div className={styles.notice} role="status"><div><strong>{pick(zh, "Company search could not be loaded.", "公司搜索暂时无法读取。")}</strong><p>{pick(zh, "Tools keeps its own state and selection.", "工具保留其自身状态与选择。")}</p></div>{onRetryCompanies && <button type="button" className={styles.secondary} onClick={onRetryCompanies}>{pick(zh, "Retry companies", "重试公司搜索")}</button>}</div>}
  </div>;
}
