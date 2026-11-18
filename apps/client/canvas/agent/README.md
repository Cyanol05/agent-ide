# tldraw's agent starter kit, the parts the canvas tools use

From [tldraw/agent-template](https://github.com/tldraw/agent-template) at `1e7c07eeb5c3e6a561328df3589b2f0c0e2ca556`, MIT (LICENSE.md here): its shape formats, the actions agents get with their sanitizers, the helpers they share, and its lints. Its agent loop, model providers, chat, todos and modes stay out; ade has its own.

The files keep upstream's paths and names, turned from TypeScript into plain JS, with `tldraw` and `zod` coming from `../tldraw.js` and `../zod.js`. Don't edit them here: refresh them with `scripts/vendor-canvas-agent.js`, which says how, and update the commit above. `actions.schema.json` is the actions' JSON schema the server offers agents with `canvas_act`, made by the same script.
