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
| opencode | `-m <model> --agent concerto-worker --auto` |
| claude | `--permission-mode acceptEdits` |
| codex | `--full-auto` |
| gemini | `--approval-mode auto` (see `gemini --help`) |

Auto-approve should cover file edits and commands; keep anything that
mutates external state (apply/deploy/push) denied or manual — the
worker contract expects state changes to be reported, not run.
