'use client';

import { Fragment, useId } from 'react';
import { useLang } from '@/lib/i18n';
import type { PrivateReference } from '@/lib/companyIntelligencePrivate';
import type { PrivateCompanyPassiveStatus, PrivateCompanyViewProps } from '@/lib/companyIntelligencePrivateView';
import { PRIVATE_COMPANY_LEX } from '@/lib/companyIntelligencePrivateLex';
import styles from './CompanyIntelligencePrivatePanel.module.css';

type LexKey = keyof typeof PRIVATE_COMPANY_LEX;
const PASSIVE_COPY: Readonly<Record<PrivateCompanyPassiveStatus, LexKey>> = {
  guest: 'guest', unselected: 'unselected', unsupported: 'unsupported',
  access_unknown: 'accessUnknown', missing_feature: 'missingFeature',
  loading: 'loading', metadata_only: 'metadataOnly',
  source_unavailable: 'sourceUnavailable', selection_changed: 'selectionChanged',
  empty: 'qualifiedEmpty',
};

/** Presentation only: the controller supplies the current, fully composed view. */
export function CompanyIntelligencePrivatePanel({
  state, onSelectFact, onSignIn, presentation = 'dark',
}: PrivateCompanyViewProps) {
  const { lang } = useLang();
  const id = useId();
  const headingId = `${id}-heading`;
  const scopeId = `${id}-scope`;
  const selectId = `${id}-selection`;
  const t = (key: LexKey) => PRIVATE_COMPANY_LEX[key][lang === 'zh' ? 1 : 0];
  const current = state.status === 'ready' || state.status === 'selecting';
  const busy = state.status === 'loading' || state.status === 'selecting';
  const referenceRows = (label: LexKey, reference: PrivateReference) => (
    <Fragment key={label}>
      <dt>{t(label)} · {t('referenceSchema')}</dt><dd>{reference.schema}</dd>
      <dt>{t(label)} · {t('referenceHash')}</dt><dd>{reference.sha256}</dd>
      <dt>{t(label)} · {t('referenceBytes')}</dt><dd className={styles.number}>{reference.byte_length}</dd>
    </Fragment>
  );

  return (
    <div className={styles['ci-private-container']}>
      <section className={styles['ci-private']} lang={lang} data-presentation={presentation} aria-labelledby={headingId}>
        <header className={styles['ci-private-header']}>
          <div>
            <p className={styles['ci-private-eyebrow']}>{t('privateContext')}</p>
            <h2 id={headingId}>{t('heading')}</h2>
            {state.query && <p className={styles['ci-private-query']}>{t('companyQuery')}: {state.query}</p>}
          </div>
          {current && (
            <label className={styles['ci-private-select']} htmlFor={selectId}>
              {t('selectIntegration')}
              <select id={selectId} aria-describedby={scopeId} value={state.selectedFactId}
                onChange={(event) => onSelectFact(event.currentTarget.value)}>
                {state.selection.selections.map((entry, index) => (
                  <option key={entry.fact_id} value={entry.fact_id}>
                    {t('integrationOrdinal').replace('{n}', String(index + 1))}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        <div aria-busy={busy}>
          <p className={`${styles['ci-private-status']} ${state.status === 'ready' ? styles['ci-private-ready-status'] : ''}`} role="status" aria-live="polite">
            {state.status === 'ready' ? t('currentSelection') : state.status === 'selecting' ? t('loading') : t(PASSIVE_COPY[state.status])}
          </p>
          {state.status === 'guest' && onSignIn && <button className={styles.signIn} type="button" onClick={onSignIn}>{t('signIn')}</button>}
          {state.status === 'ready' && (
            <>
              <div className={styles['ci-private-badges']}><span>{t('planned')}</span><span>{t('researchContext')}</span></div>
              <dl className={styles['ci-private-fields']}>
                <div><dt>{t('product')}</dt><dd>{state.fact.fact.product ?? t('notInView')}</dd></div>
                <div><dt>{t('platform')}</dt><dd>{state.fact.fact.platform ?? t('notInView')}</dd></div>
                <div><dt>{t('disclosedAsPlanned').replace('{published_date}', state.fact.source_timing.published_date)}</dt><dd>{t('publicationDate')}: {state.fact.source_timing.published_date}</dd></div>
              </dl>
              <p className={styles['ci-private-note']}>{t('scopeNote')}</p>
              <details className={styles['ci-private-details']} key={JSON.stringify([state.viewKey, state.selectedFactId])}>
                <summary>{t('referenceDetails')}</summary>
                <dl>
                  {state.fact.source_timing.publication_precision === 'instant' && (
                    <Fragment><dt>{t('publicationInstant')}</dt><dd>{state.fact.source_timing.published_at}</dd></Fragment>
                  )}
                  <dt>{t('sourceObservation')}</dt><dd>{state.fact.source_timing.known_at}</dd>
                  <dt>{t('issuer')}</dt><dd>{state.context.issuer_binding.issuer_id}</dd>
                  <dt>{t('cik')}</dt><dd>{state.context.issuer_binding.evidenced_cik}</dd>
                  {referenceRows('identityReference', state.context.issuer_binding.identity_snapshot_reference)}
                  {referenceRows('factReference', state.fact.reference)}
                  {referenceRows('editionReference', state.fact.edition)}
                  <dt>{t('generation')}</dt><dd>{state.fact.generation}</dd>
                </dl>
              </details>
            </>
          )}
          {state.status !== 'ready' && state.status !== 'selecting' &&
            ['access_unknown', 'metadata_only', 'source_unavailable', 'selection_changed'].includes(state.status) &&
            <p className={styles['ci-private-note']}>{t('laterVisit')}</p>}
        </div>
        <p id={scopeId} className={styles['ci-private-footer']}>{t('authorityNote')}</p>
      </section>
    </div>
  );
}

export default CompanyIntelligencePrivatePanel;
