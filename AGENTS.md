# AGENTS.md

## Working here

- Read [FEATURE-MAP.md](FEATURE-MAP.md) first to find the file and function a task touches; update it when you add or move a file or a major function.
- Work on `main` in the one checkout, `~/sites/agent-ide`, with jj: no branches, worktrees or copies of the repo, `/tmp` included. Every thread shares it, and several agents running jj at once trip over each other, so workers don't touch jj beyond reading (`jj st`, `jj diff`, `jj log`): edit, check, then report the paths you changed and a one-line commit message. The lead commits and pushes. Working alone with no lead, commit only your own paths and push.
- Use agent-ide the way a person would: `node scripts/try.js &` starts a scratch server with a scripted bot and an answered thread, and prints its address and the `kill` that stops it. Open it with `agent-browser --session <yours> open <url>&chat`; without `&chat` the page opens on the walkthrough. Send as a person does: `fill textarea "<text>"` then `press Enter`; the bot's `slow` runs a 5-second tool, so there's a live run to watch. Read back with `snapshot` or one `eval` of `document.querySelector('.thread').innerText`; open the newest run by clicking `li.turn:last-of-type summary` (its steps aren't in `innerText` until it's open). Check following the bottom with one `eval` of `scrollHeight - scrollTop - clientHeight` on the list. The server reads the client's files at startup, so restart it after each edit. For real data, `PORT=<free> DB_PATH=<your copy>.sqlite node server.js` from the checkout, a copy of `agent-ide.sqlite` if you need Oskar's threads. Never touch Oskar's own server on :3000, never kill by pattern, and don't build proxies, harnesses or helper scripts: if agent-ide plus agent-browser can't show it, stop and ask. For what a page fetches, hears on its socket, or stalls on, open it with `--init-script <repo>/scripts/page-spy.js` (an absolute path) and read `spy` back with `eval`.
- Test in proportion. A style, copy or layout tweak gets one look in the browser, or none when it's trivial. Logic runs the examples it touches. Server behaviour and contract changes get an example that fails on the old code first (say so) and the full suite. If a check fails twice, stop and report. When you had to work something out about checking that this guide should have told you, say it in one line of your report; the lead adds it here. A model check uses the scripted bot, or `gpt-6-luna:low@oskar` when it needs a real one.
- `pnpm install --frozen-lockfile` in a fresh checkout; leave package.json and the lockfile alone unless the task is about dependencies. After packaging changes, prove npm and npx installs; Chord's optional `ws` peer must fit the root range.

## What to build

- A change serves a promise in [apps/client/client.html](apps/client/client.html), or it needs a chat with Oskar. When an idea looks wrong, Oskar's included, argue before building.
- New features are modules, off by default.
- A thread's contract (its entries, their data, what the API returns) and how the client shows it are two decisions. A UI wish is solved in the client from existing entries; change the contract only on purpose, in its own commit, with the README and an example.
- Don't over-fix. A rare failure that would need a new store, task layer or journal stays a known gap, written on its issue.
- Keep client.html and the README saying what the code does. Docs and UI copy read like a person talking.

## Words and names

- The README says what each thing is; use its words, one per concept. A thread has one agent whose model, thinking and runner change in place; only bots have names.
- A name says what it holds and stays the same in every layer, so `rg` finds the whole path (a `To` is `to`). No one-letter names, but `_` and memory's stored `l`, `i` and `n`.

## Code

- Prove logic in `examples/`, one file per idea, through the API, socket or CLI, never server internals. `examples/00-the-api.js` is the README's walkthrough: change both together. No unit or UI tests, no TypeScript, no build step, no migrations or shims.
- Durability, ordering, retries and cancellation are Pi Durable's: find its primitive before writing your own. A tool's cancellation is `execute`'s third argument's `abortSignal`; pass it through runner calls and settle locally.
- In a Pi commit, `submit(tx, ...)` comes before table writes; after the first write it can't scan entries or snapshot. A snapshot inside a commit deadlocks silently. Copy document values before they leave the commit.
- Pi forks restore `pi.agent` at the fork entry, so the creating commit applies the thread's tools and identity without replacing the inherited model, thinking or folder.
- One web client: Solid 2, no build step, in apps/client. Read `CHEATSHEET.md` and `skills/solid-2.0/SKILL.md` in node_modules/solid-js first; fix `[CODE]` console warnings with `skills/reactivity-diagnostics/SKILL.md`. In templates, wrap live values in `() =>` and give callbacks an argument. Every bare import in the import map is a root dependency.
- Resolve installed packages (`import.meta.resolve`), never assume `<app>/node_modules`.
