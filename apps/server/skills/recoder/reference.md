# Recoder reference

Every command and flag, the report and status fields, and two example sessions. `SKILL.md` has the loop to follow. When this file and `recoder <command> --help` disagree, the help is right.

Every command here is written with `-p` (`--programmatic`), which makes it print JSON and plain progress lines. Without `-p` the output is laid out for a person at a terminal and its shape is not a contract. The defaults in the tables below are the defaults with `-p`.

## Commands

| Command                      | What it does                                                               |
| ---------------------------- | -------------------------------------------------------------------------- |
| `recoder review -p [flags]`  | Run one review and print the report. `--detach` runs it in the background. |
| `recoder status -p <run-id>` | Print a run's status as JSON.                                              |
| `recoder wait -p <run-id>`   | Wait for a run to end, then print its status.                              |
| `recoder result -p <run-id>` | Print a finished run's report.                                             |
| `recoder cancel -p <run-id>` | Ask a running review to stop.                                              |
| `recoder runs -p`            | List recent runs as JSON, newest first.                                    |
| `recoder models -p`          | List the model ids `--reviewer` and `--worker` accept, as JSON.            |
| `recoder skill`              | Print or install the agent skill.                                          |
| `recoder init`               | Set Recoder up for coding agents. A person runs it, not you.               |
| `recoder upgrade`            | Replace the program with the latest release. A person runs it, not you.    |
| `recoder doctor -p`          | Check this machine and print a JSON report. Exit 0 when ready, 4 when not. |
| `recoder --version`          | Print the version.                                                         |
| `recoder <command> --help`   | Print the flags of a command.                                              |

Every review is recorded as a run, foreground ones too, so `recoder result -p <run-id>` works after any review. A run id looks like `20261110-153045-a1b2c3`. Always give the whole id: a command also takes a part of one, and with none it reads the newest run, which may not be yours. Text that could not be part of a run id is a usage error (exit 2).

## `recoder review` flags

Choose at most one of `--staged`, `--uncommitted`, `--pull` and `--diff`. With none, `review` reviews the commits on `--head` since it left `--base`.

Target:

| Flag                     | Default               | Meaning                                                                                        |
| ------------------------ | --------------------- | ---------------------------------------------------------------------------------------------- |
| `--repo <path>`          | the working directory | Repository directory.                                                                          |
| `--base <ref>`           | the default branch    | Compare against this ref.                                                                      |
| `--head <ref>`           | `HEAD`                | Last commit to review.                                                                         |
| `--staged`               |                       | Review what is staged.                                                                         |
| `--uncommitted`          |                       | Review all uncommitted changes, untracked files included.                                      |
| `--pull <number or url>` |                       | Review a pull or merge request on the repository forge.                                        |
| `--since <commit>`       |                       | With `--pull`: review only the commits after this one. It must be in the pull request's history. |
| `--diff <file or ->`     |                       | Review a unified diff from a file, or from standard input when the value is `-`. No code runs. |

Scope:

| Flag               | Meaning                                 |
| ------------------ | --------------------------------------- |
| `--include <glob>` | Review only matching paths. Repeatable. |
| `--exclude <glob>` | Skip matching paths. Repeatable.        |

Intent:

| Flag                         | Meaning                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `--title <text>`             | What the change is called.                                    |
| `--body <text>`              | What the change is meant to do.                               |
| `--body-file <path>`         | Read the body from a file. Not with `--body`.                 |
| `--instructions <text>`      | What to look for or leave out. Costs one model call.          |
| `--instructions-file <path>` | Read the instructions from a file. Not with `--instructions`. |

Tuning:

