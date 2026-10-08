| Case | Exit | Result | permission_denials |
| --- | --- | --- | --- |
| ask-plain | 0 | E1 ask answer: none (AskUserQuestion isn't available in this session, so no question was asked) | — |
| ask-prompts-none | 0 | E1 ask answer: none (AskUserQuestion tool unavailable in this non-interactive session; ToolSearch found no match) | — |
| ask-dontask | 0 | E1 ask answer: none (AskUserQuestion tool unavailable in this session; ToolSearch returned no match) | — |
| perm-plain | 0 | 1. Succeeded: the Bash probe wrote `probe 1` to `solokit-e1-inline/probe.json`. 2. Not run: the AskUserQuestion tool isn't available in this session, so no ques | Write |
