// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DividendsPage from '@/components/fin/DividendsPage';
import type { Fund, FundDividends } from '@/lib/fund';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const empty = (yieldTtm: number | null = null): FundDividends => ({
  never_paid: true, yield_ttm: yieldTtm, payout_ratio: null, events: [], splits: [],
});
const fund = (dividends: FundDividends | null | undefined): Fund => ({
  ticker: 'TEST', asof: '2026-11-05', quote_currency: 'CAD', dividends,
} as unknown as Fund);
const explanation = (zh: boolean) => zh
  ? 'TEST 在本数据集中没有股息记录。这不能确认公司的完整派息历史或未来派息计划。'
  : "TEST has no dividend records in this dataset. This does not confirm the company's full dividend history or future distribution plans.";
const render = async (value: Fund | null, zh: boolean) => {
  await act(async () => root.render(<DividendsPage sym="TEST" fund={value} zh={zh} />));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

for (const zh of [false, true]) describe(zh ? 'Chinese' : 'English', () => {
  it.each([
    ['missing dividend field', undefined],
    ['null dividend field', null],
    ['producer no-record flag', empty()],
    ['producer no-record flag with a positive yield', empty(0.025)],
  ] as const)('limits %s to the available dataset', async (_name, dividends) => {
    const input = fund(dividends);
    const before = JSON.stringify(input);
    await render(input, zh);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('.fin-empty-why')?.textContent).toBe(explanation(zh));
    expect(container.textContent).not.toMatch(/company policy|not a gap|no distribution is currently planned|has never declared|公司政策|并非数据缺失|目前也没有派息计划|从未宣派/);
    expect(container.querySelectorAll('.fin-kpi')).toHaveLength(0);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps missing fundamentals distinct from a dataset without dividend records', async () => {
    await render(null, zh);
    expect(container.querySelector('.fin-empty-title')?.textContent).toBe(zh ? '尚未覆盖基本面数据' : 'Fundamentals not yet covered');
    expect(container.querySelector('.fin-empty-why')?.textContent).toBe(zh ? 'TEST 的股息数据尚未采集。' : "Dividend data for TEST hasn't been collected yet.");
  });

  it('preserves populated amounts, yields, dates, splits and source values', async () => {
    const input = fund({ ...empty(), never_paid: false, yield_ttm: 0.025, payout_ratio: 0.4,
      events: [{ ex: '2026-10-01', amount: 1.5, pay: '2026-10-20', type: 'regular' }],
      splits: [{ date: '2025-07-01', ratio: '2:1' }],
    });
    const before = JSON.stringify(input);
    await render(input, zh);
    expect([...container.querySelectorAll('.fin-kpi .v')].map(node => node.textContent)).toEqual(['2.50%', '1.50', '40.00%', 'Oct 1, 2026']);
    expect(container.textContent).toContain('1.5000 CAD');
    expect(container.textContent).toContain('Oct 20, 2026');
    expect(container.textContent).toContain('2:1');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(JSON.stringify(input)).toBe(before);
  });
});

it('updates both languages without remounting or retaining the old assertion', async () => {
  const value = fund(empty());
  for (const zh of [false, true, false]) {
    await render(value, zh);
    expect(container.querySelector('.fin-empty-why')?.textContent).toBe(explanation(zh));
  }
});
