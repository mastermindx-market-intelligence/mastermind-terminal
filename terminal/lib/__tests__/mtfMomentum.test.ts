import {describe,it,expect} from "vitest";
import {wilderRsi,terminalStochastic,trueStochRsi,rsiMacd,momentumPoints,confluenceScore} from "../mtfMomentum";

const bars=Array.from({length:180},(_,i)=>{
  const c=100+i*.12+Math.sin(i/6)*5;
  return {c,h:c+1.4+Math.sin(i/11)*.3,l:c-1.3-Math.cos(i/13)*.25};
});
const closes=bars.map(b=>b.c);

describe("mtfMomentum",()=>{
  it("uses bounded deterministic Terminal stochastic and RSI-MACD math",()=>{
    expect(wilderRsi(closes).length).toBe(closes.length);
    const s=terminalStochastic(bars);
    expect(s.k.filter(x=>x!=null).every(x=>x!>=0&&x!<=100)).toBe(true);
    expect(rsiMacd(closes).line.length).toBe(closes.length);
    expect(momentumPoints(bars).filter(x=>x.score!=null).every(x=>x.score!>=0&&x.score!<=100)).toBe(true);
  });
  it("keeps true stochastic-of-RSI explicitly separate from product semantics",()=>{
    const product=terminalStochastic(bars).k;
    const research=trueStochRsi(closes).k;
    expect(product.some((v,i)=>v!=null&&research[i]!=null&&Math.abs(v!-research[i]!)>1e-6)).toBe(true);
  });
  it("rewards near-bottom context without making it a hard gate",()=>{
    const p=momentumPoints(bars).at(-1)!;
    const a=confluenceScore([{tf:"D",point:p,weight:1}],0);
    const b=confluenceScore([{tf:"D",point:p,weight:1}],1);
    expect(a).not.toBeNull();
    expect(a!).toBeGreaterThanOrEqual(b!);
  });
});
