import { describe, expect, it } from "vitest";
import { paperOwnedWatchlists } from "../sectorPaperWatches";
const list=()=>({id:"owned-id",name:"Sector ideas",position:0,symbols:[{symbol:"XLE",section:"",position:0}]});
describe("Paper consumes only the existing owned watchlist inventory",()=>{
 it("keeps exact IDs, section identity and server order while excluding shared grants",()=>{
  expect(paperOwnedWatchlists({lists:[list()],sharedWithMe:[{...list(),id:"shared-read-only"}]})).toEqual([list()]);
 });
 it("distinguishes empty owned lists from unavailable or malformed inventory",()=>{
  expect(paperOwnedWatchlists({lists:[],sharedWithMe:[]})).toEqual([]);
  expect(paperOwnedWatchlists({sharedWithMe:[list()]})).toBeNull();
  expect(paperOwnedWatchlists({lists:null})).toBeNull();
 });
 it("refuses duplicate list IDs and duplicate symbols instead of adopting ambiguous ownership",()=>{
  expect(paperOwnedWatchlists({lists:[list(),list()]})).toBeNull();
  const duplicate=list();duplicate.symbols.push({...duplicate.symbols[0],position:1});
  expect(paperOwnedWatchlists({lists:[duplicate]})).toBeNull();
 });
 it("does not normalize symbols or invent missing positions and sections",()=>{
  const exact=list();exact.symbols[0].symbol="Xle";
  expect(paperOwnedWatchlists({lists:[exact]})![0].symbols[0].symbol).toBe("Xle");
  expect(paperOwnedWatchlists({lists:[{...list(),symbols:[{symbol:"XLE"}]}]})).toBeNull();
 });
});
