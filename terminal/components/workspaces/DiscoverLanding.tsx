'use client';

import { pick } from '@/lib/finFormat';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Ref } from 'react';
import { useLang } from '@/lib/i18n';
import { marketNavigationHref, workspaceMarket } from '@/lib/sharedShellMarket';
import styles from './DiscoverLanding.module.css';

interface DiscoverLandingProps {
  ready: boolean;
  onSelect: (key: string) => void;
  onSearchCompanies: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

function Arrow() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" className={styles.arrow}>
    <path d="M4 10h12m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export default function DiscoverLanding({ ready, onSelect, onSearchCompanies, headingRef }: DiscoverLandingProps) {
  const { lang } = useLang();
  const zh = lang === 'zh';
  const params = useSearchParams();
  const candidatesHref = marketNavigationHref('/prophet?tab=candidates', workspaceMarket('/discover', params.toString()));
  const participation = [
    { key: 'heatmap', title: pick(zh, 'Heatmap', '热图'), description: pick(zh, 'Inspect company participation through the price and flow views.', '通过价格与资金流视图查看公司参与情况。'), action: pick(zh, 'Open Heatmap', '打开热图') },
    { key: 'sectors', title: pick(zh, 'Sector Intelligence', '行业情报'), description: pick(zh, 'Explore sector leadership, breadth and the companies behind it.', '查看行业领涨、市场广度及相关公司。'), action: pick(zh, 'Open Sectors', '打开板块') },
  ];
  const leadership = [
    { key: 'leaders', title: pick(zh, 'Leaders', '领导者'), description: pick(zh, 'Flow and price boards, with per-name measures and source coverage.', '查看资金流与价格榜单，检查各标的指标及来源覆盖。'), action: pick(zh, 'Open Leaders', '打开领导者') },
    { key: 'radar', title: pick(zh, 'Leader Radar', '领导者雷达'), description: pick(zh, 'Published states, handoff watches and re-rating context.', '查看已发布状态、接力观察与重估背景。'), action: pick(zh, 'Open Leader Radar', '打开领导者雷达') },
  ];

  return (
    <main className={styles.landing} data-discover-chooser>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>{pick(zh, 'Discover', '发现')}</h1>
          <p className={styles.subtitle}>{pick(zh, 'Start with a question. Choose the evidence you need.', '从问题出发，选择需要查看的证据。')}</p>
        </div>
        <button type="button" disabled={!ready} className={styles.btn} onClick={onSearchCompanies}>
          {pick(zh, 'Search companies', '搜索公司')}
        </button>
      </header>

      <article className={styles.prominent}>
        <div className={styles.screenText}>
          <p className={styles.eyebrow}>{pick(zh, 'Screen companies', '筛选公司')}</p>
          <h2 className={styles.question}>{pick(zh, 'Which companies match my criteria?', '哪些公司符合我的条件？')}</h2>
          <p className={styles.description}>{pick(zh, 'Choose a universe, apply technical, fundamental and classification conditions, then inspect field coverage.', '选定股票范围，应用技术、基本面和分类条件，再检查字段覆盖。')}</p>
        </div>
        <button type="button" disabled={!ready} className={`btn btn-primary ${styles.btnPrimary}`} onClick={() => onSelect('screener')}>
          {pick(zh, 'Open Stock Screener', '打开股票筛选器')}
        </button>
      </article>

      <div className={styles.toolGroups}>
        <section className={styles.toolGroup} aria-labelledby="discover-participation">
          <h2 id="discover-participation" className={styles.question}>{pick(zh, 'Where is participation concentrated?', '市场参与集中在哪些公司和行业？')}</h2>
          {participation.map(tool => <article key={tool.key} className={styles.toolRow}>
            <h3>{tool.title}</h3><p className={styles.description}>{tool.description}</p>
            <button type="button" disabled={!ready} className={styles.textAction} onClick={() => onSelect(tool.key)}>{tool.action}<Arrow /></button>
          </article>)}
        </section>
        <section className={styles.toolGroup} aria-labelledby="discover-leadership">
          <h2 id="discover-leadership" className={styles.question}>{pick(zh, 'Which names lead on the published measures?', '哪些标的在已发布指标上领先？')}</h2>
          {leadership.map(tool => <article key={tool.key} className={styles.toolRow}>
            <h3>{tool.title}</h3><p className={styles.description}>{tool.description}</p>
            <button type="button" disabled={!ready} className={styles.textAction} onClick={() => onSelect(tool.key)}>{tool.action}<Arrow /></button>
          </article>)}
        </section>
      </div>

      <article className={styles.study}>
        <div className={styles.screenText}>
          <p className={styles.eyebrow}>{pick(zh, 'RS · 30m Pivot', '相对强度 · 30 分钟枢轴')}</p>
          <h2 className={styles.question}>{pick(zh, 'What does the 30-minute pivot study show?', '30 分钟枢轴研究显示了什么？')}</h2>
          <p className={styles.description}>{pick(zh, 'Inspect its conditions, timing and limitations.', '查看研究条件、时点与限制。')}</p>
        </div>
        <button type="button" disabled={!ready} className={styles.btn} onClick={() => onSelect('rs-pivot')}>{pick(zh, 'Open study', '打开研究')}</button>
      </article>

      <section className={styles.deeper} aria-labelledby="discover-research">
        <h2 id="discover-research" className={styles.question}>{pick(zh, 'Follow a published lead', '沿已发布线索继续研究')}</h2>
        <div className={styles.deeperGrid}>
          <article className={styles.deepCol}>
            <h3>{pick(zh, 'Prophet candidates', '先知候选')}</h3>
            <p className={styles.description}>{pick(zh, 'Browse the published pool, then inspect each candidate’s supplied fields.', '浏览已发布候选池，逐一检查来源提供的字段。')}</p>
            <Link prefetch={false} className={styles.textAction} href={candidatesHref}>{pick(zh, 'Open candidates', '打开候选池')}<Arrow /></Link>
            <Link prefetch={false} className={`${styles.textAction} ${styles.secondary}`} href="/us_stocks.html">{pick(zh, 'Full US stock workspace', '完整美股工作区')}<Arrow /></Link>
          </article>
          <article className={styles.deepCol}>
            <h3>{pick(zh, 'Catalyst Intelligence', '催化剂情报')}</h3>
            <p className={styles.description}>{pick(zh, 'Inspect developing themes, participation and the available evidence.', '查看发展中的主题、参与度及已有证据。')}</p>
            <button type="button" disabled={!ready} className={styles.textAction} onClick={() => onSelect('catalysts')}>{pick(zh, 'Open Catalyst Intelligence', '打开催化剂情报')}<Arrow /></button>
            <Link prefetch={false} className={`${styles.textAction} ${styles.secondary}`} href="/biocatalyst.html">{pick(zh, 'BioCatalyst Intelligence', '生物医药催化剂情报')}<Arrow /></Link>
          </article>
          <article className={styles.deepCol}>
            <h3>{pick(zh, 'Signal Board', '信号看板')}</h3>
            <p className={styles.description}>{pick(zh, 'Compare confluence across published signals.', '比较已发布信号之间的一致性。')}</p>
            <Link prefetch={false} className={styles.textAction} href="/confluence_screener.html">{pick(zh, 'Open Signal Board', '打开信号看板')}<Arrow /></Link>
          </article>
        </div>
      </section>
    </main>
  );
}
