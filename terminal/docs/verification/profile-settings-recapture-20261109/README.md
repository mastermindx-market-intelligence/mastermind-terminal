# Settings evidence recovery - original PR1353

Beta-shell sweep recovery on the original managed branch, source head `793dd27a1bc88fe2bcf86fa2de9962034b0769a2`. Publisher status was APPLIED and local/remote equal with a clean workspace before capture. The existing Next preview PID5100 on port3391 remains untouched.

Hosted CI run42549075934 failed two screenshot source-hash readers because SettingsProvider changed without fresh account-completeness/team-settings crops. The actual original capture scripts were executed with every fixture, interaction, assertion, measurement and PNG write retained. A recorded one-off adapter omitted only their startServer call, reusing this exact workspace's existing development preview and letting stopServer(null) leave it alone. This is not a new release or runtime owner.

Both scripts succeeded: 8 account screenshots plus 8 team screenshots, EN/ZH desktop/mobile. Their generated EVIDENCE files retain the real captured source head and freshly measured layout hashes. No test or permission was bypassed and no source hash was restamped in lieu of capture. See adapter, raw bounded capture outputs and pixel hashes here. A pixel-identical regenerated crop may have no Git diff.

These are local mocked /dev/settings captures, not production authentication proof or changes to a real account/team. Required exact-head CI, protected merge, beta installation and live acceptance remain separate.

## Readback qualification
The original two evidence guards and both affected behavior test files passed: **28 tests / 4 files**, exit 0. Representative mobile-ZH password and desktop-EN team-owner PNGs were visually inspected. Application source files remain byte-identical to captured head793dd27a1bc88fe2bcf86fa2de9962034b0769a2; only the two existing evidence packets and this recovery receipt may be published.
