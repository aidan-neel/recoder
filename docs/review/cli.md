# The recoder command line

`recoder` runs Recoder's review from a terminal. It has two audiences: a person at a terminal, who gets text laid out to read, and a program such as a coding agent (Claude Code, Codex, OpenCode and others), which passes `-p` and gets JSON. The code is `apps/server/src/cli/`; its tests are `apps/server/tests/cli/`. For the stages of a review, read [pipeline.md](pipeline.md).

## Two audiences

Every command prints for a person unless `-p` (`--programmatic`) is given. The flag may stand anywhere before a `--`; `splitAudience` (`cli/audience.ts`) takes it out of argv before the command is parsed, so no command has it in its flag table.

|                 | Person (default)                                                              | Program (`-p`)                                            |
| --------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| Command results | a view: a checklist, a table, a status card (`*-view.ts` beside each command) | one line of JSON; `doctor` prints an indented JSON report |
| `--format`      | `text`: the report laid out for a terminal (`output/text-report.ts`)          | `json`                                                    |
| `--progress`    | `live`: a block redrawn in place (`output/live-progress.ts`)                  | `text`: one line per stage and per new count              |
| `--output`      | one line on standard error saying where the report went                       | one JSON line on standard output naming the file          |
| Errors          | a marked, wrapped message                                                     | `recoder: <message>` in one line                          |

The JSON a program reads is the contract: its fields change only with `schemaVersion`. What a person sees is not, and may change in any release. `printResult` (`output/print-result.ts`) is the one place that chooses between the two for a command's result.

A view is a pure function from the result and a `Surface` to lines. A surface (`terminal/surface.ts`) says whether the stream is a terminal, how wide it is, and how to style text for it. Color follows `NO_COLOR` and `FORCE_COLOR`, then whether the stream is a terminal; a pipe or a file gets none. Styles are named by meaning (`paint.error`, `paint.muted`) and use the terminal's own 16 colors, so the user's theme decides the shades. A terminal whose locale is not UTF-8 gets ASCII symbols.

Anything redrawn in place goes through `LiveRegion` (`terminal/live-region.ts`), which draws only on a terminal. While a region is open, `writeStderrLine` and the console print above it, so a warning from the pipeline never lands inside the block. `live` progress on anything that is not a terminal, such as the log of a background review, is written as `text` lines.

## How it differs from the server

|             | Server                                                                 | `recoder`                                                                                                             |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Pipeline    | `runAdaptiveReview` (`apps/server/src/review/pipeline/harness/run.ts`) | the same function, called by `apps/server/src/cli/run/run-harness.ts`                                                 |
| Process     | a long-running HTTP server                                             | one process per command; no server and no port                                                                        |
| Input       | a pull request the server tracks                                       | a branch, uncommitted or staged work, a pull request or a diff file (`--pull` reads the forge through `gh` or `glab`) |
| Output      | the app, and a comment on the pull request                             | a report on standard output or in a file                                                                              |
| Saved state | the database, settings and tokens in the data directory                | reads the same settings and tokens; writes one folder per run under the data directory                                |

The command line reads the saved model settings (`initReviewSettings`) and the `RECODER_*` variables the server reads (see [configuration.md](configuration.md)). A review never writes the saved settings: flags such as `--reviewer` and `--budget` apply to one run in memory (`apps/server/src/cli/run/run-settings.ts`). Only `recoder init` writes them, when it saves the review model. It does not start the pull-request watcher, recover stale reviews or warm up agents (`apps/server/src/cli/run/boot.ts`).

## Install

Users install a prebuilt binary:

```sh
curl -fsSL https://recoder.dev/install.sh | sh
```

After that, `recoder upgrade` replaces the binary with the latest release. The script (`apps/site/public/install.sh`) picks `recoder-<linux|darwin>-<x64|arm64>` from the latest GitHub release (`RECODER_VERSION` names another tag), checks it against the release's `SHA256SUMS`, and moves it to `~/.local/bin` (`RECODER_INSTALL_DIR`). Nothing is installed when the checksum does not match.

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the four binaries with `bun build --compile` and publishes them with `SHA256SUMS` as a release. A binary carries everything the CLI reads at run time: the tree-sitter grammars (`with { type: 'file' }` imports in `review/pipeline/change-model/parser.ts`) and the agent skill (`with { type: 'text' }` imports in `cli/skill/bundled-skill.ts`). Code that needs a file at run time must be imported the same way, never read from a path beside the source. A background review and the clean copy started under a git hook run the program again through `selfCommand()` (`cli/self-command.ts`): the binary alone, or Bun and `main.ts` from source.

