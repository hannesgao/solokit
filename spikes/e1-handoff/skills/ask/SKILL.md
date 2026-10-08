---
name: ask
description: Spike E1 question probe. Only run when invoked explicitly.
disable-model-invocation: true
---

Ask exactly one question with the AskUserQuestion tool: question "E1 ask: which option?", header "E1", four options "One", "Two", "Three" and "Four". Do not ask in plain text and do not choose for the user.

Then reply with exactly one line: `E1 ask answer: <the label chosen>`. If the tool was unavailable or refused, reply with exactly one line: `E1 ask answer: none (<what happened>)`.
