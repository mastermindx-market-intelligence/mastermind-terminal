// Shared original Portfolio responsive fixture. Synthetic record examples only.
// The browser qualifier and incumbent spec seed the SAME canonical test store.
export const portfolioWorkspaceManifest = { symbols: {
  NVDA: { name: "NVIDIA", zh: "英伟达", last: 180.2, chg: 2.5, currency: "USD" },
  AAPL: { name: "Apple", zh: "苹果", last: 231.4, chg: -0.9, currency: "USD" },
  GLD: { name: "SPDR Gold Shares", zh: "SPDR 黄金ETF", last: 320.1, chg: .7, currency: "USD" },
  TLT: { name: "iShares 20+ Year Treasury", zh: "20年以上美国国债ETF", last: 89.2, chg: -.3, currency: "USD" },
  RKLB: { name: "Rocket Lab", zh: "火箭实验室", last: 46.3, chg: 1.1, currency: "USD" },
} };

export const portfolioWorkspaceRecords = [
    { ticker: "NVDA", shares: "120", entryPrice: "138.40", entryDate: "2026-01-05", notes: "Core holding — first record." },
    { ticker: "AAPL", shares: "60", entryPrice: "244.10", entryDate: "2026-03-18" },
    { ticker: "GLD", shares: "40", entryPrice: "296.00", entryDate: "2025-11-02" },
    { ticker: "TLT", shares: "150", entryPrice: "94.30", entryDate: "2026-02-11" },
    { ticker: "NVDA", shares: "15", entryPrice: "155", notes: "Second record — keep its identity." },
    { ticker: "RKLB" },
];
