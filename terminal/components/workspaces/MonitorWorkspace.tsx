'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useShellIdentity } from '@/components/chrome/AppShell';
import { useLang } from '@/lib/i18n';
import { composeMonitorSnapshot } from '@/lib/sharedShellMonitor';
import type { MonitorAlert, OwnerRead } from '@/lib/sharedShellMonitor';
import type { ServerWatchlist } from '@/lib/watchlists';
import { listingHref } from '@/lib/classificationScan';
import { sharedShellTerminalHref } from '@/lib/sharedShellNavigation';
import { isPresentationHref } from '@/lib/sharedShellContracts';
import { companyHref } from '@/lib/sectorIntelligence';
import { conditionText } from '@/lib/alertsView';
import styles from './MonitorWorkspace.module.css';
import MonitorEventAttention from './MonitorEventAttention';

type ShellIdentity = ReturnType<typeof useShellIdentity>;
type Lang = ReturnType<typeof useLang>['lang'];

type ListInventory = OwnerRead<readonly ServerWatchlist[]>;
type AlertInventory = OwnerRead<readonly MonitorAlert[]>;

type AlertConditionInput = {
  type?: string;
  op?: string;
  value?: number | string;
};

type Copy = {
  eventHeading: string;
  checkEvent: string;
  inventoryLoading: string;
  inventoryUnverified: string;
  membershipLost: string;
  inventoryRefreshed: string;
  title: string;
  portfolioNote: string;
  allAlerts: (count: number) => string;
  subtitle: string;
  refresh: string;
  signIn: string;
  guestHeading: string;
  guestBody: string;
  alertsHeading: string;
  alertsChecking: string;
  alertsRestricted: string;
  alertsUnavailable: string;
  alertsEmpty: string;
  quietNote: string;
  savedNote: string;
  manageAlerts: string;
  created: (isoDate: string) => string;
  activeLabel: string;
  triggeredLabel: string;
  pausedLabel: string;
  listsHeading: string;
  listsChecking: string;
  listsRestricted: string;
  listsUnavailable: string;
  listsEmpty: string;
  distinctSymbols: (count: number) => string;
  listSymbols: (count: number) => string;
  sharedNote: string;
  portfolio: string;
  openTerminal: string;
  openCompany: string;
};

