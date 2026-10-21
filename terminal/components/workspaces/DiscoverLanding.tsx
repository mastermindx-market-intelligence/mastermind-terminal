'use client';

import Link from 'next/link';
import { useLang } from '@/lib/i18n';
import styles from './DiscoverLanding.module.css';

interface DiscoverLandingProps {
  onSelect: (key: string) => void;
  onSearchCompanies: () => void;
}

export default function DiscoverLanding({ onSelect, onSearchCompanies }: DiscoverLandingProps) {
  const { lang } = useLang();
  const zh = lang === 'zh';

  return (
    <main className={styles.landing}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{zh ? '发现' : 'Discover'}</h1>
          <p className={styles.subtitle}>
            {zh ? '选择问题，打开合适的工作区。' : 'Choose a question. Open the right workspace.'}
          </p>
        </div>
        <button type="button" className={styles.btn} onClick={onSearchCompanies}>
          {zh ? '搜索公司' : 'Search companies'}
        </button>
      </header>

      <div className={styles.grid}>
        <article className={`${styles.card} ${styles.prominent}`}>
          <p className={styles.eyebrow}>{zh ? '筛选公司' : 'Screen companies'}</p>
          <h2 className={styles.cardTitle}>
            {zh ? '从股票范围出发，以证据逐步筛选。' : 'Start with a universe. Narrow it with evidence.'}
          </h2>
          <p className={styles.cardText}>
            {zh
              ? '使用技术、基本面和分类筛选；比较结果前请查看每个字段的覆盖情况。'
              : "Use technical, fundamental and classification filters. Check each field's coverage before comparing results."}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`btn btn-primary ${styles.btnPrimary}`}
              onClick={() => onSelect('screener')}
            >
              {zh ? '打开股票筛选器' : 'Open Stock Screener'}
            </button>
          </div>
        </article>

        <article className={styles.card}>
          <p className={styles.eyebrow}>{zh ? '探索市场结构' : 'Explore market structure'}</p>
          <h2 className={styles.cardTitle}>
            {zh ? '结合背景查看市场参与' : 'See participation in context'}
          </h2>
          <p className={styles.cardText}>
            {zh
              ? '从市场热图深入相关板块与公司。'
              : 'Move from the market map to the sectors and companies behind it.'}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => onSelect('heatmap')}>
              {zh ? '打开热图' : 'Open Heatmap'}
            </button>
            <button type="button" className={styles.btn} onClick={() => onSelect('sectors')}>
              {zh ? '打开板块' : 'Open Sectors'}
            </button>
          </div>
        </article>

        <article className={`${styles.card} ${styles.bottom}`}>
          <h2 className={styles.cardTitle}>
            {zh ? '跟踪市场领导者' : 'Follow market leadership'}
          </h2>
          <p className={styles.cardText}>
            {zh
              ? '查看现有领导者视图及其覆盖范围。'
              : 'Inspect the existing leader views and their underlying coverage.'}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnText}`}
              onClick={() => onSelect('leaders')}
            >
              {zh ? '领导者' : 'Leaders'}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnText}`}
              onClick={() => onSelect('radar')}
            >
              {zh ? '领导者雷达' : 'Leader Radar'}
            </button>
          </div>
        </article>

        <article className={`${styles.card} ${styles.bottom}`}>
          <h2 className={styles.cardTitle}>
            {zh ? '相对强度·30分钟枢轴' : 'RS · 30m Pivot'}
          </h2>
          <p className={styles.cardText}>
            {zh
              ? '了解研究条件、时点与限制。'
              : "Explore the study's conditions, timing and limitations."}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => onSelect('rs-pivot')}>
              {zh ? '打开研究' : 'Open study'}
            </button>
          </div>
        </article>
      </div>

      <section className={styles.deeper}>
        <h2 className={styles.sectionTitle}>
          {zh ? '通过专门工作流深入研究' : 'Go deeper with a focused workflow'}
        </h2>
        <div className={styles.deeperGrid}>
          <div className={styles.deepCol}>
            <Link className={styles.deepLink} href="/us_stocks.html">
              {zh ? '美国股票 · 先知' : 'US stocks · Prophet'}
            </Link>
            <p className={styles.deepDesc}>
              {zh
                ? '在美国股票工作区查看先知、板块和资金流。'
                : 'Open the US stock dashboard for Prophet, sectors and flows.'}
            </p>
          </div>
          <div className={styles.deepCol}>
            <Link className={styles.deepLink} href="/biocatalyst.html">
              {zh ? '催化剂' : 'Catalysts'}
            </Link>
            <p className={styles.deepDesc}>
              {zh
                ? '以原始披露为依据的公司催化剂。'
                : 'Company catalysts anchored in original disclosures.'}
            </p>
          </div>
          <div className={styles.deepCol}>
            <Link className={styles.deepLink} href="/confluence_screener.html">
              {zh ? '共振' : 'Confluence'}
            </Link>
            <p className={styles.deepDesc}>
              {zh
                ? '在既有筛选之上叠加证据共振。'
                : 'Adds evidence confluence on top of the existing screen.'}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