To run from source, use `bun run recoder <command>` in the repository root or `apps/server`. It starts in the folder you ran it from, so a review from the repository root reviews Recoder itself. Pass `--repo <path>` to review another repository.

Set it up and check the machine before a first review:

```sh
recoder init
recoder doctor
```

`doctor` prints a line per check, with the fix under each that failed; with `-p` it prints `{ ok, checks: [{ id, ok, required, detail, fix }] }`. It exits 0 when every required check passed, 4 when not. It checks git, `ps`, the data and checkout folders, the review model and its sign-in, and whether code can run in the sandbox. For an OpenCode or Devin model it asks the agent to list its models (10 seconds at most) and fails when the saved model is not in the list, which is how a missing sign-in shows. `ps` is required because a run is tied to its process by process id and start time. It makes no model call. Only the sandbox check is optional.

## Commands

| Command                                                | What it does                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `recoder review [flags]`                               | run one review and print the report. `--detach` runs it in the background         |
| `recoder status [run]`                                 | show a run's status                                                               |
| `recoder wait [run] [--timeout <minutes>]`             | follow a run until it ends, then show its status                                  |
| `recoder result [run] [flags]`                         | print a finished run's report, with the flags and exit codes of `review`          |
| `recoder cancel [run]`                                 | ask a running review to stop; the status has `stopRequested`                      |
| `recoder runs [--repo <path>] [--limit <n>]`           | list recent runs, newest first; 20 by default; `--repo` keeps one repository's    |
| `recoder models [--provider <name>] [--search <text>]` | list the model ids `--reviewer` and `--worker` accept                             |
| `recoder init [--project \| --global]`                 | set Recoder up for coding agents: the skill, the review model and a machine check |
| `recoder upgrade [--to <release>] [--check]`           | replace this binary with the latest release, checked against its checksums        |
| `recoder skill <show\|install>`                        | print or install the agent skill                                                  |
| `recoder mcp`                                          | serve the commands as MCP tools on standard input and output                      |
| `recoder doctor`                                       | check this machine                                                                |
| `recoder --version`                                    | print the version                                                                 |

`recoder <command> --help` and `recoder help <command>` explain a command (`cli/args/help.ts`). A mistyped command or flag is a usage error that names the one probably meant (`cli/args/nearest.ts`). `apps/server/skills/recoder/reference.md` lists every flag with its default, and the report and status fields.

`[run]` names a run three ways (`cli/runs/run-reference.ts`): its whole id, a part of it such as the last six characters that `recoder runs` shows, or nothing, which means the newest run. A part is matched against the ids on disk and never used in a path; text that could not be part of a run id is refused before the disk is read. A part that matches several runs is a usage error that names them. The MCP tools take whole ids only.

For a person at a terminal, `recoder wait` shows the same live view as a foreground review. It reads the events the run appends to `progress.ndjson` (`cli/runs/progress-file.ts`), each line parsed as outside input, and a line that cannot be read is skipped.

A review takes 5 to 40 minutes, which is longer than the time limit of most shell tools. An agent starts it with `--detach`, keeps the `runId`, and calls `wait` with `--timeout` in minutes, below its limit, until `state` is not `running`. `wait` exits 0 when the run ends and when the timeout passes, so the caller reads `state`. Without `--timeout` it waits until the run ends. `result` on a run that is still running is a usage error (exit 2). `result` on a finished run whose `report.json` is missing exits 3.

`--detach` starts the same program in its own session, so closing the terminal does not stop the review. It prints the run once the background process has taken the run over, and exits 0. When the background process does not start, `-p` still prints the status, which has the `error` and the `logFile`, a person gets the error, and both exit 3. A signal while it starts cancels the run (exit 130). `--detach` cannot read `--diff -`; save the diff to a file. `cancel` sends SIGTERM to the run's process, after checking that the process is the one that started the run.

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

