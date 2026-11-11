// @vitest-environment jsdom
/** Real React/DOM lifecycle coverage of source-extracted lanes; not a full TerminalShell mount. */
import { planQuoteBatch } from '@/lib/quoteDemand';
import { mergeFormingQuote } from '@/lib/formingCandles';
import { isPublicBoatsQuote, isExtQuoteCurrent, extQuotePollMs } from '@/lib/extQuoteFreshness';
import { registerReactPollingCases } from './quotePolling/reactCases.mjs';

registerReactPollingCases(planQuoteBatch, { mergeFormingQuote, isPublicBoatsQuote, isExtQuoteCurrent, extQuotePollMs });
