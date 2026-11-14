"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { SHARED_SHELL_LEGACY_ORIGIN } from "@/lib/sharedShellOrigins";
import registry from "@/lib/market-reference/registry.generated.json";
import styles from "./reference.module.css";

type Term = (typeof registry.terms)[number];
type Locale = "en" | "zh";
const termById = new Map(registry.terms.map(term => [term.id, term]));
const pair = (en: string, zh: string) => ({ en, zh });
const copy = {
  title: pair("Market Reference", "市场参考"),
  parent: pair("Research", "研究"),
  intro: pair("Look up a measure, how to read it and where it appears.", "查询指标和术语的含义、解读方法与所在页面。"),
  search: pair("Search terms or aliases", "搜索术语或别名"),
  families: pair("All families", "所有类别"),
  kinds: pair("All types", "所有类型"),
  indicator: pair("Indicator", "指标"), term: pair("Term", "术语"),
  letters: pair("A–Z", "英文字母 A–Z"), reset: pair("Clear filters", "清除筛选"),
  noMatches: pair("No terms match your filters.", "没有符合这些条件的术语。"),
  missing: pair("This term is unavailable. Browse the glossary below.", "此术语暂不可用。请浏览下方词汇表。"),
  why: pair("Why it matters", "为何重要"), basis: pair("Basis", "计量方式"),
  up: pair("Higher or improving", "上升或改善"), down: pair("Lower or weakening", "下降或走弱"),
  neutral: pair("Neutral reading", "中性读数"), caveats: pair("Limits", "局限"),
  sources: pair("Sources", "来源"), where: pair("Where it appears", "所在页面"),
  aliases: pair("Also called", "别名"), related: pair("Related terms", "相关术语"),
  coverage: pair("Dashboard elements explained elsewhere", "在其他条目中解释的看板元素"),
  superseded: pair("Replaced by", "替代条目"),
};
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const letters = Array.from(new Set(registry.terms.map(term => term.label.en[0].toUpperCase()))).sort();

function Related({ ids, lang }: { ids: string[]; lang: Locale }) {
  return <div className={styles.links}>{ids.map(id => {
    const term = termById.get(id);
    return term && <a key={id} href={"#" + id}>{term.label[lang]}</a>;
  })}</div>;
}

function TermDetail({ term, lang }: { term: Term; lang: Locale }) {
  const reads = (["basis", "up", "down", "neutral"] as const).filter(key => term[key][lang]);
  return <div className={styles.detail} id={"detail-" + term.id}>
    {term.successor && <><h4>{copy.superseded[lang]}</h4><Related ids={[term.successor]} lang={lang} /></>}
    {term.aliases[lang].length > 0 && <p className={styles.muted}>{copy.aliases[lang]} · {term.aliases[lang].join(" · ")}</p>}
    <h4>{copy.why[lang]}</h4><p>{term.why[lang]}</p>
    <dl>{reads.map(key => <div key={key}><dt>{copy[key][lang]}</dt><dd>{term[key][lang]}</dd></div>)}</dl>
    {term.caveats[lang].length > 0 && <><h4>{copy.caveats[lang]}</h4><ul>{term.caveats[lang].map(line => <li key={line}>{line}</li>)}</ul></>}
    <h4>{copy.where[lang]}</h4>
    <div className={styles.links}>{term.owners.map(owner =>
      <a key={owner.path} href={SHARED_SHELL_LEGACY_ORIGIN + "/" + owner.path}>{owner.label[lang]} ↗</a>)}</div>
    {term.sources.length > 0 && <><h4>{copy.sources[lang]}</h4><div className={styles.links}>
      {term.sources.map(source => <a key={source.url} href={source.url} rel="external">{source.label} ↗</a>)}
    </div></>}
    {term.related.length > 0 && <><h4>{copy.related[lang]}</h4><Related ids={term.related} lang={lang}/></>}
  </div>;
}