| Flag                           | Default                  | Meaning                                                                        |
| ------------------------------ | ------------------------ | ------------------------------------------------------------------------------ |
| `--budget <low\|medium\|high>` | `low`                    | How much to spend.                                                             |
| `--subagents <n\|uncapped>`    | the budget's cap         | Most subagents the review may run.                                             |
| `--reviewer <model id>`        | the saved Review model   | Model the reviewers run on. List the ids with `recoder models -p`.             |
| `--worker <model id>`          | the saved pick           | Model the workers (subagents and verifiers) run on.                            |
| `--reviewer-effort <level>`    | the budget's             | Reviewer reasoning effort: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |
| `--worker-effort <level>`      | the budget's             | Worker reasoning effort, same levels.                                          |
| `--lens <id>`                  | all                      | Run only these lenses. Repeatable or comma-separated.                          |
| `--skip-lens <id>`             |                          | Run every lens but these. Not with `--lens`.                                   |
| `--low-severity`               | the saved setting        | Keep low-severity findings.                                                    |
| `--no-low-severity`            |                          | Drop low-severity findings.                                                    |
| `--no-exec`                    |                          | Read only: run no code, so bugs are reported unverified.                       |
| `--no-baseline-cache`          |                          | Run every baseline check again.                                                |
| `--max-file-chars <n>`         | the saved setting        | Characters of one file a reviewer reads at once, 1 to 200000.                  |
| `--enable <lever>`             |                          | Switch on optional stages. Repeatable or comma-separated.                      |
| `--timeout <minutes>`          | the pipeline's own limit | Stop the review after this long.                                               |
| `--keep-checkout`              |                          | Leave the throwaway checkout on disk.                                          |

Lenses: `correctness`, `security`, `concurrency`, `api-contract`, `performance`, `rules`, `conventions`, `readability`.

Levers: `obligations`, `obligations-new-code`, `test-strength`, `caller-selection`, `residual`, `contract-checks`.

Output:

| Flag                                      | Default | Meaning                                                                         |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| `--format <text\|json\|markdown>`         | `json`  | Report format. `text` is laid out for a terminal.                               |
| `--output <file>`                         |         | Write the report here. Standard output then gets one JSON line naming the file. |
| `--min-severity <info\|warning\|error>`   | `info`  | Leave out findings below this.                                                  |
| `--include-unconfirmed`                   |         | Also write findings the review could not confirm.                               |
| `--fail-on <never\|info\|warning\|error>` | `never` | Exit 1 on a written finding at or above this.                                   |

Running:

| Flag                                    | Default | Meaning                                                                                                   |
| --------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `--progress <live\|text\|ndjson\|none>` | `text`  | Progress on standard error. `live` redraws in place on a terminal.                                        |
| `--detach`                              |         | Start the review in the background, print its run as one JSON line and exit at once. Not with `--diff -`. |

`--output` writes the filtered report to the file and prints a receipt such as:

```json
{
	"schemaVersion": 1,
	"outcome": "complete",
	"findings": 1,
	"unconfirmed": 0,
	"reportFile": "/home/dev/app/review.json"
}
```

## The other commands

`recoder wait -p <run-id> [--timeout <minutes>]` waits until the run ends or the timeout passes, then prints its status. It exits 0 either way: read `state`.

| Flag                  | Default                 | Meaning                       |
| --------------------- | ----------------------- | ----------------------------- |
| `--timeout <minutes>` | wait until the run ends | Stop waiting after this long. |

A signal stops the wait with exit 130. The run goes on.

`recoder status -p <run-id>` prints the run's status.

`recoder result -p <run-id> [flags]` prints a finished run's report, as `recoder review -p` would have. A run with no report prints its error. A run that is still running is a usage error (exit 2). It takes `--format`, `--output`, `--min-severity`, `--include-unconfirmed` and `--fail-on`, with the values and defaults of `review`. Its exit code is the one a foreground review would have: 3 for a failed run, 130 for a cancelled one.

`recoder cancel -p <run-id>` asks a running review to stop and prints its status with `stopRequested`. A run that is not running is left as it is, with `stopRequested` false.

`recoder runs -p [--repo <path>] [--limit <n>]` prints recent runs as a JSON array of statuses, newest first.

| Flag            | Default          | Meaning                                          |
| --------------- | ---------------- | ------------------------------------------------ |
| `--repo <path>` | every repository | List only the runs of this repository directory. |
| `--limit <n>`   | 20               | List at most this many runs.                     |

`recoder models -p [--provider <name>] [--search <text>]` prints the model ids that `--reviewer` and `--worker` accept on this machine, as one line of JSON: `{ reviewer, worker, models: [{ id, name, provider, efforts, defaultEffort }], problems }`. `reviewer` and `worker` are the saved picks, or null. A model with no effort levels has `efforts: []` and `defaultEffort: null`. An agent that could not list its models adds a line to `problems`; the other models are still listed. It exits 0, also for an empty list.

| Flag                | Default        | Meaning                                                                                |
| ------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `--provider <name>` | every provider | List only the models of these providers, ignoring case. Repeatable or comma-separated. |
| `--search <text>`   |                | List only models whose id or name contains this text, ignoring case.                   |

