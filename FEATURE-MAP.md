# Feature map

Where things live, so you open the right file first. The README says what each thing is; this says where it is.

```
server.js                the server: Pi Durable store, tasks, HTTP API, /ws, runners, settings
  Thread, Runners, Keys, Receipts   the docs it keeps (defineDoc)
  Anchor, Admit, Deliver, Shell     the tasks: own an agent, take a message in, hand it over, run `$ cmd`
  address, whom, modelOn, reach     whom a `to` asks, on which runner and model
  post, append, postEntry           write a message and hand it to each agent it asks
  reconfigure, newAgent, setUp      an agent switching model/thinking/runner/folder in place, or starting
  outcome, tell, restore, faulted   what a finished delivery posts back, or a failure says
  work, status, busiest, agentsIn   working / blocked / idle for agents, threads, runners
  threadList, threadRow, threadView, people   what GET /api/threads returns
  forkThread, seenBy                forks
  compact, compactingAt             compaction now, or early
  setTitle, setTools, toolList, toolsOf   a thread's title and tools
  receipt, once                     a retried request does its work once
  routes                            every HTTP route, as the README lists them
  watch, rewatch, told, doing       /ws: a browser watching one thread and its agents' live work
  mintKey, revoke, upgrade          runner keys and the runner's socket
  saveSettings, restart, connectSelf   settings, restart, the server lending its own machine
runner.js                a runner: offers its models and folders, connects, runs agents for the server
runner-updater.js        what `curl <server>/connect-runner | sh` starts; keeps the runner up to date
remote.js                the runner protocol, both ends: createRunners (server), serveRunner (runner),
                         runnerProvider (a model over the wire), remoteEnv (tools in the runner's folder)
cli.js                   the API from a terminal
util.js                  helpers server and modules share: agentTo, writtenTo, keyOf, speaker, said,
                         finished (task result), background (thread-owned task)
modules.js               agent-ide.json, MODULES, and loading each module's server/runner half
modules/
  talk.js                `post` and `threads` tools; reply sends answers back to askers
  memory.js              memory lines (Line task), `zoom`, catch-up and compaction cut; render, memory
  bots.js                bots: their doc, `bot` tool, /api/bots (serve, change, remove)
  context.js             AGENTS.md and skills from the runner's folder; listed skills stay readable outside it
  director.js            @mentions ask that bot; with picks, a model picks a bot or nobody (decide)
  search.js              `web_search`
  status.js              OSC 7501 status on the runner's terminal
  matrix.js              Matrix rooms as threads (MatrixSend, relay, sync)
apps/client/             the web client, Solid 2, no build (README.md there)
  client.html            the walkthrough and the app's page; the promises every change serves
  client.js              root: just the chat, or the live system around it
  server.js              the server as the client sees it: api, watch, lists (threads, runners, bots),
                         current, openThread, fork, entries store
  thread.js              one thread on screen
    Thread               subscribes to the thread over /ws, keeps its messages, follows the bottom (follow)
    rows                 projection: messages plus each agent's turns, which run sits in which ask box,
                         live turn, compaction cuts, folded memory lines
    Message              one message: author, reply/elsewhere (cross-thread), fork link, Body, Images
  run.js                 an agent's turns, from its own conversation
    heard, conversations the conversation entries the socket brings
    turnsOf, cutsOf      a conversation cut into turns, and where its newest compaction cut it
    summary              a closed turn's one line ("edited 2 files · 1 command")
    Exchange             an ask's own line in the asking thread; opened, question and answer as messages
    answersIn, answerOf  a post step's answer from the thread it asked
    Turn, Step, Call, Told, Ask   a turn's line, opened into steps; Ask is the post step
  composer.js            the box you type in
    pick, agent, askedBots, recipients   whom the next message asks, per thread
    missingBots, addBot  the "isn't in this thread · Add" line under a message that @mentions an absent bot
    choose, configure, toFor             model picker and runner controls changing that pick
    Composer: submit, add, typeRecipients, filled, compactNow   send, images, typed recipients, context meter
    PickerBot            bots in the picker
  agent.js               agents' labels and live work (doing); client's agentTo, formatAgent, toolLine
  model-picker.js        model, thinking and folder controls (composer and settings share them)
  runner.js              runner list, a runner's agents, ConnectRunner
  bot.js                 a bot's settings, new bot
  thread-list.js         the thread list, its family rows
  thread-details.js      title, people, family, tools for the open thread
  agent-memory.js        memory popover and compaction view for the visible thread
  settings.js            server settings: modules on/off, memory's model
  system.js, wires.js    the live system diagram and the wires between boxes
  tutorial.js            walkthrough buttons wired to the real server
  panes.js, popover.js, sure.js, notice.js, dot.js   list/detail frame, popover placement,
                         two-press button, error line, status dot
  images.js, markdown.js image shrinking to pi's limits; message markdown
  client.css             all styles, by comment-headed section
    "The page"           layout: story left, live system right
    "The live system", "Wires"   system diagram
    .thread (~721)       the chat: messages, li.turn, .run steps, .ask boxes, .elsewhere/.reply
    "A message's markdown"   message body
    "A phone"            narrow layout, drawers
    "The model picker and settings"   popovers and sheets
    "Images waiting to go", "Where compaction cut", "A message folded"   composer images, cuts, memory
scripts/
  try.js                 scratch server with a scripted bot, for clicking through
  page-spy.js            browser init script: fetches, socket frames, stalls
  replay-pi.js           replays pi sessions into a thread, to try memory
examples/lib.js          what examples share: start (owned child processes), server, runner, scriptedRunner, api, view, until, check
examples/17-memory-compaction.js   automatic and manual cuts, memory coverage and budget at small and large windows
examples/27-watch-agents-work.js   socket snapshots, streaming entries, delivery identity and reconnects
examples/all.js          suite queue, per-example timeout and interruption cleanup
examples/74-examples-clean-up.js   CLI checks: example exit, failure and timeout leave no server
```

Where a feature lives:

- Talk between threads: modules/talk.js (post, threads, reply), server.js append/whom, client thread.js rows (ask boxes), run.js Ask.
- Asking a model / switching it: composer.js pick/choose, model-picker.js, server.js whom/reconfigure.
- Live work you watch: server.js work/doing/watch, client agent.js doing, run.js Turn.
- Memory and compaction: modules/memory.js, server.js compact/compactingAt, client agent-memory.js, thread.js rows (cuts, folded lines), run.js cutsOf.
- Bots: modules/bots.js, client bot.js, composer.js PickerBot, client server.js homeBot/botAgent.
- Runners and keys: remote.js, runner.js, server.js mintKey/revoke/upgrade, client runner.js.
- Forks: server.js forkThread/seenBy, client server.js fork, thread.js Message (fork link).
- `$ cmd`: server.js Shell, printed, shells.
- Status dots: server.js status/busiest, client dot.js.
- A new popover or panel: copy the context popover in composer.js (Settings in settings.js is the fuller model): `<div class="settings" popover>` placed by `placePopover`, holding `<Panes title actions>` (panes.js, its header and Done button) and rows as `ul.modules > li`, all styled by the `.settings` rules in client.css ("The model picker and settings"); add no CSS of your own.
- Settings and modules: modules.js, server.js saveSettings/restart, client settings.js.