export default function MarketReference() {
  const { lang } = useLang();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [kind, setKind] = useState("");
  const [letter, setLetter] = useState("");
  const [selected, setSelected] = useState("");
  const [missing, setMissing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const coverage = useRef<HTMLDetailsElement>(null);
  const article = useRef<HTMLElement>(null);
  const initialQuery = params.get("q") ?? "";
  useEffect(() => { if (!location.hash) setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => {
    function followHash() {
      let id;
      try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ""; }
      setSelected(termById.has(id) ? id : "");
      setMissing(Boolean(id && !termById.has(id) && !["shared-shell-content", "rf-top", "coverage"].includes(id)));
      if (id === "coverage" && coverage.current) coverage.current.open = true;
      if (termById.has(id)) {
        setQuery(""); setFamily(""); setKind(""); setLetter("");
      }
    }
    followHash();
    setHydrated(true);
    window.addEventListener("hashchange", followHash);
    window.addEventListener("popstate", followHash);
    return () => { window.removeEventListener("hashchange", followHash); window.removeEventListener("popstate", followHash); };
  }, []);
  useEffect(() => {
    if (selected) article.current?.querySelector<HTMLElement>("#" + CSS.escape(selected))?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  function clearSelection() {
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
    setSelected(""); setMissing(false);
  }
  function reset() { setQuery(""); setFamily(""); setKind(""); setLetter(""); clearSelection(); }
  const needle = normalize(query);
  const matches = registry.terms.filter(term => (!family || term.family === family) &&
    (!kind || term.kind === kind) && (!letter || term.label.en[0].toUpperCase() === letter) && term.search.includes(needle));
  return <main ref={article} id="shared-shell-content" tabIndex={-1} data-hydrated={hydrated} className={"main2 " + styles.reader}>
    <div id="rf-top" className={styles.column}>
      <header><p className={styles.muted}>{copy.parent[lang]}</p><h1>{copy.title[lang]}</h1><p>{copy.intro[lang]}</p></header>
      <input type="search" value={query} aria-label={copy.search[lang]} placeholder={copy.search[lang]}
        onChange={event => { clearSelection(); setQuery(event.target.value); }} />
      <div className={styles.filters}>
        <select value={family} aria-label={copy.families[lang]} onChange={e => { clearSelection(); setFamily(e.target.value); }}>
          <option value="">{copy.families[lang]}</option>
          {registry.families.map(f => <option key={f.id} value={f.id}>{f.label[lang]}</option>)}
        </select>
        <select value={kind} aria-label={copy.kinds[lang]} onChange={e => { clearSelection(); setKind(e.target.value); }}>
          <option value="">{copy.kinds[lang]}</option><option value="indicator">{copy.indicator[lang]}</option><option value="glossary">{copy.term[lang]}</option>
        </select>
        <select value={letter} aria-label={copy.letters[lang]} onChange={e => { clearSelection(); setLetter(e.target.value); }}>
          <option value="">{copy.letters[lang]}</option>{letters.map(l => <option key={l}>{l}</option>)}
        </select>
        {(query || family || kind || letter) && <button type="button" onClick={reset}>{copy.reset[lang]}</button>}
      </div>
      <p role="status" className={styles.muted}>{missing ? copy.missing[lang] : matches.length ?
        (lang === "zh" ? matches.length + " 个条目" : matches.length + (matches.length === 1 ? " entry" : " entries")) : copy.noMatches[lang]}</p>
      {registry.families.map(f => {
        const rows = matches.filter(term => term.family === f.id);
        return rows.length > 0 && <section key={f.id}><h2>{f.label[lang]}</h2>{rows.map(term => {
          const open = selected === term.id;
          return <article key={term.id} id={term.id} className={styles.entry} data-open={open}>
            <h3><a href={"#" + term.id} aria-expanded={hydrated ? open : undefined} aria-controls={"detail-" + term.id} onClick={event => {
              if (open && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); clearSelection(); }
            }}>{term.label[lang]} <span aria-hidden="true">{open ? "−" : "+"}</span></a></h3>
            <p>{term.definition[lang]}</p>
            <TermDetail term={term} lang={lang}/>
          </article>;
        })}</section>;
      })}
      <details id="coverage" ref={coverage} className={styles.coverage}><summary>{copy.coverage[lang]}</summary>{registry.coverage.map(c =>
        <section key={c.label.en}><h3>{c.label[lang]}</h3><p className={styles.muted}>{c.surface[lang]}</p>
          {c.reason[lang] && <p>{c.reason[lang]}</p>}<Related ids={c.related} lang={lang} /></section>)}</details>
    </div>
  </main>;
}
