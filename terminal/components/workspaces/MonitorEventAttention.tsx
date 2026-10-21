'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/components/onboarding/OnboardingProvider';
import { companyRetainedContextParams, loadCompanyRetainedContext } from '@/lib/companyRetainedContext';
import { normalizeCompanyIntelligenceSymbol } from '@/lib/eventWorkspace';
import styles from './MonitorEventAttention.module.css';

type Selection = { listId: string; symbol: string };
type Props = { subjectId: string; selection: Selection | null; refreshKey?: number; lang: 'en' | 'zh' };
type Evidence = { symbol: string; issuer: string; year: number; quarter: number; sourceDate: string | null; href: string; partial: boolean };
type Result =
  | { phase: 'loading' }
  | { phase: 'ready' | 'quiet'; evidence: Evidence }
  | { phase: 'restricted'; session: boolean }
  | { phase: 'missing'; unsupported: boolean }
  | { phase: 'unavailable' | 'timeout' };

const COPY = {
  en: {
    title: 'Event evidence', idle: 'Choose “Check event evidence” beside a saved symbol.',
    loading: 'Checking the selected event and source access…',
    retained: 'Available retained event version.', source: 'Event source available', dateUnknown: 'Source date unavailable',
    fiscal: (quarter: number, year: number) => `Fiscal Q${quarter} ${year}`,
    open: 'Open retained event evidence', coverage: 'Inspect source coverage',
    quiet: 'No byte-replayed source evidence is available in this retained event. Any source addresses remain inspectable.',
    partial: 'Some event coverage is incomplete. Inspect the retained sources for its limits.',
    session: 'Your session could not authorize this check. Sign in to continue.',
    rights: 'This event’s sources are restricted under current access.',
    missing: 'The selected retained event version is unavailable. Another version has not replaced it.',
    unsupported: 'This saved symbol cannot be checked through the Company event path.',
    unavailable: 'Event evidence could not be verified. Your watchlists and saved alerts remain separate.',
    timeout: 'The event evidence check timed out. Check again when the source service responds.',
    retry: 'Check again', signIn: 'Sign in',
  },
  zh: {
    title: '事件证据', idle: '点击已保存代码旁的“核对事件证据”。',
    loading: '正在核对所选事件与来源权限…',
    retained: '可用的已保留事件版本。', source: '事件来源可用时间', dateUnknown: '来源日期暂不可用',
    fiscal: (quarter: number, year: number) => `财年 ${year} 年第 ${quarter} 季度`,
    open: '打开已保留事件证据', coverage: '查看来源覆盖',
    quiet: '此已保留事件没有可回放原始字节的来源证据；已有来源地址仍可查看。',
    partial: '部分事件覆盖不完整，请查看已保留来源中的限制。',
    session: '当前会话无法授权此次核对，请登录后继续。',
    rights: '当前权限不允许查看此事件的来源。',
    missing: '所选已保留事件版本不可用，未使用其他版本替代。',
    unsupported: '此已保存代码不支持通过公司事件路径核对。',
    unavailable: '无法验证事件证据；关注列表与已保存预警仍独立显示。',
    timeout: '事件证据核对超时，请在来源服务响应后重试。',
    retry: '重新核对', signIn: '登录',
  },
};

function Panel({ lang, state, children }: { lang: Props['lang']; state: string; children: ReactNode }) {
  return <section className={styles.panel} data-event-attention-state={state} aria-label={COPY[lang].title}>
    <h2>{COPY[lang].title}</h2>{children}
  </section>;
}

function failed(reason: string): Result {
  if (reason === 'unauthenticated') return { phase: 'restricted', session: true };
  if (['rights_denied', 'denied', 'http_403'].includes(reason)) return { phase: 'restricted', session: false };
  if (reason === 'missing_generation') return { phase: 'missing', unsupported: false };
  if (reason.startsWith('invalid_reference')) return { phase: 'missing', unsupported: true };
  return { phase: 'unavailable' };
}

export default function MonitorEventAttention(props: Props) {
  const [retry, setRetry] = useState(0);
  if (!props.selection) return <Panel lang={props.lang} state="idle"><p>{COPY[props.lang].idle}</p></Panel>;
  // Selection, owner departure/re-entry and explicit retries destroy the complete read.
  const key = JSON.stringify([props.subjectId, props.selection.listId, props.selection.symbol, props.refreshKey ?? 0, retry]);
  return <SelectedEvent key={key} {...props} selection={props.selection} onRetry={() => setRetry(value => value + 1)} />;
}

