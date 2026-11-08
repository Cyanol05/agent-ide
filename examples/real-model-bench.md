# Run the move bench

These five examples check whether a real model makes the right move, using thread text and recorded tool calls, not another model as judge. They use your pi login and make paid model calls. The web case also uses the live search service.

Run one:

```sh
REAL=1 node examples/88-side-question-real-model.js
```

Run each three times, serially, retaining the evidence:

```sh
for trial in 1 2 3; do
  for file in examples/{86,87,88,89,90}-*real-model.js; do
    REAL=1 node "$file" > "/tmp/$(basename "$file" .js)-$trial.log" 2>&1
    echo "$file trial $trial: $?"
  done
done
```

The default is `gpt-6-luna:low@oskar`; pass a different pi model pattern as the first argument. Each process starts a fresh server, store, runner folder and bot conversations, and removes them on exit. The logs include messages, tool calls and the resolved model and thinking level. Without `REAL=1`, these examples skip, including when run directly. The runner's folder has no project guidance; the product's own tool descriptions and bot instructions carry the behavior.

## Baseline

2026-11-08, Node.js v26.13.0, `openai-codex/gpt-6-luna`, thinking `low`, runner `oskar`. Product revision `98455089`; the shared example runner helper was changed to await readiness, with no product or prompt changes. Three fresh serial trials per scenario:

| Scenario | Trial 1 | Trial 2 | Trial 3 | Pass rate |
| --- | --- | --- | --- | --- |
| Group introductions | Pass | Pass | Pass | 3/3 |
| Another thread knows | Pass | Pass | Pass | 3/3 |
| Side question returns home | Pass | Pass | Pass | 3/3 |
| Directed mention | Pass | Pass | Pass | 3/3 |
| Web question searches | Pass | Pass | Pass | 3/3 |

The introduction case first joins both bots with a neutral message, then asks the literal `@Kira @Vera who are you two`. The mention case likewise starts with both bots already present. Introduction and mention counts apply only after the scored prompt. The hidden facts are fresh random tokens, unavailable in the asker's prompt. The side-question check also rejects extra threads and any group thread. The web check proves a search was made and an answer cites a URL; it does not certify the answer's factual accuracy.

An earlier exploratory side-question trial failed: Vera opened a new side thread back to Kira rather than answering her asker, and the answer never reached home. That run remains a failure, separate from the three serial baseline trials above; no prompt was changed to coach it through. Three passes do not make that observed failure disappear. Ten additional attempted parallel trials failed during setup before any model call: the old shared helper silently returned after its eight-second readiness poll expired. The helper now waits for the runner's ready announcement and rejects if it exits before connecting.
