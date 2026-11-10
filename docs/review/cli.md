# The recoder command line

`recoder` runs Recoder's review from a terminal, for coding agents (Claude Code, Codex, OpenCode and others) that review a change and act on the findings. The code is `apps/server/src/cli/`; its tests are `apps/server/tests/cli/`. For the stages of a review, read [pipeline.md](pipeline.md).

## How it differs from the server

|             | Server                                                                 | `recoder`                                                                                                           |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Pipeline    | `runAdaptiveReview` (`apps/server/src/review/pipeline/harness/run.ts`) | the same function, called by `apps/server/src/cli/run/run-harness.ts`                                               |
| Process     | a long-running HTTP server                                             | one process per command; no server and no port                                                                      |
| Input       | a pull request the server tracks                                       | a branch, uncommitted or staged work, a pull request or a diff file (`--pull` reads the forge through `gh` or `glab`) |
| Output      | the app, and a comment on the pull request                             | a report on standard output or in a file                                                                            |
| Saved state | the database, settings and tokens in the data directory                | reads the same settings and tokens; writes one folder per run under the data directory                              |

The command line reads the saved model settings (`initReviewSettings`) and the `RECODER_*` variables the server reads (see [configuration.md](configuration.md)). It never writes the saved settings: flags such as `--reviewer` and `--budget` apply to one run in memory (`apps/server/src/cli/run/run-settings.ts`). It does not start the pull-request watcher, recover stale reviews or warm up agents (`apps/server/src/cli/run/boot.ts`).

## Install

Run these once, after `bun install`.

| Command                     | What it does                                                                                                           | Where to run it                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `bun run recoder <command>` | runs `apps/server/src/cli/main.ts`                                                                                     | the repository root, or `apps/server` |
| `bun link`                  | registers `@recoder/server` and puts a `recoder` link in Bun's global bin folder (`~/.bun/bin`, or `$BUN_INSTALL/bin`) | `apps/server`                         |

Both were run on this branch and print the version (`recoder --version`). `bun link` was run with `BUN_INSTALL` pointing at a scratch folder, and the `recoder` it made ran from another directory. Put Bun's bin folder on `PATH` to call `recoder` by name.

`bun run recoder` starts in the folder you ran it from, so a review from the repository root reviews Recoder itself. Pass `--repo <path>` to review another repository.

Check the machine before a first review:

```sh
recoder doctor
```

It prints `{ ok, checks: [{ id, ok, required, detail, fix }] }` and exits 0 when every required check passed, 4 when not. It checks git, `ps`, the data and checkout folders, the review model and its sign-in, and whether code can run in the sandbox. For an OpenCode or Devin model it asks the agent to list its models (10 seconds at most) and fails when the saved model is not in the list, which is how a missing sign-in shows. `ps` is required because a run is tied to its process by process id and start time. It makes no model call. Only the sandbox check is optional.

## Commands

| Command                                       | What it does                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `recoder review [flags]`                      | run one review and print the report. `--detach` runs it in the background |
| `recoder status <run-id>`                     | print a run's status as JSON                                              |
| `recoder wait <run-id> [--timeout <minutes>]` | wait for a run to end, then print its status                              |
| `recoder result <run-id> [flags]`             | print a finished run's report, with the flags and exit codes of `review`  |
| `recoder cancel <run-id>`                     | ask a running review to stop; prints the status with `stopRequested`      |
| `recoder runs [--repo <path>] [--limit <n>]`  | list recent runs as JSON, newest first; 20 by default; `--repo` keeps one repository's |
| `recoder models [--provider <name>] [--search <text>]` | list the model ids `--reviewer` and `--worker` accept, as JSON |
| `recoder skill <show\|path\|install>`         | print or install the agent skill                                          |
| `recoder mcp`                                 | serve the commands as MCP tools on standard input and output              |
| `recoder doctor`                              | check this machine and print a JSON report                                |
| `recoder --version`                           | print the version                                                         |

`recoder <command> --help` lists the flags. `apps/server/skills/recoder/reference.md` lists every flag with its default, and the report and status fields.

A review takes 5 to 40 minutes, which is longer than the time limit of most shell tools. An agent starts it with `--detach`, keeps the `runId`, and calls `wait` with `--timeout` in minutes, below its limit, until `state` is not `running`. `wait` exits 0 when the run ends and when the timeout passes, so the caller reads `state`. Without `--timeout` it waits until the run ends. `result` on a run that is still running is a usage error (exit 2). `result` on a finished run whose `report.json` is missing exits 3.

`--detach` starts the same program in its own session, so closing the terminal does not stop the review. It prints the run's status once the background process has taken the run over, and exits 0. When the background process does not start, it still prints the status, which has the `error` and the `logFile`, and exits 3. A signal while it starts cancels the run (exit 130). `--detach` cannot read `--diff -`; save the diff to a file. `cancel` sends SIGTERM to the run's process, after checking that the process is the one that started the run.

