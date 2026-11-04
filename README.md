# agent-ide

A small agent IDE on [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable), built to show how little it takes. One server keeps every thread. Runners connect your machines to it, with their model logins and a folder. Runs with Node.js 24+. The client uses Solid 2, with no build step; its code and Mermaid diagrams are served locally.

The words it uses, how it fits together and its principles: [apps/client/client.html](apps/client/client.html), the page every server serves at `/`, beside the app itself. The code is the truth, and [examples/](examples) shows each idea working.

## Try it

```sh
npx github:oskarrough/agent-ide
```

Its agents work in the folder it starts in, as a runner named after this machine. They think with the models [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) is logged into there, so run `pi` and `/login` once first. From a clone, `npm install && node server.js` does the same; for development, use `pnpm install --frozen-lockfile`. Open the address it prints and the page walks you through it.

`pnpm examples` runs every example, each with its own server and runner; `node examples/05-fork.js` runs one. The `real-model` ones use your pi login, so they run only on their own or with `REAL=1`.

## Running it

```sh
HOST=0.0.0.0 PORT=3001 node server.js   # reachable from other machines
RUNNER=~/code node server.js            # work in another folder; RUNNER=0 connects none
MODULES=+search,+bots node server.js    # +name and -name change the defaults; each module's top says how it works
MODULES=+memory MEMORY_MODEL=haiku@desk node server.js   # memory needs an agent to write its lines
DB_PATH=other.sqlite node server.js     # another store

node cli.js key desk                    # on the server's machine, via localhost
node cli.js post "hello" --to sonnet@laptop
node cli.js threads | runners | read 3 | stop 3
```

To connect another machine, start the server with `HOST=0.0.0.0`, open its page through localhost on the server's own machine, and click “Connect a runner”. Run the command it gives you on the other machine, in the folder agents should work in. It holds the runner's key, so keep it private; a new command for the same name replaces the old key. `node runner.js --help` lists the runner's flags, like `--read-only` and `--owner`.

Only localhost on the server's own machine can mint or revoke runner keys. Other websites cannot write to this server, even on loopback. People have no keys or accounts: anyone who can reach the server can read, post as anyone and ask its runners to work. Keep it on a trusted network.

## API

Everything the client does goes through [server.js](server.js)'s `routes`, with `/ws` pushing changes. Send `x-user: name` to say who you are.

```
GET    /api/server
GET    /api/runners
POST   /api/runners {name}                 a key and the command that connects it
DELETE /api/runners/:name                  takes its key away
GET    /api/threads
POST   /api/threads {title, parent?, tools?, requestId?}
GET    /api/threads/:id                    the thread and its entries
DELETE /api/threads/:id                    hides it
POST   /api/threads/:id/entries {body, to?, steer?, requestId?}
POST   /api/threads/:id/fork {at, title?}
POST   /api/threads/:id/tools {tools}      as pi --tools takes them
POST   /api/threads/:id/read
POST   /api/threads/:id/stop
GET    /api/conversations/:id              an agent's own conversation, tool calls and all
```

A module can add `/api/<module>` and `/api/threads/:id/<module>`. Send the same `requestId` again after a dropped response and you get the first result back.

A message's `to` is a list, or one: an agent's name in the thread, a recipe like `sonnet:high@laptop` or `{runner, model, thinkingLevel?, dir?, name?}`, or `null` for nobody. Left out, it asks whom the thread asked last. A body starting with `$ ` runs a command on the one runner it's sent to.

An entry is Pi's own, `{id, kind: "agent-ide.message", conversationId, byTaskId?, data}`, and `data` is a message:

```
{ author, body, to?: [name], from?: threadId, re?: [entryId], answer?: {conversation, entry},
  error?: true, shell?: {runner, code, stdout, stderr, error?} }
```

Runners speak the protocol in [remote.js](remote.js).
