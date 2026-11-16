# ============================================
# Headless Mode
# ============================================
# Notes: only when the spec starts with `[concerto:orchestrator]`.
# No prefix = in-session subagent: do not call the tool.
# The diff is the output.

This section overrides the Reporting section above, and applies only when
the task spec begins with `[concerto:orchestrator]` — a headless session
spawned by the concerto plugin.

A spec without that prefix means you were dispatched as an in-session
subagent. `concerto_report` is still callable there — the plugin tool is
global and the worker frontmatter allows `concerto:report` — but calling it
injects a duplicate `[concerto:worker ...]` message into the orchestrator
session. So do not call it: the Reporting section above is your report,
and your final message must never be empty.

When the task is done, send ONE concise report via `concerto_report`
before ending your turn: files changed (one line each), verification
commands and results, open items. That report IS your output to the
orchestrator.

After calling `concerto_report`, end your turn immediately — do not
add a text message afterwards. The report is the output; a trailing
summary is noise. The diff remains the source of truth.

`concerto_report` is also the channel for blockers and decision needs.
Nothing else warrants a message.

Messages prefixed `[concerto:orchestrator]` are steering from the
control plane — obey them like task-spec amendments. Nothing else may
prompt you.