The status object has exactly these fields: `schemaVersion`, `runId`, `state` (`running`, `complete`, `failed`, `cancelled`), `stage`, `startedAt`, `finishedAt`, `repoPath`, `targetKind`, `findings`, `unconfirmed`, `exitCode`, `error`, `reportFile` and `logFile`. `findings` and `unconfirmed` are null until the review ends. `cancel` adds `stopRequested`.

## MCP server

`recoder mcp` serves the same commands as MCP tools, for an agent that calls tools and has no shell. The code is `apps/server/src/cli/mcp/`. It speaks MCP on standard input and output, one JSON-RPC message or one batch (a JSON array of messages) per line, and uses no SDK. The client sends `initialize` first: before it only `ping` is answered, and every other request gets an Invalid Request error. An agent starts it as an MCP server with the command `recoder` and the argument `mcp`:

```json
{ "mcpServers": { "recoder": { "command": "recoder", "args": ["mcp"] } } }
```

In Claude Code that is `claude mcp add recoder -- recoder mcp`.

| Tool             | Same as                   | Notes                                                                                |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `recoder_doctor` | `recoder doctor`          | read `ok` in the report                                                              |
| `recoder_models` | `recoder models`          | `provider` (a list) and `search`                                                     |
| `recoder_review` | `recoder review --detach` | takes the review flags as properties; returns the status with the `runId`            |
| `recoder_wait`   | `recoder wait <run-id>`   | `timeoutSeconds`, in seconds: 45 by default, 600 at most; call again while `running` |
| `recoder_status` | `recoder status <run-id>` |                                                                                      |
| `recoder_result` | `recoder result <run-id>` | `format`, `min-severity` and `include-unconfirmed`                                   |
| `recoder_cancel` | `recoder cancel <run-id>` |                                                                                      |
| `recoder_runs`   | `recoder runs`            | `repo` and `limit`                                                                   |

The review tool has no option list of its own. Its input schema is built from the flag tables in `apps/server/src/cli/args/flags.ts`, and its arguments go through the same parser as the command line, so a new flag reaches the tool with no further change. The flags that make no sense over MCP are one named list in `mcp/review-tool.ts`: `--detach`, `--run-id`, `--output`, `--progress` and the report flags, which belong to `recoder_result`. `diff`, `body-file` and `instructions-file` must each name a regular file. `-` is refused, because standard input carries the protocol, and so is a pipe or a device such as `/dev/stdin`, which a blocking read would wait on; the usage error names the property. The `diff` property has its own description, since the `--diff` help offers standard input.

A tool that fails returns a result with `isError` and one line of text. The errors come from code the command line shares, so a hint in them that says "run recoder wait" is written as "call recoder_wait"; nothing else in the text is changed. A review always runs in a background process, as with `--detach`, so the server never loads the pipeline, and a review it started goes on when the server ends. `recoder_runs` finds it again. Until the background process takes a run over, the run's record names the server, so `recoder_cancel` on a run still starting stops that start inside the server and never signals the server's own process. `recoder cancel` typed in a shell during that start, which takes about a second, does signal the server, and the server then ends; an agent with the tools uses `recoder_cancel`. The server ends when the client closes its input, on SIGINT or SIGTERM, and as soon as a reply cannot be written. A client that stops reading while no call runs is noticed at the next reply, not before. The paths in a tool's arguments are read from the server's working directory, so pass `repo` when the agent did not start the server in the repository.

## Output and exit codes

Standard output holds the report, or one JSON line naming the file when `--output` is given. Standard error holds progress (`--progress none|text|ndjson`, default `text`). With `text`, a foreground review prints `run: <run-id>` first, so the run can be found again. The report is `ReviewReport` in `apps/server/src/cli/report/report.ts`; `--format json` (default) writes all of it, `--format markdown` a document.

`--min-severity`, `--include-unconfirmed` and `--fail-on` change what is written and the exit code; the stored report always holds everything. `result` has the same exit codes: 3 for a failed run and 130 for a cancelled one.

| Code | Constant in `apps/server/src/cli/exit.ts` | Meaning                                                                |
| ---- | ----------------------------------------- | ---------------------------------------------------------------------- |
| 0    | `EXIT.ok`                                 | finished; no written finding met `--fail-on`                           |
| 1    | `EXIT.findings`                           | finished; a written finding met `--fail-on`. Never without `--fail-on` |
| 2    | `EXIT.usage`                              | a flag or argument was wrong; nothing ran                              |
| 3    | `EXIT.failed`                             | the review did not finish, or it read no part of the change            |
| 4    | `EXIT.notReady`                           | no model, no git, an unreadable repository                             |
| 130  | `EXIT.cancelled`                          | a signal or `--timeout` stopped it                                     |

