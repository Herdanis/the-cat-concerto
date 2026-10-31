# Other harnesses

`install.sh` covers opencode, claude, codex, gemini. herdr recognizes
many more agent kinds (run `herdr agent` to list installed kinds). To
use the orchestrator with one of them:

1. Install the herdr skill: `herdr integration install <kind>`
2. Place the orchestrator + worker prompts wherever your harness reads
   global instructions (its equivalent of AGENTS.md/CLAUDE.md), or pass
   them per-session if it supports that
3. When spawning workers, pass your harness's non-interactive /
   auto-approve flags after `--`:

| Kind | Worker flags after `--` (examples) |
|---|---|
| opencode V2 (default) | `--auto --session <id> --prompt "$(cat spec)"` (API-created session; TUI has no `--agent` flag) |
| opencode V2 (one-shot) | `run "<task>" --agent concerto-worker --auto` |
| opencode V1 | `-m <model> --agent concerto-worker --auto` |
| claude | `--permission-mode acceptEdits --allowedTools "Bash(*)"` |
| codex | `--full-auto` |
| gemini | `--approval-mode auto` (see `gemini --help`) |

Pick the opencode recipe with `opencode --version`. The full-screen
TUI (`opencode`) has `--auto`. `mini` is not used for workers — it has
no `--auto`, and it ignores `session.permissions: "autoaccept"` in
`~/.config/opencode/cli.json` in practice. Auto-accept is safe because
the installed `concerto-worker` agent carries its own deny floor (push,
apply, deploy, migrate, repo create, plus the question/subagent
tools), which is applied after allow/ask. `tabs.mode: auto` hides
OpenCode's own tabs inside herdr by design. V1 keeps `--auto` on the
main TUI.

claude workers need an allowlisted Bash tool or they stall on every
command prompt.

Auto-approve should cover file edits and commands; keep anything that
mutates external state (apply/deploy/push) denied or manual — the
worker contract expects state changes to be reported, not run.
