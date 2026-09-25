# the-cat-concerto

Orchestrator prompt + worker contract for coding agents, driven by
[herdr](https://herdr.dev).

One orchestrator prompt routes work by location: inside your repo it
works directly; across sibling project repos it spawns one herdr pane
per repo, starts a worker agent in it, delegates, then reviews the
result.

## Prerequisites

1. **herdr** — `brew install herdr` or see https://herdr.dev
   (the installer warns but proceeds without it; delegation needs it)

The herdr skill for your harness is handled during install: run it
via herdr, install the bundled snapshot, or skip (the command is
printed at the end).

## Install

One-liner — interactive, no clone needed:

```bash
curl -fsSL https://raw.githubusercontent.com/Herdanis/the-cat-concerto/latest-release/install.sh | bash
```

You get two questions (arrow keys + space to select, enter to
confirm, backspace to go back):

1. **Harness** (multi-select): opencode, claude, codex, gemini
2. **herdr skill**: run `herdr integration install <harness>` now,
   install the bundled snapshot, or skip

Non-interactive (CI, scripts) — clone and pass flags:

```bash
git clone --depth 1 --branch v0.1.0 https://github.com/Herdanis/the-cat-concerto /tmp/the-cat-concerto
/tmp/the-cat-concerto/install.sh --harness <harness>
```

Supported harnesses: `opencode`, `claude` (Claude Code), `codex`,
`gemini` (Gemini CLI). Other herdr-supported agents: see
[docs/harnesses.md](docs/harnesses.md).

## Options

| Flag | Values | Default | Meaning |
|---|---|---|---|
| `--harness` | opencode, claude, codex, gemini (comma-sep for multiple) | interactive prompt | target harness(es) |
| `--herdr-skill` | manual, vendor | manual | manual: prints the `herdr integration install` command; vendor: installs the bundled snapshot |
| `--prefix DIR` | any dir | `$HOME` | install root (for testing) |
| `--force` | — | off | overwrite files that lack concert markers |
| `CONCERTO_NO_TUI=1` | env | — | numbered prompts instead of arrow-key TUI |

## What gets installed

| Harness | Orchestrator | Worker |
|---|---|---|
| opencode | `~/.config/opencode/agents/orchestrator.md` | `~/.config/opencode/agents/concerto-worker.md` |
| claude | marked block in `~/.claude/CLAUDE.md` | same block |
| codex | marked block in `~/.codex/AGENTS.md` | same block |
| gemini | marked block in `~/.gemini/GEMINI.md` | same block |

Re-running the installer is safe: same version = no-op, newer version =
in-place upgrade, foreign files are refused unless `--force`.

## Uninstall

- opencode: delete `agents/orchestrator.md` and
  `agents/concerto-worker.md` (and `skills/herdr/` if vendored)
- claude/codex/gemini: delete everything from the
  `# BEGIN the-cat-concerto` line through the
  `# END the-cat-concerto` line, markers included

## License

MIT — see [LICENSE](LICENSE). The bundled herdr skill snapshot is
Apache-2.0 — see [NOTICE.md](NOTICE.md).