Standard output holds the report. With `--output` the report goes to the file, never with terminal styling, and `-p` puts one JSON line naming the file on standard output. Standard error holds progress (`--progress live|text|ndjson|none`). With `text`, a foreground review prints `run: <run-id>` first, so the run can be found again; a person is told the run id after the report. The report is `ReviewReport` in `apps/server/src/cli/report/report.ts`; `--format json` writes all of it, `--format markdown` a document, and `--format text` the terminal layout.

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
| `--format`       | `text`, or `json` with `-p`                        | a person reads a layout; an agent reads fields                                                           |
| `--min-severity` | `info`                                             | the report holds everything; the caller filters                                                          |
| `--fail-on`      | `never`                                            | exit 0 whenever the review finished, so a nonzero code means the tool itself had a problem               |
| `--progress`     | `live`, or `text` with `-p`, on standard error     | nothing on standard output but the report                                                                |

The budget's effort applies to a saved OpenCode or Devin model only when that agent lists the model's efforts. The lookup has 10 seconds (`MODEL_LOOKUP_LIMIT_MS` in `apps/server/src/cli/run/model-choices.ts`); when it fails or is too slow, a line on standard error says so and the model runs with no reasoning effort, as the app shows a model nobody lists (`resolveEffort` in `packages/shared/src/models.ts`). `--reviewer-effort` and `--worker-effort` still win.

`--reviewer <model id>` names the model the reviewers run on, and `--worker <model id>` the model of the workers: the subagents and verifiers a reviewer hands narrow tasks to. Both apply to one run and default to the saved picks. `recoder models -p` prints every id they accept on this machine as one JSON line: `{ reviewer, worker, models: [{ id, name, provider, efforts, defaultEffort }], problems }`. For a person the models are listed under their providers with the saved picks marked; a list of more than 40 that no flag narrowed is summed up by provider instead. `reviewer` and `worker` are the saved picks or null, and `provider` is the group the app's model picker shows. The list and the check of a named id read the same sources (`listAcceptedModels` and `namedModelChoices` in `apps/server/src/cli/run/model-choices.ts`), so a listed id is always accepted. OpenCode and Devin list their models by running, within the same 10 seconds each; an installed agent that fails or is too slow adds a line to `problems`, without the agent's own error text, and an agent that is not installed is left out. `--provider` (repeatable or comma-separated) and `--search` narrow the list; a provider with no model here is a usage error that names the providers there are. The command does not load the review pipeline.

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
- When that preparation fails, the message ends with the last lines of git's error, with credentials removed (`util/redact.ts`).

Environment variables a git hook exports (`GIT_DIR` and the like) are removed for the run, so the pipeline's git commands never act on the user's repository. Bun gives a child process the environment the program started with, so the program starts itself again without them (`apps/server/src/cli/repository-env.ts`). That copy runs in its own session, because a shared process group would deliver a terminal's Ctrl-C twice and a review treats a second stop as "exit now". The cost: under a git hook the review has no controlling terminal, so nothing can prompt on `/dev/tty` and job control does not reach it. The copy stops its review when the process that started it is gone, for example after `kill -9`.

## Upgrading with `recoder upgrade`

`recoder upgrade` replaces the running binary with the latest release, and `--to <release>` with a named one, newer or older. `--check` only says whether a newer release exists. The code is `apps/server/src/cli/upgrade/`.

The latest release is read from where `releases/latest` on GitHub redirects to, which needs no token and is not counted by the API's rate limit (`upgrade/release-source.ts`). The tag in that answer, like one from `--to`, must have the shape `v1.2.3` before it is put in a download address (`upgrade/release-tag.ts`). For a few minutes after a release is published GitHub can still answer with the one before it.

The install follows the install script: download `recoder-<linux|darwin>-<x64|arm64>` for this machine and the release's `SHA256SUMS`, and refuse a binary whose checksum is missing, malformed or different (`upgrade/install-binary.ts`). The new file is written beside the executable, run once with `--version`, and renamed over it only when it prints the release's version, so a reader finds the old program or the new one and a failure leaves the old one. The executable is resolved through symbolic links first, so a link to the binary keeps pointing at it. A program run from source has no binary to replace and is refused. A signal stops a download and exits 130.

