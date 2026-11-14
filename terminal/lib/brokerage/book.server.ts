import {createHash} from "node:crypto";
import { readPositions as readManual, type PortfolioDb, type PositionsRead, type Position } from "@/lib/portfolio";
import {brokerageServices,TABLE} from "./service.server";
import type {ImportedHolding} from "./snapshot";

export async function readPositions(db:PortfolioDb,owner:string):Promise<PositionsRead>{
  const manual=await readManual(db,owner);
  if(!manual.ok || process.env.PORTFOLIO_BROKERAGE_ENABLED!=="1")return manual;
  const services=brokerageServices();
  if(!services)return {ok:false,error:"Brokerage configuration unavailable"};
  try{
    const read=await services.db.from(TABLE).select("id,holdings,synced_at,stage").eq("user_id",owner).in("stage",["connected","disconnecting"]).order("id");
    if(read.error || !read.data)return {ok:false,error:"Brokerage holdings unreadable"};
    const imported:Position[]=[];
    for(const connection of read.data){
      if(!connection.synced_at || !Array.isArray(connection.holdings))return {ok:false,error:"Brokerage holdings pending"};
      for(const item of connection.holdings as ImportedHolding[]){
        const identity=createHash("sha256").update(JSON.stringify([owner,connection.id,item.accountId,item.securityId])).digest("hex");
        imported.push({id:"broker:"+identity,ticker:item.symbol??"UNLISTED-"+identity.slice(0,12).toUpperCase(),shares:item.quantity,entryPrice:null,entryCurrency:null,entryDate:null,
          notes:null,status:"open",createdAt:null,brokerage:{account:item.accountName,name:item.name,symbol:item.symbol,type:item.type,price:item.price,
          value:item.value,currency:item.currency,asOf:item.asOf,syncedAt:connection.synced_at}});
      }
    }
    return {ok:true,positions:[...manual.positions,...imported]};
  }catch{return {ok:false,error:"Brokerage holdings unreadable"};}
}
