// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SpotVolCard} from '../../components/msc/TrendCards';
import {MarketStructureBody} from '../../components/msc/MarketStructureBody';
import {spotVol} from '../aggTrend';
import {makeMscT} from '../../components/msc/mscStrings';
// Source-shaped series mirror the unchanged Macro daily_aggregates/build_trend_payload
// fixtures exercised in the support package. Decimal IV is published to four places.
function payload(n: number, kind = 'flat') {
  const date = new Date('2025-01-02T00:00:00Z');
  const series = Array.from({length:n}, (_,i) => {
    while ([0,6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate()+1);
    const d=date.toISOString().slice(0,10); date.setUTCDate(date.getUTCDate()+1);
    return {d,s:kind==='spot'?100:i%2===0?100:200,
      iv:kind==='orthogonal'?[.25,.375,.5,.375][i%4]
        :kind==='variable'?[.25,.375,.3125,.5,.4375][i%5]:.25};
  });
  return {schema:'options_hub.aggtrend/v1',root:'SPY',series};
}
const cases = {
  constant30:payload(31),constant32:payload(33),constant252:payload(253),
  roundedFlat:payload(65),measuredZero:payload(33,'orthogonal'),
  variable:payload(65,'variable'),insufficient:payload(30),constantSpot:payload(65,'spot'),
};

// Peripheral siblings and parent-only monetary format seam; actual body/model/target/chrome/SVG run.
vi.mock('../../components/msc/MatrixHeatCard',()=>({MatrixHeatCard:()=>null}));
vi.mock('../../components/msc/QuadCards',()=>({FloatingStrikeCard:()=>null,QuadScreenerCard:()=>null}));
vi.mock('../../components/msc/GradesCard',()=>({GradesCard:()=>null}));
vi.mock('../gexLadder',()=>({fmtMn:(v:number)=>String(v),fmtMnMag:(v:number)=>String(Math.abs(v))}));

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const mounted:Root[]=[];
afterEach(()=>{for(const r of mounted)act(()=>r.unmount());mounted.length=0;document.body.innerHTML='';});
const gex={spot_ref:100,by_strike:[{strike:95,gamma_net:1,delta_net:2,vanna_net:3,charm_net:4},{strike:105,gamma_net:-1,delta_net:2,vanna_net:3,charm_net:4}]};
function view(agg:any,lang:'en'|'zh',parent:boolean){return parent?<MarketStructureBody gex={gex as any} moves={null} agg={agg} lang={lang}/>:<SpotVolCard agg={agg} lang={lang}/>;}
function card(container:ParentNode,lang:'en'|'zh'){
 const title=makeMscT(lang)('svTitle');
 return [...container.querySelectorAll('section')].find(e=>e.textContent?.includes(title))??container;
}
function value(container:ParentNode,label:string){const node=[...container.querySelectorAll('span')].find(x=>x.textContent===label);return node?.nextElementSibling?.textContent;}
function mount(agg:any,lang:'en'|'zh',parent:boolean){const el=document.createElement('div');document.body.append(el);const root=createRoot(el);mounted.push(root);act(()=>root.render(view(agg,lang,parent)));return {el,root};}
const nulls=['constant30','constant32','constant252','roundedFlat'] as const;
for(const parent of [false,true])for(const lang of ['en','zh'] as const){
 describe(`${parent?'actual parent':'direct'} ${lang}`,()=>{
  for(const name of nulls)it(`${name}: producer null stays unavailable, beta zero stays measured`,()=>{
   const agg=cases[name],r=spotVol(agg.series);
   expect(r.r2).toBeNull();expect(r.beta).toBe(0);expect(r.n).toBeGreaterThanOrEqual(30);
   const {el}=mount(agg,lang,parent),target=card(el,lang),t=makeMscT(lang);
   expect(value(target,t('svR2'))).toBe('—');
   expect(value(target,t('svBeta'))).toBe('0.00');
   expect(target.textContent).toContain(t('svUnknown'));
   expect(target.querySelector(`svg[aria-label="${t('svTitle')}"]`)).not.toBeNull();
  });
  it('genuine measured R² zero remains 0%',()=>{
   const agg=cases.measuredZero,r=spotVol(agg.series);expect(r.r2).toBe(0);expect(r.beta).toBe(0);
   const {el}=mount(agg,lang,parent),t=makeMscT(lang);expect(value(card(el,lang),t('svR2'))).toBe('0%');
  });
  it('variable regression retains its measured explained percentage and units',()=>{
   const agg=cases.variable,r=spotVol(agg.series);expect(r.r2).not.toBeNull();
   const {el}=mount(agg,lang,parent),t=makeMscT(lang);expect(value(card(el,lang),t('svR2'))).toBe(`${(r.r2!*100).toFixed(0)}%`);expect(el.textContent).toContain(t('svBeta'));
  });
  for(const name of ['insufficient','constantSpot'] as const)it(`${name}: keeps existing absent-regression state`,()=>{
   const agg=cases[name],r=spotVol(agg.series);expect(r.beta).toBeNull();
   const {el}=mount(agg,lang,parent),t=makeMscT(lang);expect(value(card(el,lang),t('svR2'))).toBeUndefined();expect(el.textContent).toContain(t('svNone').replace('{n}',String(r.n)));
  });
  it('repeated parent update preserves each distinction',()=>{
   const {el,root}=mount(cases.variable,lang,parent),t=makeMscT(lang);
   for(let i=0;i<3;i++)for(const [name,expected] of [['constant32','—'],['measuredZero','0%']] as const){act(()=>root.render(view(cases[name],lang,parent)));expect(value(card(el,lang),t('svR2'))).toBe(expected);}
  });
 });
}
