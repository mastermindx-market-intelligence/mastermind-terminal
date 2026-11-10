# PR #768: wait for lazy details before measuring the phone layout

The phone drawing regression case compared its initial details height while two lazy sections were still loading with the completed panel after drawing interactions. The original failure is in run42757795606, mobile-1 job129636397950, at the unchanged strict geometry assertion.

The retained failed artifact13737119365 has SHA256 b783f52e7446f6867e79c1be4e5fe461ac327fc5024f300b353bb00b2fdbbd90. Across all three original attempts, all172 snapshots after both StockAnalysis (.sa) and Seasonality (seasonality-card) were present share the same details subtree. The initial measured height was826.984375; the final1919 height followed lazy content hydration. Those are observations from the failed Linux trace, not dimensions inferred for this local run.

## Change

Two existing visibility assertions now establish the details-content baseline immediately before initialLayout. Seasonality's test ID is rendered only after its bar statistics exist. The final full bounding-box equality, real clicks and drawing placement, safe-area bounds, collision checks, sheet overlay checks and overflow assertions remain unchanged. No product code, timeout, tolerance or retry setting changed.

## Actual qualification

Validation checkout: 1b5fe9b88568e4d74dc48db84f10f198cb297153, the exact failed CI merge of PR head9ef372c8086ceaac8bcb153bd2d2d71b5b63d62c. The target preimage is byte-identical on the PR head. The new source SHA256 is7d060fb90e21ab0989680d687f0f360042afa68d03a4a78b991c3df032360912; Git blob7e92dd1f54d6650d0775c362e67a4fa92732d683.

The focused Chromium mobile390×844 run passed1/1 with zero skips, failures, flakes or retries. All1999 observed runtime/test/config source entries remained identical before and after. Port47768 and the owned server were reconciled closed. The dependencies were an APFS clone of the existing matching package lock; no package installation was performed.

The retained trace ce81146c8390e85d9dae542f8bd3da809367e661cfa69b6aed87a379979fc2aa shows .sa visible completed28172.438ms and Seasonality visible completed28184.162ms, before baseline bounding boxes at28188.245/28189.172ms. The unchanged strict toEqual assertion completed31415.935ms without an error. The trace does not serialize numeric box values.

execution.json, the complete native JSON report, raw log, source snapshots, lifecycle receipt and trace are retained. source.diff is the reviewed test-only patch. inventory.json binds every proof file except itself.

## Scope and next gate

The explicit EOD32/GEX29/Options-browser71 applicability sets do not include this drawing spec. Their previously accepted integration/native/browser proof remains intact. This test belongs to broader recursive CI source inventories, so current-head CI must qualify its own applicable evidence; old CI proof is not restamped. The three old pre-test browser provisioning timeouts were not retried. Existing protected auto-merge remains the admission mechanism. This local proof does not claim hosted CI, protected merge, deployment or production acceptance.