With `-p` it prints `{ state, currentVersion, targetVersion, path }`: `state` is `current` when there is nothing to install, `available` when `--check` found a release, and `upgraded` when the binary at `path` was replaced. It exits 0 in all three. A newer binary carries a newer skill, so the person is told to run `recoder init` afterwards.

## Setting up with `recoder init`

`recoder init --project` sets up the working directory, to commit with the repository; `recoder init --global` sets up the machine. With neither, a person at a terminal is asked; anywhere else it is a usage error. The code is `apps/server/src/cli/init/`. The steps run in order and each is printed as it ends:

| Step         | `--project`                                                        | `--global`                        |
| ------------ | ------------------------------------------------------------------ | --------------------------------- |
| Skill        | `.claude/skills/recoder` and `.agents/skills/recoder`              | the same under the home directory |
| Review rules | creates `RECODER.md` when the project has no guidelines file       | not run                           |
| MCP server   | with `--mcp`, adds `recoder` to `.mcp.json`, keeping what is there | not run; `--mcp` is a usage error |
| Review model | saves the pick                                                     | the same                          |
| This machine | the doctor's checks in one line                                    | the same                          |

The skill goes to the agents found on the machine (`init/detect-agents.ts`: a command on the PATH or the agent's folder in the home directory), or to those `--agent` names; with none found, to Claude Code. A skill that is already this version is left. One that differs is replaced when the person agrees, or with `--force` or `--yes`; otherwise the step is skipped and says so.

The new `RECODER.md` holds section headings and no rules. A guidelines file with no rules is not sent to the reviewers (`hasRules` in `review/guidelines/guidelines.ts`), so it changes no review until someone writes a rule.

The review model is the one setting `init` saves: `--reviewer <id>` is checked as a review's flag is, then written through `saveReviewSettings`, the same file the app's settings write. With no flag, a configured model is kept; with none configured a person picks from a list that typing narrows, and anyone else is told how to choose.

`init` exits 0 when every step is in place and a review can run, 3 when a step failed, and 4 when the setup is in place but the machine cannot review yet. With `-p` it prints `{ scope, ready, steps: [{ id, label, state, detail, path, fix }] }`, where `state` is `done`, `unchanged`, `skipped` or `failed`. Questions are asked only of a person with a terminal on both standard input and standard error, and never with `--yes` (`terminal/prompt/`).

## The agent skill

The skill in `apps/server/skills/recoder/` tells an agent when and how to use the commands above: `SKILL.md` is the loop and the rules, `reference.md` the flags, report fields and two example sessions. Every command in it is written with `-p`. A skill installed by a version before `-p` runs the commands without it and reads the text meant for a person; run `recoder init` again to replace it.

| Command                                                                                           | What it does                                                                                 |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `recoder skill show`                                                                              | print `SKILL.md`                                                                             |
| `recoder skill install [--agent claude\|agents] [--scope user\|project] [--dir <path>] [--force]` | write it to `<skills folder>/recoder`; with `-p`, print `{"installed":"<path>","files":<n>}` |

| `--agent`          | `--scope user`     | `--scope project`                    |
| ------------------ | ------------------ | ------------------------------------ |
| `claude` (default) | `~/.claude/skills` | `<working directory>/.claude/skills` |
| `agents`           | `~/.agents/skills` | `<working directory>/.agents/skills` |

`--dir` names the skills folder directly, relative to the working directory, for any other agent; it cannot be combined with `--agent` or `--scope`. An existing `recoder` folder is a usage error (exit 2) unless `--force`, which replaces only that folder. A `recoder` entry that is a symbolic link is always refused. The skill's files are built into the program, so `install` writes them rather than copying a folder. The code is `apps/server/src/cli/skill/`.

When the skill's text and a command disagree, the command wins. `reference.md` is written by hand: after a flag changes, update its tables so that every `--flag` in the `--help` texts appears there and no other does.
