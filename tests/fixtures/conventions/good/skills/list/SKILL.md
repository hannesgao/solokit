---
name: list
description: Fixture skill with allowed-tools as a YAML list at column 0.
allowed-tools:
- Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
- Bash(git status *)
---

Before anything else:

!`node ${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs --data ${CLAUDE_PLUGIN_DATA} read`
