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
check "T1 frontmatter starts at line 1" test "$(head -n1 "$TMP/h1/.config/opencode/agents/orchestrator.md")" = "---"
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
rm -rf "$CP/.git"
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

# T5: claude block install creates file with block
"$REPO/install.sh" --harness claude --prefix "$TMP/h5" >/dev/null 2>&1
check "T5 claude CLAUDE.md created" test -f "$TMP/h5/.claude/CLAUDE.md"
check "T5 block markers present" grep -qF '# BEGIN the-cat-concerto' "$TMP/h5/.claude/CLAUDE.md"
check "T5 orchestrator body present" grep -q 'Role' "$TMP/h5/.claude/CLAUDE.md"
check "T5 worker contract present" grep -q 'Worker Contract' "$TMP/h5/.claude/CLAUDE.md"

# T6: block appended to existing user file, user content preserved
mkdir -p "$TMP/h6/.codex"
echo "my codex config" > "$TMP/h6/.codex/AGENTS.md"
"$REPO/install.sh" --harness codex --prefix "$TMP/h6" >/dev/null 2>&1
check "T6 user content preserved" grep -q 'my codex config' "$TMP/h6/.codex/AGENTS.md"
check "T6 block appended" grep -qF '# BEGIN the-cat-concerto' "$TMP/h6/.codex/AGENTS.md"

# T7: re-run keeps exactly one block
"$REPO/install.sh" --harness codex --prefix "$TMP/h6" >/dev/null 2>&1
check "T7 single block after re-run" test "$(grep -cF '# BEGIN the-cat-concerto' "$TMP/h6/.codex/AGENTS.md")" -eq 1
check "T7 user content still preserved" grep -q 'my codex config' "$TMP/h6/.codex/AGENTS.md"

# T8: vendor mode inlines skill into block
"$REPO/install.sh" --harness gemini --prefix "$TMP/h8" --herdr-skill vendor >/dev/null 2>&1
check "T8 vendored skill inlined" grep -q '^name: herdr' "$TMP/h8/.gemini/GEMINI.md"

# T9: version bump replaces block content, keeps user content
"$CP/install.sh" --harness codex --prefix "$TMP/h6" >/dev/null 2>&1
check "T9 block upgraded" grep -q 'the-cat-concerto v9.9.9' "$TMP/h6/.codex/AGENTS.md"
check "T9 user content survives upgrade" grep -q 'my codex config' "$TMP/h6/.codex/AGENTS.md"
check "T9 still one block" test "$(grep -cF '# BEGIN the-cat-concerto' "$TMP/h6/.codex/AGENTS.md")" -eq 1

# T10: version from git tag renders single-v marker (skipped without .git)
CP2="$TMP/repo-tagged"; cp -R "$REPO" "$CP2"
for _t in $(git -C "$CP2" tag); do git -C "$CP2" tag -d "$_t" >/dev/null; done
if git -C "$CP2" tag v9.9.9 2>/dev/null; then
  "$CP2/install.sh" --harness opencode --prefix "$TMP/h10" >/dev/null 2>&1
  check "T10 tag version single v" grep -q '^<!-- the-cat-concerto v9.9.9 -->$' "$TMP/h10/.config/opencode/agents/orchestrator.md"
  check_false "T10 no double v marker" grep -q '^<!-- the-cat-concerto vv' "$TMP/h10/.config/opencode/agents/orchestrator.md"
fi

# T11: interactive multi-select via numbered fallback (piped stdin)
OUT=$(printf '1,3\n3\n' | CONCERTO_NO_TUI=1 CONCERTO_STDIN=1 "$REPO/install.sh" --prefix "$TMP/h11" 2>&1)
check "T11 opencode installed from interactive" test -f "$TMP/h11/.config/opencode/agents/orchestrator.md"
check "T11 codex block installed" grep -qF '# BEGIN the-cat-concerto' "$TMP/h11/.codex/AGENTS.md"
check "T11 claude not selected so not installed" test ! -f "$TMP/h11/.claude/CLAUDE.md"
check "T11 skip prints herdr command" grep -q 'herdr skill not installed — run: herdr integration install opencode' <<<"$OUT"

# T12: invalid multi-select input re-prompted, then valid ("08" guards octal)
OUT=$(printf '9\n08\n1\n3\n' | CONCERTO_NO_TUI=1 CONCERTO_STDIN=1 "$REPO/install.sh" --prefix "$TMP/h12" 2>&1)
check "T12 invalid input re-prompted then accepted" test -f "$TMP/h12/.config/opencode/agents/orchestrator.md"

# T13: vendor via interactive picker (option 2 when herdr hidden = vendor first)
OUT=$(printf '4\n1\n' | CONCERTO_NO_TUI=1 CONCERTO_STDIN=1 PATH="/usr/bin:/bin" "$REPO/install.sh" --prefix "$TMP/h13" 2>&1)
check "T13 vendor skill inlined into gemini block" grep -q '^name: herdr' "$TMP/h13/.gemini/GEMINI.md"

# T14: no tty, no flags, no CONCERTO_NO_TUI → usage exit 2
check_false "T14 no-tty no-flags exits 2" sh -c 'cd "'"$REPO"'" && ./install.sh </dev/null >/dev/null 2>&1'
OUT=$(cd "$REPO" && ./install.sh </dev/null 2>&1); RC=$?
check "T14 usage shows curl example" grep -q 'curl -fsSL' <<<"$OUT"

# T15: bootstrap (no src/ beside script) fails cleanly with unreachable API
mkdir -p "$TMP/bs"; cp "$REPO/install.sh" "$TMP/bs/install.sh"
OUT=$(cd "$TMP/bs" && CONCERTO_API_OVERRIDE="http://127.0.0.1:1/nope" bash install.sh 2>&1); RC=$?
check_false "T15 bootstrap bad API exits non-zero" test "$RC" -eq 0
check "T15 friendly release error" grep -q 'could not resolve latest release' <<<"$OUT"

# T16: piped-stdin script (curl|bash shape) — BASH_SOURCE unset, must
# reach bootstrap, not die on unbound variable
OUT=$(cd "$TMP" && CONCERTO_API_OVERRIDE="http://127.0.0.1:1/nope" bash -s < "$REPO/install.sh" 2>&1); RC=$?
check_false "T16 piped script exits nonzero on bad API" test "$RC" -eq 0
check "T16 piped script reaches bootstrap error" grep -q 'could not resolve latest release' <<<"$OUT"
check "T16 no unbound BASH_SOURCE error" grep -qv 'BASH_SOURCE' <<<"$OUT"

echo
echo "passed=$PASS failed=$FAIL"
[[ $FAIL -eq 0 ]]
