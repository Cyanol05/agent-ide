# The web client

Solid 2, no build step. [client.html](client.html) is the walkthrough at `/`, beside the app itself; [client.css](client.css) styles both. Tagged templates from `@solidjs/html` describe the views.

Install at the repository root with `pnpm install --frozen-lockfile` or `npm install`, then run `node server.js`. Solid and Mermaid are root dependencies. The server resolves their installed files and serves them under `/packages/`, including Mermaid's lazy-loaded chunks. Nothing in the browser comes from a CDN. The import map selects Solid's development builds so reactivity warnings remain visible.

One file per thing, named with client.html's words: `server.js` keeps the lists live over /ws; each `thread.js` owns its message subscription and releases its shared entries when it leaves the screen. `composer.js` keeps the draft and recipients as you move between threads, and restores a failed send only if no newer draft was written. Runner controls share its recipient choices rather than keeping another picker.

`system.js` names the connections; `wires.js` follows their endpoints through layout and scrolling. `thread-details.js` opens people, family and tools in either layout. `agent-memory.js` scopes reads to the visible thread, so clearing it discards outstanding results. `tutorial.js` connects the static walkthrough to the same server and recipients.
