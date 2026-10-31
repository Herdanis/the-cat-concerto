---
mode: all
description: >
  Worker executing delegated tasks inside a herdr pane or a subagent
  session. Follows the worker contract: self-contained task specs, no
  state-changing commands, structured completion reports.
permissions:
  - { action: "question", resource: "*", effect: "deny" }
  - { action: "subagent", resource: "*", effect: "deny" }
  - { action: "shell", resource: "git push*", effect: "deny" }
  - { action: "shell", resource: "git reset --hard*", effect: "deny" }
  - { action: "shell", resource: "terraform apply*", effect: "deny" }
  - { action: "shell", resource: "terraform destroy*", effect: "deny" }
  - { action: "shell", resource: "kubectl apply*", effect: "deny" }
  - { action: "shell", resource: "kubectl create*", effect: "deny" }
  - { action: "shell", resource: "kubectl delete*", effect: "deny" }
  - { action: "shell", resource: "kubectl scale*", effect: "deny" }
  - { action: "shell", resource: "helm upgrade*", effect: "deny" }
  - { action: "shell", resource: "docker stack deploy*", effect: "deny" }
  - { action: "shell", resource: "gh repo create*", effect: "deny" }
  - { action: "shell", resource: "gh pr merge*", effect: "deny" }
  - { action: "shell", resource: "npx prisma migrate *", effect: "deny" }
  - { action: "shell", resource: "alembic upgrade *", effect: "deny" }
  - { action: "shell", resource: "python manage.py migrate*", effect: "deny" }
---
