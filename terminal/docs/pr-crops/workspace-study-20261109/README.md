# Workspace and study UI proof

Source and acceptance: [refinement record](../../../../docs/terminal-workspace-study-refinement-20261109.md). Publication: [PR #1407](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1407). [receipt.json](receipt.json) records source hashes, capture hashes and truthful run boundaries.

These are actual-component local Playwright captures, not production screenshots. Names and data are synthetic fixtures. The final screenshots show the existing dark/light tokens and responsive owners.

| Capture | What to inspect |
| --- | --- |
| [Workspace — desktop, dark](workspace-desktop-dark.png) | Readable unreadable-workspace name; separate Open/Actions; Export and Delete remain reachable. |
| [Workspace — phone, light](workspace-mobile-light.png) | Correct light sheet material, wrapped name, clear raw Export recovery and focus ring. |
| [Scripts — tablet, English](scripts-tablet-en-dark.png) | Wrapped long name, compact row hierarchy and 44px secondary actions. |
| [Scripts — phone, English](scripts-mobile-en-dark.png) | Long-name wrapping and separate action row without horizontal overflow. |
| [Scripts — phone, Chinese](scripts-mobile-zh-dark.png) | CJK wrapping and visible keyboard return focus. |
| [Study actions — desktop, light](studies-desktop-en-light.png) | Enabled Guide/Settings clearly distinct from the locked main action. |
| [Study actions — phone, English, light](studies-mobile-en-light.png) | Labelled enabled actions with 44px targets. |
| [Study actions — phone, Chinese, light](studies-mobile-zh-light.png) | Existing localized action labels and readable light treatment. |
| [Layers — phone, English](layers-mobile-en-dark.png) | Browse-first focus and native phone top layer. |
| [Layers — tablet, Chinese](layers-tablet-zh-dark.png) | Localized hierarchy and study state. |

## Evidence interpretation

- `logs/unit.log`: 128 passing tests at the product-logic checkpoint.
- `logs/typecheck-final.log` and `logs/static-final-checks.json`: final TypeScript exit 0.
- `logs/lint-final.log` / `logs/lint-baseline.log`: the same pre-existing LayoutMenu effect finding; no new lint finding.
- `logs/e2e.log`: first broad responsive run, including two incorrect post-download visibility expectations.
- `logs/e2e-release.log`: corrected final matrix, 13 pass / 2 intentional skips / no retries.
- `logs/e2e-actions-final.log`: final Guide/Settings visual delta, 6 pass / no retries.

Across the affected suite, 36 distinct executable responsive cases passed; six cases are intentionally breakpoint-specific skips. Overlapping runs must not be summed. Guest storage/theme reload is real local-owner proof; authenticated persistence, a physical IME/device and production acceptance are not claimed.
