# agent-ide

Threads for you and your agents, on your own machines. One server keeps every thread; runners connect your machines to it, each with its model logins and a folder for agents to work in. It's built on [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable) to show how little that takes: a restart or a stop loses nothing.

What it promises, the words it uses and its principles are in [apps/client/client.html](apps/client/client.html), the page every server serves at `/`. The code is the truth, and [examples/](examples) shows each idea working.

## Try it

```sh
npx github:oskarrough/agent-ide
```

Its agents work in the folder you start it in, as a runner named after this machine, and think with the models [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) is logged into there, so run `pi` and `/login` once first. Open the address it prints and the page walks you through it. It needs Node.js 24+.

From a clone, `npm install && node server.js` does the same; for development, `pnpm install --frozen-lockfile`. `pnpm examples` runs every example, each with its own server and runner, and `node examples/05-fork.js` runs one. The `real-model` ones use your pi login, so they run only on their own or with `REAL=1`.

## Running it

```sh
node server.js
```

Its settings live in `agent-ide.json` in the folder you start it in, and the page changes them: open settings beside the runners, switch modules on or off, pick memory's model, and save. The server writes the file and restarts itself, losing nothing; where the runtime can't restart in place, the page says it stopped and you start it again. Only the server's own machine can change them; elsewhere the page shows them read-only.

talk, status and context are on by default, the rest off; each module file's first lines say what it does. Memory has each thread's own agent write its lines, unless you pick one model for all. In the file that reads `{"modules": ["+memory", "-status"], "memory": {"model": "haiku@desk"}}`; bare names replace the whole list.

Environment variables override the file:

```sh
HOST=0.0.0.0 PORT=3001 node server.js   # reachable from other machines
RUNNER=~/code node server.js            # agents work in another folder; RUNNER=0 connects none
MODULES=+search,-talk node server.js    # modules on (+name) or off (-name)
MEMORY_MODEL=haiku@desk node server.js  # one model writes every thread's memory
DB_PATH=other.sqlite node server.js     # another store
```

## Another machine

Start the server with `HOST=0.0.0.0`, open its page on the server's own machine through localhost, and click "Add runner". Run the command it gives you on the other machine, in the folder agents should work in. The command holds the runner's key, so keep it private; a new command for the same name replaces the old key. `node runner.js --help` lists the runner's flags, like `--read-only` and `--owner`. Both machines need to reach each other: the same network, or [Tailscale](https://tailscale.com).

Only the server's own machine can mint or revoke runner keys, and other websites can't write to the server, even on loopback. People have no accounts: anyone who can reach the server can read, post as anyone and ask its runners to work. Keep it on a trusted network.

## The API

Everything the page does, you can do with a few requests. Say who you are with `x-user`:

```sh
api() { curl -s -H 'x-user: oskar' -H 'content-type: application/json' "localhost:3000/api/$1" ${2:+-d "$2"}; }

api threads '{"title": "hello"}'                                # → {"id": 3}
api threads/3/entries '{"body": "what machine is this?", "to": "sonnet@laptop"}'
api threads/3                                                   # the thread and its messages so far
api threads/3/entries '{"body": "and now?", "to": "opus:high@laptop"}'   # same agent, new model
api threads/3/fork '{"at": 5}'                                  # a new thread from message 5
api threads/3/stop '{}'
```

To watch a thread live, open `/ws` and send `{"watch": 3}`. You get its new messages and who's in it as they happen, and each agent's live work (the tool it's in, the words it's writing). Every other change arrives as `{}`, which means "fetch the list again".

Four ideas carry it:

- A thread has one agent, plus any bots. A message's `to` says whom it asks: a recipe like `sonnet:high@laptop` or `{runner, model, thinkingLevel?, dir?}` for the thread's agent, a bot's name, or `null` for nobody. Left out, it asks whom the thread asked last. A recipe starts the agent, or switches the one there in place, keeping its conversation; it's told when it moves runner or folder. `ada=sonnet@laptop` switches the bot ada the same way. From another thread, `12` reaches thread 12's agent and `12/ada` a bot there.
- A message is a Pi entry, `{id, kind: "agent-ide.message", conversationId, byTaskId?, data}`, with `data` as `{author, body, to?, images?, from?, re?, answer?, error?, shell?}`. A body starting with `$ ` runs a command on the runner it's sent to, and `shell` holds what it printed.
- Threads, agents, runners and bots each carry one `status`: `working`, `blocked` while its runner is offline, or `idle`. An idle thread says `done` or `error` until you read its answer.
- Send the same `requestId` again after a dropped response and you get the first result back.

```
GET    /api/server                         its modules, those off, and whether you may add runners
GET    /api/runners                        every runner holding a key, connected or not
POST   /api/runners {name}                 a key, and the command that connects it
DELETE /api/runners/:name                  takes its key away
GET    /api/threads
POST   /api/threads {title, parent?, tools?, requestId?}
GET    /api/threads/:id                    the thread, its messages and who's in it
DELETE /api/threads/:id                    hides it
POST   /api/threads/:id/entries {body, to?, images?, steer?, requestId?}   images as pi's ImageContent, base64
POST   /api/threads/:id/fork {at, title?}
POST   /api/threads/:id/title {title}
POST   /api/threads/:id/tools {tools}      as pi --tools takes them
POST   /api/threads/:id/read
POST   /api/threads/:id/stop
GET    /api/conversations/:id              an agent's own conversation, tool calls and all
```

A module can add routes under `/api/<module>` and `/api/threads/:id/<module>`. Runners speak the protocol in [remote.js](remote.js).

The CLI is the same API from a terminal:

```sh
node cli.js post "hello" --to sonnet@laptop    # prints the answer as it lands; --thread 3 to continue one
node cli.js threads
node cli.js read 3
node cli.js stop 3
node cli.js key desk                           # a runner key, on the server's machine
node cli.js revoke desk
```

`node cli.js --help` has the rest, like `--server`, `--as` and `--thinking`.
