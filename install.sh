#!/usr/bin/env bash
# ============================================
# the-cat-concerto installer
# ============================================
set -euo pipefail

if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  SRCDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  SRCDIR="$PWD"   # curl|bash: script read from stdin, bootstrap decides
fi
ORIG_ARGS=("$@")
HARNESS=""
HARNESS_MULTI=""
HERDR_SKILL="manual"
PREFIX=""
FORCE=0
FAILED=0
INTERACTIVE_USED=0
BLOCK_BEGIN="# BEGIN the-cat-concerto"
BLOCK_END="# END the-cat-concerto"
HARNESS_KINDS="opencode claude codex gemini"

usage() {
  cat >&2 <<EOF
Usage: install.sh --harness <opencode|claude|codex|gemini> [options]
       install.sh                 (interactive, no flags)

Or the one-liner (no clone needed):

  curl -fsSL https://raw.githubusercontent.com/Herdanis/the-cat-concerto/latest-release/install.sh | bash

Options:
  --harness X[,Y...]           one or more of: opencode claude codex gemini
  --herdr-skill manual|vendor  herdr skill source (default: manual)
  --prefix DIR                 install root (default: \$HOME)
  --force                      overwrite files lacking concert markers
  CONCERTO_NO_TUI=1            numbered prompts instead of arrow-key TUI
EOF
  exit 2
}

# ============================================
# Arg parsing (flags optional)
# ============================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --harness)     HARNESS="${2:?missing value}" ; shift 2 ;;
    --herdr-skill) HERDR_SKILL="${2:?missing value}" ; shift 2 ;;
    --prefix)      PREFIX="${2:?missing value}" ; shift 2 ;;
    --force)       FORCE=1 ; shift ;;
    *)             usage ;;
  esac
done

# ============================================
# Bootstrap: curl|bash — no checkout beside script
# ============================================
if [[ ! -d "$SRCDIR/src" ]]; then
  if command -v curl >/dev/null 2>&1; then
    API="${CONCERTO_API_OVERRIDE:-https://api.github.com/repos/Herdanis/the-cat-concerto/releases/latest}"
    TAG="$(curl -sf "$API" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1 || true)"
    if [[ -z "$TAG" ]]; then
      echo "error: could not resolve latest release ($API)" >&2
      exit 1
    fi
    TARBALL="https://github.com/Herdanis/the-cat-concerto/archive/refs/tags/$TAG.tar.gz"
    WORK="$(mktemp -d)"
    if ! curl -sfL "$TARBALL" -o "$WORK/src.tar.gz"; then
      echo "error: download failed: $TARBALL" >&2
      exit 1
    fi
    tar -xzf "$WORK/src.tar.gz" -C "$WORK" || { echo "error: extract failed" >&2; exit 1; }
    DIR="$WORK/the-cat-concerto-${TAG#v}"
    [[ -d "$DIR" ]] || DIR="$(ls -d "$WORK"/the-cat-concerto-* | head -n1)"
    exec bash "$DIR/install.sh" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}
  fi
  echo "error: no the-cat-concerto checkout beside this script (src/ not found)" >&2
  echo "hint:  use the curl one-liner from the README, or clone the repo first" >&2
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
VERSION="${VERSION#v}"
MARKER="the-cat-concerto v$VERSION"
ROOT="${PREFIX:-$HOME}"

# ============================================
# Prerequisites (informational only)
# ============================================
HERDR_PRESENT=0
command -v herdr >/dev/null 2>&1 && HERDR_PRESENT=1
if [[ "$HERDR_PRESENT" -eq 0 ]]; then
  echo "warn: herdr not found in PATH — the orchestrator cannot delegate"
  echo "      until it is installed: brew install herdr (or https://herdr.dev)"
  echo "      installing prompts anyway."
fi

# ============================================
# Interactive mode (no flags, tty present)
# ============================================
have_tty() { [[ -t 2 ]]; }

