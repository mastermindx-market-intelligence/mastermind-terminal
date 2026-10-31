# Shared manifest cache: consumer recovery proof

Captured against `0ce6f40051975dccf4da271210da2dbeff84cec5`, using the existing local fixture runtime and Chromium 149. Product source was unchanged during these checks. English and Chinese were exercised at 1440×900, 820×1180 and 390×844.

- **Heatmap: six passing cases.** A valid static manifest first reached the browser's own IndexedDB. After the record was aged one hour, the static response became `{symbols: []}` and the flow-manifest route returned 503. Two full reloads preserved the exact cached record, including its original timestamp. The board retained its tiles and breadth while showing the localized failed-refresh warning and Retry. Six screenshots were reviewed.
- **Analysis symbol picker: six passing composed cases.** A malformed cold manifest showed the localized retryable error. After Retry, AAPL was searchable and selectable; the host label and URL changed to AAPL. Twelve screenshots show the error and recovered result. Each passing case observed one expected search-analytics POST and zero owner-data writes. Other analytics are recorded separately.

The picker result combines five accepted cases with a corrected tablet-English control. In that control the fixture only becomes valid after the actual Retry click, preventing an unrelated background read from making the button disappear before the intended action. No forced click, sleep, tolerance or product change was used.

Original harness failures are preserved in the local receipt: misclassifying search analytics as owner writes; an unscoped combobox selector also matching the company-event dropdown; a dev-server 404 startup timeout with no tests run; and the early-recovery tablet case. The startup cause and exact background trigger of early recovery remain unproved. These failures are not presented as product defects.

`measurements.json` binds the reviewed images and original measurement hashes. The complete original harness, logs, failures and native IndexedDB records are retained in the mission's `screener-stale-refresh/persistence/CONSUMER_COMPATIBILITY_ACCEPTANCE.json` capsule. This packet proves only the stated local consumer paths. It does not establish live data, authenticated provider access, whole-page accessibility, text enlargement, other themes, merge, installation or production acceptance.
