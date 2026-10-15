# Top-ten actual ES depth conformance

The source canary now extends beyond BBO: the official public CME MBP-10 CSV
sample independently supplies the top TEN displayed bid and ask price levels.
Source link, advertised by https://databento.com/tick-data:
https://hist.databento.com/v0/dataset/sample/download/glbx.mdp3/mbp-10?sample_type=futures

Only the bounded five-minute prefix was read; the full 1.5GB file was NOT fetched.
The prefix contains 6,841 MBP-10 records matching the same ESZ5 / 2025-09-22 MBO
window used by the BBO and browser canaries.

**6,280/6,280 comparable completed packet/time groups agree exactly**, across all
TEN bid levels and TEN ask levels, including price, displayed quantity and order
count. Zero mismatches, zero unmatched reference groups, zero source adapter errors.
The ruler is unchanged from the corrected BBO comparison: last completed instrument
state per receive-time/packet-sequence group. No tolerance or averaging is used.

The original 377 trades / 839 contracts remain conserved. This is deeper source
validation, not an independent exchange/full-book-queue oracle, full-session test,
NQ source comparison, license grant, authenticated venue definition or live proof.
Raw/normalized reference data stays under ignored `.local-futures/`; only source
URLs, hashes and aggregate results are published here.

Regression coverage explicitly mutates deeper ranks, rejects missing/bad level-9
fields, and verifies a deeper book change can fail while BBO is unchanged.
Current full Hub tests: **526/526**. Current Python source/codec tests: **26/26**.
The preceding actual historical browser proof remains 6/6; its source inputs did
not change. The expanded synthetic ES/NQ GEX browser proof remains distinct.
