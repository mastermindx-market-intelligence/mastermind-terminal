'use client';

import { useCallback, useId, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n';
import { useSectorT } from '@/lib/sectorIntelligenceLex';
import { identityOwnerKey, isAccountOwner, type AccountIdentity } from '@/lib/accountIdentity';
import { companyHref, formatValue, type FeedPayload, type FeedStatus } from '@/lib/sectorIntelligence';
import { holdingsCoverageLine, type SectorHoldingsFund } from '@/lib/sectorHoldingsCoverage';
import CompanyIntelligencePrivate from '@/components/fin/CompanyIntelligencePrivate';
import styles from './SectorConstituentEvidence.module.css';

export interface SectorConstituentEvidenceProps {
  /** The sector's fund exactly as the owner holdings feed names it, e.g. "XLK". */
  readonly fund: string | null;
  /** The owner holdings coverage for that fund. Null when the source is absent, refused or unqualified. */
  readonly coverage: SectorHoldingsFund | null;
  /** The served receipt for the holdings source. */
  readonly feed: FeedPayload | null;
  /** The signed-in owner. The existing private host owns every admission decision. */
  readonly identity: AccountIdentity;
  /** The existing host owns sign-in navigation. */
  readonly onSignIn?: () => void;
  readonly presentation?: 'dark' | 'light';
}

/** A selection that belongs to one evidence lifetime. The epoch retires it. */
interface Scoped {
  readonly value: string;
  readonly epoch: number;
}

/**
 * Sector fund constituent → the company's existing private evidence.
 *
 * The listed holdings come from the owner's holdings source, never from a constant: the exact
 * fund ETF, the exact listed ticker, its position in the listed sample and weight in that fund, the membership date and
 * the served source receipt are all read as they were supplied. The component never claims the
 * list is a complete constituent set, never states a capture receipt the source did not supply,
 * and never turns a membership date into a disclosure date.
 *
 * The company evidence below is the owner's existing private host, mounted unchanged with the
 * exact supplied symbol. This component owns no fetch, no decoder, no permission decision and
 * no source store; it owns only the explicit open, the member selection and the lifetime fence
 * that retires a selection whose sector, member, source or account changed. The host's own
 * controller keeps its abort and generation behaviour.
 */
export default function SectorConstituentEvidence({
  fund, coverage, feed, identity, onSignIn, presentation,
}: SectorConstituentEvidenceProps) {
  const t = useSectorT();
  const { lang } = useLang();
  const headingId = useId();
  const selectId = useId();
  const evidenceId = useId();

  const ownerKey = identityOwnerKey(identity);
  const guest = !isAccountOwner(ownerKey);
  const receipt = feed?.receipt ?? null;
  const status: FeedStatus = receipt?.status ?? 'loading';

  // The lifetime binding. Every input that can change what the private read means takes part:
  // the sector's fund, the served receipt, the listed holdings and the account.
  const receiptKey = receipt
    ? [receipt.source, receipt.status, receipt.path, receipt.asOf, receipt.observedAt, receipt.contentHash, receipt.stale].join('|')
    : '';
  const coverageKey = coverage
    ? [coverage.fund, coverage.asOf, coverage.count.listed, coverage.count.total, coverage.weightPct].join('|')
    : '';
  const listedKey = coverage
    ? coverage.listed.map(row => `${row.ticker}:${row.rank}:${row.weightPct}`).join('|')
    : '';
  const binding = JSON.stringify([fund, ownerKey, receiptKey, coverageKey, listedKey]);

  // A monotonic epoch, so A → B → A is a NEW lifetime: the retired selection can never revive
  // the old panel. The adjustment happens during render, before anything is committed.
  const [scope, setScope] = useState(() => ({ binding, epoch: 0 }));
  if (scope.binding !== binding) setScope({ binding, epoch: scope.epoch + 1 });
  const epoch = scope.binding === binding ? scope.epoch : scope.epoch + 1;

  const [member, setMember] = useState<Scoped | null>(null);
  const [open, setOpen] = useState<Scoped | null>(null);

  const listed = coverage?.listed ?? [];
  const selected = member !== null && member.epoch === epoch && listed.some(row => row.ticker === member.value)
    ? member.value
    : null;
  // Only the CURRENT selected holding can be open. A changed member, a changed source or a
  // changed account closes the panel instead of re-pointing it.
  const opened = open !== null && open.epoch === epoch && open.value === selected ? open.value : null;
  const selectedRow = selected === null ? null : listed.find(row => row.ticker === selected) ?? null;

  const choose = useCallback((ticker: string) => {
    setMember({ value: ticker, epoch });
    // Another holding is another evidence lifetime: the previous panel is closed, never carried.
    setOpen(null);
  }, [epoch]);
  const openEvidence = useCallback(() => {
    if (selected !== null) setOpen({ value: selected, epoch });
  }, [selected, epoch]);
  const closeEvidence = useCallback(() => setOpen(null), []);

  const researchHref = selected === null ? null : companyHref(selected);
  const unavailable = status !== 'ready' ? (
    status === 'loading' ? t('siConstituentEvidenceFeedLoading')
      : status === 'access' ? t('siConstituentEvidenceFeedAccess')
        : status === 'invalid' ? t('siConstituentEvidenceFeedUnqualified')
          : t('siConstituentEvidenceFeedUnavailable')
  ) : null;

  return (
    <section className={styles.section} aria-labelledby={headingId} data-testid="sector-constituent-evidence"
      data-member={selected ?? undefined} data-open={opened !== null ? "true" : undefined}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{t('siConstituentEvidenceEyebrow')}</p>
          <h2 id={headingId}>{t('siConstituentEvidenceTitle')}</h2>
          <p className={styles.subject}>
            {t('siConstituentEvidenceFundLabel')}: {coverage?.fund ?? fund ?? '—'}
          </p>
        </div>
      </header>

      {unavailable !== null
        ? <p className={styles.status} role="status">{unavailable}</p>
        : coverage === null
          ? <p className={styles.status} role="status">{t('siConstituentEvidenceNoFund')}</p>
          : !listed.length
            ? <p className={styles.status} role="status">{t('siConstituentEvidenceNoMembers')}</p>
            : <>
              <p className={styles.basis}>{t('siConstituentEvidenceScope')}</p>

              <div className={styles.membership} data-testid="sector-constituent-membership">
                <dl className={styles.fields}>
                  <div>
                    <dt>{t('siTicker')}</dt>
                    <dd>{selected ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('siConstituentEvidenceRankLabel')}</dt>
                    <dd>{selectedRow === null ? '—' : `#${selectedRow.rank}`}</dd>
                  </div>
                  <div>
                    <dt>{t('siConstituentEvidenceWeightLabel')}</dt>
                    <dd>{selectedRow === null ? '—' : formatValue(selectedRow.weightPct, 2, '%')}</dd>
                  </div>
                  <div>
                    <dt>{t('siConstituentEvidenceMembershipAsOf')}</dt>
                    <dd><time dateTime={coverage.asOf}>{coverage.asOf}</time></dd>
                  </div>
                </dl>
                <p className={styles.coverage}>{holdingsCoverageLine(coverage, lang === 'zh' ? 'zh' : 'en')}</p>
                <p className={styles.scopeNote}>{t('siConstituentEvidenceSeparation')}</p>
                <p className={styles.scopeNote}>{t('siConstituentEvidenceTopHoldingsNote')}</p>
              </div>

              <div className={styles.picker}>
                <label htmlFor={selectId}>{t('siConstituentEvidenceMemberLabel')}</label>
                <select id={selectId} value={selected ?? ''} onChange={event => choose(event.currentTarget.value)}>
                  <option value="">{t('siConstituentEvidenceChooseMember')}</option>
                  {listed.map(row => (
                    <option key={row.ticker} value={row.ticker}>
                      {`${row.ticker} · #${row.rank} · ${formatValue(row.weightPct, 2, '%')}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.actions}>
                {opened === null
                  ? <button type="button" className={styles.action} disabled={selected === null}
                    aria-expanded={false} aria-controls={evidenceId} onClick={openEvidence}>
                    {t('siConstituentEvidenceOpen')}
                  </button>
                  : <button type="button" className={styles.action} aria-expanded={true} aria-controls={evidenceId}
                    onClick={closeEvidence}>
                    {t('siConstituentEvidenceClose')}
                  </button>}
                {researchHref !== null && <Link className={styles.secondary} href={researchHref}>{t('siOpenCompany')} ↗</Link>}
              </div>

              <div className={styles.evidence} id={evidenceId} data-testid="sector-constituent-evidence-panel">
                <CompanyIntelligencePrivate
                  key={JSON.stringify([epoch, opened])}
                  identity={identity}
                  symbol={opened}
                  enabled={opened !== null}
                  onSignIn={onSignIn}
                  presentation={presentation}
                />
                {opened !== null && onSignIn === undefined && guest && (
                  <Link className={styles.signIn} href="/login">{t('siConstituentEvidenceSignIn')}</Link>
                )}
              </div>
            </>}

      <details className={styles.receipt}>
        <summary>{t('siConstituentEvidenceFeedRecord')}</summary>
        <dl className={styles.fields}>
          <div>
            <dt>{t('siSourcePath')}</dt>
            <dd><code>{receipt?.path || '—'}</code></dd>
          </div>
          <div>
            <dt>{t('siSnapshotDate')}</dt>
            <dd>{receipt?.asOf || t('siUnknownDate')}</dd>
          </div>
          <div>
            <dt>{t('siFetched')}</dt>
            <dd>{receipt?.observedAt || '—'}</dd>
          </div>
          <div>
            <dt>{t('siHash')}</dt>
            <dd>{receipt?.contentHash || t('siConstituentEvidenceHashAbsent')}</dd>
          </div>
        </dl>
        {receipt?.stale === true && <p className={styles.note}>{t('siStale')}</p>}
        <p className={styles.note}>{t('siConstituentEvidenceFeedRecordCopy')}</p>
      </details>
    </section>
  );
}