`recoder skill <show|install>` prints or installs this skill. `show` prints `SKILL.md`. `install -p` writes the skill to `<skills folder>/recoder` and prints one JSON line: `{"installed":"<path>","files":<n>}`.

| Flag                       | Default  | Meaning                                                                                            |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `--agent <claude\|agents>` | `claude` | Whose skills folder to use.                                                                        |
| `--scope <user\|project>`  | `user`   | `user`: `~/.claude/skills` or `~/.agents/skills`. `project`: the same under the working directory. |
| `--dir <path>`             |          | Use this skills folder instead; relative to the working directory. For any other agent.            |
| `--force`                  |          | Replace an existing `recoder` folder. Nothing beside it is touched.                                |

`recoder doctor -p` prints `{ ok, checks: [{ id, ok, required, detail, fix }] }`. `ok` is true when every check with `required: true` passed. Each failed check names its `fix`, or has `fix: null` when there is nothing to do. A failed check with `required: false`, such as `sandbox`, limits reviews and does not stop them.

## MCP tools

`recoder mcp` serves the commands as MCP tools on standard input and output.

| Tool             | Arguments                                                      | Returns                                |
| ---------------- | -------------------------------------------------------------- | -------------------------------------- |
| `recoder_doctor` | none                                                           | the doctor report                      |
| `recoder_models` | `provider` (a list), `search`                                  | the model list                         |
| `recoder_review` | the review flags as properties, such as `uncommitted`, `title` | the status object, with the `runId`    |
| `recoder_wait`   | `runId`, `timeoutSeconds` (45 by default, 600 at most)         | the status object                      |
| `recoder_status` | `runId`                                                        | the status object                      |
| `recoder_result` | `runId`, `format`, `min-severity`, `include-unconfirmed`       | the report, as JSON or markdown        |
| `recoder_cancel` | `runId`                                                        | the status object with `stopRequested` |
| `recoder_runs`   | `repo`, `limit`                                                | an array of status objects             |

`recoder_review` always starts a background run. It does not take `detach`, `output`, `progress` or the report flags, and `diff`, `body-file` and `instructions-file` must each name a regular file: not `-`, a pipe or a device. A tool that fails returns `isError` with one line of text; a hint in it names the tool to call. The client must send `initialize` before any tool call, as every MCP client does.

## Exit codes

The exit codes are in `SKILL.md`. `status`, `wait`, `cancel` and `runs` exit 0 when they print what was asked for. `review --detach` exits 0 when the background review started. It exits 3 when it did not start; the status line it prints has the `error` and the `logFile`.

## The status object

`--detach`, `status`, `wait` and `cancel` print this as one JSON object. `runs` prints an array of them. `cancel` adds `stopRequested`.

| Field           | Type                                             | Meaning                                                                                                                                                   |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | number                                           | 1 today                                                                                                                                                   |
| `runId`         | string                                           | pass it to `status`, `wait`, `result` and `cancel`                                                                                                        |
| `state`         | `running`, `complete`, `failed`, `cancelled`     |                                                                                                                                                           |
| `stage`         | string or null                                   | the last stage the review reported; null before the first. One of `checkout`, `understand`, `checks`, `reviewing`, `subagents`, `verify`, `consolidation` |
| `startedAt`     | string                                           | ISO time                                                                                                                                                  |
| `finishedAt`    | string or null                                   | null while running, and for a run whose process died                                                                                                      |
| `repoPath`      | string                                           | the repository that was reviewed                                                                                                                          |
| `targetKind`    | `range`, `staged`, `uncommitted`, `pull`, `diff` |                                                                                                                                                           |
| `findings`      | number or null                                   | confirmed findings; null until the review ends                                                                                                            |
| `unconfirmed`   | number or null                                   | null until the review ends                                                                                                                                |
| `exitCode`      | number or null                                   | what a foreground review would have exited with; null while running                                                                                       |
| `error`         | string or null                                   | why a `failed` or `cancelled` run stopped                                                                                                                 |
| `reportFile`    | string or null                                   | the stored report; null until it exists                                                                                                                   |
| `logFile`       | string or null                                   | standard error of a background run; a foreground run has none                                                                                             |
| `stopRequested` | boolean                                          | only from `cancel`: whether a stop was sent                                                                                                               |

A run whose process died without finishing reads as `failed`, with the error `the process ended without finishing`.

## The report

`recoder result -p` and a foreground `recoder review -p` print one object. `schemaVersion` changes when a field is removed or changes meaning.

