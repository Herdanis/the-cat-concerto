---
mode: all
description: >
  Worker executing delegated tasks — headless concerto session or
  herdr pane. Follows the worker contract: self-contained task
  specs, no state-changing commands.
permissions:
  - { action: "question", resource: "*", effect: "deny" }
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "concerto", resource: "*", effect: "deny" }
  - { action: "concerto", resource: "report", effect: "allow" }
---
