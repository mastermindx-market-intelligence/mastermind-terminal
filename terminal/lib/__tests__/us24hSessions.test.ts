import { describe, it, expect, vi, afterEach } from "vitest";
import { usEquitySessionAtDisplayEpoch as phase, usSessionBucket, isUsEquityTradingDate } from "../usEquityCalendar";
import { liveDisplayEpoch, mutateLiveCandle, isOvernightTimeframe } from "../liveCandle";
import { resampleUsEquitySession, type Bar6 } from "../intradayShared";
import { sessionVwap } from "../intradayMath";
const ep = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`) / 1000;
const bar = (date: string, time: string, value = 100): Bar6 => [ep(date, time), value, value, value, value, 10];
afterEach(() => vi.restoreAllMocks());
describe("24-hour sessions use the canonical exchange calendar", () => {
 it.each([
  ["2026-10-18","19:59","closed",null], ["2026-10-18","20:00","overnight","2026-10-19"],
  ["2026-10-19","00:00","overnight","2026-10-19"], ["2026-10-19","03:59","overnight","2026-10-19"],
  ["2026-10-19","04:00","pre","2026-10-19"], ["2026-10-19","09:30","rth","2026-10-19"],
  ["2026-10-19","16:00","post","2026-10-19"], ["2026-10-23","20:00","closed",null],
  ["2026-10-24","02:00","closed",null], ["2026-11-25","20:00","closed",null],
  ["2026-11-26","20:00","overnight","2026-11-27"], ["2026-11-27","13:00","post","2026-11-27"],
  ["2026-11-27","17:00","closed",null], ["2026-07-02","13:00","rth","2026-07-02"],
  ["2026-07-02","20:00","closed",null], ["2026-12-24","13:00","post","2026-12-24"],
 ])("classifies %s %s", (date,time,session,tradeDate) => expect(phase(ep(date,time))).toMatchObject({session,tradeDate}));
 it("retains a single overnight bucket across midnight but splits at 04:00 and 09:30", () => {
  expect(usSessionBucket(ep("2026-10-19","02:00"),43200,"24h")).toBe(ep("2026-10-18","20:00"));
  expect(usSessionBucket(ep("2026-10-19","08:00"),43200,"24h")).toBe(ep("2026-10-19","04:00"));
  expect(usSessionBucket(ep("2026-10-19","10:00"),43200,"24h")).toBe(ep("2026-10-19","09:30"));
  expect(usSessionBucket(ep("2026-10-19","16:05"),43200,"24h")).toBe(ep("2026-10-19","16:00"));
 });
 it("does not fill missing candles and conserves admitted observations", () => {
  const tape=[bar("2026-10-18","23:50"),bar("2026-10-19","00:05",101),bar("2026-10-19","04:00",102)];
  expect(resampleUsEquitySession(tape,720,"24h")).toEqual([
   [ep("2026-10-18","20:00"),100,101,100,101,20], [ep("2026-10-19","04:00"),102,102,102,102,10],
  ]);
 });
 it("refuses invalid dates and preserves unknown-calendar refusal", () => {
  expect(isUsEquityTradingDate("2026-02-30")).toBe(false);
  expect(()=>phase(ep("2029-01-01","20:00"))).toThrow("US_SESSION_CLOCK_UNAVAILABLE");
 });
 it("handles the two DST boundaries with the exchange wall clock", () => {
  expect(liveDisplayEpoch(Date.parse("2026-03-09T00:30:00Z"),"us")).toBe(ep("2026-03-08","20:30"));
  expect(liveDisplayEpoch(Date.parse("2026-11-02T01:30:00Z"),"us")).toBe(ep("2026-11-01","20:30"));
 });
 it.each(["1s","5m","4h","12h"])("allows eligible %s",tf=>expect(isOvernightTimeframe(tf)).toBe(true));
 it.each(["D","W","1M","24h","13h"])("excludes %s",tf=>expect(isOvernightTimeframe(tf)).toBe(false));
});
describe("BOATS observed candles", () => {
 const utc = Date.parse("2026-10-19T01:15:00Z"); // Sunday21:15ET, Monday trading date
 const q = {extSource:"tiingo_boats",extBasis:"LIVE",extVenue:"BOATS",extPriceKind:"LAST_TRADE",extSession:"overnight",extPrice:105,extTs:utc/1000,extReceivedTs:utc/1000,extPublishedTs:utc/1000,extExpiresTs:utc/1000+30};
 const bars=[{time:ep("2026-10-16","19:55"),o:100,h:100,l:100,c:100,v:1000}];
 it("requires explicit24H opt-in and cleared current source, then creates only the observed bucket",()=>{
  vi.spyOn(Date,"now").mockReturnValue(utc);
  expect(mutateLiveCandle(bars,q,"5m","us",true)).toBeNull();
  const result=mutateLiveCandle(bars,q,"5m","us",true,true);
  expect(result?.bars).toHaveLength(2);
  expect(result?.bar).toEqual({time:ep("2026-10-18","21:15"),o:105,h:105,l:105,c:105,v:0});
  expect(mutateLiveCandle(bars,{...q,extSource:"yahoo-relay"},"5m","us",true,true)).toBeNull();
 });
 it("can begin with one qualified observed trade when no historical bars exist",()=>{
  vi.spyOn(Date,"now").mockReturnValue(utc);
  const observed=mutateLiveCandle([],q,"5m","us",true,true);
  expect(observed?.bars).toHaveLength(1);
  expect(observed?.bar.v).toBe(0);
  expect(mutateLiveCandle([],q,"5m","us",true,false)).toBeNull();
 });
 it("never accepts an expired or unqualified BOATS fact",()=>{
  vi.spyOn(Date,"now").mockReturnValue(utc+30000);
  expect(mutateLiveCandle(bars,q,"5m","us",true,true)).toBeNull();
 });
 it("session VWAP resets on trade-date and stays unavailable on unknown overnight volume",()=>{
  const tape=[bar("2026-10-19","15:55"),bar("2026-10-19","20:00",200),bar("2026-10-20","00:01",201),bar("2026-10-20","04:00",300)];
  const rows=tape.map(b=>({time:b[0],o:b[1],h:b[2],l:b[3],c:b[4],v:b[5]}));
  expect(sessionVwap(rows,"us",true,[1],true).vwap).toEqual([100,null,null,300]);
 });
});