| Field               | Type                              | Meaning                                                                                       |
| ------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `schemaVersion`     | number                            | 1 today                                                                                       |
| `outcome`           | `complete`, `failed`, `cancelled` | `failed` stopped early or read no part of the change; `cancelled` was a signal or `--timeout` |
| `summary`           | string                            | the review's own account of what it did and found                                             |
| `error`             | string or null                    | why a `failed` or `cancelled` review stopped                                                  |
| `target`            | object                            | what was reviewed (below)                                                                     |
| `settings`          | object                            | what the review ran with (below)                                                              |
| `findings`          | finding[]                         | confirmed findings, most severe first                                                         |
| `unconfirmed`       | finding[]                         | raised but not confirmed; empty in the output unless `--include-unconfirmed`                  |
| `recommendedChecks` | string[]                          | commands worth running before you merge                                                       |
| `coverage`          | object                            | `{ reviewed, pending, partial, excluded, total }`, counted in units of the change             |
| `coverageGaps`      | gap[]                             | `{ path, hunkId?, role?, state, reason }`; `state` is `pending`, `partial` or `excluded`      |
| `funnel`            | object or null                    | how many candidates each stage dropped                                                        |
| `questions`         | object or null                    | the questions the review asked itself and what became of them                                 |
| `obligations`       | object or null                    | null unless `--enable obligations` was given                                                  |
| `startedAt`         | string                            | ISO time                                                                                      |
| `durationMs`        | number                            | wall time                                                                                     |

`target`:

| Field                                | Type                                             | Meaning                                               |
| ------------------------------------ | ------------------------------------------------ | ----------------------------------------------------- |
| `kind`                               | `range`, `staged`, `uncommitted`, `pull`, `diff` | the target that was reviewed                          |
| `repoPath`                           | string or null                                   | absolute path of the repository; null for a bare diff |
| `base`, `head`                       | string or null                                   | refs, as named or detected                            |
| `baseSha`, `mergeBaseSha`, `headSha` | string or null                                   | commits; the change starts at `mergeBaseSha`          |
| `url`                                | string or null                                   | the pull request's address                            |
| `changedFiles`                       | number                                           | files in the reviewed diff                            |

`settings`:

| Field                            | Type                    | Meaning                                                       |
| -------------------------------- | ----------------------- | ------------------------------------------------------------- |
| `budget`                         | `low`, `medium`, `high` |                                                               |
| `subagents`                      | number or `uncapped`    | the most subagents the review could run                       |
| `reviewerModel`, `workerModel`   | string or null          | null is the saved model                                       |
| `reviewerEffort`, `workerEffort` | string or null          | `minimal`, `low`, `medium`, `high`, `xhigh`, `max`            |
| `lenses`                         | string[] or null        | null means every lens that applies ran                        |
| `reportLowSeverity`              | boolean                 | whether `info` findings were kept                             |
| `exec`                           | boolean                 | whether code could run; false means bugs are `unverified`     |
| `execReason`                     | string or null          | why code could not run (`--no-exec`, no sandbox, a bare diff) |

A finding:

| Field                       | Type                                           | Meaning                                                                                                     |
| --------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                        | string                                         |                                                                                                             |
| `title`                     | string, optional                               | short heading                                                                                               |
| `file`                      | string                                         | repository-relative path                                                                                    |
| `line`, `endLine`           | number, optional                               | the range, inclusive; a finding may have no line                                                            |
| `side`                      | `old`, `new`, optional                         | `old` is deleted code; the default is `new`                                                                 |
| `severity`                  | `error`, `warning`, `info`                     |                                                                                                             |
| `message`                   | string                                         | what is wrong and why it matters; may start with a `[category]` tag                                         |
| `suggestion`                | string, optional                               | how to fix it, in words                                                                                     |
| `category`                  | string, optional                               | for example `correctness`, `security`, `tests`, `duplication`, `readability`                                |
| `kind`                      | `bug`, `quality`, optional                     | a defect, or code that works but is harder to maintain                                                      |
| `lens`                      | string, optional                               | which lens or detector raised it                                                                            |
| `ruleId`, `smell`, `symbol` | string, optional                               | the repo rule broken, the readability smell, the enclosing function or class                                |
| `claim`                     | object, optional                               | `{ trigger, executionPath[{ file, line, note? }], consequence, violatedContract, existingGuard? }`          |
| `patch`                     | object, optional                               | `{ diff, checks[] }`: a unified diff rooted at the repository, and the commands that passed with it applied |
| `relatedLocations`          | `{ file, line?, endLine?, side? }[]`, optional | other places the finding points at                                                                          |
| `verification`              | object, optional                               | below                                                                                                       |

