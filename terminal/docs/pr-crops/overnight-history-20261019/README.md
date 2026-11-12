# Overnight history reload verification

Source: 981f6aca4659c1274338f40d39acc69cb1b1e32d. Four EN/ZH desktop/mobile browser cases passed after correcting the test interceptor to distinguish 24H chart reads from unrelated companion reads. The tests use synthetic candles and verify a fresh API read and the captured-history notice after reload. The separate 12-case overnight settings/eligibility matrix passed on this source, and its screenshots were refreshed. Terminal remains on its existing dark material.

The private real-data reader and actual local route separately consumed AAPL/AMD/SOXX exports. Those evidence files and licensed data remain private; the committed captures are synthetic. Production deployment, stream freshness and full-universe coverage are separate acceptance steps.

Current validation also includes 30/30 visual-context browser cases, 4 fresh ChartChrome captures, 5 passing option-axis captures, 46 parser/store/route/coverage/evidence tests and 4 ChartChrome evidence tests; TypeScript passes. Four private real AMD browser cases (EN/ZH at 1440 and 390) each reloaded the actual local API and retained the same 144 five-minute candles and source digest. Private real-data captures were visually inspected and remain outside Git. The inherited mobile footer clipping is also visible in the accepted base captures; this change does not claim a footer redesign.
