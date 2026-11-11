import type {
  PrivateCompanyContext,
  PrivateIssuerSelections,
  PrivateProductIntegration,
} from './companyIntelligencePrivate';

/** Feature-local presentation contract; it confers no source or account authority. */
interface PrivateViewIdentity {
  /** Opaque controller lifetime/request key, used only to reset local disclosure UI. */
  readonly viewKey: string;
  readonly query: string | null;
}

export type PrivateCompanyPassiveStatus =
  | 'guest'
  | 'unselected'
  | 'unsupported'
  | 'access_unknown'
  | 'missing_feature'
  | 'loading'
  | 'metadata_only'
  | 'source_unavailable'
  | 'selection_changed'
  | 'empty';

export interface PrivateCompanyPassiveState extends PrivateViewIdentity {
  readonly status: PrivateCompanyPassiveStatus;
}

/** A current selection can remain selectable while its new fact is being read. */
export interface PrivateCompanySelectingState extends PrivateViewIdentity {
  readonly status: 'selecting';
  readonly context: PrivateCompanyContext;
  readonly selection: PrivateIssuerSelections;
  readonly selectedFactId: string;
}

/** Only the controller's fully decoded and composed current result reaches READY. */
export interface PrivateCompanyReadyState extends PrivateViewIdentity {
  readonly status: 'ready';
  readonly context: PrivateCompanyContext;
  readonly selection: PrivateIssuerSelections;
  readonly selectedFactId: string;
  readonly fact: PrivateProductIntegration;
}

export type PrivateCompanyViewState =
  | PrivateCompanyPassiveState
  | PrivateCompanySelectingState
  | PrivateCompanyReadyState;

export interface PrivateCompanyViewProps {
  readonly state: PrivateCompanyViewState;
  readonly onSelectFact: (factId: string) => void;
  /** The existing host owns sign-in navigation; no route is invented here. */
  readonly onSignIn?: () => void;
  /** Light requires an explicit future host signal and approved host token aliases. */
  readonly presentation?: 'dark' | 'light';
}
