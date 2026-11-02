# client-solidjs

A proof: is the web client clearer in Solid 2 (RC)? So far it shows the server and its thread list, live, at `/solid`, beside the real client at `/`. No build step: tagged templates from `@solidjs/html`, and server.js serves Solid's own files from node_modules through the import map in index.html.

    pnpm install       # at the repo root; this is a workspace package
    node server.js     # then open http://localhost:3000/solid

One file per thing, named with client.html's words: `server.js` is what the server says, kept live over /ws; `thread-list.js`, `dot.js` and `client.js` draw it. The stylesheet is apps/client/client.css.
