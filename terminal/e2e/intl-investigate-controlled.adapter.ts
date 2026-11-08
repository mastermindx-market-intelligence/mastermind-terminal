import { test } from "@playwright/test";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Incumbent pure closed proxy policy.
const { guardProxy } = require("./tools/intl_return_closed_policy.cjs");
test.beforeEach(async ({ context, baseURL }) => { guardProxy(context.request, baseURL); });
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Load unchanged authored case after actual runner hook.
require("./intl-investigate-return.spec");
