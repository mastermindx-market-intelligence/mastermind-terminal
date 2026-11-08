// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IntlInvestigationPanel, type IntlInvestigationPanelProps, type IntlEvidenceChange, type IntlComparisonStatus } from '@/components/research/IntlInvestigationPanel';
afterEach(cleanup);
const base: IntlInvestigationPanelProps = {
  lang:'en', question:'Independent acceptance fixture', marketLabel:'Japan', toolLabel:'Evidence', periodLabel:'1m', basisLabel:'USD',
  selectedMeasures:[], changedItems:[], comparisonStatus:'changed', savedAt:null, updatedAt:null, sourceGenerationAt:null, rightsAt:null,
  readiness:{state:'incomplete',unmet:['History']},
};
const row: IntlEvidenceChange = {
  stableId:'m1', label:'One evidence row', membership:'present', version:'revised', qualification:'changed', availability:'available',
  correction:true, excluded:false, numeric:{prior:0,current:1,delta:1,unit:'%'}, nonComparableReason:null,
};
const statuses: [IntlComparisonStatus,string,string][] = [
  ['changed','1 material evidence change','1 项实质证据变化'], ['unchanged','No material changes','无实质变化'],
  ['incomplete','Comparison incomplete','对比不完整'], ['unavailable','Comparison unavailable','对比不可用'],
  ['denied','Comparison denied','对比被拒绝'], ['invalid','Comparison invalid','对比无效'],
  ['scope_changed','Comparison scope changed','对比范围已变化'], ['unchecked','Not yet compared','尚未对比'],
];
for (const lang of ['en','zh'] as const) for(const [status,en,zh] of statuses) {
  it(`${lang}: visibly distinguishes ${status}`,()=>{
    render(<IntlInvestigationPanel {...base} lang={lang} comparisonStatus={status} evidenceChanges={[row]} />);
    expect(screen.getByText(lang==='en'?en:zh)).toBeTruthy();
  });
}
for (const lang of ['en','zh'] as const) {
  it(`${lang}: one row retains concurrent revision, qualification, correction and numeric zero`,()=>{
    render(<IntlInvestigationPanel {...base} lang={lang} evidenceChanges={[row]} changedItems={[{id:'legacy',label:'Must not duplicate',kind:'revised',note:'Legacy payload'}]} />);
    expect(screen.getAllByText('One evidence row')).toHaveLength(1);
    expect(screen.queryByText('Must not duplicate')).toBeNull();
    expect(screen.getByText(lang==='en'?'Revised':'已修订')).toBeTruthy();
    expect(screen.getByText(lang==='en'?'Qualification changed':'资格变化')).toBeTruthy();
    expect(screen.getByText(lang==='en'?'Correction':'更正')).toBeTruthy();
    expect(screen.getByText(lang==='en'?'0% → 1% (Δ +1%)':'0% → 1%（Δ +1%）')).toBeTruthy();
  });
}
const reasons = [
  ['unavailable','Numeric comparison unavailable','数值对比不可用'],
  ['not_applicable','Numeric comparison not applicable','数值对比不适用'],
  ['missing','Numeric comparison missing usable values','数值对比缺少可用数值'],
  ['incompatible','Numeric comparison incompatible — unit, basis or cohort differ','数值对比不兼容——单位、基准或队列不同'],
] as const;
for (const lang of ['en','zh'] as const) for (const [reason,en,zh] of reasons) {
  it(`${lang}: visibly retains ${reason} numeric reason`,()=>{
    render(<IntlInvestigationPanel {...base} lang={lang} comparisonStatus='incomplete' evidenceChanges={[{...row,numeric:null,nonComparableReason:reason}]} />);
    expect(screen.getByText(lang==='en'?en:zh)).toBeTruthy();
    expect(screen.queryByText(/0% → 1%/)).toBeNull();
  });
}
it('rendering the lossless path invokes no callback',()=>{
  const callback=vi.fn();
  render(<IntlInvestigationPanel {...base} evidenceChanges={[row]} onInspect={callback} onContinue={callback} onEdit={callback}/>);
  expect(callback).not.toHaveBeenCalled();
});