const COPY: Record<Lang, Copy> = {
  en: {
    eventHeading: 'Event evidence',
    checkEvent: 'Check event evidence',
    inventoryLoading: 'Refreshing your lists. Event checks resume after membership is verified.',
    inventoryUnverified: 'Your list membership could not be verified. Refresh your lists before checking event evidence.',
    membershipLost: 'The selected membership is no longer in your owned lists. Choose another saved symbol.',
    inventoryRefreshed: 'Your lists were refreshed. Choose Check event evidence to read an authorized version again.',
    title: 'Monitor',
    portfolioNote: 'Watchlists follow your interests. Your held positions are in Portfolio.',
    allAlerts: (count) => 'See all ' + count + ' saved alerts',
    subtitle: 'Your watchlists and saved alert conditions.',
    refresh: 'Refresh',
    signIn: 'Sign in',
    guestHeading: 'Sign in to see your Monitor',
    guestBody: 'Sign in to load your watchlists and saved alert conditions.',
    alertsHeading: 'Saved alerts',
    alertsChecking: 'Checking your saved alert conditions…',
    alertsRestricted: 'Saved alert conditions are restricted for this account.',
    alertsUnavailable: 'Saved alert conditions are unavailable right now.',
    alertsEmpty: 'No saved alert conditions.',
    quietNote:
      'Choose a price or event to follow in Alerts.',
    savedNote:
      'Saved conditions and recorded states. The latest evaluation time is unavailable here.',
    manageAlerts: 'Manage alerts',
    created: (isoDate) => 'Created ' + isoDate,
    activeLabel: 'Active',
    triggeredLabel: 'Triggered (recorded)',
    pausedLabel: 'Paused',
    listsHeading: 'Your lists',
    listsChecking: 'Checking your watchlists…',
    listsRestricted: 'Watchlist inventory is restricted for this account.',
    listsUnavailable: 'Watchlist inventory is unavailable right now.',
    listsEmpty: 'You have no watchlists yet.',
    distinctSymbols: (count) => count + ' distinct symbols',
    listSymbols: (count) => count + (count === 1 ? ' symbol' : ' symbols'),
    sharedNote: 'Only lists you own appear here.',
    portfolio: 'Portfolio',
    openTerminal: 'Open current chart',
    openCompany: 'Company',
  },
  zh: {
    eventHeading: '事件证据',
    checkEvent: '核对事件证据',
    inventoryLoading: '正在刷新关注列表；验证成员关系后可继续核对事件。',
    inventoryUnverified: '无法验证关注列表成员关系。请刷新列表后再核对事件证据。',
    membershipLost: '所选代码已不在你拥有的列表中，请选择其他已保存代码。',
    inventoryRefreshed: '关注列表已刷新。点击“核对事件证据”可重新读取获授权的版本。',
    title: '监控',
    portfolioNote: '关注列表记录你的关注；实际持仓请查看投资组合。',
    allAlerts: (count) => '查看全部 ' + count + ' 条提醒',
    subtitle: '你的关注列表与已保存的预警条件。',
    refresh: '刷新',
    signIn: '登录',
    guestHeading: '登录后查看你的监控',
    guestBody: '登录后加载你的关注列表与已保存的预警条件。',
    alertsHeading: '已保存的预警',
    alertsChecking: '正在读取已保存的预警条件…',
    alertsRestricted: '当前账户无法查看已保存的预警条件。',
    alertsUnavailable: '预警条件暂时无法读取。',
    alertsEmpty: '暂无已保存的预警条件。',
    quietNote: '前往提醒页面，选择要关注的价格或事件。',
    savedNote: '以下为已保存的条件与记录状态；本页暂未提供最近评估时间。',
    manageAlerts: '管理预警条件',
    created: (isoDate) => '创建于 ' + isoDate,
    activeLabel: '生效中',
    triggeredLabel: '已触发（记录）',
    pausedLabel: '已暂停',
    listsHeading: '你的列表',
    listsChecking: '正在读取你的关注列表…',
    listsRestricted: '当前账户无法查看关注列表。',
    listsUnavailable: '关注列表暂时无法读取。',
    listsEmpty: '你还没有关注列表。',
    distinctSymbols: (count) => count + ' 个不同代码',
    listSymbols: (count) => count + ' 个代码',
    sharedNote: '这里只展示你拥有的列表。',
    portfolio: '投资组合',
    openTerminal: '打开当前图表',
    openCompany: '公司页',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSymbolMember(
  value: unknown,
): { symbol: string; section: string; position: number } | null {
  if (!isRecord(value)) return null;
  const symbol = value.symbol;
  const section = value.section;
  const position = value.position;
  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  if (typeof section !== 'string') return null;
  if (typeof position !== 'number' || !Number.isFinite(position)) return null;
  return { symbol, section, position };
}

function parseWatchlistRow(value: unknown): ServerWatchlist | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const name = value.name;
  const position = value.position;
  const symbols = value.symbols;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof name !== 'string') return null;
  if (typeof position !== 'number' || !Number.isFinite(position)) return null;
  if (!Array.isArray(symbols)) return null;
  const members: { symbol: string; section: string; position: number }[] = [];
  for (const entry of symbols) {
    const member = parseSymbolMember(entry);
    if (!member) return null;
    members.push(member);
  }
  return { id, name, position, symbols: members };
}

function parseWatchlistPayload(payload: unknown): ServerWatchlist[] | null {
  if (!isRecord(payload)) return null;
  if (!Array.isArray(payload.lists)) return null;
  const lists: ServerWatchlist[] = [];
  for (const row of payload.lists) {
    const parsed = parseWatchlistRow(row);
    if (!parsed) return null;
    lists.push(parsed);
  }
  return lists;
}

function parseAlertRow(value: unknown): MonitorAlert | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const symbol = value.symbol;
  const active = value.active;
  const createdAt = value.created_at;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  if (typeof active !== 'boolean') return null;
  if (typeof createdAt !== 'string' || createdAt.length === 0) return null;
  const row: MonitorAlert = { id, symbol, active, created_at: createdAt };
  if (value.condition !== undefined) {
    if (!isRecord(value.condition)) return null;
    row.condition = value.condition;
  }
  return row;
}

function parseAlertPayload(payload: unknown): MonitorAlert[] | null {
  if (!isRecord(payload)) return null;
  if (!Array.isArray(payload.alerts)) return null;
  const alerts: MonitorAlert[] = [];
  for (const row of payload.alerts) {
    const parsed = parseAlertRow(row);
    if (!parsed) return null;
    alerts.push(parsed);
  }
  return alerts;
}

