# AGENTS.md

- A change serves one of the promises in [apps/client/client.html](apps/client/client.html), or it requires a chat with Oskar. When a better design breaks a principle, or an idea looks wrong, Oskar's included, argue before building.
- Use the words client.html uses, one per concept. Fewer concepts beats fewer lines.
- Durability, ordering, retries and cancellation are Pi Durable's: find its primitive before writing your own.
- New features are modules, off by default.
- Keep client.html and the README saying what the code does high level.
- Prove things in `examples/`, one file per idea. No unit tests, no TypeScript, no build step, no migrations or shims.
- Check UI changes in a browser: `agent-browser open <url>` with `server.js` running.
