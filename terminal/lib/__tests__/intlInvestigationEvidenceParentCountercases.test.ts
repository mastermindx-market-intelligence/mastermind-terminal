// @ts-nocheck -- frozen parent_countercases.mjs is untyped JavaScript; its body is byte-identical (the repo never typechecks JS: allowJs without checkJs).
import { test } from "vitest";
import assert from 'node:assert/strict';
import {toIntlEvidenceCensus,reviewIntlEvidence} from '@/lib/intlInvestigationEvidence';
import {reviewEvidence} from '@/lib/investigationEvidenceDiff';
const ctx={researchMarket:'JP',toolBindingVersion:'v1',periodIdentity:'1m',currencyBasis:'local',returnBasis:'price',owner:'intl',query:'policy',cohort:'all',temporalPolicy:'latest_vintage',selectedMeasureIds:['rate']};
const row={id:'rate',availability:'available',qualified:true,excluded:false,correction:false,contentIdentity:'content-v1',qualificationIdentity:'q1',interpretation:{value:0,unit:'percent',basis:'nominal_point',cohort:'JP'}};
const make=(context=ctx,patch={})=>({...context,generation:'g1',read:'ok',membership:'complete',observations:[row],tombstones:[],...patch});
test('an explicit unmet comparison prerequisite cannot become answer ready',()=>{
 const result=reviewIntlEvidence(make(),make(),ctx,{requiredMeasureIds:['rate','comparison-rate'],unmetPrerequisites:['comparison economy missing']});
 assert.equal(result.answerReadiness,'incomplete');
});
test('zero qualified observations cannot become answer ready',()=>{
 const result=reviewIntlEvidence(make(),make(ctx,{observations:[{...row,qualified:false}]}),ctx,{requiredMeasureIds:['rate'],unmetPrerequisites:[]});
 assert.deepEqual(result.coverage,{selectedCount:1,qualifiedCount:0});
 assert.equal(result.answerReadiness,'incomplete');
});
test('malformed context fails closed without throwing',()=>{
 let result;assert.doesNotThrow(()=>{result=reviewIntlEvidence(make(),make(),{});});
 assert.equal(result.answerReadiness,'incomplete');
 assert.equal(result.review.summary,'invalid');
});
test('safe censuses bind full context even when generic kernel is called directly',()=>{
 const other={...ctx,toolBindingVersion:'v2'};
 const a=toIntlEvidenceCensus(make(),ctx),b=toIntlEvidenceCensus(make(other),other);
 assert.equal(a.ok,true);assert.equal(b.ok,true);
 assert.equal(reviewEvidence(a.census,b.census).summary,'scope_changed');
});
test('failed read stays unavailable rather than falsely becoming an access denial',()=>{
 const r=toIntlEvidenceCensus(make(ctx,{read:'unavailable'}),ctx);
 assert.equal(r.ok,true);assert.equal(r.census.items[0].interpretation,null);
 assert.equal(r.census.items[0].availability,'unavailable');
});