function SelectedEvent({ subjectId, selection, lang, onRetry }: Omit<Props, 'selection'> & { selection: Selection; onRetry: () => void }) {
  const c = COPY[lang];
  const onboarding = useOnboarding();
  const { symbol, listId } = selection;
  const eligible = Boolean(subjectId && listId) && normalizeCompanyIntelligenceSymbol(symbol) === symbol;
  const [result, setResult] = useState<Result>(eligible ? {phase: 'loading'} : {phase: 'missing', unsupported: true});
  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    let alive = true;
    let timedOut = false;
    let rejectBoundary: (reason: Error) => void = () => {};
    const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectBoundary(Error('event read deadline'));
    }, 10_000);
    void (async () => {
      try {
        const response = await Promise.race([loadCompanyRetainedContext({symbol, signal: controller.signal}), boundary]);
        if (!alive) return;
        if (timedOut) { setResult({phase: 'timeout'}); return; }
        if (!response.ok) { setResult(failed(response.reason)); return; }
        const {workspace, receipt} = response;
        if (workspace.issuer.company_id !== receipt.company_id || workspace.event_id !== receipt.event_id
          || workspace.generation_id !== receipt.generation_id || !workspace.issuer.listings.some(listing => listing.ticker === symbol)) {
          setResult({phase: 'unavailable'}); return;
        }
        const params = new URLSearchParams({symbol, page: 'intelligence', ci_lens: 'sources'});
        // This existing validator exports the authorized immutable receipt, never a current-payload hash.
        for (const [key, value] of companyRetainedContextParams(receipt)) params.set(key, value);
        const evidence: Evidence = {symbol, issuer: workspace.issuer.display_name,
          year: workspace.fiscal_period.year, quarter: workspace.fiscal_period.quarter,
          sourceDate: receipt.public_known_at, href: `/analysis?${params}`, partial: workspace.lifecycle.state === 'partial'};
        setResult({phase: workspace.sources.some(source => source.receipt_state === 'byte_replayed') ? 'ready' : 'quiet', evidence});
      } catch {
        if (alive) setResult({phase: timedOut ? 'timeout' : 'unavailable'});
      } finally { clearTimeout(timer); }
    })();
    return () => {
      alive = false; clearTimeout(timer); controller.abort(); rejectBoundary(Error('inactive event read'));
    };
  }, [eligible, symbol]);

  if (result.phase === 'loading') return <Panel lang={lang} state="loading">
    <p role="status" aria-live="polite">{c.loading}</p>
    <div aria-hidden="true" className={styles.skeleton}><span /><span /></div>
  </Panel>;
  if (result.phase === 'ready' || result.phase === 'quiet') {
    const item = result.evidence;
    return <Panel lang={lang} state={result.phase}>
      <p className={styles.subject}><strong>{item.symbol}</strong>{item.issuer && <span>{item.issuer}</span>}</p>
      <p className={styles.period}>{c.fiscal(item.quarter, item.year)}</p>
      <p className={styles.note}>{c.retained}</p>
      <p className={styles.clock}>{item.sourceDate ? <><span>{c.source}</span>
        <time dateTime={item.sourceDate}>{new Date(item.sourceDate).toISOString().slice(0, 10)} UTC</time></> : c.dateUnknown}</p>
      {result.phase === 'quiet' && <p role="status">{c.quiet}</p>}
      {item.partial && <p className={styles.note}>{c.partial}</p>}
      <div className={styles.actions}>
        <Link href={item.href} className={styles.link}>{result.phase === 'quiet' ? c.coverage : c.open}</Link>
        <button type="button" onClick={onRetry}>{c.retry}</button>
      </div>
    </Panel>;
  }
  const message = result.phase === 'restricted' ? (result.session ? c.session : c.rights)
    : result.phase === 'missing' ? (result.unsupported ? c.unsupported : c.missing)
    : result.phase === 'timeout' ? c.timeout : c.unavailable;
  return <Panel lang={lang} state={result.phase}>
    <p role="status">{message}</p><div className={styles.actions}>
      {result.phase === 'restricted' && result.session && <button type="button" onClick={() => onboarding.open('signin')}>{c.signIn}</button>}
      <button type="button" onClick={onRetry}>{c.retry}</button>
    </div>
  </Panel>;
}
