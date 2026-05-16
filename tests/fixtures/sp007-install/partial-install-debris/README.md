# Partial-install debris fixture

Represents an XDG-shape directory tree that exists WITHOUT a valid
`install-receipt.json` — the FR-INSTALL-004 partial-install detection
test (T021 / T034) walks this tree, asserts `partial_install_detected:
true`, and exits non-zero with a remediation message.

The actual subdirectories are placeholders; tests synthesize the relevant
structure via `fs.mkdirSync` in their setup hooks.