`verification`: `status` is `verified` or `unverified`; `reason` says what the run showed or why nothing proved it. Optional: `method` (`run`, `trace`, `detector`, `rule` or `convention`), `command` and `exitCode` of the proving run, `outcome` (`reproduced`, `traced`, `inconclusive`, `refuted`, `not-run`) and `evidence` (the command, its exit code, an excerpt of its output and a comparison with the merge-base tree).

## Where a run is stored

`<data dir>/cli-runs/<run-id>/`, with the data directory `RECODER_DATA_DIR` (default `~/.recoder/data`):

| File              | Holds                                                        |
| ----------------- | ------------------------------------------------------------ |
| `run.json`        | the run's record: the status fields and the process id       |
| `report.json`     | the complete, unfiltered report, once the review returns one |
| `progress.ndjson` | every progress event, one JSON object per line               |
| `background.log`  | standard error of a background run                           |

## Example: review a branch

The agent checks the machine once.

```text
$ recoder doctor -p
{
  "ok": true,
  "checks": [
    {
      "id": "git",
      "ok": true,
      "required": true,
      "detail": "git found at /usr/bin/git.",
      "fix": null
    },
    {
      "id": "data-dir",
      "ok": true,
      "required": true,
      "detail": "Data folder ~/.recoder/data is writable.",
      "fix": null
    },
    {
      "id": "workdir",
      "ok": true,
      "required": true,
      "detail": "Checkout folder /tmp/recoder-work is writable.",
      "fix": null
    },
    {
      "id": "review-model",
      "ok": true,
      "required": true,
      "detail": "Review model fake-model; subagent model fake-model.",
      "fix": null
    },
    {
      "id": "sandbox",
      "ok": true,
      "required": false,
      "detail": "Reviewers can run code in the sandbox.",
      "fix": null
    }
  ]
}
```

It starts the review in the background and keeps the `runId`.

```text
$ recoder review -p --detach --title "Back off between retries" --body "Failed sync jobs wait longer after each failed attempt."
{"schemaVersion":1,"runId":"20261110-180048-bb5dee","state":"running","stage":null,"startedAt":"2026-11-10T18:00:48.543Z","finishedAt":null,"repoPath":"/home/dev/app","targetKind":"range","exitCode":null,"error":null,"findings":null,"unconfirmed":null,"reportFile":null,"logFile":"~/.recoder/data/cli-runs/20261110-180048-bb5dee/background.log"}
```

It waits. The first wait uses a very short timeout, so the run is still `running`. The second wait returns when the run ends.

```text
$ recoder wait -p 20261110-180048-bb5dee --timeout 0.1
{"schemaVersion":1,"runId":"20261110-180048-bb5dee","state":"running","stage":"checks", … }

$ recoder wait -p 20261110-180048-bb5dee --timeout 5
{"schemaVersion":1,"runId":"20261110-180048-bb5dee","state":"complete","stage":"consolidation","startedAt":"2026-11-10T18:00:48.543Z","finishedAt":"2026-11-10T18:01:04.847Z","repoPath":"/home/dev/app","targetKind":"range","exitCode":0,"error":null,"findings":1,"unconfirmed":0,"reportFile":"~/.recoder/data/cli-runs/20261110-180048-bb5dee/report.json","logFile":"~/.recoder/data/cli-runs/20261110-180048-bb5dee/background.log"}
```

It reads the result.

```text
$ recoder result -p 20261110-180048-bb5dee --format markdown
# Recoder review: complete

Review complete. 1 finding. 1 bug is not verified: no type check, lint or test command was found to run here. The review brief read 0 of 1 changed units in full.

- Target: range main...HEAD, head bc302c7, /home/dev/app, 1 changed files
- Settings: budget low, subagents 3, model fake-model, subagent model fake-model, all lenses, low severity on, exec on
- Findings: 0 error, 1 warning, 0 info
- Unconfirmed: 0
- Coverage: 2 of 2 reviewed, 0 partial, 0 pending, 0 excluded
- Duration: 16.1s

## Findings

### warning: Backoff delay overflows for large attempts (`src/retry.ts:4`)

[correctness] The shift `1 << attempt` wraps around at 32 bits, so the backoff stops growing and restarts from a tiny delay.

Verification: unverified. Not verified: no type check, lint or test command was found to run here.
```

