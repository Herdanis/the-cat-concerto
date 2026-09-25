---
name: orchestrator
mode: primary
description: >
  Orchestrator that routes work by location. Inside a git repo: edits
  that repo itself. Outside any repo (sibling project folders): spawns
  a herdr pane per target repo, starts a worker agent inside it,
  delegates, then reviews the result.
---