function narrowAlertCondition(condition: Record<string, unknown> | undefined): AlertConditionInput {
  if (!isRecord(condition)) return {};
  return {
    type: typeof condition.type === 'string' ? condition.type : undefined,
    op: typeof condition.op === 'string' ? condition.op : undefined,
    value:
      typeof condition.value === 'number' || typeof condition.value === 'string'
        ? condition.value
        : undefined,
  };
}

function isoDay(created_at: string): string | null {
  const parsed = new Date(created_at);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function alertStatusClass(alert: MonitorAlert): 'statusActive' | 'statusTriggered' | 'statusPaused' {
  if (alert.active) return 'statusActive';
  if (isRecord(alert.condition) && Boolean(alert.condition.triggered)) return 'statusTriggered';
  return 'statusPaused';
}

function alertStatusLabel(alert: MonitorAlert, copy: Copy): string {
  const statusClass = alertStatusClass(alert);
  if (statusClass === 'statusActive') return copy.activeLabel;
  if (statusClass === 'statusTriggered') return copy.triggeredLabel;
  return copy.pausedLabel;
}

// One deadline covers response arrival and body decoding. Each owner read has its own
// linked controller; even a transport that ignores abort cannot keep the UI loading.
const MONITOR_READ_DEADLINE_MS = 10_000;
type InventoryResult<T> = { state: 'ready'; data: T } | { state: 'restricted' | 'unavailable' };

function readInventory<T>(url: string, parentSignal: AbortSignal, parse: (body: unknown) => T | null): Promise<InventoryResult<T>> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (result: InventoryResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      parentSignal.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => {
      controller.abort();
      finish({ state: 'unavailable' });
    };
    const deadline = setTimeout(abort, MONITOR_READ_DEADLINE_MS);
    parentSignal.addEventListener('abort', abort, { once: true });
    if (parentSignal.aborted) {
      abort();
      return;
    }
    void (async () => {
      try {
        const response = await fetch(url, {
          method: 'GET', credentials: 'same-origin', cache: 'no-store',
          signal: controller.signal, headers: { Accept: 'application/json' },
        });
        if (settled) return;
        if (response.status === 401 || response.status === 403) {
          finish({ state: 'restricted' });
          return;
        }
        if (!response.ok) {
          finish({ state: 'unavailable' });
          return;
        }
        const payload: unknown = await response.json();
        if (settled) return;
        const data = parse(payload);
        finish(data === null ? { state: 'unavailable' } : { state: 'ready', data });
      } catch {
        finish({ state: 'unavailable' });
      }
    })();
  });
}

// The same null snapshot is used by SSR and initial hydration; the browser URL
// becomes available through the external-store update after hydration.
const serverLocationSnapshot = (): string | null => null;
const browserLocationSnapshot = () => window.location.href;
function subscribeToLocation(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener('hashchange', onChange);
  window.addEventListener('mmx:shell-location', onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('mmx:shell-location', onChange);
  };
}

function monitorChartHref(symbol: string, currentHref: string | null): string | null {
  const listing = listingHref(symbol);
  if (!listing || !currentHref || !isPresentationHref(currentHref)) return null;
  if (new URL(currentHref).pathname !== '/monitor') return null;
  // The incumbent listing helper owns eligibility and symbol normalization.
  const canonicalSymbol = new URLSearchParams(listing.split('?')[1]).get('sym');
  return canonicalSymbol ? sharedShellTerminalHref(currentHref, canonicalSymbol) : null;
}

export default function MonitorWorkspace() {
  const identity: ShellIdentity = useShellIdentity();
  const { lang } = useLang();
  const subjectId = identity.kind === 'account' ? identity.userId : null;
  return <OwnedMonitorWorkspace key={subjectId ?? 'guest'} subjectId={subjectId} lang={lang} />;
}

