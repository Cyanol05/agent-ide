# AGENTS.md

- A change serves one of the promises in [apps/client/client.html](apps/client/client.html), or it requires a chat with Oskar. When a better design breaks a principle, or an idea looks wrong, Oskar's included, argue before building.
- Use the words client.html uses, one per concept. Fewer concepts beats fewer lines.
- Durability, ordering, retries and cancellation are Pi Durable's: find its primitive before writing your own.
- A tool's cancellation comes from `execute`'s third Context argument: pass its `abortSignal` through runner calls, and settle cancellation locally without waiting for the runner's reply.
- Use `pnpm install --frozen-lockfile` in a fresh worktree; `bun install` rewrites package.json and adds bun.lock.
- New features are modules, off by default.
- Keep client.html and the README saying what the code does high level.
- Prove things in `examples/`, one file per idea. No unit tests, no TypeScript, no build step, no migrations or shims.
- Pi forks restore `pi.agent` at the fork entry, so apply the thread's current tools and new identity in the creating commit without replacing the inherited model, thinking or folder.
- Check UI changes in a browser: `agent-browser open <url>` with `server.js` running.
- Solid 2 is not Solid 1: read `CHEATSHEET.md` and `skills/solid-2.0/SKILL.md` in apps/client-solidjs/node_modules/solid-js before writing the Solid client, and fix any `[CODE]` warning in the browser console with `skills/reactivity-diagnostics/SKILL.md` there.
- The Solid client's import map names every package Solid imports bare, so each one, `@solidjs/signals` too, is a direct dependency of apps/client-solidjs.
- bb worktrees are plain git worktrees jj can't see: commit there with git, then move `main` and push with jj from the main checkout.
