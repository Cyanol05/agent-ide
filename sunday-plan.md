# Sunday plan

## v1, landed
- Packaging: the package ships only the app; npm and npx install cleanly, with no ws warning.
- No runner attached: nothing hangs, and the model picker offers to connect one.
- Status follows the Program Status Protocol; a dropped runner shows error.
- Your message appears the moment you press Enter, with room left below it for the answer.
- Posts read "Messaged …"; a failed post shows as a failed step, not a pending ask.

## v1, in flight
- Bots and director on by default.
- Memory per thread: on in bot threads by default; setting `memory.threads` (bots, all, none) and a switch on each thread.

## v1, Oskar
- Homepage copy against the README (Sol's list in thread 40837).
- Commit the client and FEATURE-MAP edits.
- Publish: drop "private", version 0.1.0.
- Phone checks: top-bar blur, Send arrow, × on panels; does Enter add a newline or do nothing on touch?

## After v1
- A bench for the final test: does a cheap model reach for the right move at the right time? Five or so real scenarios (introduce yourself in a group chat, ask another thread, a side question returning home, recall from memory, search the web), run on Luna low and judged from the thread's text. Today we judge by eye, one test at a time.
- Memory notes: a folder per bot that persists (#39).
- Trim the client: client.css is about 3000 lines and the client about 7300; that's where v1.1's cuts are.
- A worker's CLI posts show as Oskar's; they should show as the agent.
- Drop the Claude cache_control retry once pi-claude-code#10 is fixed.
- The name. Keep agent-ide until a better one shows up in use.