The same finding in the JSON report (`recoder result -p 20261110-180048-bb5dee`), under `findings`:

```json
{
	"id": "aa22a999-e477-421b-a1b3-211910351289",
	"title": "Backoff delay overflows for large attempts",
	"file": "src/retry.ts",
	"line": 4,
	"endLine": 4,
	"side": "new",
	"severity": "warning",
	"message": "[correctness] The shift `1 << attempt` wraps around at 32 bits, so the backoff stops growing and restarts from a tiny delay.",
	"category": "correctness",
	"kind": "bug",
	"lens": "correctness",
	"symbol": "nextDelayMs",
	"claim": {
		"trigger": "nextDelayMs is called with an attempt of 31 or more",
		"executionPath": [
			{
				"file": "src/retry.ts",
				"line": 4,
				"note": "1 << attempt wraps at 32 bits"
			}
		],
		"consequence": "The delay becomes zero or negative, so the retry fires at once",
		"violatedContract": "The delay grows with each attempt"
	},
	"verification": {
		"status": "unverified",
		"outcome": "not-run",
		"reason": "Not verified: no type check, lint or test command was found to run here."
	}
}
```

The finding is `unverified`: no test command was found to run, and `verification.reason` says so. The agent reads `src/retry.ts:4`, confirms that `1 << attempt` wraps at 32 bits, and fixes it. It then runs `recoder review -p --detach --uncommitted --include "src/retry.ts" --title "Cap the retry backoff delay"` and the same `wait` loop on the touched file.

`recoder result -p 20261110-180048-bb5dee --fail-on warning` prints the same report and exits 1, because the finding is a `warning`.

## Example: stop a run

A background run can be stopped. `cancel` sends the stop and prints the status with `stopRequested`; the run is still `running` at that moment. `wait` returns when it has ended.

```text
$ recoder review -p --detach --title "Retry failed sync jobs" --body "Sync jobs retry up to 5 times with backoff."
{"schemaVersion":1,"runId":"20261110-175854-3a42d6","state":"running","stage":null,"startedAt":"2026-11-10T17:58:54.797Z","finishedAt":null,"repoPath":"/home/dev/app","targetKind":"range","exitCode":null,"error":null,"findings":null,"unconfirmed":null,"reportFile":null,"logFile":"~/.recoder/data/cli-runs/20261110-175854-3a42d6/background.log"}

$ recoder cancel -p 20261110-175854-3a42d6
{"schemaVersion":1,"runId":"20261110-175854-3a42d6","state":"running","stage":"checks","startedAt":"2026-11-10T17:58:54.797Z","finishedAt":null,"repoPath":"/home/dev/app","targetKind":"range","exitCode":null,"error":null,"findings":null,"unconfirmed":null,"reportFile":null,"logFile":"~/.recoder/data/cli-runs/20261110-175854-3a42d6/background.log","stopRequested":true}

$ recoder wait -p 20261110-175854-3a42d6 --timeout 1
{"schemaVersion":1,"runId":"20261110-175854-3a42d6","state":"cancelled","stage":"reviewing","startedAt":"2026-11-10T17:58:54.797Z","finishedAt":"2026-11-10T17:59:16.257Z","repoPath":"/home/dev/app","targetKind":"range","exitCode":130,"error":"The review was cancelled.","findings":0,"unconfirmed":0,"reportFile":"~/.recoder/data/cli-runs/20261110-175854-3a42d6/report.json","logFile":"~/.recoder/data/cli-runs/20261110-175854-3a42d6/background.log"}
```

A cancelled run still has a report, with the coverage it reached. `result` exits 130 for it.

```text
$ recoder result -p 20261110-175854-3a42d6 --format markdown
# Recoder review: cancelled

Review cancelled.

Error: The review was cancelled.

- Target: range main...HEAD, head dde0235, /home/dev/app, 1 changed files
- Settings: budget low, subagents 3, model fake-model, subagent model fake-model, all lenses, low severity on, exec on
- Findings: 0 error, 0 warning, 0 info
- Unconfirmed: 0
- Coverage: 0 of 1 reviewed, 0 partial, 1 pending, 0 excluded
- Duration: 21.3s

## Coverage gaps

- a.ts (pending): assigned
$ echo $?
130
```
