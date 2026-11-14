import {afterEach,expect,it,vi} from "vitest";
import {createFixtureDb} from "../watchlistsFixtureDb";
import {linkStart,finishLink,syncConnection,disconnect,type Connection} from "../brokerage/service.server";
import type {BrokerageConfig} from "../brokerage/plaid.server";
import type {DbRow} from "../watchlists";
import {randomUUID} from "node:crypto";

const config:BrokerageConfig={host:"https://sandbox.plaid.com",origin:"https://terminal.example",key:Buffer.alloc(32,7),clientId:"fixture",secret:"fixture"};
const owner="fixture-owner";
afterEach(()=>vi.unstubAllGlobals());
it("binds consent, claims a single exchange, preserves a failed snapshot and removes a confirmed connection",async()=>{
  // The existing fixture query implements select/insert/update/delete and owner+revision filters.
  const fixture=createFixtureDb("brokerage-flow-"+randomUUID());
  const db={from:()=>fixture.from("portfolio_positions")} as unknown as Parameters<typeof linkStart>[0];
  let id="", exchanges=0, removed=0, quantity=3, fail=false;
  vi.stubGlobal("fetch",vi.fn(async(url:string,options:RequestInit)=>{
    const body=JSON.parse(String(options.body)), route=new URL(url).pathname;
    if(route==="/link/token/create"){
      expect(body.user.client_user_id).toBe(owner);
      id=new URL(body.hosted_link.completion_redirect_uri).searchParams.get("brokerage_return")!;
      return Response.json({link_token:"fake-link",hosted_link_url:"https://secure.plaid.com/hl/test",expiration:new Date(Date.now()+600000).toISOString()});
    }
    if(route==="/link/token/get"){expect(body.link_token).toBe("fake-link");return Response.json({link_sessions:[{results:{item_add_results:[{public_token:"fake-public"}]}}]});}
    if(route==="/item/public_token/exchange"){exchanges++;expect(body.public_token).toBe("fake-public");return Response.json({item_id:"bank",access_token:"fake-item"});}
    if(route==="/item/remove"){removed++;expect(body.access_token).toBe("fake-item");return Response.json({request_id:"fixture"});}
    expect(route).toBe("/investments/holdings/get");expect(body.access_token).toBe("fake-item");
    return Response.json({item:{item_id:"bank"},accounts:[{account_id:"a",name:"Brokerage"}],
      securities:fail?[]:[{security_id:"s",ticker_symbol:"AAPL",type:"equity"}],
      holdings:[{account_id:"a",security_id:"s",quantity,institution_value:20*quantity,institution_price:20,iso_currency_code:"USD"}]});
  }));
  await linkStart(db,config,owner);
  const read=async()=>{const result=await fixture.from("portfolio_positions").select("*").eq("user_id",owner).eq("id",id).maybeSingle();return result.data as unknown as Connection};
  // Supply the database defaults that the generic fixture doesn't generate.
  await fixture.from("portfolio_positions").update({revision:randomUUID(),holdings:[],sync_error:false} as DbRow).eq("id",id);
  const pending=await read();expect(pending.secret_box).not.toContain("fake-link");
  await Promise.allSettled([finishLink(db,config,pending),finishLink(db,config,pending)]);
  const first=await read();expect(exchanges).toBe(1);expect(first.stage).toBe("connected");expect(first.holdings[0].quantity).toBe(3);
  fail=true;await expect(syncConnection(db,config,first)).rejects.toThrow();const retained=await read();
  expect(retained.holdings).toEqual(first.holdings);expect(retained.synced_at).toBe(first.synced_at);expect(retained.sync_error).toBe(true);
  fail=false;quantity=4;await syncConnection(db,config,retained);const revised=await read();expect(revised.holdings[0].quantity).toBe(4);
  await disconnect(db,config,revised);expect(removed).toBe(1);expect(await read()).toBeNull();
});