# Renders a selection screen. Sets SELECTED[] (names) and returns 0 on
# confirm, 1 on backspace.
# Globals used: SEL_TITLE SEL_ITEMS (array) SEL_MULTI (0/1) SEL_CURSOR SEL_MASK
render_screen() {
  local i n row bullet
  n=${#SEL_ITEMS[@]}
  echo "$SEL_TITLE" >&2
  for ((i = 0; i < n; i++)); do
    if [[ "$i" -eq "$SEL_CURSOR" ]]; then row=">"; else row=" "; fi
    if [[ "${SEL_MASK:$i:1}" == "1" ]]; then bullet="●"; else bullet="○"; fi
    echo "  $row $bullet ${SEL_ITEMS[$i]}" >&2
  done
  echo >&2
  echo "  ↑/↓ move   space select   enter confirm   backspace back" >&2
}

# Moves terminal cursor back up over the drawn screen so the next
# render overwrites in place.
undraw_screen() {
  local n=${#SEL_ITEMS[@]}
  # n item lines + title + blank + legend = n + 3 lines
  printf '\033[%dA' "$((n + 3))" >&2
  printf '\033[J' >&2
}

read_key() { # sets KEY
  local k
  IFS= read -rsn1 k < /dev/tty || KEY="enter"; [[ -n "${k:-}" ]] || { KEY="enter"; return; }
  if [[ "$k" == $'\033' ]]; then
    local seq
    IFS= read -rsn2 seq < /dev/tty || true
    case "$seq" in
      '[A') KEY="up" ;;
      '[B') KEY="down" ;;
      *)   KEY="other" ;;
    esac
  elif [[ "$k" == " " ]]; then
    KEY="space"
  elif [[ "$k" == $'\x7f' || "$k" == $'\b' ]]; then
    KEY="back"
  else
    KEY="other"
  fi
}

tui_select() { # sets SELECTED (array) — uses SEL_TITLE/SEL_ITEMS/SEL_MULTI
  SEL_CURSOR=0
  SEL_MASK=""
  local i n
  n=${#SEL_ITEMS[@]}
  for ((i = 0; i < n; i++)); do SEL_MASK+="0"; done
  render_screen
  while true; do
    read_key
    case "$KEY" in
      up)   SEL_CURSOR=$(( (SEL_CURSOR - 1 + n) % n )); undraw_screen; render_screen ;;
      down) SEL_CURSOR=$(( (SEL_CURSOR + 1) % n )); undraw_screen; render_screen ;;
      space)
        if [[ "$SEL_MULTI" -eq 1 ]]; then
          if [[ "${SEL_MASK:$SEL_CURSOR:1}" == "1" ]]; then
            SEL_MASK="${SEL_MASK:0:$SEL_CURSOR}0${SEL_MASK:$((SEL_CURSOR+1))}"
          else
            SEL_MASK="${SEL_MASK:0:$SEL_CURSOR}1${SEL_MASK:$((SEL_CURSOR+1))}"
          fi
        else
          SEL_MASK=""
          for ((i = 0; i < n; i++)); do SEL_MASK+="0"; done
          SEL_MASK="${SEL_MASK:0:$SEL_CURSOR}1${SEL_MASK:$((SEL_CURSOR+1))}"
        fi
        undraw_screen; render_screen ;;
      back)
        undraw_screen
        SELECTED=()
        return 1 ;;
      enter)
        if [[ "$SEL_MULTI" -eq 1 && "$SEL_MASK" == *"1"* || "$SEL_MULTI" -eq 0 && "$SEL_MASK" == *"1"* ]]; then
          break
        fi
        undraw_screen; render_screen
        echo "  select at least one item" >&2
        sleep 0.6
        undraw_screen; render_screen ;;
    esac
  done
  undraw_screen
  SELECTED=()
  for ((i = 0; i < n; i++)); do
    [[ "${SEL_MASK:$i:1}" == "1" ]] && SELECTED+=("${SEL_ITEMS[$i]}")
  done
  return 0
}

