#!/usr/bin/env bash
# ============================================
# the-cat-concerto installer
# ============================================
set -euo pipefail

SRCDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS=""
HERDR_SKILL="manual"
PREFIX=""
FORCE=0
FAILED=0
BLOCK_BEGIN="# BEGIN the-cat-concerto"
BLOCK_END="# END the-cat-concerto"

usage() {
  cat >&2 <<EOF
Usage: install.sh --harness <opencode|claude|codex|gemini> [options]

Options:
  --herdr-skill manual|vendor   herdr skill source (default: manual)
  --prefix DIR                  install root (default: \$HOME)
  --force                       overwrite files lacking concert markers
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
while [[ $# -gt 0 ]]; do
  case "$1" in
    --harness)     HARNESS="${2:?missing value}" ; shift 2 ;;
    --herdr-skill) HERDR_SKILL="${2:?missing value}" ; shift 2 ;;
    --prefix)      PREFIX="${2:?missing value}" ; shift 2 ;;
    --force)       FORCE=1 ; shift ;;
    *)             usage ;;
  esac
done

case "$HARNESS" in
  opencode|claude|codex|gemini) ;;
  *) echo "error: --harness must be opencode|claude|codex|gemini" >&2; usage ;;
esac
case "$HERDR_SKILL" in
  manual|vendor) ;;
  *) echo "error: --herdr-skill must be manual or vendor" >&2; exit 2 ;;
esac

if [[ ! -d "$SRCDIR/src" ]]; then
  echo "error: run from a the-cat-concerto checkout (src/ not found). See README quickstart." >&2
  exit 1
fi

# ============================================
# Version
# ============================================
if V="$(git -C "$SRCDIR" describe --tags --exact-match 2>/dev/null)"; then
  VERSION="$V"
else
  VERSION="$(tr -d '[:space:]' < "$SRCDIR/VERSION")"
fi
MARKER="the-cat-concerto v$VERSION"
ROOT="${PREFIX:-$HOME}"

# ============================================
# Prerequisites (informational only)
# ============================================
if ! command -v herdr >/dev/null 2>&1; then
  echo "warn: herdr not found in PATH — the orchestrator cannot delegate"
  echo "      until it is installed: brew install herdr (or https://herdr.dev)"
  echo "      installing prompts anyway."
fi
if [[ "$HERDR_SKILL" == manual ]]; then
  echo "herdr skill: install it yourself with: herdr integration install $HARNESS"
fi

# ============================================
# Install helpers
# ============================================
install_agent_file() { # <target> <rendered-temp>
  local target="$1" rendered="$2"
  if [[ -f "$target" ]]; then
    if [[ "$(head -n1 "$target")" =~ ^\<!--\ the-cat-concerto\ v ]]; then
      if [[ "$(head -n1 "$target")" == "<!-- $MARKER -->" ]]; then
        echo "  already installed ($VERSION): $target"
      else
        mv "$rendered" "$target"
        echo "  upgraded to $VERSION: $target"
      fi
    elif [[ "$FORCE" -eq 1 ]]; then
      mv "$rendered" "$target"
      echo "  overwrote (forced): $target"
    else
      echo "  refusing: $target exists without a concert marker (use --force)" >&2
      rm -f "$rendered"
      FAILED=1
    fi
  else
    mkdir -p "$(dirname "$target")"
    mv "$rendered" "$target"
    echo "  installed: $target"
  fi
}

install_skill() { # <target>
  local target="$1" src="$SRCDIR/vendor/herdr-skill/SKILL.md"
  if [[ -f "$target" ]] && cmp -s "$src" "$target"; then
    echo "  herdr skill already vendored: $target"
  elif [[ -f "$target" ]] && [[ "$FORCE" -eq 0 ]]; then
    echo "  herdr skill exists and differs (herdr-managed?) — keeping it (use --force to replace): $target" >&2
  else
    mkdir -p "$(dirname "$target")"
    cp "$src" "$target"
    echo "  vendored herdr skill: $target"
  fi
}

# ============================================
# opencode: agent files
# ============================================
if [[ "$HARNESS" == opencode ]]; then
  BASE="$ROOT/.config/opencode"
  R1="$(mktemp)"; R2="$(mktemp)"
  { printf '<!-- %s -->\n\n' "$MARKER"
    cat "$SRCDIR/harness/opencode/agent-header.md" "$SRCDIR/src/orchestrator.md"; } > "$R1"
  { printf '<!-- %s -->\n\n' "$MARKER"
    cat "$SRCDIR/harness/opencode/worker-header.md" "$SRCDIR/src/worker.md"; } > "$R2"
  install_agent_file "$BASE/agents/orchestrator.md" "$R1"
  install_agent_file "$BASE/agents/concerto-worker.md" "$R2"
  [[ "$HERDR_SKILL" == vendor ]] && install_skill "$BASE/skills/herdr/SKILL.md"
fi

# block-mode harnesses land in Task 5

[[ "$FAILED" -eq 0 ]] || exit 1
echo "done ($MARKER)."
