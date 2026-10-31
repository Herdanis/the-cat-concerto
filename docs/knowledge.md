# Known Issues

## Two-Editor Protocol Quirks (herdr + modal editors)

- **esc wipes unsubmitted paste**: pressing esc exits insert/paste mode, discarding any text not yet committed to the editor buffer. Submit sequence is `esc && sleep 1 && enter` — esc clears partial paste, enter submits committed prompt.
- **enter needs marker landed**: after esc, prompt submission marker must be visible before pressing enter. `sleep 1` gap gives settle time. Large pastes: extend to `sleep 2` and verify with `agent read --source visible` first.
- **Paste-drop in normal mode**: vim plugin may leave editor in normal mode after previous submit, swallowing pastes. Recovery: `i` (insert mode) → re-prompt → wait for settle → `esc + enter`.
- **Probe contamination**: diagnostic probes or stray text in paste are visible in `agent read --source visible` before submission. Always scan visible buffer before pressing enter.

## OpenCode V2 Delegation

- **Paste/esc recovery is not for opencode**: the `esc && enter` submit dance in the orchestrator applies only to modal-editor harnesses (claude, codex, gemini, opencode V1). A V2 orchestrator prompts and reads through the HTTP API and never sends keys.
- **`--prompt` submits at launch on the TUI**: the full-screen `opencode` takes the spec as a launch argument, so there is no paste step at all — no `esc`/`enter`, no `agent_prompt_stalled`.
- **The TUI has no `--agent` flag**: the session must be created with the agent via the API (`POST /api/session` with `"agent":"concerto-worker"`), then attached with `--session "$SID"`.
- **`--auto` lives on the TUI and `run` only**: it does not exist on `mini`. It is safe because agent deny rules outrank auto-approval (denies are checked after allow/ask).
- **`mini` ignores cli.json `session.permissions: "autoaccept"`** in practice — a pending ask prompt stalls a `mini` worker. Use `mini --session <id>` only when an outside party answers approvals via the API.
- **No orchestrator body in `~/.config/opencode/AGENTS.md`**: V2 injects the global AGENTS.md into every session, workers included — an installed concert block puts the orchestrator persona into worker panes and duplicates the agent system prompt. The installer now only strips a stale block from that file.

## macOS test.py symlink false-negative

- `test_regression_test_runner` can false-red on macOS when home directory path resolves through `/var → /private/var` symlink. Test home-dir gate sees different canonical path than expected.
- Fix: rerun with `TMPDIR=/private/tmp` to force canonical paths. No code issue — test environment only.