# Numbered fallback (CONCERTO_NO_TUI / non-ANSI / no raw keys)
num_select() { # sets SELECTED — uses SEL_TITLE/SEL_ITEMS/SEL_MULTI
  local n=${#SEL_ITEMS[@]} i answer part idx
  local use_tty=0
  if [[ "${CONCERTO_STDIN:-}" == "1" ]]; then
    use_tty=0
  elif [[ -r /dev/tty ]]; then
    use_tty=1
  fi
  while true; do
    echo "$SEL_TITLE" >&2
    for ((i = 0; i < n; i++)); do
      echo "  $((i+1))) ${SEL_ITEMS[$i]}" >&2
    done
    if [[ "$use_tty" -eq 1 ]]; then
      if [[ "$SEL_MULTI" -eq 1 ]]; then
        read -r -p "Choice (comma numbers, e.g. 1,3): " answer < /dev/tty || exit 0
      else
        read -r -p "Choice [1-$n]: " answer < /dev/tty || exit 0
      fi
    else
      read -r answer || exit 0
      [[ -z "$answer" ]] && exit 0   # stdin exhausted
    fi
    if [[ "$SEL_MULTI" -eq 1 ]]; then
      answer="${answer//[[:space:]]/}"
      [[ -z "$answer" ]] && { echo "  select at least one item" >&2; continue; }
      local bad=0
      IFS=',' read -ra parts <<< "$answer"
      for part in "${parts[@]}"; do
        [[ "$part" =~ ^[0-9]+$ ]] || { bad=1; break; }
        idx=$((10#$part - 1))
        if (( idx < 0 || idx >= n )); then bad=1; break; fi
        local dup=0 s
        for s in "${SELECTED[@]:-}"; do [[ "$s" == "${SEL_ITEMS[$idx]}" ]] && dup=1; done
        [[ "$dup" -eq 0 ]] && SELECTED+=("${SEL_ITEMS[$idx]}")
      done
      [[ "$bad" -eq 1 ]] && { echo "  invalid choice: $answer" >&2; SELECTED=(); continue; }
      [[ ${#SELECTED[@]} -eq 0 ]] && { echo "  select at least one item" >&2; continue; }
      return 0
    else
      [[ "$answer" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= n )) || { echo "  invalid choice: ${answer:-}" >&2; continue; }
      SELECTED=("${SEL_ITEMS[$((answer - 1))]}")
      return 0
    fi
  done
}

# Select harnesses. Echoes space-separated names; empty = cancelled.
choose_harnesses() {
  SEL_TITLE="Select harness (multi):"
  SEL_ITEMS=($HARNESS_KINDS)
  SEL_MULTI=1
  if [[ "${CONCERTO_NO_TUI:-}" == "1" ]]; then
    num_select || return 1
  else
    tui_select || return 1
  fi
  echo "${SELECTED[*]:-}"
  return 0
}

# Select herdr skill option. Echoes: run|vendor|skip
choose_skill() {
  local opts=("Run herdr integration install now" "Install bundled snapshot (vendor)" "Skip")
  if [[ "$HERDR_PRESENT" -eq 0 ]]; then
    opts=("Install bundled snapshot (vendor)" "Skip")
  fi
  SEL_TITLE="herdr skill:"
  SEL_ITEMS=("${opts[@]}")
  SEL_MULTI=0
  if [[ "${CONCERTO_NO_TUI:-}" == "1" ]]; then
    num_select || return 1
  else
    tui_select || return 1
  fi
  local pick="${SELECTED[0]}"
  case "$pick" in
    "Run herdr integration install now")          echo "run" ;;
    "Install bundled snapshot (vendor)")          echo "vendor" ;;
    "Skip")                                       echo "skip" ;;
    *) echo "skip" ;;
  esac
  return 0
}

if [[ -z "$HARNESS" ]]; then
  if have_tty || [[ "${CONCERTO_NO_TUI:-}" == "1" ]]; then
    INTERACTIVE_USED=1
    while true; do
      HARNESS_MULTI="$(choose_harnesses || true)"
      if [[ -z "${HARNESS_MULTI:-}" ]]; then
        echo "cancelled."
        exit 0
      fi
      if SKILL_PICK="$(choose_skill)"; then break; fi
    done
    case "${SKILL_PICK:-skip}" in
      run)    HERDR_SKILL="manual"; RUN_HERDR=1 ;;
      vendor) HERDR_SKILL="vendor" ;;
      *)      HERDR_SKILL="manual" ;;
    esac
  else
    usage
  fi
