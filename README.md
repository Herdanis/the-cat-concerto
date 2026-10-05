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
curl -fsSL https://raw.githubusercontent.com/Herdanis/the-cat-concerto/main/install.sh | bash
```

By default this installs the latest release tag. To install from the
latest commit on `main` instead:

```bash
curl -fsSL https://raw.githubusercontent.com/Herdanis/the-cat-concerto/main/install.sh | bash -s -- --source commit
```

You get two questions (arrow keys + space to select, enter to
confirm, backspace to go back):

1. **Harness** (multi-select): opencode, claude, codex, gemini
2. **herdr skill**: run `herdr integration install <harness>` now,
   install the bundled snapshot, or skip

Non-interactive (CI, scripts) — clone and pass flags:

```bash
git clone --depth 1 https://github.com/Herdanis/the-cat-concerto /tmp/the-cat-concerto
/tmp/the-cat-concerto/install.sh --harness <harness>
```

Supported harnesses: `opencode`, `claude` (Claude Code), `codex`,
`gemini`, `pi`, `omp`. Other herdr-supported agents: see
[docs/harnesses.md](docs/harnesses.md).

## Options

| Flag | Values | Default | Meaning |
|---|---|---|---|
| `--harness` | opencode, claude, codex, gemini, pi, omp (comma-sep for multiple) | interactive prompt | target harness(es) |
| `--herdr-skill` | manual, vendor | manual | manual: prints the `herdr integration install` command; vendor: installs the bundled snapshot |
| `--source` | tag, commit, local | tag for curl installs, local for a checkout | where the prompts come from: latest git tag, latest main commit, or the checkout beside the script (testing) |
| `--prefix DIR` | any dir | `$HOME` | install root (for testing) |
| `--force` | — | off | overwrite files that lack concert markers |
| `CONCERTO_NO_TUI=1` | env | — | numbered prompts instead of arrow-key TUI |

## What gets installed

| Harness | Orchestrator | Worker |
|---|---|---|
| opencode | `~/.config/opencode/agents/orchestrator.md` + marked block in `~/.config/opencode/AGENTS.md` | `~/.config/opencode/agents/concerto-worker.md` |
| claude | marked block in `~/.claude/CLAUDE.md` | same block |
| codex | marked block in `~/.codex/AGENTS.md` | same block |
| gemini | marked block in `~/.gemini/GEMINI.md` | same block |
| pi | marked block in `~/.pi/agent/AGENTS.md` | same block |
| omp | marked block in `~/.omp/agent/AGENTS.md` | same block |

Re-running the installer is safe: same version = no-op, newer version =
in-place upgrade (vendored herdr skill included — it carries a concert
marker and updates in place), foreign and herdr-managed files are
refused unless `--force`. With no flags, an already-installed system
skips the prompts entirely and just updates what's there (pass
`--harness` to add or change harnesses).

## Commits and pushes

Workers and the orchestrator never commit or push on their own
initiative. When you explicitly ask the orchestrator to commit or
push — for you, or for a delegated repo — it passes that
authorization down to the worker through the task spec. No user
instruction, no state change.

## Uninstall

- opencode: delete `agents/orchestrator.md` and
  `agents/concerto-worker.md` (and `skills/herdr/` if vendored), and
  the marked block in `~/.config/opencode/AGENTS.md` (from
  `# BEGIN the-cat-concerto` through `# END the-cat-concerto`,
  markers included)
- claude/codex/gemini/pi/omp: delete everything from the
  `# BEGIN the-cat-concerto` line through the
  `# END the-cat-concerto` line, markers included

## Herdr plugin

Listed on [herdr.dev/plugins](https://herdr.dev/plugins). With herdr
installed:

```bash
herdr plugin install Herdanis/the-cat-concerto
herdr plugin pane open --plugin the-cat-concerto --entrypoint installer
```

The pane opens an interactive terminal running install.sh. The curl
one-liner above remains the primary install path.

## License

MIT — see [LICENSE](LICENSE). The bundled herdr skill snapshot is
Apache-2.0 — see [NOTICE.md](NOTICE.md).
