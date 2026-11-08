# agent-ide

Threads for you and your agents, on your own machines. One server keeps every thread; runners connect your machines to it, each with its model logins and a folder for agents to work in. It's built on [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable) to show how little that takes: a restart or a stop loses nothing.

What it promises is on [apps/client/client.html](apps/client/client.html), the page every server serves at `/`. The code is the truth, and [examples/](examples) shows each idea working.

## Try it

You need Node.js 24+ and [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) logged in: run `pi` and `/login` once. Then, in the folder you want agents to work in:

```sh
npx github:oskarrough/agent-ide
```

Open the address it prints and the page walks you through it.

From a clone it's `pnpm install --frozen-lockfile && node server.js`. `pnpm examples` runs every example; `node examples/05-fork.js` runs one.

## Settings

Settings live in `agent-ide.json` in the folder you start in. The page edits them, but only on the server's own machine: open settings beside the runners, change things, save, and the server restarts itself without losing anything.

A few environment variables win over the file:

```sh
HOST=0.0.0.0 PORT=3001 node server.js      # reachable from other machines
RUNNER=~/code node server.js               # agents work in another folder; RUNNER=0 for none
MODULES=+web-search,-talk node server.js   # switch modules on or off
DB_PATH=other.sqlite node server.js        # another store
RESTART_LIMIT=2 node server.js             # work cut off by this many crashes in a row ends; 5 unless set
```

The log sits next to the store, in `agent-ide.log`.

## Another machine

Start the server with `HOST=0.0.0.0`, open its page on that machine, and click "Add runner". Run the command it gives you on the other machine, in the folder agents should work in. Keep that command private, it holds the runner's key. `node runner.js --help` lists the rest.

There are no accounts: anyone who can reach the server can read, post as anyone, and put its runners to work. Keep it on a trusted network. [Tailscale](https://tailscale.com) is the easy one:

```sh
npx github:oskarrough/agent-ide
tailscale serve 3000
```

Now open `https://<your-machine>.<your-tailnet>.ts.net` on your phone.

## The words

One word per thing.

- **Server**: the one process you start. It keeps every thread and every agent's conversation in one SQLite file. One server is one world.
- **Runner**: connects a machine to the server, offering its folders and the model logins pi has there. Agents reach nothing outside those folders. Whoever connects a runner pays for the thinking on it; the server holds no logins.
- **Agent**: a model, how hard it thinks, and the runner it works on, written `sonnet:high@laptop`. Every part is optional; `laptop` alone is that runner's default model. Each thread has one. Change its model or runner whenever you like and it keeps the conversation. It has no name.
- **Thread**: what people, one agent and any bots write to each other. _Hands off_ takes away its agents' write, edit and bash, so every change goes through a thread.
- **Bot**: one name in many threads, with a home thread, the agent it joins as, and instructions. Only bots have names.
- **Client**: whatever you look through: the web page, the CLI, a Matrix room. They all speak the same API and store nothing.
- **Module**: a feature you can switch on or off. Each module file's first lines say what it does and how to set it.

A **conversation** is one agent's own context: what it was handed, its tool calls and its answers.

## How it behaves

- An agent gets everything it hasn't seen yet in one go, and only its final answer comes back to the thread. Its tool calls stay in its own conversation, where anyone can read them.
- Threads talk like email. An agent asks with `post`: with no thread, it starts a child holding only the question; given a thread, it asks whoever is there. The answer goes back once to the asking thread. Nothing else crosses.
- Bots answer when asked, by name or by @mention. A bot can ask another bot the same way.
- A person's message is an instruction, an agent's is a colleague's report or request. Nobody can fake a speaker.
- A fork copies a thread and its agents' conversations at one message. A stop posts nothing.

## Modules

On by default: talk, status, context, bots, director and memory. Off: auto-title, web-search and matrix. The details are at the top of each file in [modules/](modules); [FEATURE-MAP.md](FEATURE-MAP.md) says where everything else lives.

- **talk** gives agents `post` and `threads`, to ask other threads and read them.
- **memory** writes one short line per message, so agents read the lines instead of every word, and compact into them when context gets long. Threads with a bot in them remember.
- **director** asks the bots a message @mentions, one after another. It can also pick who answers when nobody's named.
- **bots** gives you bots.
- **context** hands agents the AGENTS.md and skills in their folder, the way pi does.
- **status** shows what agents are doing on a runner's terminal.
- **auto-title** turns a thread's first message into a short title.
- **web-search** gives agents a `web_search` tool.
- **matrix** makes Matrix rooms into threads.

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

A message's `to` says whom it asks: an agent like `sonnet@laptop`, a bot's name, or `null` for nobody. Leave it out and it asks whoever the thread asked last. A body starting with `$ ` runs that command on the runner instead.

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

Modules add their own routes under `/api/<module>`. The routes are in `server.js`, the runner protocol in [remote.js](remote.js).

The CLI is the same API from a terminal:

```sh
node cli.js post "hello" --to sonnet@laptop    # prints the answer as it lands
node cli.js threads
node cli.js read 3
node cli.js wait 3                             # waits for its agents, then prints the answers
node cli.js stop 3
```

`node cli.js --help` has the rest.
