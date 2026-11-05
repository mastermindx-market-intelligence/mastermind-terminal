// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChartTableView from '../../components/ChartTableView';
import { etDisplay, etDisplaySec, localDisplay } from '../intradaySources';

vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));

type Bar = { time: string | number; o: number; h: number; l: number; c: number; v: number };
const bar = (time: string | number, c = 102): Bar => ({ time, o: 100, h: 105, l: 99, c, v: 1000 });
const epoch = (iso: string) => Date.parse(iso) / 1000;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(bars: Bar[], timeframe = '1m') {
  await act(async () => root.render(<ChartTableView symbol="SPY" timeframe={timeframe} bars={bars}
    indCols={[{ key: 'ema', label: 'EMA', tag: 'EMA' }]}
    indRowsAt={(time) => ({ ema: typeof time === 'number' ? time % 100 : 42 })}
    onBack={() => {}} />));
}

const labels = () => [...host.querySelectorAll('.ctv-row .ctv-td-date')].map((node) => node.textContent);

describe('chart table bar timestamps', () => {
  it('distinguishes minute bars on the same day in newest-first order', async () => {
    await render([bar(epoch('2026-10-09T13:30:00Z')), bar(epoch('2026-10-09T13:31:00Z'), 103)]);
    expect(labels()[0]).toContain('13:31:00');
    expect(labels()[1]).toContain('13:30:00');
    expect(labels().every((label) => !label?.includes('UTC'))).toBe(true);
  });

  it('retains seconds for second-resolution bars', async () => {
    await render([bar(epoch('2026-10-09T13:30:01Z')), bar(epoch('2026-10-09T13:30:02Z'))], '1s');
    expect(labels()[0]).toContain('13:30:02');
    expect(labels()[1]).toContain('13:30:01');
  });

  it.each([
    ['US daylight time', etDisplay(Date.parse('2026-10-09T13:31:00Z')).epoch, 'Oct 09', '09:31:00'],
    ['US standard time', etDisplay(Date.parse('2026-01-09T14:31:00Z')).epoch, 'Jan 09', '09:31:00'],
    ['US seconds', etDisplaySec(Date.parse('2026-10-09T13:31:02.987Z')).epoch, 'Oct 09', '09:31:02'],
    ['China', localDisplay(Date.parse('2026-10-09T01:31:00Z'), 'Asia/Shanghai').epoch, 'Oct 09', '09:31:00'],
    ['Hong Kong', localDisplay(Date.parse('2026-10-09T01:31:00Z'), 'Asia/Hong_Kong').epoch, 'Oct 09', '09:31:00'],
  ])('renders the actual %s producer clock without a second offset or UTC claim', async (_market, time, date, clock) => {
    expect(Number.isInteger(time)).toBe(true);
    await render([bar(time as number)]);
    expect(labels()[0]).toContain(date);
    expect(labels()[0]).toContain(clock);
    expect(labels()[0]).not.toContain('UTC');
  });

  it('keeps the encoded chart date boundary when the browser uses another timezone', async () => {
    await render([bar(epoch('2026-10-09T23:59:59Z')), bar(epoch('2026-10-10T00:00:00Z'))]);
    expect(labels()[0]).toContain('Oct 10');
    expect(labels()[0]).toContain('00:00:00');
    expect(labels()[1]).toContain('Oct 09');
    expect(labels()[1]).toContain('23:59:59');
  });

  it.each(['D', '3D', 'W', '1M'])('preserves date-only calendar bars for %s', async (timeframe) => {
    await render([bar('2026-10-08'), bar('2026-10-09')], timeframe);
    expect(labels()).toEqual(['Fri Oct 09, 26', 'Thu Oct 08, 26']);
    expect(labels().every((label) => !label?.includes(':') && !label?.includes('UTC'))).toBe(true);
  });

  it('uses each bar identity rather than inferring midnight from an interval label', async () => {
    await render([bar('2026-10-09')], '1m');
    expect(labels()).toEqual(['Fri Oct 09, 26']);
  });

  it('preserves invalid-date fallback rather than inventing a clock', async () => {
    await render([bar(Infinity)]);
    expect(labels()).toEqual(['Invalid Date']);
  });

  it('aligns the date header with timestamp rows without changing numerical columns', async () => {
    await render([bar(epoch('2026-10-09T13:30:00Z'))]);
    const header = host.querySelector<HTMLElement>('.ctv-th.ctv-td-date')!;
    const cell = host.querySelector<HTMLElement>('.ctv-row .ctv-td-date')!;
    expect(header.style.minWidth).toBe(cell.style.minWidth);
    expect(parseInt(cell.style.minWidth)).toBeGreaterThanOrEqual(220);
    expect([...host.querySelectorAll('.ctv-row .ctv-td')].slice(1).map((node) => node.textContent))
      .toEqual(['100.00', '105.00', '99.00', '102.00', '+0.00 (+0.00%)', '1,000', '0.0000']);
  });

  it('exports exact intraday identities and the same retained replay rows and indicator values', async () => {
    const times = [epoch('2026-10-09T13:30:01Z'), epoch('2026-10-09T13:30:02Z')];
    const bars = times.map((time, i) => bar(time, 102 + i));
    const input = JSON.stringify(bars);
    let download: NodeBlob | undefined;
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('URL', { createObjectURL: (blob: NodeBlob) => { download = blob; return 'blob:chart-table'; }, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();
    await render(bars, '1s');
    await act(async () => host.querySelector<HTMLButtonElement>('.ctv-dl button')!.click());
    const csv = (await download!.text()).split('\n');
    expect(csv[0]).toBe('Date,Open,High,Low,Close,Change,Change%,Volume,EMA');
    expect(csv.slice(1)).toEqual([
      `${times[1]},100.0000,105.0000,99.0000,103.0000,1.0000,0.9804,1000,${(times[1] % 100).toFixed(4)}`,
      `${times[0]},100.0000,105.0000,99.0000,102.0000,0.0000,0.0000,1000,${(times[0] % 100).toFixed(4)}`,
    ]);
    expect(JSON.stringify(bars)).toBe(input);
    // Replay supplies only the admitted prefix; table and CSV must never reconstruct future rows.
    await render(bars.slice(0, 1), '1s');
    expect(labels()).toHaveLength(1);
    expect(labels()[0]).toContain('13:30:01');
    await act(async () => host.querySelector<HTMLButtonElement>('.ctv-dl button')!.click());
    expect((await download!.text()).split('\n')).toHaveLength(2);
  });
});
