# Unified Today daily desk

Actual React components under controlled local source/identity fixtures, **not a live authenticated beta release**. Paper binding and parent scope: `docs/plans/SHARED_SHELL_DAILY_DESK_2026-11-09.md`.

## Source qualification

Current pre-capture source: 223/223 focused tests in 11 suites; TypeScript, scoped ESLint and diff whitespace checks passed. Node 26 exposes experimental Web Storage that shadows jsdom. The initial unmodified baseline failed before rendering on undefined localStorage; `NODE_OPTIONS=--no-experimental-webstorage` restores jsdom ownership without changing product or CI guards.

## Initial composition proof

Source `edbf1c8a0d5e4851d0c67eb95708b119de88a253`: 23 Chromium cases, zero page errors and zero horizontal overflow. Desktop 1440, tablet 820, phone 390 and 320 stress; both themes/languages and first, quiet, teaser, unavailable, expanded-change states. Initial pictures in this source commit reflect that initial composition. Updated comparison, workflow and risk/events pictures follow the next exact-source capture.

The runner reuses the existing Today browser harness. It exercises actual components and CSS, while identity, API responses and Next Link are fixture boundaries. Its dates/values are explicitly illustrative, not current market information. Every external request is blocked. It proves local rendering, reader calls, source/owner preservation, storage and focus behavior; it does not prove live authentication, served Macro documents, Next routing, CSP or deployment.

Generated JS/CSS bundles are ignored. Captured source identity and detailed results remain in the JSON receipt beside the images.
