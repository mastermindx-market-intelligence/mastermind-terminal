# Preserve Commodities research through Google OAuth

## Problem and change

The Google OAuth kickoff constructed `next` from the pathname alone. It discarded the selected company, page, transmission evidence and nested Macro return URL before the callback. The fix retains the current query and sets exactly one `onboard=resume`. It does not forward the outer fragment, change callback admission, or change password finalization (separate PR #1045).

## Verification

- 128 focused unit tests pass across market-ontology context, OAuth construction, callback recovery, shared-shell auth redirect and sign-in completion.
- The new regression was observed failing before the production fix: the callback lost the company and duplicate research fields. Tests now verify both, nested return encoding, omitted outer token-like fragments, storage failure and provider errors.
- Next route type generation and TypeScript check pass.
- 12 Playwright cases pass: English/Chinese, desktop 1440×900, tablet 820×1180 and mobile 390×844, under both system color preferences. The application remains dark in both; this is not a light-theme claim.
- Each browser case activates the actual Google button, inspects the SDK-generated callback destination, visits the callback/resume path, verifies context cleanup, and uses the actual Dashboard button to return to the exact commodities investigation URL. Screenshots cover sign-in and resumed company research; both states fit their viewport.
- The shipped reduced-motion preference disables the return button's decorative pulse so its ordinary pointer click can settle. No forced click, injected CSS or product animation change is used.

The fixture supplies a session and intercepts the external authorization and Macro destination. These tests establish local handoff, resume and exact return navigation; they do not complete Google authentication or establish production deployment. The callback unit test separately covers successful mocked code exchange. Existing redirect validation is unchanged.

## Reproduce

From `terminal/`, run the five focused Vitest suites, `npx next typegen`, `npx tsc --noEmit`, and:

```sh
npm run test:e2e:responsive -- e2e/onboarding-oauth-context.spec.ts --workers=2 --reporter=line,json
```

On the local Node 26 runtime, set `NODE_OPTIONS=--no-experimental-webstorage` so Vitest 2 uses jsdom's storage. The existing responsive fixture uses its documented local server configuration; this evidence used port 3197. No production login or account token is needed.

## Captures

The table links both states in each language at every viewport. The directory also contains all corresponding light-system-preference captures. `verification.json` binds all 24 PNG files and the four implementation/test files by SHA256.

| Viewport | English | Chinese |
| --- | --- | --- |
| desktop | [Sign-in](screenshots/desktop-en-dark-oauth.png) · [Research resumed](screenshots/desktop-en-dark-research-resumed.png) | [Sign-in](screenshots/desktop-zh-dark-oauth.png) · [Research resumed](screenshots/desktop-zh-dark-research-resumed.png) |
| tablet | [Sign-in](screenshots/tablet-en-dark-oauth.png) · [Research resumed](screenshots/tablet-en-dark-research-resumed.png) | [Sign-in](screenshots/tablet-zh-dark-oauth.png) · [Research resumed](screenshots/tablet-zh-dark-research-resumed.png) |
| mobile | [Sign-in](screenshots/mobile-en-dark-oauth.png) · [Research resumed](screenshots/mobile-en-dark-research-resumed.png) | [Sign-in](screenshots/mobile-zh-dark-oauth.png) · [Research resumed](screenshots/mobile-zh-dark-research-resumed.png) |
