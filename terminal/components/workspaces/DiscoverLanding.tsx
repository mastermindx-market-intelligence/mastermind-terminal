'use client';

import { pick } from "@/lib/finFormat";
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
          <h1 className={styles.title}>{pick(zh, 'Discover', '发现')}</h1>
          <p className={styles.subtitle}>
            {pick(zh, 'Choose a question. Open the right workspace.', '选择问题，打开合适的工作区。')}
          </p>
        </div>
        <button type="button" className={styles.btn} onClick={onSearchCompanies}>
          {pick(zh, 'Search companies', '搜索公司')}
        </button>
      </header>

      <div className={styles.grid}>
        <article className={`${styles.card} ${styles.prominent}`}>
          <p className={styles.eyebrow}>{pick(zh, 'Screen companies', '筛选公司')}</p>
          <h2 className={styles.cardTitle}>
            {pick(zh, 'Start with a universe. Narrow it with evidence.', '从股票范围出发，以证据逐步筛选。')}
          </h2>
          <p className={styles.cardText}>
            {pick(zh, "Use technical, fundamental and classification filters. Check each field's coverage before comparing results.", '使用技术、基本面和分类筛选；比较结果前请查看每个字段的覆盖情况。')}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`btn btn-primary ${styles.btnPrimary}`}
              onClick={() => onSelect('screener')}
            >
              {pick(zh, 'Open Stock Screener', '打开股票筛选器')}
            </button>
          </div>
        </article>

        <article className={styles.card}>
          <p className={styles.eyebrow}>{pick(zh, 'Explore market structure', '探索市场结构')}</p>
          <h2 className={styles.cardTitle}>
            {pick(zh, 'See participation in context', '结合背景查看市场参与')}
          </h2>
          <p className={styles.cardText}>
            {pick(zh, 'Move from the market map to the sectors and companies behind it.', '从市场热图深入相关板块与公司。')}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => onSelect('heatmap')}>
              {pick(zh, 'Open Heatmap', '打开热图')}
            </button>
            <button type="button" className={styles.btn} onClick={() => onSelect('sectors')}>
              {pick(zh, 'Open Sectors', '打开板块')}
            </button>
          </div>
        </article>

        <article className={`${styles.card} ${styles.bottom}`}>
          <h2 className={styles.cardTitle}>
            {pick(zh, 'Follow market leadership', '跟踪市场领导者')}
          </h2>
          <p className={styles.cardText}>
            {pick(zh, 'Inspect the existing leader views and their underlying coverage.', '查看现有领导者视图及其覆盖范围。')}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnText}`}
              onClick={() => onSelect('leaders')}
            >
              {pick(zh, 'Leaders', '领导者')}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnText}`}
              onClick={() => onSelect('radar')}
            >
              {pick(zh, 'Leader Radar', '领导者雷达')}
            </button>
          </div>
        </article>

        <article className={`${styles.card} ${styles.bottom}`}>
          <h2 className={styles.cardTitle}>
            {pick(zh, 'RS · 30m Pivot', '相对强度·30分钟枢轴')}
          </h2>
          <p className={styles.cardText}>
            {pick(zh, "Explore the study's conditions, timing and limitations.", '了解研究条件、时点与限制。')}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => onSelect('rs-pivot')}>
              {pick(zh, 'Open study', '打开研究')}
            </button>
          </div>
        </article>
      </div>

      <section className={styles.deeper}>
        <h2 className={styles.sectionTitle}>
          {pick(zh, 'Go deeper with a focused workflow', '通过专门工作流深入研究')}
        </h2>
        <div className={styles.deeperGrid}>
          <div className={styles.deepCol}>
            <Link className={styles.deepLink} href="/us_stocks.html">
              {pick(zh, 'US stocks · Prophet', '美国股票 · 先知')}
            </Link>
            <p className={styles.deepDesc}>
              {pick(zh, 'Open the US stock dashboard for Prophet, sectors and flows.', '在美国股票工作区查看先知、板块和资金流。')}
            </p>
          </div>
          <div className={styles.deepCol}>
            <Link className={styles.deepLink} href="/biocatalyst.html">
              {pick(zh, 'Catalysts', '催化剂')}
            </Link>
            <p className={styles.deepDesc}>
              {pick(zh, 'Company catalysts anchored in original disclosures.', '以原始披露为依据的公司催化剂。')}
            </p>
          </div>
          <div className={styles.deepCol}>
            <Link className={styles.deepLink} href="/confluence_screener.html">
              {pick(zh, 'Confluence', '共振')}
            </Link>
            <p className={styles.deepDesc}>
              {pick(zh, 'Adds evidence confluence on top of the existing screen.', '在既有筛选之上叠加证据共振。')}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
