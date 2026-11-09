import { describe, expect, it, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OptionCard, type LiveMark } from "../../components/prophet/OptionCard";
const now = Date.parse("2026-11-04T00:00:00Z");
const contract = {type:"CALL", strike:100, expiry:"2026-12-18", entry_premium:2, eod_mark:3};
const good:LiveMark = {bid:3.9, ask:4.1, mid:4, last:4, ts_utc:new Date(now).toISOString()};
afterEach(()=>vi.restoreAllMocks());
function render(patch:Record<string,unknown>,lang:"en"|"zh",forced=false) {
 vi.spyOn(Date,"now").mockReturnValue(now);
 return renderToStaticMarkup(<OptionCard contract={contract} lang={lang} liveMark={{...good,...patch} as LiveMark} liveMarkForced={forced}/>);
}
for(const lang of ["en","zh"] as const) describe(lang,()=>{
 for(const [label,age] of [["now",0],["boundary",1200000]] as const)
 it("valid "+label,()=>{const html=render({ts_utc:new Date(now-age).toISOString()},lang);expect(html).toContain("$4.00");expect(html).toContain("$3.90");});
 for(const [label,ts] of [["stale",new Date(now-1200001).toISOString()],["future",new Date(now+1).toISOString()],["invalid","not-a-date"]] as const)
 it("falls back for "+label,()=>{const html=render({ts_utc:ts},lang);expect(html).toContain("$3.00");expect(html).not.toContain("$4.00");});
 it("forced fixture preserves intended clock bypass",()=>expect(render({ts_utc:"not-a-date"},lang,true)).toContain("$4.00"));
 for(const [label,patch] of [
  ["string mid",{mid:"4"}],["string bid",{bid:"3.9"}],["null bid",{bid:null}],["missing ask",{ask:undefined}]
 ] as const)
 it("malformed fresh "+label+" should degrade to EOD",()=>{const html=render(patch,lang);expect(html).toContain("$3.00");expect(html).not.toContain("$4.00");});
 for(const [label,patch] of [
  ["null mid",{mid:null}],["missing mid",{mid:undefined}],["negative mid",{mid:-4}],["crossed spread",{bid:4.2,ask:4.1}]
 ] as const)
 it("characterize "+label,()=>{const html=render(patch,lang);expect(html).toContain("obs-prophet-option");});
});

for(const lang of ["en","zh"] as const) {
 for(const forced of [false,true]) {
  for(const patch of [{mid:null},{mid:undefined},{mid:NaN},{mid:Infinity},{bid:Infinity},{ask:NaN},{mid:"4"}]) {
   it("numeric render contract "+lang+" "+forced+" "+JSON.stringify(patch),()=>{
    const html=render(patch,lang,forced);
    expect(html).toContain("$3.00");
    expect(html).not.toContain("$4.00");
    expect(html).not.toContain("$NaN");
    expect(html).not.toContain("$Infinity");
   });
  }
 }
}
