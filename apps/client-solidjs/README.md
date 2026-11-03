# client-solidjs

A proof: is the web client clearer in Solid 2 (RC)? At `/solid`, open or start a thread, pick its recipients, read streaming replies and tool calls, fork a message, or stop its agents. Forks sit side by side with links both ways. The old client remains at `/`; runner cards, wires, bots, memory and the walkthrough are not ported yet. No build step: tagged templates from `@solidjs/html`, and server.js serves Solid's own files from node_modules through the import map in index.html.

    pnpm install       # at the repo root; this is a workspace package
    node server.js     # then open http://localhost:3000/solid

One file per thing, named with client.html's words: `server.js` keeps the lists live over /ws; each `thread.js` owns its message subscription, and `composer.js` keeps the draft and recipients as you move between threads. The stylesheet is apps/client/client.css.
