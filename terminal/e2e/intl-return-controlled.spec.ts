// Execution adapter only. The original case, real Link/router and canonical-origin
// helper stay unchanged. Its local HTML/RSC/static requests pass a second exact
// APIRequestContext guard before any transport; all other methods remain denied.
import { test } from "@playwright/test";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Pure incumbent Node policy.
const { guardProxy } = require("./tools/intl_return_closed_policy.cjs");
test.beforeEach(async ({ context, baseURL }) => {
  guardProxy(context.request, baseURL);
});
// Deliberately loaded after the real runner hook; not a copied test or fake router.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Preserve original source verbatim.
require("./intl-investigation-return.spec");
