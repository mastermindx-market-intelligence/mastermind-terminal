import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/upstreams", () => ({ FLOW_BACKEND: "http://127.0.0.1:8000" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { GET } from "@/app/api/portfolio/risk-history/route";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { createFixtureDb, fixtureUserId } from "@/lib/watchlistsFixtureDb";
import { resetOhlcSeriesCache } from "@/lib/ohlcSeriesCache";
import { RF_UNREADABLE_REASON } from "@/lib/portfolioRiskHistory";

const DAY = 86400000;
function dateBack(date: string, n: number) { return new Date(Date.parse(date + "T00:00:00Z") - n * DAY).toISOString().slice(0, 10); }
function price(ticker: string) {
  return { t: ticker, o: 1, bars: Array.from({ length: 140 }, (_, i) => {
    const date = new Date(Date.parse("2023-01-02T00:00:00Z") + i * DAY).toISOString().slice(0,10);
    const c = 100 + i * .1 + i % 7;
    return [date, c, c, c, c, 1];
  }) };
}
function envelope(url: string, stale = false) {
  const u = new URL(url);
  const requested = Object.fromEntries(u.searchParams);
  const last = stale ? dateBack(requested.expected_through, 1) : requested.end;
  const points = [];
  for (let d = requested.start; d <= last; d = dateBack(d, -1)) points.push({date:d,value:4.4});
  return { schema:"treasury.daily_history.v1",status:stale?"stale":"read",reason:stale?"before_expected_through":null,
    unit:"percent_per_annum",basis:"investment",points,requested,
    coverage:{observation_count:points.length,requested_calendar_days:(Date.parse(requested.end)-Date.parse(requested.start))/DAY+1,first:points[0]?.date??null,last:points.at(-1)?.date??null},
    clocks:{read_at:"2023-05-22T12:00:00+00:00",release_at:null,knowledge_at:null,vintage_at:null},
    source:{source_id:"DGS3MO",native_alias:"us3m",origin:"FRED",native_path:"data/fred/DGS3MO.parquet",last_observation_date:last,sha256:"a".repeat(64),citation:"Board of Governors of the Federal Reserve System (US), H.15, via FRED",source_url:"https://fred.stlouisfed.org/series/DGS3MO",publication_status:"not_qualified"} };
}

