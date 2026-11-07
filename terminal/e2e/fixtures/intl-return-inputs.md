# Intl Return input and execution contract

This is a test of the existing real Next/AppShell/SharedShellPresentation/Link
and catchall route. The single spec loops Macro and Risk. It does not exercise
Save, a baseline request, production auth, provider data or actual deployment.
It must be enrolled only at the next qualified Terminal source boundary; it
must not amend/replay the live1312/00f73 or1340 operations.

The test extends `playwright.config.ts` and the development-only layout/Analysis
preview already used by `shared-shell-directory-hardening.spec.ts` and
`shared-shell-refinement.spec.ts`. No product component, router, Link, parent,
status JSON, config or issuer is replaced. `fixtures/real-next-legacy-transport.ts`
serves the real Next process's SSR/RSC/chunks/status at the existing canonical
Beta browser origin, with the actual locally rendered legacy document at www.
Only HTTP transport is mapped. This keeps the existing approved Beta/www bridge
origins, never touches the original unknown3100 process, and does not broaden
an allowlist. All unrelated outgoing requests, mutations and baseline requests
are blocked and recorded. Only two existing fixed guest-layout cookies are
forwarded; no session, signer or credential is created/copied.

Two exact source inputs are required:

- `INTL_RETURN_FIXTURE_DIR`: directory containing `intl.html` from the existing
  real full-page Jinja fixture composition at Macro
  `7a2ffcb8dec91f701ebaf0d04990b2be6a7b8abb`. SHA256 is
  `4f807836970e39dbfe429368e23079aff6a21ceed39d9f2f724259cb9e612f8a`.
  Existing composition: `tests/intl_gs_fixture_site.py::_vm/_env` plus
  `tests/intl_investigation_page_fixture.py::page_fixture`, rendered through
  `lib.intl_library_mount.render_international_pages` and actual `intl.html.j2`.
  Replace only `vm['intl_workspace']` with the supplied S28 page fixture, no
  new UI wrapper, invented History controls or provider/build job. The accepted
  retained input is in the original S28 `visual-s28/presentation-7a2` artifact;
  normal CI's owning source-input stage must carry these exact bytes.
- `INTL_RETURN_MACRO_ASSETS`: the qualified same-source `templates` asset root
  including fonts. The case pins all five functional Intl/bridge JS/CSS digests
  before the browser case. Missing/wrong inputs fail the admitted case; there
  is no download, current-generation fallback or replacement rendering.

The normal qualified existing CI job may run, after supplying those inputs and
its ordinary installed dependencies:

```sh
CI=1 MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=<owned-CI-port-not3100> \
  INTL_RETURN_FIXTURE_DIR=<qualified-input-dir> \
  INTL_RETURN_MACRO_ASSETS=<qualified-Macro7a2-templates> \
  npm run test:e2e:responsive -- e2e/intl-investigation-return.spec.ts --project=desktop --retries=0
```

Use the existing responsive project's appropriate next source-boundary scope;
this command is an instruction, not a launched CI/browser operation. The local
non-CI case requires the incumbent explicit visual-operation handle, which makes
its existing config refuse unrelated-server reuse. No arbitrary local server,
mutable customer checkout or held browser objective may be borrowed.

Required observations: actual Link click retains the same Beta origin and top
Next document; actual status endpoint and LegacyPageHost reach ready; the actual
mounted Intl handle and visible panel restore view, selected market, ordered
pins, horizon, currency basis and price-return basis. No POST/baseline is allowed.
Only those executed observations establish the missing Return leg. Static types,
test discovery, the prior paired14 and destination assertions do not.

The transport helper is test-owned and may be imported read-only by the disjoint
History case with that case's actual accepted repaired-consumer HTML/assets.
It does not generate History data, expose a parallel viewer or qualify a page.
