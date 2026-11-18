# ade

Ade is yet another app for working with agents.

> Threads live on a server you own, and agents run on the machines you want, in folders you choose.

The basics:

- one command to start anywhere: `npx github:oskarrough/ade`
- one command to let agents work on another machine
- threads survive crashes, restarts and reloads
- works with any model provider, via pi

I run it on my office computer, which is always on, at localhost:3000. That's all I need for daily work, and my laptop and home PC can join as runners when I want agents working there.

## Start

Install [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and log in: `pi`, then `/login` with any provider. Then, in the folder you want agents to work in:

```sh
npx github:oskarrough/ade
```

`pnpm dlx` and `bunx` work just as well, or fork/clone the repo and `npm link` (or `pnpm link`) it to get an `ade` command.

Open the address it prints for a walkthrough and the app.

Agents start in the folder you run it from; add more with `--dir ~/sites --dir ~/notes`, and threads start in the first. File tools stay inside these folders, but shell commands don't. Ade has no sandbox: doing one properly is hard, and a half-baked one would only make you feel safe.

To let agents work on another machine, click "Add runner" (or run `npx github:oskarrough/ade key laptop`) for the command to run there; keep it private, it holds a key. There are no accounts, so reach the server only over Tailscale: `tailscale serve <port>`, using the port ade printed. That's it.

## Settings

Settings live in `~/.config/ade/ade.json` (or under `$XDG_CONFIG_HOME`), wherever you start. For example, to turn web search on and talk off:

```json
{
	"modules": ["+web-search", "-talk"]
}
```

Use `+` and `-` to change the defaults; a list of bare names replaces them.

The server's address, port and data file come from the environment (`HOST`, `PORT`, `DB_PATH`), and so can `MODULES`. These win over the file.

## What it does

So, what's different about this one? Not much, but it adds patterns I've found useful enough to write down. Each is a module; you can switch any of them on or off.

- bots are agents with a name, instructions and a hands-off home thread (`bots`)
- agents and bots message each other (`talk`)
- threads are multiplayer, and group chats once you invite bots, who answer when it's their turn (`director`)
- bots remember long threads as short summary lines they can zoom back into, so they can stick around for good (`memory`)
- agents get their folder's AGENTS.md and skills, like in pi (`context`)
- see what agents are doing on a runner's terminal (`status`)
- threads get a short title once their first message is answered (`auto-title`)
- agents can search the web (`web-search`, off by default)
- Matrix rooms become threads (`matrix`, off by default)
- a short page per thread says where it stands and what waits on you (`overview`, off by default)
- move threads to and from pi (`pi-sessions`, off by default)

For each module's settings, see the top of its file in [modules/](modules). A module there with `export const on = true` is on by default; a new file there is a new module.

Scripting it? See [the API and CLI](docs/api.md).
