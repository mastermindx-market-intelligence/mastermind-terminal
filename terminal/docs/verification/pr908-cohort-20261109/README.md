# Cohort card evidence for PR #908

Source checkout: `587b33a5fc66346cc3a223955174b33d012b078a`; source tree: `5a691e9a2112dabe0e473875b101dbacea28a90a`. The original PR branch remains the publication owner. This packet was captured from the immutable source checkout before the evidence-promotion commit.

The producer completed all 13 prescribed images on 2026-11-09 at 04:43:48Z. All five source bindings and all thirteen PNG hashes match EVIDENCE.yml. Root visually inspected all 13 images: the desktop popover and full page preserve stacking and complete boundaries; tablet and mobile ready, unavailable and empty states have intact bottom borders and legible EN/ZH content. No developer indicator is visible. Existing disclosures about withheld display rights are preserved.

## Verification

- Focused native tests: **35 passed, 0 failed**.
- Real Playwright checks: **7 passed, 0 skipped, 0 unexpected, 0 flaky**, with zero retries and one worker.
- The six existing desktop cohort interaction and geometry cases ran alongside the existing tablet saved `1s` startup case on an owned fresh server.
- Existing warmup and fixture-readiness checks ran unchanged. No other Visual Intelligence journey that writes capture files was selected.
- All source and image hashes remained unchanged after verification. Both owned server ports were absent afterward.

The browser process exited 0. The first receipt parser encountered global-setup warmup lines before the JSON reporter and exited 1 after the tests had completed. The retained log was parsed correctly without rerunning the browser. Both the original combined output and the exact extracted JSON are retained.

The previous 14-file packet remains byte-identical under `history/before-integration-ab638b65/`, with its original provenance. No historical image or source hash was restamped. These fixture proofs do not claim production deployment or live acceptance.
