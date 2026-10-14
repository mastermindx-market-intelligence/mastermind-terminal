# Current BOATS feature-copy repair

Hosted c0bf8a744a0d963360de45dab8c655a575776280 job114589700956 failed because adding one BOATS LEX label changed the global i18n source hash pinned by historical screenshot receipts. Those receipts remain untouched. The new label now uses the existing feature-copy pattern in extQuoteCopy.ts and shared language state. Global i18n.tsx is byte-identical to protected base85ad93866dcd9daf203c89a7d5e23280b5d6ed50. Exact EN/ZH copy, prices, source clocks, response ordering and expiry are unchanged.

The unchanged copy guard passes with the new helper included in the supplied diff; typecheck passes; all554 Vitest files/9141 tests pass with4 existing todo; six EN/ZH desktop1440/tablet820/mobile390 browser cases pass. Source hashes, actual failed hosted log, current green logs and six current screenshots are retained here. These screenshots are synthetic fixture proof, not genuine live market receipt.

The independent acceptance report binds the actual patch hashes and preserves the other15 previously accepted consumer files. Current-head hosted CI, protected merge, existing VPS/Hub release and genuine BOATS feed acceptance remain distinct obligations. The earlier i18n-repair artifacts describe their dated source and are preserved; they are superseded for current source by this feature-copy receipt.
