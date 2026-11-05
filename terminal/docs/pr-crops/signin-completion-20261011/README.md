# Sign-in completion regression evidence

An already authenticated visitor can open the normal sign-in sheet. Successful
password authentication previously left that sheet on “One moment…” because the
server email was already populated and the provider waited for an empty-to-filled
transition. The form now reports acknowledged sign-in completion explicitly,
clears the password and resets its busy state. The sheet closes through its
existing close handler; the existing server refresh and signup steps remain.
While authentication is pending, the mode-switch button is disabled so a late
sign-in completion cannot close a newly selected signup flow. This additional
regression first failed (1 failed, 3 passed), then passed after the repair.
Independent review accepted this bounded repair; the browser test holds the
response until it verifies the disabled mode switch and still-visible sheet.

The component regression first returned **2 failed, 2 passed**. After repair,
**44 affected unit tests passed**, typecheck passed, and the existing responsive
runner returned **18 passed (42.6s)**. The browser matrix covers desktop,
tablet and mobile, English and Chinese, and both operating-system color preferences.
Terminal currently renders its dark art direction in both preferences; these images
are not evidence of a light product design. No layout, styling, locale strings,
authentication policy or entitlement checks were changed.

Screenshots retain sign-in and successful continuation for every viewport/language.
They use only deterministic local account fixtures and the real SDK/form/router
path. The test asserts exactly one password request, sheet closure without a reload,
retained NVDA and source parameters, visible chart and no horizontal overflow.
The initial browser attempt exposed an unreachable local auth fixture transport;
using the existing password-recovery fetch seam resolved that fixture problem.
The first corrected attempt then found an obsolete chart selector, replaced with
the existing responsive suite's chart canvas selector. Neither failure was greened
by changing product behavior or removing a required assertion.

`evidence.json` binds source bytes, screenshots, command and scope. Live repair
acceptance still requires protected landing, a merged-source installation and the
real signed-in browser path. The earlier observed production workaround is not a
pristine end-to-end pass.
