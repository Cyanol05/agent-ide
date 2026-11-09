# Run the bench

These seven examples check whether a real model makes the right move. They score it from thread text and the agents' own conversations, not with another model as judge. They use your pi login and make paid model calls. The web case also uses the live search service. Without `REAL=1` they skip, and the examples suite leaves them out.

| Example                 | What it asks                                                   | Step budget     |
| ----------------------- | -------------------------------------------------------------- | --------------- |
| 19 memory recall        | a code from before the compaction, which is now only in memory | 4 for the agent |
| 23 memory deep recall   | a code in message 7 of 64, kept by every merged line above it  | 4 for Kira      |
| 86 group introductions  | `@Kira @Vera who are you two`: each answers once               | 1 each          |
| 87 another thread knows | a token recorded in another thread, read or asked for          | 3 for Kira      |
| 88 side question        | Kira asks Vera, and the answer comes back home                 | 3 Kira, 1 Vera  |
| 89 directed mention     | `@Vera …` in a group: only Vera answers                        | 1 each          |
| 90 web question         | the latest Node.js release, searched for and cited             | 3 for Kira      |

Run one:

```sh
REAL=1 node examples/88-side-question-real-model.js
```

Each run ends with one line to compare:

```
score {"case":"88-side-question","model":"gpt-6-luna:low@oskar","revision":"1eaf180a","pass":true,"failed":[],"steps":2,"errors":1,"input":13296,"output":129,"cacheRead":17408,"wall_ms":9431}
```

`steps` counts the agents' tool calls and `errors` the calls that failed. The token counts come from each answer's usage in `GET /api/conversations/:id`, added up over every agent the case reads. `revision` is the checkout's commit. A step budget that's exceeded fails the run, like any other check.

For an A/B, run every case three times serially, keeping the logs and collecting the score lines. Then make the one change to a prompt or a module and run them again:

```sh
mkdir -p .bench
for trial in 1 2 3; do
  for file in examples/{19,23,86,87,88,89,90}-*real-model.js; do
    REAL=1 node "$file" > ".bench/$(basename "$file" .js)-$trial.log" 2>&1
    grep '^score ' ".bench/$(basename "$file" .js)-$trial.log" >> .bench/scores
  done
done
```

The model is `gpt-6-luna:low` unless a different pi model pattern is passed as the first argument. Each process starts a fresh server, store, runner folder and bot conversations, and removes them on exit. The logs hold the messages, the tool calls and the resolved model and thinking level. The runner's folder has no project guidance: the product's own tool descriptions and bot instructions carry the behavior.

## Baseline

2026-11-09, Node.js v26.13.0, `openai-codex/gpt-6-luna`, thinking `low`, runner `oskar`, revision `1eaf180a`. Three fresh serial trials per case. The numbers are each trial's in turn; input tokens are uncached.

| Case                    | Pass | Steps | Errors | Input tokens      | Output      | Seconds     |
| ----------------------- | ---- | ----- | ------ | ----------------- | ----------- | ----------- |
| 19 memory recall        | 3/3  | 2 4 3 | 0 0 0  | 77.6k 97.0k 85.6k | 101 155 123 | 15 14 13    |
| 23 memory deep recall   | 3/3  | 1 1 0 | 0 0 0  | 9.0k 14.9k 8.7k   | 78 71 20    | 159 130 161 |
| 86 group introductions  | 3/3  | 0 0 1 | 0 0 0  | 20.3k 20.3k 20.5k | 62 67 79    | 9 11 12     |
| 87 another thread knows | 3/3  | 1 1 1 | 0 0 0  | 6.1k 11.8k 6.1k   | 55 63 55    | 6 9 5       |
| 88 side question        | 2/3  | 5 2 3 | 3 1 0  | 19.8k 13.3k 19.4k | 232 129 178 | 38 9 12     |
| 89 directed mention     | 3/3  | 0 0 0 | 0 0 0  | 13.5k 13.5k 13.5k | 121 93 109  | 11 13 17    |
| 90 web question         | 3/3  | 2 2 1 | 0 0 0  | 8.2k 18.4k 15.5k  | 158 164 94  | 11 20 6     |

What the numbers show:

- The side question's failed trial still got the right answer home, but it went over Vera's step budget. Kira's first `post` left out the title a new thread needs and had to be sent again; that error shows up in two of the three trials. Vera then read her own thread and zoomed into a message she had already been handed before she answered.
- Memory recall reads about 80–100k input tokens. That's the compacted context plus the long filler, and most of it is cached. It zoomed in every trial.
- Deep recall spends most of its time writing the 64 lines and their merges. The code survived every merge up to the root in each trial, and Kira answered from the lines without zooming. Its one step, in two trials, was Kira rewriting her own instructions with `bot` after the warm-up message.
- Bots reach for `bot` unasked: Kira rewrote her instructions in one side-question trial and in two deep-recall trials.

Earlier, on 2026-11-08 at revision `98455089`, the five move cases (86–90) passed 3/3 each, scored on correctness alone. One exploratory side-question trial failed then: Vera opened a new side thread back to Kira rather than answering her asker.

Memory recall asks the thread's own agent, not a bot. In a first try with a bot, the bot kept the code by rewriting its instructions with `bot`, which never tests memory.
