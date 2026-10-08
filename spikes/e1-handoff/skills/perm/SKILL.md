---
name: perm
description: Spike E1 permission probe. Only run when invoked explicitly.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

Do these steps in order, in this one turn. Do not skip a step, do not retry a step, and do not ask for anything else.

1. Run this exact command with the Bash tool:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs write 1 ${CLAUDE_PLUGIN_DATA}`
2. Ask one question with the AskUserQuestion tool: question "E1 perm: pick any option", header "E1", options "Alpha" and "Beta".
3. Run this exact command with the Bash tool:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/probe.mjs write 2 ${CLAUDE_PLUGIN_DATA}`
4. Use the Write tool (not Bash) to write the file `${CLAUDE_PLUGIN_DATA}/write-tool.json` with the content `{"written_by":"Write tool"}`.
5. Finish with one line per step: the step number and whether it succeeded, was denied, or asked for permission.
