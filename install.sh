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
  local target="$1" rendered="$2" installed
  if [[ -f "$target" ]]; then
    if installed="$(grep -m1 '^<!-- the-cat-concerto v' "$target")"; then
      if [[ "$installed" == "<!-- $MARKER -->" ]]; then
        rm -f "$rendered"
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
  { cat "$SRCDIR/harness/opencode/agent-header.md"
    printf '\n<!-- %s -->\n\n' "$MARKER"
    cat "$SRCDIR/src/orchestrator.md"; } > "$R1"
  { cat "$SRCDIR/harness/opencode/worker-header.md"
    printf '\n<!-- %s -->\n\n' "$MARKER"
    cat "$SRCDIR/src/worker.md"; } > "$R2"
  install_agent_file "$BASE/agents/orchestrator.md" "$R1"
  install_agent_file "$BASE/agents/concerto-worker.md" "$R2"
  [[ "$HERDR_SKILL" == vendor ]] && install_skill "$BASE/skills/herdr/SKILL.md"
fi

# ============================================
# Block mode: claude / codex / gemini
# ============================================
install_block() { # <file> <content-temp>
  local file="$1" content="$2"
  mkdir -p "$(dirname "$file")"
  if [[ ! -f "$file" ]]; then
    { echo "$BLOCK_BEGIN"; cat "$content"; echo; echo "$BLOCK_END"; } > "$file"
    echo "  installed (new file): $file"
    return 0
  fi
  if grep -qF "$BLOCK_BEGIN" "$file"; then
    local current; current="$(mktemp)"
    awk -v begin="$BLOCK_BEGIN" -v end="$BLOCK_END" '
      index($0, begin) == 1 { inb = 1; next }
      index($0, end) == 1 { inb = 0; exit }
      inb { print }
    ' "$file" > "$current"
    if cmp -s "$current" "$content"; then
      echo "  already installed ($VERSION): $file"
    else
      awk -v begin="$BLOCK_BEGIN" -v end="$BLOCK_END" -v cf="$content" '
        index($0, begin) == 1 { print; while ((getline l < cf) > 0) print l; close(cf); inb = 1; next }
        index($0, end) == 1 && inb { inb = 0 }
        !inb { print }
      ' "$file" > "$file.tmp" || { rm -f "$file.tmp"; echo "  error: block rewrite failed: $file" >&2; FAILED=1; return 1; }
      mv "$file.tmp" "$file"
      echo "  updated block ($VERSION): $file"
    fi
    rm -f "$current"
  else
    { echo; echo "$BLOCK_BEGIN"; cat "$content"; echo; echo "$BLOCK_END"; } >> "$file"
    echo "  appended block: $file"
  fi
}

case "$HARNESS" in
  claude) BLOCK_FILE="$ROOT/.claude/CLAUDE.md" ;;
  codex)  BLOCK_FILE="$ROOT/.codex/AGENTS.md" ;;
  gemini) BLOCK_FILE="$ROOT/.gemini/GEMINI.md" ;;
esac

if [[ -n "${BLOCK_FILE:-}" ]]; then
  CONTENT="$(mktemp)"
  {
    printf '<!-- %s -->\n\n' "$MARKER"
    cat "$SRCDIR/src/orchestrator.md"
    echo
    cat "$SRCDIR/src/worker.md"
    if [[ "$HERDR_SKILL" == vendor ]]; then
      echo
      cat "$SRCDIR/vendor/herdr-skill/SKILL.md"
    fi
  } > "$CONTENT"
  install_block "$BLOCK_FILE" "$CONTENT"
  rm -f "$CONTENT"
fi

[[ "$FAILED" -eq 0 ]] || exit 1
echo "done ($MARKER)."
