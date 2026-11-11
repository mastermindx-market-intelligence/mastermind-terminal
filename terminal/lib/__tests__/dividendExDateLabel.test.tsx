// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import DividendsPage from '@/components/fin/DividendsPage';
import type {Fund,DividendEvent} from '@/lib/fund';
import {fmtDate} from '@/lib/finFormat';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let el:HTMLDivElement,root:Root;
const event=(ex:string,amount=1):DividendEvent=>({ex,amount,pay:'2026-11-01',type:'Regular'});
const fund=(events:DividendEvent[]):Fund=>({ticker:'TEST',asof:'2026-10-15',quote_currency:'CAD',dividends:{never_paid:false,yield_ttm:0.035,payout_ratio:0.25,events,splits:[]}} as unknown as Fund);
async function render(events:DividendEvent[],zh=false){await act(async()=>root.render(<DividendsPage sym="TEST" fund={fund(events)} zh={zh}/>));}
const card=()=>el.querySelectorAll('.fin-kpi')[3];
const label=()=>card()?.querySelector('.k')?.textContent;
const value=()=>card()?.querySelector('.v')?.textContent;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Network forbidden')}));el=document.createElement('div');document.body.appendChild(el);root=createRoot(el);});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();vi.useRealTimers();vi.unstubAllGlobals();});
for(const zh of [false,true])describe(zh?'ZH':'EN',()=>{
 const last=zh?'上次除息日':'Last ex-date',next=zh?'下次除息日':'Next ex-date',unknown=zh?'除息日':'Ex-date';
 it('labels latest past event as last',async()=>{await render([event('2026-04-01'),event('2026-10-01')],zh);expect(label()).toBe(last);expect(value()).toBe(fmtDate('2026-10-01'));});
 it('keeps the nearest future event next',async()=>{await render([event('2026-12-01'),event('2026-11-01')],zh);expect(label()).toBe(next);expect(value()).toBe(fmtDate('2026-11-01'));});
 it('keeps today inclusive',async()=>{await render([event('2026-10-15')],zh);expect(label()).toBe(next);});
 it('keeps mixed unsorted choice and amount',async()=>{await render([event('2026-12-01',3),event('2026-10-01',2),event('2026-11-01',4)],zh);expect(label()).toBe(next);expect(value()).toBe(fmtDate('2026-11-01'));expect(card()?.querySelector('.s')?.textContent).toContain('4.0000 CAD');});
 it.each(['','invalid','2026-02-30'])('does not call unusable date %s last or next',async(ex)=>{await render([event(ex)],zh);expect(label()).toBe(unknown);});
 it('handles no event without a time claim',async()=>{await render([],zh);expect(label()).toBe(unknown);expect(value()).toBe('—');});
 it('uses the existing UTC boundary before and after midnight',async()=>{vi.setSystemTime(new Date('2026-10-15T23:59:59Z'));await render([event('2026-10-15')],zh);expect(label()).toBe(next);vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));await render([event('2026-10-15')],zh);expect(label()).toBe(last);});
 it('keeps missing date neutral',async()=>{await render([{amount:1} as DividendEvent],zh);expect(label()).toBe(unknown);});
 it('keeps all other KPI values, history and provenance',async()=>{const ev=[event('2026-10-01',2),event('2026-04-01',1)];await render(ev,zh);const cards=el.querySelectorAll('.fin-kpi');expect(cards[0].querySelector('.v')?.textContent).toBe('3.50%');expect(cards[1].querySelector('.v')?.textContent).toBe('3.00');expect(cards[2].querySelector('.v')?.textContent).toBe('25.00%');expect(el.querySelectorAll('tbody tr')).toHaveLength(2);expect(el.querySelector('.fin-asof')?.textContent).toContain(fmtDate('2026-10-15'));expect(ev.map(x=>x.ex)).toEqual(['2026-10-01','2026-04-01']);});
 it('preserves null fund and explicit never-paid empty states',async()=>{await act(async()=>root.render(<DividendsPage sym="TEST" fund={null} zh={zh}/>));expect(el.querySelectorAll('.fin-kpi')).toHaveLength(0);expect(el.textContent).toContain('TEST');const f=fund([]);f.dividends.never_paid=true;await act(async()=>root.render(<DividendsPage sym="TEST" fund={f} zh={zh}/>));expect(el.querySelectorAll('.fin-kpi')).toHaveLength(0);expect(el.textContent).toContain(zh?'无股息记录':'No dividends on record');});
});
it('updates the label when the mounted language changes',async()=>{await render([event('2026-10-01')]);expect(label()).toBe('Last ex-date');await render([event('2026-10-01')],true);expect(label()).toBe('上次除息日');expect(value()).toBe(fmtDate('2026-10-01'));await render([event('2026-10-01')],false);expect(label()).toBe('Last ex-date');});
it('updates past to upcoming and back while mounted',async()=>{await render([event('2026-10-01')]);expect(label()).toBe('Last ex-date');await render([event('2026-11-01')]);expect(label()).toBe('Next ex-date');await render([event('2026-10-01')]);expect(label()).toBe('Last ex-date');});
it('does not change malformed selected-event value or amount',async()=>{await render([event('2026-02-30',7)]);expect(label()).toBe('Ex-date');expect(value()).toBe(fmtDate('2026-02-30'));expect(card()?.querySelector('.s')?.textContent).toContain('7.0000 CAD');});
it('retains the forty-row history cap',async()=>{const ev=Array.from({length:45},(_,i)=>event(`2025-${String(1+Math.floor(i/28)).padStart(2,'0')}-${String(1+i%28).padStart(2,'0')}`));await render(ev);expect(el.querySelectorAll('tbody tr')).toHaveLength(40);expect(el.querySelector('.fin-div-more')?.textContent).toBe('Showing 40 of 45 events');});
