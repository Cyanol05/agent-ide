# agent-ide

A small agent IDE on [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable), built to show how little it takes. One server keeps every thread. Runners on your machines lend it their model logins and a folder. Runs with bun or Node.js 24+, no build step.

The words it uses, how it fits together and its principles: [apps/client/client.html](apps/client/client.html), the page every server serves at `/`, beside the app itself. The code is the truth, and [examples/](examples) shows each idea working.

## Try it

```sh
npx github:oskarrough/agent-ide
```

It lends the folder it starts in to its agents, as a runner named after this machine. From a clone, `pnpm install && bun server.js` does the same. Open http://127.0.0.1:3000 and the page walks you through it.

Read [examples/](examples): one file per idea, each starting its own server and runner. `bun run examples` runs them all, `bun examples/05-fork.js` one. The `real-model` ones use your pi login, so they only run on their own or with `REAL=1`.

## Running it

```sh
HOST=0.0.0.0 PORT=3001 bun server.js   # reachable from other machines
RUNNER=~/code bun server.js            # lend another folder; RUNNER=0 lends none
MODULES=+memory,+bots bun server.js    # +name and -name change the defaults; each module's top says how it works
DB_PATH=other.sqlite bun server.js     # another store

bun cli.js key desk                    # prints the line that connects runner desk to this server
bun cli.js post "hello" --to sonnet@laptop
bun cli.js threads | runners | read 3 | stop 3
```

On another machine, nothing to clone: `curl -fsSL http://yourbox:3000/connect-runner | AGENT_IDE_KEY=air_… sh -s -- --name desk --dir ~/code`. `bun runner.js --help` lists the rest.

A runner needs its key to connect, so nobody can take its name. People have no keys yet: anyone who can reach the server can claim any name, so keep it on a trusted network.

## API

Everything the client does is in [server.js](server.js), under `/api`, with `/ws` pushing changes. Send `x-user: name` to say who you are. The POSTs that make a thread or an entry take an optional `"requestId"`: send the same one again after a dropped response and you get the first result back.

An entry is Pi's own, `{id, kind: "agent-ide.message", data}`, and `data` is a message:

```
{ author, body, to?: [{runner, model, thinkingLevel?, dir?}], from?: threadId, re?: [entryId],
  answer?: {conversation, entry}, error?: true, shell?: {runner, code, stdout, stderr} }
```

Runners speak the protocol in [remote.js](remote.js).
