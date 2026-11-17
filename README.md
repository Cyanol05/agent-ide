# ade

agent-ide is yet another chat app for working with agents.

Threads live on a server you own, and agents run on your own machines, in folders you choose. Built on [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable), so a restart or crash loses nothing.

So, what's different about this one? Not much, but it adds patterns I've found to prove themselves useful enough to write here:

Bots aka agents with a name, instructions and a hands-off home thread. Agents and bots can message each other. Bots remember long threads as short summary lines they can zoom back into. Threads are multiplayer and group chats as well, invite your bots.

## Try it

You need Node.js 24+, pnpm and [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) logged in: run `pi` and `/login` once with any provider. Then, in the folder you want agents to work in:

```sh
pnpm dlx github:oskarrough/ade
```

Open the server's URL for a walkthrough and the chat app. That's it.

Agents work in the folder you start in. To give them others, name each with `--dir`; threads start in the first:

```sh
pnpm dlx github:oskarrough/ade --dir ~/sites --dir ~/notes
pnpm dlx github:oskarrough/ade --no-runner   # don't connect this machine as a runner
```

Installed, the command is `ade`: `ade --dir ~/sites`, `ade runner …`, `ade post …`.

## Another machine

The other machine needs to reach the server. To let it connect over your network, start the server with:

```sh
HOST=0.0.0.0 pnpm dlx github:oskarrough/ade
```

Click "Add runner" on the page, or run this on the server's machine:

```sh
pnpm dlx github:oskarrough/ade key laptop
```

Either gives you a command to run on the other machine, in the folder agents should work in. Keep it private: it holds the runner's key. The runner saves that key in `~/.config/ade/` (or under `$XDG_CONFIG_HOME`) for later starts.