else
  HARNESS_MULTI="$HARNESS"
fi

# ============================================
# Validate selections
# ============================================
if [[ -z "${HARNESS_MULTI:-}" ]]; then
  echo "error: no harness selected" >&2
  exit 2
fi
SELECTED_HARNESS=()
HARNESS_MULTI="${HARNESS_MULTI//,/ }"
IFS=' ' read -ra _h <<< "$HARNESS_MULTI"
for _x in "${_h[@]}"; do
  case "$_x" in
    opencode|claude|codex|gemini) SELECTED_HARNESS+=("$_x") ;;
    *) echo "error: unknown harness '$_x' (opencode|claude|codex|gemini)" >&2; exit 2 ;;
  esac
done
case "$HERDR_SKILL" in
  manual|vendor) ;;
  *) echo "error: --herdr-skill must be manual or vendor" >&2; exit 2 ;;
esac

if [[ "$HERDR_SKILL" == manual && "${RUN_HERDR:-0}" -ne 1 ]]; then
  for h in "${SELECTED_HARNESS[@]}"; do
    echo "herdr skill: install it yourself with: herdr integration install $h"
  done
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
      ' "$file" > "$file.tmp" || { rm -f "$file.tmp" "$current"; echo "  error: block rewrite failed: $file" >&2; FAILED=1; return 1; }
      mv "$file.tmp" "$file"
      echo "  updated block ($VERSION): $file"
    fi
    rm -f "$current"
  else
    { echo; echo "$BLOCK_BEGIN"; cat "$content"; echo; echo "$BLOCK_END"; } >> "$file"
    echo "  appended block: $file"
  fi
}

# ============================================
# Per-harness install
# ============================================
run_herdr_integration() { # <harness>
  local h="$1"
  echo "herdr skill: running: herdr integration install $h"
  if herdr integration install "$h"; then
    echo "  herdr skill installed for $h"
  else
    echo "  warn: herdr integration install $h failed — run it yourself later" >&2
  fi
}

SUMMARY_SKIPPED=()

for H in "${SELECTED_HARNESS[@]}"; do
  echo "==> $H"

  if [[ "$H" == opencode ]]; then
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
  else
    case "$H" in
      claude) BLOCK_FILE="$ROOT/.claude/CLAUDE.md" ;;
      codex)  BLOCK_FILE="$ROOT/.codex/AGENTS.md" ;;
      gemini) BLOCK_FILE="$ROOT/.gemini/GEMINI.md" ;;
    esac
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

  if [[ "${RUN_HERDR:-0}" -eq 1 ]]; then
    run_herdr_integration "$H"
  elif [[ "$HERDR_SKILL" == manual && "$INTERACTIVE_USED" == 1 ]]; then
    SUMMARY_SKIPPED+=("$H")
  fi
done

[[ "$FAILED" -eq 0 ]] || exit 1
echo "done ($MARKER)."

for h in "${SUMMARY_SKIPPED[@]:-}"; do
  [[ -z "$h" ]] && continue
  echo "herdr skill not installed — run: herdr integration install $h"
done
