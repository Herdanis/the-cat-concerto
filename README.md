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
2. **herdr skill** for your harness — either:
   - `herdr integration install <harness>` (preferred; always current), or
   - `--herdr-skill vendor` at install time to use the bundled snapshot

## Install

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
| `--harness` | opencode, claude, codex, gemini | required | target harness |
| `--herdr-skill` | manual, vendor | manual | manual: prints the `herdr integration install` command; vendor: installs the bundled snapshot |
| `--prefix DIR` | any dir | `$HOME` | install root (for testing) |
| `--force` | — | off | overwrite files that lack concert markers |

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