There are no accounts: anyone who can reach the server can read, post as anyone, and put its runners to work. Keep it on a trusted network. To use [Tailscale](https://tailscale.com) instead:

```sh
pnpm dlx github:oskarrough/ade
tailscale serve 3000
```

Open `https://<your-machine>.<your-tailnet>.ts.net` on the other machine or your phone.

## Settings

Settings live in `~/.config/ade/ade.json` (or under `$XDG_CONFIG_HOME`), wherever you start. For example, to turn web search on and talk off:

```json
{
	"modules": ["+web-search", "-talk"]
}
```

Use `+` and `-` to change the defaults; a list of bare names replaces them.

The server's address and data path are set in the environment, not the file:

```sh
HOST=0.0.0.0 pnpm dlx github:oskarrough/ade  # open the printed address on your phone or another machine
PORT=3001 pnpm dlx github:oskarrough/ade     # a fixed port; otherwise the first free one from 3000
DB_PATH=other.sqlite pnpm dlx github:oskarrough/ade
```

These win over the file; leave them unset to choose from the page.

```sh
MODULES=+web-search,-talk pnpm dlx github:oskarrough/ade
MEMORY_MODEL=sonnet@laptop pnpm dlx github:oskarrough/ade
```

From a clone, use `node server.js` in place of `pnpm dlx github:oskarrough/ade`.

Threads and conversations live in `~/.config/ade/ade.sqlite`, with the server's output in `ade.log` beside it, so every folder you start in sees the same threads. `DB_PATH` moves all three: `other.sqlite` logs to `other.log` and reads `ade.json` from its own folder.

## Modules

Everything is a module that you can turn on and off.

On by default: talk, status, context, bots, director, memory and auto-title.  
Off: web-search, matrix, pi-sessions and overview.

- **talk** gives agents `post` and `threads`, to ask other threads and read them. A thread answers the thread that started it on its own; anywhere else, an agent answers with `post`. A new `post` never needs a title: an omitted or blank title uses the first 60 characters of its trimmed body (or "An image" for an empty body), just like the client and CLI. This title stays with auto-title off, or is polished after the first answer with it on. Both tools accept a thread id (number or digit string) or an exact title in `thread`; digit strings always select an id, even if a thread has that title. A title that matches several threads fails and lists their ids.
- **memory** summarizes messages so agents can keep working in long threads. It's used by default in threads with bots; you can switch it on or off for any thread. Recorded lines can be loaded with `POST /api/threads/:id/memory {lines: [{id, n, text}]}`: each span covers `n` messages from `id` (aligned powers of two, within the thread); existing lines stay, and memory turns on without calling a model.
- **director** asks the bots a message @mentions, one after another. It can also pick who answers when nobody's named.
- **bots** lets you create named bots and give them instructions and a colour. A bot without a picked colour (`color`, a hue) gets one from the order bots were made. A bot rewrites its own instructions or model with its `bot` tool; that call's result keeps what it was before as `details.before`, `{instructions, model}`, so the thread can show old against new.
- **context** hands agents the AGENTS.md and skills in their folder, and the folder itself, the way pi does. A person's message that starts `/skill:name` reaches the agent as that skill's file, then the rest of the message, as pi expands it; the thread keeps it as typed, and an unknown name goes as typed. `GET /api/context?runner=&dir=` lists a folder's skills, `{skills: [{name, description}]}`.
- **status** shows what agents are doing on a runner's terminal.
- **auto-title** turns a thread's first message into a short title once it's answered. `POST /api/threads/:id/auto-title` writes a new one whenever you ask and answers with it, or with why it couldn't; a rename in the meantime wins.
- **web-search** gives agents a `web_search` tool.
- **matrix** makes Matrix rooms into threads.
- **overview** keeps a short page per thread that says where it stands: one sentence, then what waits on you, what's being worked on and what's done lately, one line each, linked to the messages behind them. A cheap model rewrites it from the page before and the messages since, only while someone has it open; its model is `overview.model`, else memory's, else the thread's agent with thinking off. `GET /api/threads/:id/overview` answers `{page, summary, waiting, open, through, writtenAt, writing}`, and with `?open` says someone's looking: a page that's behind catches up, and answers keep it current while the asking goes on. Behind means new messages, or Working naming a thread that has stopped. A link `#message-12` in the page is message 12, counting from 0. `POST {}` writes it now and answers once it's written, and `{fresh: true}` writes it from scratch. `GET /api/overview` gives each thread's `{summary, waiting, open}` by id. Agents read a page with the `overview` tool; in the client, Overview beside a thread's title opens it as a column, its sections and child threads grouped together as waiting on you, working, idle and done; a working line whose threads have stopped leaves Working. The column being open is what keeps the page written.
- **pi-sessions** moves threads to and from pi. Each agent's conversation is written as a pi session file you can `pi --resume`, and `node cli.js import <runner>` starts a new thread from a pi session. Nothing syncs after that.

For each module's settings, see the top of its file in [modules/](modules). A module there with `export const on = true` is on by default; a new file there is a new module.

## What's what

- **Server**: the one process you start. It keeps every thread and every agent's conversation in one SQLite file.
- **Runner**: connects a machine to the server, offering its folders and the model logins pi has there. Agents reach nothing outside those folders, except the runner's own temp folder, where a script's saved images go. The server holds no logins.
- **Agent**: a model, how hard it thinks, and the runner it works on, written `sonnet:high@laptop`. Every part is optional; `laptop` alone is that runner's default model. Each thread has one. Change its model or runner whenever you like and it keeps the conversation. It has no name.
- **Thread**: what people, one agent and any bots write to each other. _Hands off_ prevents its agents from editing files or running commands.
- **Bot**: one name in many threads, with a home thread, the agent it joins as, and instructions. Only bots have names.
- **Conversation**: what one agent has read, its tool calls and its answers.
- **Client**: the web page, the CLI or a Matrix room you use to read and write in threads; the server keeps the data.
- **Module**: a feature you can switch on or off. Each module file's first lines say what it does and how to set it.

## The API

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

Run from an agent's own shell, `post` writes as that agent (its model and thinking, like `sonnet:high`), whatever its model; anywhere else it writes as you.

A new thread prints `thread N` on stdout, followed by any answers; progress and errors go to stderr. To capture just its id without waiting:

```sh
thread=$(node cli.js post "hello" --to sonnet@laptop --no-wait)
node cli.js wait "${thread#thread }"
```

`node cli.js --help` has the rest.

## Scratch server

In a checkout, `node scripts/try.js` starts a disposable server and a real runner in your current folder. It uses `echo/try`, a scripted model that exercises the real tools, skills, AGENTS.md context and runner modules, without a model login. It writes `notes.md` in that folder. The printed `kill` command stops both processes.

Send `slow` to watch a five-second command, `post` to ask another thread, or `slow post` for both. Ada, Bram and Cleo answer with their name, persona and the messages they received. In a bot’s home, `bot <instructions>` changes its instructions. The simpler `echo/echo` model remains a text mirror.
