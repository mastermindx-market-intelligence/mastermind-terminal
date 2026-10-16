# Repair of the completed hosted browser failures

The exact-head desktop-2 job 115271921632 failed five existing Options tests.
The new futures link had been appended as a third header row and consumed 44px
from the existing Exposure/Prophet panels. All five failures reproduced locally.
The repair places a compact bilingual Futures destination in the existing category
row. It preserves the original two-row header and mobile 44px hit target.

All five original tests now pass with their expectations UNCHANGED and zero retries.
The complete focused futures workspace browser suite passes 27 cases at desktop,
tablet and mobile. Navigation tests now check no added header row, on-screen link
geometry and the mobile hit target. Three header-only images are retained; they
contain navigation chrome rather than market data. Typecheck passes; scoped lint
passes with the existing unused-lang warning. This is not full hosted-CI completion.

The original source/API review was newly admitted under the SAME stable ID and
root/parent; a second independent leaf examines the frozen domain/render/client
files. Both remain ACTIVE_OR_WAITING at this save, not accepted reviews. Their
packets/hashes are retained locally and neither worker may modify source. The
parent remains sole writer on the original PR964 branch. Source permissions and
live-data activation are unchanged. One unrelated compound read was safety-blocked
and was not replayed; the prior compatible procedure pin remains usable.
