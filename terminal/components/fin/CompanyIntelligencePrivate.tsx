'use client';

import { Component, type ReactNode } from 'react';
import { identityOwnerKey, type AccountIdentity } from '@/lib/accountIdentity';
import { useLang } from '@/lib/i18n';
import { PRIVATE_COMPANY_LEX } from '@/lib/companyIntelligencePrivateLex';
import { usePrivateCompanyIntelligence } from '@/lib/usePrivateCompanyIntelligence';
import CompanyIntelligencePrivatePanel from './CompanyIntelligencePrivatePanel';

export interface CompanyIntelligencePrivateProps {
  readonly identity: AccountIdentity;
  readonly symbol: string | null;
  readonly enabled?: boolean;
  readonly onSignIn?: () => void;
}

/**
 * A private render failure leaves constant copy in the view. The application root's
 * own caught-error reporter requires separate host qualification before integration.
 */
class PrivateRenderBoundary extends Component<
  { readonly children: ReactNode; readonly fallback: ReactNode },
  { readonly failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Deliberately do not log or forward the exception or private component props.
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ConnectedPrivateView({ identity, symbol, onSignIn }: CompanyIntelligencePrivateProps) {
  const { state, selectFact } = usePrivateCompanyIntelligence(identity, symbol);
  return <CompanyIntelligencePrivatePanel state={state} onSelectFact={selectFact} onSignIn={onSignIn} />;
}

/**
 * Isolated host entry point. Mounting in the real intelligence branch is separately
 * owned; no global theme signal or account/issuer authority is inferred here.
 */
export default function CompanyIntelligencePrivate({
  identity,
  symbol,
  enabled = true,
  onSignIn,
}: CompanyIntelligencePrivateProps) {
  const { lang } = useLang();
  if (!enabled) return null;

  // Email is mutable display information. UUID and the exact query define custody.
  // A real navigation/owner change starts a new private lifetime; errors never retry.
  const lifetime = JSON.stringify([identityOwnerKey(identity), symbol]);
  const fallback = <p role="status">{PRIVATE_COMPANY_LEX.sourceUnavailable[lang === 'zh' ? 1 : 0]}</p>;
  return (
    <PrivateRenderBoundary key={lifetime} fallback={fallback}>
      <ConnectedPrivateView identity={identity} symbol={symbol} onSignIn={onSignIn} />
    </PrivateRenderBoundary>
  );
}
