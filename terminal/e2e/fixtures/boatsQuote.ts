// Synthetic consumer fixture only; no source capture, rights or market acceptance.
export function boatsQuote(extPrice:number,extChg:number,ts=Date.now()/1000-1) {
 return {extPrice,extChg,extTs:ts,extSession:"overnight",extSource:"tiingo_boats",extBasis:"LIVE",
  extVenue:"BOATS",extPriceKind:"LAST_TRADE",extReceivedTs:ts,extPublishedTs:ts,extExpiresTs:ts+30,
  extCaptureId:"12345678-1234-1234-1234-123456789abc",extGeneration:1};
}
