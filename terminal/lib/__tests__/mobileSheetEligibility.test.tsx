// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach, afterEach, describe, it, expect, vi} from 'vitest';
import MobileSheet from '@/components/ui/MobileSheet';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  window.matchMedia = vi.fn(() => ({matches:false,addEventListener(){},removeEventListener(){}})) as any;
  window.requestAnimationFrame = cb => window.setTimeout(() => cb(0), 0);
  window.cancelAnimationFrame = id => window.clearTimeout(id);
  // Layout is not supplied by jsdom. Every connected, non-hidden node has one
  // explicit synthetic box; hidden/display:none ancestry has no boxes.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this:HTMLElement) {
    return this.isConnected && !this.closest('[hidden], [data-no-box]') ? [new DOMRect(0,0,20,20)] as any : [] as any;
  });
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

function Fixture({open, keepMounted=false}: {open:boolean;keepMounted?:boolean}) {
  return <><button id="outside">Outside</button><MobileSheet open={open} keepMounted={keepMounted} onClose={()=>{}} initialFocus="sheet">
    <div id="ancestor"><button id="remembered">Remembered</button></div><button id="good">Good</button>
  </MobileSheet></>;
}
async function render(open:boolean, keepMounted=false) {await act(async () => root.render(<Fixture open={open} keepMounted={keepMounted}/>));await act(async()=>vi.runAllTimersAsync());}
function el(id:string){return document.getElementById(id)!;}
async function present(){await render(false);el('outside').focus();await render(true);}
async function key(shift=false){const e=new KeyboardEvent('keydown',{key:'Tab',shiftKey:shift,bubbles:true,cancelable:true});await act(async()=>{document.activeElement!.dispatchEvent(e);});return e;}

describe('1154 current-sheet effective eligibility',()=>{
  for(const kind of ['unchanged','disabled','fieldset','aria-disabled','aria-hidden','inert','hidden','visibility','display','removed','negative-tabindex']) {
    it('re-presentation checks remembered target: '+kind,async()=>{
      await present();el('remembered').focus();expect(document.activeElement).toBe(el('remembered'));
      await render(false,true);el('outside').focus();
      const remembered=el('remembered'), ancestor=el('ancestor');
      if(kind==='disabled')(remembered as HTMLButtonElement).disabled=true;
      if(kind==='aria-disabled')remembered.setAttribute('aria-disabled','true');
      if(kind==='fieldset'){const fieldset=document.createElement('fieldset');ancestor.append(fieldset);fieldset.append(remembered);fieldset.disabled=true;expect(remembered.matches(':disabled')).toBe(true);}
      if(kind==='aria-hidden')ancestor.setAttribute('aria-hidden','true');
      if(kind==='inert')ancestor.setAttribute('inert','');
      if(kind==='hidden')ancestor.hidden=true;
      if(kind==='visibility')ancestor.style.visibility='hidden';
      if(kind==='display'){ancestor.style.display='none';ancestor.setAttribute('data-no-box','');}
      if(kind==='removed')remembered.remove();
      if(kind==='negative-tabindex')remembered.tabIndex=-1;
      await render(true,true);
      const sheet=document.querySelector<HTMLElement>('.msheet')!;
      expect(document.activeElement).toBe(kind==='unchanged'?remembered:sheet);
      expect(sheet.contains(document.activeElement)).toBe(true);
    });
  }
  for(const kind of ['disabled','aria-disabled','hidden','inert','visibility','display']) {
    it('presentation skips an unavailable explicit autofocus: '+kind,async()=>{
      await render(false,true);el('outside').focus();
      const remembered=el('remembered'),ancestor=el('ancestor');
      remembered.setAttribute('data-autofocus','');
      if(kind==='disabled')(remembered as HTMLButtonElement).disabled=true;
      if(kind==='aria-disabled')remembered.setAttribute('aria-disabled','true');
      if(kind==='hidden')ancestor.hidden=true;
      if(kind==='inert')ancestor.setAttribute('inert','');
      if(kind==='visibility')ancestor.style.visibility='hidden';
      if(kind==='display'){ancestor.style.display='none';ancestor.setAttribute('data-no-box','');}
      await render(true,true);
      expect(document.activeElement).toBe(document.querySelector('.msheet'));
    });
  }
  it('retains deliberately non-tabbed explicit autofocus',async()=>{
    await render(false,true);el('outside').focus();
    const parked=document.createElement('div');parked.tabIndex=-1;parked.setAttribute('data-autofocus','');document.querySelector('.msheet')!.append(parked);
    await render(true,true);expect(document.activeElement).toBe(parked);
  });
  it('does not reject the first-legend exception in a disabled fieldset',async()=>{
    await present();const remembered=el('remembered'),ancestor=el('ancestor');
    const fieldset=document.createElement('fieldset'),legend=document.createElement('legend');ancestor.append(fieldset);fieldset.append(legend);legend.append(remembered);fieldset.disabled=true;
    expect(remembered.matches(':disabled')).toBe(false);
    await key();expect(document.activeElement).toBe(remembered);
  });
  for(const shift of [false,true]) {
    it('Tab skips a disabled fieldset descendant from parked focus: '+shift,async()=>{
      await present();const remembered=el('remembered'),ancestor=el('ancestor');
      const fieldset=document.createElement('fieldset');ancestor.append(fieldset);fieldset.append(remembered);fieldset.disabled=true;
      // Reverse the eligible nodes so the disabled descendant is the chosen end.
      if(shift)document.querySelector('.msheet')!.append(ancestor);
      const e=await key(shift);expect(e.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el('good'));
    });
  }
  it('current parked-inside-node fix remains active in both directions',async()=>{
    await present();const sheet=document.querySelector<HTMLElement>('.msheet')!;
    const parked=document.createElement('div');parked.tabIndex=-1;sheet.append(parked);
    parked.focus();await key();expect(document.activeElement).toBe(el('remembered'));
    parked.focus();await key(true);expect(document.activeElement).toBe(el('good'));
  });
  it('ordinary boundaries still wrap within the same focus owner',async()=>{
    await present();el('remembered').focus();await key(true);expect(document.activeElement).toBe(el('good'));
    await key(false);expect(document.activeElement).toBe(el('remembered'));
  });
});
