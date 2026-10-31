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
`gemini`, `pi`, `omp`. Works with OpenCode V1 and V2 — worker spawn
flags differ per version, see [docs/harnesses.md](docs/harnesses.md).
Other herdr-supported agents: same doc.

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
| opencode | `~/.config/opencode/agents/orchestrator.md` | `~/.config/opencode/agents/concerto-worker.md` |
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

The opencode install writes agent files only — never
`~/.config/opencode/AGENTS.md`, which OpenCode V2 injects into every
session including workers. A block left there by an older version is
stripped on the next run (the file is deleted only if nothing else
remains).

## Commits and pushes

The installed `concerto-worker` agent hard-denies the actions that
change real state: push, reset --hard, terraform apply/destroy,
kubectl apply/create/delete/scale, helm upgrade, docker stack deploy,
gh repo create, gh pr merge, DB migrations — plus the question and
subagent tools. No instruction unlocks those: the worker writes the
change and reports the exact command for you to run.

A local commit is the exception you can authorize: when you explicitly
ask the orchestrator to commit — for you, or for a delegated repo — it
passes it through the task spec, and the worker commits with a
conventional message and reports the hash. No user instruction, no
state change.

## Uninstall

- opencode: delete `agents/orchestrator.md` and
  `agents/concerto-worker.md` (and `skills/herdr/` if vendored). Nothing
  of ours lives in `~/.config/opencode/AGENTS.md`; a legacy block there
  is removed by the installer on the next run
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
