import { test } from "vitest";
import assert from 'node:assert/strict';
import {reviewIntlEvidence,CONTEXT_FIELDS,type IntlExactContext,type IntlOwnerResult} from '@/lib/intlInvestigationEvidence';
const context: IntlExactContext={researchMarket:'intl',toolBindingVersion:'v1',periodIdentity:'1m',currencyBasis:'USD',returnBasis:'price',owner:'owner',query:'q',cohort:'c',temporalPolicy:'asof',selectedMeasureIds:['b','a','b']};
const current: IntlOwnerResult={...context,generation:'g1',read:'ok',membership:'complete',observations:[],tombstones:[]};
test('published selected membership is unique, ordered and exactly backs the denominator',()=>{
  const r=reviewIntlEvidence(null,current,context);assert.deepEqual(r.selectedMeasureIds,['b','a']);assert.equal(r.coverage.selectedCount,2);
});
test('malformed selected input retains the same safe valid-ID denominator law',()=>{
  const bad={...context,selectedMeasureIds:['b',null,'a','b','',3]};
  const r=reviewIntlEvidence(null,current,bad as unknown as IntlExactContext);
  assert.deepEqual(r.selectedMeasureIds,['b','a']);assert.equal(r.coverage.selectedCount,r.selectedMeasureIds.length);assert.equal(r.answerReadiness,'incomplete');
});
test('missing selected membership fails closed with empty published list',()=>{
  const bad={...context,selectedMeasureIds:undefined};const r=reviewIntlEvidence(null,current,bad as unknown as IntlExactContext);
  assert.deepEqual(r.selectedMeasureIds,[]);assert.equal(r.coverage.selectedCount,0);
});
test('exported scope law keeps its nine original fields',()=>assert.deepEqual(CONTEXT_FIELDS,['researchMarket','toolBindingVersion','periodIdentity','currencyBasis','returnBasis','owner','query','cohort','temporalPolicy']));
