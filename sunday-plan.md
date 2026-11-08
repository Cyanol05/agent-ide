# Sunday plan

## v1, landed
- Packaging: npm/npx install clean, no ws warning.
- No runner: nothing hangs, picker offers to connect one.
- Status follows the Program Status Protocol.
- Your message appears on Enter, room left for the answer.
- Posts read "Messaged …"; failed post shows as a failed step.
- Bots and director on by default.

## v1, in flight
- Memory per thread: on by default in bot threads, `memory.threads` setting.
- Slash commands like /compact do nothing in a thread (#35).

## v1, Oskar
- Homepage copy against the README (Sol's list, thread 40837).
- Commit client and FEATURE-MAP edits.
- Publish: drop "private", version 0.1.0.
- Phone checks: top-bar blur, Send arrow, panel ×, Enter behavior.

## After v1
- Bench: scored scenarios on Luna low, not judged by eye.
- Memory notes, a folder per bot (#39).
- Trim the client: client.css ~3000 lines, client ~7300.
- Worker's CLI posts should show as the agent, not Oskar.
- Drop Claude cache_control retry once pi-claude-code#10 lands.
- The name: keep agent-ide for now.

