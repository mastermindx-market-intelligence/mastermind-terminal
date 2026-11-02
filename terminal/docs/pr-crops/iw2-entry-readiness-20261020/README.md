# Saved research entry readiness

The server-rendered Start new research button previously accepted a native click while client JavaScript was withheld. After bootstrap and an explicit five-second wait the form remained closed; a second native click opened it. This separately controlled defect does not establish the cause of earlier hosted Title-field retries.

The existing button is now disabled until the existing owner/recovery initialization batch finishes. The existing frozen condition, click handler, auth/recovery/save logic and all SQL remain unchanged. No extra initialization effect or lifecycle store was introduced.

Six local English/Chinese desktop, tablet and mobile browser cases pass. They hold actual client-script requests, verify the server button is disabled, release bootstrap, then open and edit an unsaved draft through the ordinary button. No Save, owner/auth/model write or manual SQL occurs. The permanent regression is `terminal/e2e/investigation-entry-readiness.spec.ts`.

TypeScript passes; the new test has zero lint findings. Component lint remains one error and three warnings, all inherited from the baseline. The raw worker patch added an error and was not accepted as final; the corrected parent source was tested again. Nine screenshots contain five unique reviewed pixel images and four identical reuses. The owned browser/server ended; no broad evidence recapture or restamp was needed.

Hosted CI for this new source is a separate obligation. Release, migration0030, T03k refusal/unknown effects, installation and authenticated journey acceptance remain held.
