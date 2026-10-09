// @vitest-environment jsdom
/** Real React/DOM lifecycle coverage of source-extracted lanes; not a full TerminalShell mount. */
import { planQuoteBatch } from '@/lib/quoteDemand';
import { registerReactPollingCases } from './quotePolling/reactCases.mjs';

registerReactPollingCases(planQuoteBatch);
