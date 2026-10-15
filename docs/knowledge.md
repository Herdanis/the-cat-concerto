# Known Issues

## Two-Editor Protocol Quirks (herdr + modal editors)

- **esc wipes unsubmitted paste**: pressing esc exits insert/paste mode, discarding any text not yet committed to the editor buffer. Submit sequence is `esc && sleep 1 && enter` — esc clears partial paste, enter submits committed prompt.
- **enter needs marker landed**: after esc, prompt submission marker must be visible before pressing enter. `sleep 1` gap gives settle time. Large pastes: extend to `sleep 2` and verify with `agent read --source visible` first.
- **Paste-drop in normal mode**: vim plugin may leave editor in normal mode after previous submit, swallowing pastes. Recovery: `i` (insert mode) → re-prompt → wait for settle → `esc + enter`.
- **Probe contamination**: diagnostic probes or stray text in paste are visible in `agent read --source visible` before submission. Always scan visible buffer before pressing enter.

## macOS test.py symlink false-negative

- `test_regression_test_runner` can false-red on macOS when home directory path resolves through `/var → /private/var` symlink. Test home-dir gate sees different canonical path than expected.
- Fix: rerun with `TMPDIR=/private/tmp` to force canonical paths. No code issue — test environment only.
