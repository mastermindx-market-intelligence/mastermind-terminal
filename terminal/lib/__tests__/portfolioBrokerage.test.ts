import {describe,expect,it,vi,afterEach} from "vitest";
import {averageInstitutionCost} from "../portfolioInstitutionValue";
import {recordIssues,selectPortfolioRecords} from "../portfolioWorkspace";
import {brokerageSnapshot} from "../brokerage/snapshot";
import {seal,unseal,type BrokerageConfig} from "../brokerage/plaid.server";
import {createPosition,updatePosition,readPositions,normalizeExecutionTime,positionPrice,marketValue,type Position} from "../portfolio";
import {createFixtureDb,fixtureUserId} from "../watchlistsFixtureDb";

const config:BrokerageConfig={key:Buffer.alloc(32,1),origin:"https://test.invalid",host:"https://sandbox.plaid.com",clientId:"fixture",secret:"fixture"};
const snapshot={item:{item_id:"item"},accounts:[{account_id:"one",name:"Retirement"},{account_id:"two",name:"Taxable"}],
  securities:[{security_id:"sec",ticker_symbol:"AAPL",name:"Apple"},{security_id:"cash",name:"Foreign currency",type:"cash"}],
  holdings:[{account_id:"one",security_id:"sec",quantity:2,institution_price:10,institution_value:20,iso_currency_code:"USD"},
    {account_id:"two",security_id:"sec",quantity:3,institution_price:10,institution_value:30,iso_currency_code:"USD"},
    {account_id:"two",security_id:"cash",quantity:40,institution_value:40,iso_currency_code:"EUR"}]};
afterEach(()=>vi.unstubAllEnvs());
describe("brokerage and manual history",()=>{
 it("retains individual accounts and non-ticker assets",()=>{const data=brokerageSnapshot(snapshot,"item");expect(data.map(x=>[x.accountId,x.symbol,x.value])).toEqual([["one","AAPL",20],["two","AAPL",30],["two",null,40]]);});
 it("rejects partial snapshots, unknown items and duplicated identities before replacing a book",()=>{for(const body of [{...snapshot,securities:[]},{...snapshot,item:{item_id:"different"}},{...snapshot,holdings:[...snapshot.holdings,snapshot.holdings[0]]}])expect(()=>brokerageSnapshot(body,"item")).toThrow();});
 it("binds a credential to its owner and connection purpose",()=>{const token=seal(config,"fictional-token","owner-one/link");expect(unseal(config,token,"owner-one/link")).toBe("fictional-token");expect(()=>unseal(config,token,"other/item")).toThrow();});
 it("preserves dated broker values for non-unit instruments",()=>{const p={ticker:"OPT",shares:1,brokerage:{symbol:"OPT",currency:"USD",value:2000,price:20}} as Position;expect(positionPrice(p,{last:22,currency:"USD"},{})).toEqual({last:20,currency:"USD",chg:null});expect(marketValue(p,20,"USD")).toBe(2000);});
 it("uses a reported total cost to recover average unit costs only for supported securities",()=>{
   const equity={symbol:"AAPL",type:"equity",quantity:4,costBasis:120,currency:"USD"};
   expect(averageInstitutionCost(equity)).toBe(30);
   for (const item of [{...equity,type:"derivative"},{...equity,quantity:0},{...equity,currency:null},{...equity,costBasis:null}]) {
     expect(averageInstitutionCost(item)).toBeNull();
   }
   const data=brokerageSnapshot({...snapshot,holdings:[{...snapshot.holdings[0],cost_basis:15}]},"item");
   expect(data[0].costBasis).toBe(15);
 });
 it("shows value-only positions as priced, honors missing derivative values and finds imported account names",()=>{
   const asset={symbol:"OPT",type:"derivative",name:"Options on Example",account:"Retirement plan",currency:"USD",value:2000,price:null};
   const lot={ticker:"OPT",shares:1,entryPrice:null,status:"open",brokerage:asset} as Position;
   expect(marketValue(lot,null)).toBe(2000);
   expect(marketValue({...lot,brokerage:{...lot.brokerage!,price:20,value:null}},20,"USD")).toBeNull();
   expect(recordIssues(lot,undefined,undefined)).toEqual([]);
   expect(selectPortfolioRecords([lot],{},{},{status:"open",query:"retirement",filter:"all"})).toEqual([lot]);
 });
 it("keeps date-only history when time fields are disabled",()=>{expect(normalizeExecutionTime(undefined)).toEqual({kind:"absent"});expect(normalizeExecutionTime("2026-01-01T12:00")).toEqual({kind:"invalid"});});
 it("round trips a dated closed lot, owner-scopes the read and refuses a reversed exit",async()=>{
   vi.stubEnv("PORTFOLIO_EXECUTION_TIMES","1");const db=createFixtureDb("history"),owner=fixtureUserId("history");
   const row=await createPosition(db,owner,{ticker:"AAPL",entryDate:"2026-01-05",entryAt:"2026-01-05T09:30:00-05:00",exitDate:"2026-01-07",exitAt:"2026-01-07T19:00:00Z",status:"closed"});
   expect(row.position?.entryAt).toBe("2026-01-05T14:30:00.000Z");
   expect(await readPositions(db,owner)).toMatchObject({ok:true,positions:[{exitAt:"2026-01-07T19:00:00.000Z",status:"closed"}]});
   expect(await updatePosition(db,owner,row.position!.id,{exitDate:"2026-01-02"})).toMatchObject({ok:false,status:400});
   expect(await readPositions(db,fixtureUserId("other-history"))).toEqual({ok:true,positions:[]});
 });
});