describe("risk-history Treasury composition", () => {
  let db: ReturnType<typeof createFixtureDb>;
  let owner: string;
  let calls: {url:string;init?:RequestInit}[];
  let getSession: ReturnType<typeof vi.fn>;
  let getUser: ReturnType<typeof vi.fn>;
  let reply: (url:string)=>Response;
  let alterPrices: (body: ReturnType<typeof price>) => ReturnType<typeof price>;
  const savedEnv = {...process.env};
  beforeEach(async () => {
    delete process.env.TERMINAL_E2E_FIXTURE;
    process.env.STOCKDATA_BASE = "https://www.mastermind-x.com";
    resetOhlcSeriesCache();calls=[];
    const key = "treasury-"+Math.random().toString(36).slice(2);owner=fixtureUserId(key);db=createFixtureDb(key);
    await db.from("portfolio_positions").insert({user_id:owner,ticker:"AAA",shares:10,entry_price:10,status:"open",entry_currency:"USD",entry_currency_basis:{ticker:"AAA",price:10}} as any);
    getSession=vi.fn(async()=>({data:{session:{access_token:"captured-owner-token",user:{id:owner}}},error:null}));
    getUser=vi.fn(async(_token:string)=>({data:{user:{id:owner}},error:null}));
    vi.mocked(createClient).mockResolvedValue({...db,auth:{getSession,getUser}} as any);
    vi.mocked(cookies).mockResolvedValue({getAll:()=>[{name:"sb-ref-auth-token",value:"later-cookie-generation"},{name:"unrelated",value:"private-cookie"}]} as any);
    reply = url => new Response(JSON.stringify(envelope(url)));
    alterPrices = body => body;
    global.fetch = vi.fn(async (input: string | URL | Request,init?:RequestInit) => {
      const url=String(input);calls.push({url,init});
      if(url.includes("/api/internal/treasury-history")) return reply(url);
      const ticker=/\/ohlc\/([^/]+)\.json$/.exec(url)?.[1];
      return ticker ? new Response(JSON.stringify(alterPrices(price(ticker)))) : new Response("missing",{status:404});
    }) as typeof fetch;
  });
  afterEach(()=>{vi.restoreAllMocks();process.env={...savedEnv};});
  const treasuryCalls = (calls: {url:string;init?:RequestInit}[])=>calls.filter(c=>c.url.includes("/api/internal/treasury-history"));
  it("uses the same captured verified bearer and actual qualified compiler window",async()=>{
    const res=await GET();const body=await res.json();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(getSession).toHaveBeenCalledTimes(1);expect(getUser).toHaveBeenCalledTimes(1);expect(getUser).toHaveBeenCalledWith("captured-owner-token");
    const ts=treasuryCalls(calls);expect(ts).toHaveLength(1);
    const {url,init}=ts[0];const query=new URL(url).searchParams;
    expect(query.get("start")).toBe(dateBack(body.history.window.firstSession,7));
    expect(query.get("end")).toBe(body.history.window.lastSession);
    expect(query.get("expected_through")).toBe(dateBack(body.history.window.lastSession,7));
    expect([...query.keys()].sort()).toEqual(["end","expected_through","start"]);
    expect(new URL(url).origin).toBe("http://127.0.0.1:8000");
    expect(init).toMatchObject({method:"GET",cache:"no-store",redirect:"manual",credentials:"omit"});
    expect([...new Headers(init?.headers)]).toEqual([["authorization","Bearer captured-owner-token"]]);
    expect(init?.body).toBeUndefined();expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(body.history.sources.riskFreeSource).toBe("DGS3MO");expect(body.history.sources.riskFreeAsOf).toBe(body.history.window.lastSession);
    expect(body.history.beta).not.toBeNull();expect(body.history.sharpe).not.toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/captured-owner-token|later-cookie-generation|read_at|sha256/);
    for(const c of calls.filter(c=>c.url.includes("/ohlc/"))) {
      expect(new Headers(c.init?.headers).get("cookie")).toBe("sb-ref-auth-token=later-cookie-generation");
      expect(new Headers(c.init?.headers).has("authorization")).toBe(false);
      expect(c.url).not.toMatch(/DGS3MO|us3m|holdings|tickers=/);
    }
  });
  it.each(["different-owner","no-session","no-token","session-error","user-error","no-user"])("refuses %s before reading positions or fetching",async defect=>{
    if(defect==="different-owner") getUser.mockResolvedValue({data:{user:{id:"other"}},error:null});
    if(defect==="no-session") getSession.mockResolvedValue({data:{session:null},error:null});
    if(defect==="no-token") getSession.mockResolvedValue({data:{session:{access_token:"",user:{id:owner}}},error:null});
    if(defect==="session-error") getSession.mockResolvedValue({data:{session:null},error:{message:"auth"}});
    if(defect==="user-error") getUser.mockResolvedValue({data:{user:{id:owner}},error:{message:"auth"}});
    if(defect==="no-user") getUser.mockResolvedValue({data:{user:null},error:null});
    const from=vi.spyOn(db,"from");vi.mocked(createClient).mockResolvedValue({from,auth:{getSession,getUser}} as any);
    expect((await GET()).status).toBe(401);expect(from).not.toHaveBeenCalled();expect(calls).toHaveLength(0);
  });
  it.each(["https://attacker.invalid","http://www.mastermind-x.com","https://www.mastermind-x.com.attacker.invalid","https://evil@www.mastermind-x.com","http://127.0.0.1:9377"])("does not forward a price cookie to %s",async base=>{
    process.env.STOCKDATA_BASE=base;await GET();
    for(const c of calls.filter(c=>c.url.includes("/ohlc/"))) expect([...new Headers(c.init?.headers)]).toEqual([]);
    expect(new Headers(treasuryCalls(calls)[0].init?.headers).get("authorization")).toBe("Bearer captured-owner-token");
  });
  it.each([401,403,302,500])("keeps beta and null risk ratios on Treasury HTTP %i without retry",async status=>{
    reply=()=>new Response("denied",{status,headers:{location:"https://attacker.invalid"}});
    const body=await (await GET()).json();expect(treasuryCalls(calls)).toHaveLength(1);
    expect(body.history.beta).not.toBeNull();expect(body.history.sharpe).toBeNull();expect(body.history.sortino).toBeNull();
    expect(body.history.sharpeReason).toBe(RF_UNREADABLE_REASON);expect(body.history.sources.riskFreeSource).toBe("unreadable");
  });
  it.each(["missing","bad-unit","clock-after-window","duplicate-date"])("does not promote %s RF input",async defect=>{
    reply=url=>{const e=envelope(url);
      if(defect==="missing") {e.status="unavailable";e.reason="missing";e.points=[];e.coverage={...e.coverage,observation_count:0,first:null,last:null} as any;e.source={...e.source,last_observation_date:null,sha256:null} as any;}
      if(defect==="bad-unit") e.unit="percent";
      if(defect==="clock-after-window") e.clocks.read_at="2023-01-01T00:00:00Z";
      if(defect==="duplicate-date") e.points.push({...e.points[0]});
      return new Response(JSON.stringify(e));};
    const body=await (await GET()).json();expect(body.history.beta).not.toBeNull();expect(body.history.sharpe).toBeNull();expect(body.history.sortino).toBeNull();expect(body.history.sources.riskFreeSource).toBe("unreadable");
  });
  it("does not refresh stale observations or substitute read time for their source date",async()=>{
    reply=url=>new Response(JSON.stringify(envelope(url,true)));
    const body=await (await GET()).json();const c=treasuryCalls(calls)[0];const actual=envelope(c.url,true);
    expect(body.history.sources.riskFreeAsOf).toBe(actual.coverage.last);expect(body.history.sources.riskFreeAsOf).not.toBe("2023-05-22");
    expect(body.history.sharpeReason).toBe("risk-free series is stale");
    expect(body.history.sortinoReason).toBe("risk-free series is stale");
    expect(body.history.beta).not.toBeNull();expect(body.history.sharpe).toBeNull();expect(body.history.sortino).toBeNull();
  });
  it.each(["2023-13-01", "2023-05-99"])("fails closed on malformed price boundary %s", async invalid => {
    alterPrices = body => ({ ...body, bars: body.bars.map((bar, i) => i === body.bars.length - 1 ? [invalid, ...bar.slice(1)] : bar) });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history.beta).not.toBeNull();
    expect(body.history.sharpe).toBeNull();
    expect(body.history.sortino).toBeNull();
    expect(treasuryCalls(calls)).toHaveLength(0);
  });
  it("does not request Treasury when no qualified price window exists",async()=>{
    global.fetch=vi.fn(async(input: string | URL | Request,init?:RequestInit)=>{calls.push({url:String(input),init});return new Response("missing",{status:404});}) as typeof fetch;
    const body=await (await GET()).json();expect(body.history.window.firstSession).toBeNull();expect(treasuryCalls(calls)).toHaveLength(0);
  });
});
