// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
for(const lang of ['en','zh'] as const) for(const state of ['present','absent'] as const) {
  it(`${lang} ${state}: keeps a focusable tooltip trigger without suppressing the global focus ring`,async()=>{
    vi.resetModules();
    vi.stubGlobal('fetch',async()=>new Response(JSON.stringify(state==='present'?{game_plan:{available:true,verdict:{en:'Mixed — normalizing',zh:'混合 — 正常化'},sub:{en:'Settled evidence',zh:'已结算证据'},asof:'2026-10-30',css:'neutral'}}:null),{status:200}));
    const {VolRegimeChip}=await import('@/components/eodcontext/VolRegimeChip');
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    try {
      await act(async()=>root.render(<VolRegimeChip lang={lang}/>));
      const trigger=host.querySelector('span[tabindex="0"]') as HTMLSpanElement;
      expect(trigger).toBeTruthy();
      expect(trigger.style.display).toBe('inline-flex');
      expect(trigger.textContent).toContain(state==='present'?(lang==='en'?'Mixed — normalizing':'混合 — 正常化'):(lang==='en'?'Vol regime unavailable':'波动率体制不可用'));
      await act(async()=>trigger.focus());
      expect(document.activeElement).toBe(trigger);
      const tip=document.querySelector('[role="tooltip"]');
      expect(tip).toBeTruthy();expect(trigger.getAttribute('aria-describedby')).toBe(tip!.id);
      await act(async()=>trigger.blur());expect(document.querySelector('[role="tooltip"]')).toBeNull();
      // Inline outline:none outranks the existing stylesheet :focus-visible ring.
      // This is a DOM/style contract, not a rendered keyboard or contrast certificate.
      expect(trigger.style.outline).not.toBe('none');
      expect(trigger.style.outlineStyle).not.toBe('none');
    } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
  });
}
it('retains the shared focus-visible rule rather than introducing a second local ring',()=>{
  const css=readFileSync(path.resolve(__dirname,'../../app/globals.css'),'utf8');
  expect(css).toContain(':focus-visible{outline:2px solid var(--brand-2);outline-offset:2px}');
});
