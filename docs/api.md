# API and CLI

Everything the page does, you can do with a few requests. Say who you are with `x-user`:

```sh
api() { curl -s -H 'x-user: oskar' -H 'content-type: application/json' "localhost:3000/api/$1" ${2:+-d "$2"}; }

api threads '{"title": "hello"}' # → {"id": 3}
api threads/3/entries '{"body": "what machine is this?", "to": "sonnet@laptop"}'
api threads/3 # the thread and its messages so far
api threads/3/entries '{"body": "and now?", "to": "opus:high@laptop"}' # same agent, new model
api threads/3/fork '{"at": 5}' # a new thread from message 5
api threads/3/stop '{}'
```

A message's `to` says whom it asks: an agent like `sonnet@laptop`, a bot's name, or `null` for nobody. Leave it out in a group (the thread's agent plus bots, at least two) and the director picks who answers, or nobody; people don't count. An `@name` mention asks that bot for this message only. Failed picks ask the thread's agent and record the failure in `picked`; without a thread agent, nobody is asked. Solo chats and commands ask whoever the thread asked last. A body starting with `$ ` runs that command on the runner instead.

To watch a thread live, open `/ws` and send `{"watch": 3}`. You get new messages and each agent's work as it happens; a bare `{}` means "fetch the list again".

```
GET    /api/server                     modules, settings, whether you may add runners
GET    /api/runners
POST   /api/runners {name}             a key, and the command that connects it
DELETE /api/runners/:name
GET    /api/threads
POST   /api/threads {title, parent?, tools?}
GET    /api/threads/:id
GET    /api/threads/archived
POST   /api/threads/:id/archive {archived}
POST   /api/threads/:id/entries {body, to?, images?, steer?}
POST   /api/threads/:id/fork {at, title?}
POST   /api/threads/:id/title {title}
POST   /api/threads/:id/tools {tools}  as pi --tools takes them
POST   /api/threads/:id/read
POST   /api/threads/:id/stop
POST   /api/threads/:id/compact
GET    /api/conversations/:id          an agent's own conversation, tool calls and all
```

Modules add their own routes under `/api/<module>`. The routes are in `server.js`, the runner protocol in [remote.js](../remote.js).

The CLI is the same API from a terminal:

```sh
node cli.js post "hello" --to sonnet@laptop    # prints the answer as it lands
node cli.js threads
node cli.js read 3
node cli.js wait 3                             # waits for its agents, then prints the answers
node cli.js stop 3
```

Run from an agent's own shell, `post` writes as that agent (its model and thinking, like `sonnet:high`), whatever its model; anywhere else it writes as you.

A new thread prints `thread N` on stdout, followed by any answers; progress and errors go to stderr. To capture just its id without waiting:

```sh
thread=$(node cli.js post "hello" --to sonnet@laptop --no-wait)
node cli.js wait "${thread#thread }"
```

`node cli.js --help` has the rest.

## Server settings

The server's address and data path are set in the environment, not in `ade.json`:

```sh
HOST=0.0.0.0 npx github:oskarrough/ade  # open the printed address on your phone or another machine
PORT=3001 npx github:oskarrough/ade     # a fixed port; otherwise the first free one from 3000
DB_PATH=other.sqlite npx github:oskarrough/ade
```

These win over the file; leave them unset to choose from the page.

```sh
MODULES=+web-search,-talk npx github:oskarrough/ade
MEMORY_MODEL=sonnet@laptop npx github:oskarrough/ade
```

From a clone, use `node server.js` in place of `npx github:oskarrough/ade`.

Threads and conversations live in `~/.config/ade/ade.sqlite`, with the server's output in `ade.log` beside it, so every folder you start in sees the same threads. `DB_PATH` moves all three: `other.sqlite` logs to `other.log` and reads `ade.json` from its own folder.

`--no-runner` starts the server without connecting this machine as a runner.
