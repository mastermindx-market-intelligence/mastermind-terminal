import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import CompanyIntelligencePrivatePanel from '@/components/fin/CompanyIntelligencePrivatePanel';
import { LangProvider, applyLang } from '@/lib/i18n';
import type { PrivateCompanyViewState } from '@/lib/companyIntelligencePrivateView';
import fixture from './fixture.json';
const statuses = ['ready', 'guest', 'unselected', 'unsupported', 'access_unknown', 'missing_feature', 'loading', 'metadata_only', 'source_unavailable', 'selection_changed', 'empty', 'selecting'];
function Harness() {
 const [status,setStatus]=useState('ready');const [width,setWidth]=useState('820');const [locale,setLocale]=useState('en');const [theme,setTheme]=useState('dark');const [stress,setStress]=useState(false);const [epoch,setEpoch]=useState(0);
 const state=structuredClone(fixture);state.status=status;state.viewKey='synthetic-'+epoch;
 if(stress){state.fact.fact.product=locale==='zh'?'例'.repeat(84):'X'.repeat(256);state.fact.fact.platform=locale==='zh'?'文'.repeat(84):'Y'.repeat(256);}
 const light = theme==='light' ? {'--bg':'#ffffff','--panel':'#ffffff','--panel-2':'#fbfcfe','--line':'#e3e7ee','--line-2':'#e3e7ee','--text':'#1a1d24','--text-2':'#4a5160','--brand-2':'#2962ff'} : {};
 return <><div id="controls"><label>State <select id="state" value={status} onChange={e=>{setStatus(e.target.value);setEpoch(x=>x+1)}}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><label>Pane <select id="width" value={width} onChange={e=>setWidth(e.target.value)}>{['300','390','820','1400'].map(s=><option key={s}>{s}</option>)}</select></label><button id="locale" onClick={()=>{const l=locale==='en'?'zh':'en';setLocale(l);applyLang(l)}}>Locale: {locale}</button><button id="theme" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>Study material: {theme}</button><button id="stress" onClick={()=>setStress(x=>!x)}>Max strings: {String(stress)}</button><button id="epoch" onClick={()=>setEpoch(x=>x+1)}>New synthetic epoch</button></div><div id="pane" style={{width:Number(width),...light}}><CompanyIntelligencePrivatePanel state={state as PrivateCompanyViewState} onSelectFact={()=>setEpoch(x=>x+1)} onSignIn={()=>{}} presentation={theme as 'dark'|'light'} /></div></>;
}
createRoot(document.getElementById('app')!).render(<LangProvider><Harness/></LangProvider>);
