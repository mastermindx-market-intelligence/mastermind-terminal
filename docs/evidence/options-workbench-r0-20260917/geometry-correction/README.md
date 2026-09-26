# R0 partial source correction — 17 September 2026

This continues Terminal #608 on its original branch; it does not complete #603.
Desktop Commander and Studio Direct permissions were inspected: both already Allow all actions. Desktop Commander successfully applied three source changes. Studio Direct runtime tools are not exposed in this conversation. The separate provider/view/pane integration attempt was refused by the tool-call safety check; same-carrier readback proves no effect from that call. It has not been rerouted.

Applied: actual price-axis mapping per heat band; additive awaited cache refresh preserving default SWR/in-flight deduplication; paused timestamp retention when earlier frames are inserted or an observation is removed with an earlier frame available. The cache capability is not yet wired into the displayed refresh loop.

Verified: 37 renderer tests; 56 cache/reducer tests; six actual-chart pixel tests (normal/inverted/logarithmic, DPR 1/2); six actual /options-route band-proportion tests (EN/ZH, 1440/820/390). The six pixel cases fail when the original renderer is temporarily restored, then the candidate is restored and byte-checked. Market inputs and captures are synthetic, not live-source proof. Two early log-scale harness attempts misused the installed chart library's internal-unit custom-range setter; the final harness uses the real autoscaled logarithmic axis. No production chart-library change or test exclusion was introduced.

Full Vitest: 5,525 pass, five failures in the retained mounted replay suite, four existing todo. Those failures are the still-unapplied provider integration. No all-green claim and no auto-merge. Required independent review, fresh served-market proof, and parent surface/UI parity remain owed.

The timestamp reducer still needs an explicit unavailable-state design if every remaining index observation is later than a withdrawn selection; no claim of complete point-in-time replay is made. Latest-loaded frame is not proven live. Single-to-quad time preservation and the growing-index loop remain blocked, not fixed.

Next: after a genuine tool authorization/recovery change, reconcile and complete the held integration on this same carrier; retain every regression. No second cache, replay bus, model, collector, watcher or source store was created. Do not redo the competitor study or the successful geometry correction.
