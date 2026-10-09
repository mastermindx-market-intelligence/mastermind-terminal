/** Native Vitest coverage of source-extracted polling callbacks, with a full planner import. */
import { test } from 'vitest';
import { planQuoteBatch } from '@/lib/quoteDemand';
import { registerPollingCases } from './quotePolling/singleFlightCases.mjs';

registerPollingCases(test, planQuoteBatch);
