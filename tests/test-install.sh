#!/usr/bin/env bash
# ============================================
# Installer test suite (prefix-based, no home writes)
# ============================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL - $1"; }
check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else fail "$desc"; fi
}
check_false() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$desc"; else ok "$desc"; fi
}

# T1: opencode fresh install with vendored skill
"$REPO/install.sh" --harness opencode --prefix "$TMP/h1" --herdr-skill vendor >/dev/null 2>&1
check "T1 opencode orchestrator agent" test -f "$TMP/h1/.config/opencode/agents/orchestrator.md"
check "T1 opencode worker agent" test -f "$TMP/h1/.config/opencode/agents/concerto-worker.md"
check "T1 vendored herdr skill" test -f "$TMP/h1/.config/opencode/skills/herdr/SKILL.md"
check "T1 orchestrator frontmatter" grep -q '^name: orchestrator' "$TMP/h1/.config/opencode/agents/orchestrator.md"
check "T1 version marker" grep -q '^<!-- the-cat-concerto v' "$TMP/h1/.config/opencode/agents/orchestrator.md"
check "T1 manual skill not installed" test ! -f "$TMP/h1/.config/opencode/skills/herdr/SKILL.md.nonexistent"

# T2: idempotent re-run is a no-op
S1=$(cksum "$TMP/h1/.config/opencode/agents/orchestrator.md" | cut -d' ' -f1)
OUT=$("$REPO/install.sh" --harness opencode --prefix "$TMP/h1" --herdr-skill vendor 2>&1)
S2=$(cksum "$TMP/h1/.config/opencode/agents/orchestrator.md" | cut -d' ' -f1)
check "T2 re-run reports already installed" grep -q 'already installed' <<<"$OUT"
check "T2 file unchanged" test "$S1" = "$S2"

# T3: newer version replaces agent file
CP="$TMP/repo-copy"; cp -R "$REPO" "$CP"
echo 9.9.9 > "$CP/VERSION"
"$CP/install.sh" --harness opencode --prefix "$TMP/h1" >/dev/null 2>&1
check "T3 newer version replaces" grep -q 'the-cat-concerto v9.9.9' "$TMP/h1/.config/opencode/agents/orchestrator.md"

# T4: foreign agent file refused, then forced
mkdir -p "$TMP/h4/.config/opencode/agents"
echo "my own agent" > "$TMP/h4/.config/opencode/agents/orchestrator.md"
check_false "T4 foreign file refused" "$REPO/install.sh" --harness opencode --prefix "$TMP/h4"
check "T4 refused file untouched" grep -q 'my own agent' "$TMP/h4/.config/opencode/agents/orchestrator.md"
"$REPO/install.sh" --harness opencode --prefix "$TMP/h4" --force >/dev/null 2>&1
check "T4 forced overwrite" grep -q 'the-cat-concerto v' "$TMP/h4/.config/opencode/agents/orchestrator.md"

echo
echo "passed=$PASS failed=$FAIL"
[[ $FAIL -eq 0 ]]
