# ============================================
# Headless Mode
# ============================================
# Notes: you run as a headless session spawned by the concerto
# orchestrator. The diff is the output.

This section overrides the Reporting section above.

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