function OwnedMonitorWorkspace({ subjectId, lang }: { subjectId: string | null; lang: Lang }) {
  const copy = COPY[lang];
  const currentHref = useSyncExternalStore(subscribeToLocation, browserLocationSnapshot, serverLocationSnapshot);
  const [listState, setListState] = useState<ListInventory>({ subjectId: '', state: 'loading' });
  const [alertState, setAlertState] = useState<AlertInventory>({ subjectId: '', state: 'loading' });
  const [refreshTick, setRefreshTick] = useState(0);
  const [attention, setAttention] = useState<{listId: string; symbol: string; inventoryRead: number; attempt: number} | null>(null);
  const attentionTarget = useRef<HTMLDivElement>(null);
  const attentionAttempt = useRef(0);
  const generationRef = useRef(0);

  const loadListInventory = useCallback(async (uid: string, generation: number, signal: AbortSignal) => {
    const result = await readInventory('/api/watchlist', signal, parseWatchlistPayload);
    if (generationRef.current === generation) setListState({ subjectId: uid, ...result });
  }, []);

  const loadAlertInventory = useCallback(async (uid: string, generation: number, signal: AbortSignal) => {
    const result = await readInventory('/api/alerts', signal, parseAlertPayload);
    if (generationRef.current === generation) setAlertState({ subjectId: uid, ...result });
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!subjectId) {
      return () => {
        generationRef.current += 1;
      };
    }
    const controller = new AbortController();
    void loadListInventory(subjectId, generation, controller.signal);
    void loadAlertInventory(subjectId, generation, controller.signal);
    return () => {
      generationRef.current += 1;
      controller.abort();
    };
  }, [subjectId, refreshTick, loadListInventory, loadAlertInventory]);

  const onRefresh = useCallback(() => {
    if (!subjectId) return;
    generationRef.current += 1;
    setListState({ subjectId, state: 'loading' });
    setAlertState({ subjectId, state: 'loading' });
    setRefreshTick((tick) => tick + 1);
  }, [subjectId]);

  const snapshot = composeMonitorSnapshot(subjectId, listState, alertState);
  const listPhase: 'ready' | 'loading' | 'restricted' | 'unavailable' = snapshot.listState;
  const alertPhase: 'ready' | 'loading' | 'restricted' | 'unavailable' = snapshot.alertState;
  const lists = listPhase === 'ready' ? snapshot.lists : [];
  const alerts = alertPhase === 'ready' ? snapshot.alerts : [];
  const listCount = listPhase === 'ready' ? lists.length : null;
  const distinctCount = listPhase === 'ready' ? snapshot.distinctSymbolCount : null;
  const selectedMembership = attention && lists.some(list => list.id === attention.listId
    && list.symbols.some(member => member.symbol === attention.symbol));
  const attentionBoundary = !attention ? null
    : listPhase === 'loading' ? { state: 'inventory-loading', text: copy.inventoryLoading }
    : listPhase !== 'ready' ? { state: 'membership-unavailable', text: copy.inventoryUnverified }
    : !selectedMembership ? { state: 'membership-lost', text: copy.membershipLost }
    : attention.inventoryRead !== refreshTick ? { state: 'inventory-refreshed', text: copy.inventoryRefreshed }
    : null;
  const attentionSelection = attention && !attentionBoundary ? {listId: attention.listId, symbol: attention.symbol} : null;
  const chooseEvent = (listId: string, symbol: string) => {
    if (listPhase !== 'ready' || !lists.some(list => list.id === listId && list.symbols.some(member => member.symbol === symbol))) return;
    setAttention({ listId, symbol, inventoryRead: refreshTick, attempt: ++attentionAttempt.current });
    attentionTarget.current?.scrollIntoView?.({ block: 'start' });
    attentionTarget.current?.focus({ preventScroll: true });
  };


  let listBody;
  if (listPhase === 'loading') {
    listBody = <div role="status" aria-busy="true"><p className={styles.stateText}>{copy.listsChecking}</p><div className={styles.skeleton} aria-hidden="true"><span /><span /><span /></div></div>;
  } else if (listPhase === 'restricted') {
    listBody = <p className={styles.stateText}>{copy.listsRestricted}</p>;
  } else if (listPhase === 'unavailable') {
    listBody = <p className={styles.stateText}>{copy.listsUnavailable}</p>;
  } else if (lists.length === 0) {
    listBody = <p className={styles.emptyText}>{copy.listsEmpty}</p>;
  } else {
    listBody = (
      <div className={styles.listStack}>
        {lists.map((list) => (
          <details key={list.id} className={styles.listCard}>
            <summary className={styles.listSummary}>
              <span className={styles.listName}>{list.name}</span>
              <span className={styles.listMeta}>{copy.listSymbols(list.symbols.length)}</span>
            </summary>
            <ul className={styles.symbolList}>
              {list.symbols.map((member) => {
                const terminal = monitorChartHref(member.symbol, currentHref);
                const company = companyHref(member.symbol);
                return (
                  <li
                    key={list.id + ':' + member.symbol + ':' + String(member.position)}
                    className={styles.symbolRow}
                  >
                    <span className={styles.symbolName}>{member.symbol}</span>
                    <span className={styles.symbolActions}>
                      {terminal ? (
                        <Link className={styles.actionLink} href={terminal}>
                          {copy.openTerminal}
                        </Link>
                      ) : null}
                      {company ? (
                        <Link className={styles.actionLink} href={company}>
                          {copy.openCompany}
                        </Link>
                      ) : null}
                      <button type="button" className={styles.actionLink}
                        aria-controls="monitor-event-attention"
                        aria-label={`${copy.checkEvent} · ${member.symbol}`}
                        onClick={() => chooseEvent(list.id, member.symbol)}>{copy.checkEvent}</button>
                      {!terminal && !company ? (
                        <span className={styles.plainSymbol}>{member.symbol}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    );
  }

  let alertBody;
  if (alertPhase === 'loading') {
    alertBody = <div role="status" aria-busy="true"><p className={styles.stateText}>{copy.alertsChecking}</p><div className={styles.skeleton} aria-hidden="true"><span /><span /><span /></div></div>;
  } else if (alertPhase === 'restricted') {
    alertBody = <p className={styles.stateText}>{copy.alertsRestricted}</p>;
  } else if (alertPhase === 'unavailable') {
    alertBody = <p className={styles.stateText}>{copy.alertsUnavailable}</p>;
  } else if (alerts.length === 0) {
    alertBody = (
      <div className={styles.quietBlock}>
        <p className={styles.emptyText}>{copy.alertsEmpty}</p>
        <p className={styles.note}>{copy.quietNote}</p>
      </div>
    );
  } else {
    alertBody = (
      <ul className={styles.alertList}>
        {alerts.slice(0, 8).map((alert) => {
          const created = isoDay(alert.created_at);
          return (
            <li key={alert.id} className={styles.alertItem}>
              <div className={styles.alertHead}>
                <span className={styles.alertSymbol}>{alert.symbol}</span>
                <span className={styles.statusBadge + ' ' + styles[alertStatusClass(alert)]}>
                  {alertStatusLabel(alert, copy)}
                </span>
              </div>
              <p className={styles.alertCondition}>
                {conditionText(narrowAlertCondition(alert.condition), alert.symbol, lang)}
              </p>
              {created ? (
                <p className={styles.alertMeta}>{copy.created(created)}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.subtitle}>{copy.subtitle}</p>
        </div>
        {subjectId ? (
          <button type="button" className="btn btn-primary" onClick={onRefresh}>
            {copy.refresh}
          </button>
        ) : null}
      </header>
      <div className={styles.main}>
        {subjectId ? (
          <div className={styles.grid}>
            <div className={styles.attentionStack}>
              <div id="monitor-event-attention" ref={attentionTarget} tabIndex={-1} className={styles.attentionTarget}>
                {attentionBoundary ? <section className={styles.panel} data-event-attention-state={attentionBoundary.state}>
                  <h2 className={styles.panelTitle}>{copy.eventHeading}</h2>
                  <p className={styles.stateText} role="status">{attentionBoundary.text}</p>
                </section> : <MonitorEventAttention subjectId={subjectId} selection={attentionSelection}
                  refreshKey={attention?.attempt ?? 0} lang={lang} />}
              </div>
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>{copy.alertsHeading}</h2>
              {alertBody}
              <p className={styles.note}>{copy.savedNote}</p>
              <p className={styles.footerLink}>
                <Link href="/alerts">{alerts.length > 8 ? copy.allAlerts(alerts.length) : copy.manageAlerts}</Link>
              </p>
            </section>
            </div>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>
                  {copy.listsHeading}
                  {listCount !== null ? ' (' + String(listCount) + ')' : ''}
                </h2>
                {distinctCount !== null && distinctCount > 0 ? (
                  <p className={styles.distinctLabel}>{copy.distinctSymbols(distinctCount)}</p>
                ) : null}
              </div>
              {listBody}
              <p className={styles.note}>{copy.sharedNote}</p>
              <p className={styles.footerLink}>
                <span className={styles.portfolioNote}>{copy.portfolioNote}</span>
                <Link href="/portfolio">{copy.portfolio}</Link>
              </p>
            </section>
          </div>
        ) : (
          <section className={styles.panel + ' ' + styles.guestCard}>
            <h2 className={styles.panelTitle}>{copy.guestHeading}</h2>
            <p className={styles.stateText}>{copy.guestBody}</p>
            <p className={styles.footerLink}>
              <Link className="btn btn-primary" href="/login">
                {copy.signIn}
              </Link>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
