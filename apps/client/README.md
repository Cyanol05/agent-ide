# The web client

Solid 2, no build step. [client.html](client.html) is the walkthrough at `/`, beside the app itself; [client.css](client.css) styles both. Tagged templates from `@solidjs/html` describe the views.

Install at the repository root with `pnpm install --frozen-lockfile` or `npm install`, then run `node server.js`. Solid and Pele are root dependencies. The server resolves their installed files and serves them under `/packages/`. Nothing in the browser comes from a CDN. The import map selects Solid's development builds so reactivity warnings remain visible.

One file per thing, named with client.html's words: `server.js` keeps the lists live over /ws; each `thread.js` owns its message subscription while on screen, and keeps the messages it has seen, so coming back to a thread shows them at once while it catches up. `composer.js` keeps the draft as you move between threads, but what you choose in the model picker stays with the thread you chose it in, since asking a thread's agent as another model switches it. You choose one model, plus any bots; in a bot's home, the picker sets the bot's model, and the bot's settings open the same picker. It restores a failed send only if the same thread is still open and the draft is empty. Runner controls change the same choice rather than keeping another picker.

[model-picker.js](model-picker.js) shares the model and thinking controls between the composer and settings; each caller owns its choice. Settings use [panes.js](panes.js) to open a detail inside the same popup. The list stays mounted, keeping its draft and scroll; Back restores focus, and Escape goes back before closing.

`system.js` names the connections; `wires.js` follows their endpoints through layout and scrolling. `thread-details.js` opens people, family and tools in either layout. `agent-memory.js` scopes reads to the visible thread, so clearing it discards outstanding results. `tutorial.js` connects the static walkthrough to the same server and model picker.