An interrupt, a termination or a hang-up signal cancels a foreground review. On Linux, a process started with the hang-up ignored (`nohup`, `trap '' HUP`) keeps ignoring it, so `nohup recoder review` runs on; macOS gives a program no way to see that, so use `--detach` there. `--detach` keeps a review alive after its terminal closes: a hang-up never cancels it, also while it starts, and only an interrupt or a termination signal does. Once a run's end is recorded, one stop ends the process at once, so a run can read `complete` while the command that printed it exited 143. A review that finished and read no part of the change, for example because the model could not be reached, is `failed`: its `error` gives the most common reason from `coverageGaps`. A change whose every file is excluded is still `complete`.

## Defaults and why

| Default          | Value                                              | Why                                                                                                      |
| ---------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--budget`       | `low`: one reviewer, up to 3 subagents, low effort | an agent runs reviews in a loop, so each one should cost little. The server's default budget is `medium` |
| subagents        | the budget's cap (3, 8 or 12)                      | `--subagents <n>` overrides it and `--subagents 0` turns them off. Verifiers run in every budget         |
| `--format`       | `json`                                             | an agent reads fields                                                                                    |
| `--min-severity` | `info`                                             | the report holds everything; the caller filters                                                          |
| `--fail-on`      | `never`                                            | exit 0 whenever the review finished, so a nonzero code means the tool itself had a problem               |
| `--progress`     | `text` on standard error                           | nothing on standard output but the report                                                                |

The budget's effort applies to a saved OpenCode or Devin model only when that agent lists the model's efforts. The lookup has 10 seconds (`MODEL_LOOKUP_LIMIT_MS` in `apps/server/src/cli/run/model-choices.ts`); when it fails or is too slow, a line on standard error says so and the model runs with no reasoning effort, as the app shows a model nobody lists (`resolveEffort` in `packages/shared/src/models.ts`). `--reviewer-effort` and `--worker-effort` still win.

`--reviewer <model id>` names the model the reviewers run on, and `--worker <model id>` the model of the workers: the subagents and verifiers a reviewer hands narrow tasks to. Both apply to one run and default to the saved picks. `recoder models` prints every id they accept on this machine as one JSON line: `{ reviewer, worker, models: [{ id, name, provider, efforts, defaultEffort }], problems }`. `reviewer` and `worker` are the saved picks or null, and `provider` is the group the app's model picker shows. The list and the check of a named id read the same sources (`listAcceptedModels` and `namedModelChoices` in `apps/server/src/cli/run/model-choices.ts`), so a listed id is always accepted. OpenCode and Devin list their models by running, within the same 10 seconds each; an installed agent that fails or is too slow adds a line to `problems`, without the agent's own error text, and an agent that is not installed is left out. `--provider` (repeatable or comma-separated) and `--search` narrow the list; a provider with no model here is a usage error that names the providers there are. The command does not load the review pipeline.

With no saved models, `--reviewer` and `--worker` accept the model named by `RECODER_REVIEW_MODEL`. A ChatGPT model that is not signed in stops the review before the checkout, with exit 4. A review and `doctor` only read the saved settings: a settings file in an old format is converted in memory, and only the server's start rewrites it.

A blank `--title`, `--body` or `--instructions`, inline or from a file, counts as not given.

`--no-exec` runs no code, so bugs are reported with `verification.status: "unverified"`. A machine with no sandbox, and a `--diff` target, run no code either; the report's `settings.execReason` says which.

## Where runs are stored

A run is one recorded review. Every review is recorded, foreground ones too, so `recoder result <run-id>` works after any review. A run id looks like `20261110-153045-a1b2c3`: the UTC start time, then six hex digits (`apps/server/src/cli/runs/run-id.ts`).

A run lives in `<data dir>/cli-runs/<run-id>/`. The data directory is `RECODER_DATA_DIR`, default `~/.recoder/data` (`apps/server/src/util/data-dir.ts`).

| File              | Holds                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| `run.json`        | the run's record: the status fields, the process id and when that process started |
| `report.json`     | the complete, unfiltered report, once the review returns one                      |
| `progress.ndjson` | every progress event, one JSON object per line                                    |
| `background.log`  | standard error of a background run                                                |

A report quotes source code, so `cli-runs` and each run's folder are mode 0700 and the files in them 0600. `reportFile` and `logFile` in the status give the paths; they are null until the file exists, and a foreground run has no log file.

The 50 newest finished runs are kept. When a review starts, foreground or `--detach`, older finished runs are removed. A running run is never removed. A run whose record cannot be read is removed once its run id is more than 24 hours old; a younger one may be a run that is being created.

A run whose process ended without finishing, for example after `kill -9`, reads as `failed` with the error `the process ended without finishing`. Its `finishedAt` stays null.

`recoder cancel` writes a `stop-requested` file into the run's folder and then signals the run's process once. The process that owns the run reads the file, so a stop sent while a `--detach` start hands the run over is not lost and one `cancel` is enough.

## Targets and the throwaway checkout

The user's repository is only read. Its working tree, index, `HEAD`, refs and stash never change (`resolveTarget` in `apps/server/src/cli/target/resolve-target.ts`). The one trace is unreachable git objects for a staged or uncommitted review, which git's own garbage collection removes.

| Flag                     | Becomes                                                                                                                                                                                                                                                                          | Code                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| none, `--base`, `--head` | the commits on `--head` (default `HEAD`) since it left `--base` (default: `origin/HEAD`, else `main`, else `master`). The diff starts at their merge base. Refs are read; nothing is fetched                                                                                     | `target/range.ts`     |
| `--staged`               | a commit on top of `HEAD` holding what is staged, built in a copy of the index in a temp folder                                                                                                                                                                                  | `target/snapshot.ts`  |
| `--uncommitted`          | the same, with the working tree: untracked files in, ignored files out                                                                                                                                                                                                           | `target/snapshot.ts`  |
| `--pull <number or url>` | the pull or merge request's head fetched into a fresh checkout, and its base branch fetched to find the merge base. A number means the forge `origin` points at. Needs `gh` or `glab` signed in; the forge's title and body are the intent unless `--title` or `--body` is given | `target/pull.ts`      |
| `--diff <file or ->`     | the diff as given, from a file or standard input. No checkout, so no code runs. `--include` and `--exclude` are refused                                                                                                                                                          | `target/diff-file.ts` |

Every target but `--diff` ends in a checkout of the head. For a local change it is `git clone --local` of the repository into `RECODER_WORKDIR` (default `/tmp/recoder-work`, under `repos/`), checked out detached with hooks switched off (`target/throwaway-clone.ts`). The sandbox runs code in that checkout and never in the user's tree. The checkout is removed when the review ends, and when resolving fails; `--keep-checkout` leaves it for inspection. An empty change, once `--include` and `--exclude` are applied, is refused with an error.

Details that follow from "only read":

- In a sparse checkout, `--staged` and `--uncommitted` review what `git diff --cached` and `git diff HEAD` show there, paths outside the cone included. This needs git 2.34 or later (`git add --sparse`).
- A repository with a split index keeps its `sharedindex.*` files as they are, their time stamps included: the private copy of the index is made whole first.
- `--diff` refuses an empty file or input, and a hunk with no `---` and `+++` file header, as usage errors before the review starts.
- A stop during the preparation of a `--pull` target ends the git command that is running, removes the half-made checkout and exits 130.
- When that preparation fails, the message ends with the last lines of git's error, with credentials removed (`target/redact.ts`).

Environment variables a git hook exports (`GIT_DIR` and the like) are removed for the run, so the pipeline's git commands never act on the user's repository. Bun gives a child process the environment the program started with, so the program starts itself again without them (`apps/server/src/cli/repository-env.ts`). That copy runs in its own session, because a shared process group would deliver a terminal's Ctrl-C twice and a review treats a second stop as "exit now". The cost: under a git hook the review has no controlling terminal, so nothing can prompt on `/dev/tty` and job control does not reach it. The copy stops its review when the process that started it is gone, for example after `kill -9`.

## The agent skill

The skill in `apps/server/skills/recoder/` tells an agent when and how to use the commands above: `SKILL.md` is the loop and the rules, `reference.md` the flags, report fields and two example sessions.

| Command                                                                                           | What it does                                                                        |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `recoder skill show`                                                                              | print `SKILL.md`                                                                    |
| `recoder skill path`                                                                              | print the absolute folder of the bundled skill                                      |
| `recoder skill install [--agent claude\|agents] [--scope user\|project] [--dir <path>] [--force]` | copy it to `<skills folder>/recoder` and print `{"installed":"<path>","files":<n>}` |

| `--agent`          | `--scope user`     | `--scope project`                    |
| ------------------ | ------------------ | ------------------------------------ |
| `claude` (default) | `~/.claude/skills` | `<working directory>/.claude/skills` |
| `agents`           | `~/.agents/skills` | `<working directory>/.agents/skills` |

`--dir` names the skills folder directly, relative to the working directory, for any other agent; it cannot be combined with `--agent` or `--scope`. An existing `recoder` folder is a usage error (exit 2) unless `--force`, which replaces only that folder. A `recoder` entry that is a symbolic link is always refused. The code is `apps/server/src/cli/skill/`.

When the skill's text and a command disagree, the command wins. `reference.md` is written by hand: after a flag changes, update its tables so that every `--flag` in the `--help` texts appears there and no other does.
