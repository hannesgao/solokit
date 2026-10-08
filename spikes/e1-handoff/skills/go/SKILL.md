---
name: go
description: Spike E1 hand-off target. Writes a marker file and echoes its arguments. Only run when invoked explicitly.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/mark.mjs go`

Reply with exactly this one line and do nothing else:

E1: go skill expanded with args=<$ARGUMENTS>
