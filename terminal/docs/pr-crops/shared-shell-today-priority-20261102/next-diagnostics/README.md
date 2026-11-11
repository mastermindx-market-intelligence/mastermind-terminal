# Local mutable-dev delivery failure

The successful browser received 2,306,198 bytes of `app/layout.js`, equal to its complete compiler artifact. The failing phone received only 458,752 bytes and failed JavaScript parsing before hydration or API calls. The contemporaneous complete compiler artifact still had 2,306,198 bytes and parsed successfully. HTTP reported JavaScript UTF-8 and 200 with gzip/chunked transfer.

The failed bytes belong to an intermediate development generation: the first difference against both complete snapshots is at byte 273343 in a webpack hot/CSS identifier. The failed bytes are not asserted to be a byte-identical prefix of either retained complete snapshot. Source-length truncation and compilation drift are separately recorded in the delivery JSON files.

The gzip files reversibly retain the exact decoded browser/compiler bytes; their decoded SHA-256 values are in the delivery records. They are local fixture artifacts, contain only public product source and test boundaries, and are not beta or production evidence. The positive replacement qualification uses one frozen Next build, with asset bytes checked in both journeys. No product/authentication workaround or page reload is used.
