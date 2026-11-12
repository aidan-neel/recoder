---
name: recoder
description: Reviews a code change with Recoder's review pipeline and returns findings you can fix. Use when asked to review a change, a branch or a pull request with Recoder, when you want an independent review of your own work before you finish or open a pull request, or when the user mentions recoder. Needs the `recoder` command on the PATH.
---

# Recoder

Recoder reviews a change. Reviewers read the diff and the code around it, then verifiers try to reproduce each reported bug by running code in a sandbox. It reports findings and never edits the repository: you decide what to change.

A review takes 5 to 40 minutes. The commands and flags below are complete; `reference.md` beside this file has the full flag list, the report fields and two example sessions.

## Always pass `-p`

Pass `-p` (`--programmatic`) to every `recoder` command, right after the command's name. With it the command prints JSON whose fields do not change shape, and plain progress lines. Without it the output is laid out for a person at a terminal: colors, tables and a live progress view that you cannot parse.

## Before the first review

Run `recoder doctor -p`. It prints JSON and exits 0 when a review can run.

If it exits 4, read each check with `"ok": false`. Tell the user its `fix` line, word for word, and stop. Do not configure models, sign in to providers or edit settings yourself.

A failed check with `"required": false` (usually `sandbox`) does not stop reviews. It means no code can run, so bugs come back `unverified`.

## The loop

A review outlasts a shell tool's time limit, so run it in the background and poll.

1. Start it. Keep the `runId` from the one JSON line it prints:
   `recoder review -p --detach --title "<what the change does>"`
   Exit 3 means the review did not start. Read `error` in that line, then tell the user.
2. Wait. Set `--timeout` in minutes, below your shell limit (use 5 if you do not know it):
   `recoder wait -p <run-id> --timeout 5`
   It exits 0 when the run ends and when the timeout passes. Read `state` in the JSON. Run it again while `state` is `running`. Without `--timeout` it does not return until the run ends, which can pass your shell limit.
3. Read the result once `state` is not `running` (`result` on a running run exits 2):
   `recoder result -p <run-id> --format markdown`
4. Act on the findings (see "Acting on findings"), then run the loop again on the touched files.

`recoder status -p <run-id>` prints the state without waiting. `recoder cancel -p <run-id>` asks a running review to stop. `recoder runs -p --repo .` lists the newest runs of this repository, so you can find a `runId` you lost.

## With MCP tools

If the `recoder_*` tools are available, use them and not the shell. The loop is the same: `recoder_doctor` once, `recoder_review`, then `recoder_wait` with the `runId` until `state` is not `running`, then `recoder_result`. The review flags below are the properties of `recoder_review`, under the same names without the dashes in front. `recoder_wait` takes `timeoutSeconds`, in seconds. Pass `diff`, `body-file` and `instructions-file` as paths of regular files. A tool that fails returns one line of text in place of an exit code.

## Choosing the target

The target flags are mutually exclusive. With none, Recoder reviews the commits on the current branch since it left the default branch.

- no flag: the branch against the default branch. Use it for committed work. Add `--base <ref>` if the default branch is wrong.
- `--uncommitted`: everything not committed, untracked files included. Use it when you have not committed yet.
- `--staged`: only what is staged. Use it before a commit.
- `--pull <number or url>`: a pull or merge request on GitHub or GitLab. Needs the forge CLI (`gh` or `glab`) signed in.
- `--diff <file or ->`: a unified diff, from a file or standard input. Use it when there is no repository. No code runs, so bugs are `unverified`. `--detach` needs a file, not `-`.

Recoder reviews a throwaway copy. It never changes your working tree, index or branches.

## Say what the change is for

The review checks the change against its stated intent, so a real description gives better findings.

- `--title "<one line>"` names the change.
- `--body "<text>"` or `--body-file <path>` says what it should do and why.
- `--instructions "<text>"` says what to look for or leave out. It costs one model call.

Never put secrets in these. With `--pull` the forge's title and body are used unless you pass your own.

## Cost and depth

Start with the default: `--budget low` runs one reviewer, up to 3 subagents and low effort. Verifiers run in every budget.

- Raise it to `--budget medium` (2 or 3 reviewers, up to 8 subagents) for a large or risky change. `--budget high` runs 4 reviewers and up to 12 subagents and takes the longest.
- Narrow it when the change is big and you care about one thing: `--lens correctness,security` runs only those lenses, `--skip-lens readability` drops one. `--include "src/api/**"` and `--exclude "**/*.test.ts"` limit the paths.
- Leave the models alone unless the user names one. When they do, `recoder models -p` prints the ids this machine accepts; pass one as `--reviewer <id>` (the reviewers), `--worker <id>` (the subagents) or `--verifier <id>` (the verifiers, which follow the reviewers' model otherwise). Each applies to this run only.
- `--subagents 0` turns subagents off. The review is faster and cheaper, and misses the questions subagents would have followed up.
- `--no-exec` runs no code. It is the safest and cheapest option, and every bug comes back `unverified`.

## Reading the report

- `outcome`: `complete`, `failed` or `cancelled`. Only `complete` is a result.
- `findings`: what the review stands behind, most severe first.
- `unconfirmed`: raised but not confirmed, because no verifier could settle them or one refuted them. Hidden unless you pass `--include-unconfirmed` to `recoder result -p`. Read them only for a high-risk change.
- `coverageGaps` and `coverage`: what was not reviewed. A `complete` review with gaps did not read everything. Say so to the user and do not call the change clean.
- `recommendedChecks`: commands worth running before you merge. Run them.
- `settings.exec` and `settings.execReason`: whether code could run.

Each finding has `severity` (`error`, `warning`, `info`), `file`, `line`, `title`, `message`, and sometimes `suggestion` and `patch`. `verification.status` is `verified` when something proved the finding: a command that reproduced it, a trace through the code, a detector, a repo rule or a convention (`verification.method` says which). It is `unverified` when nothing did, for example because no test command was found; `verification.reason` says why.

## Acting on findings

1. Read the code at `file:line` and confirm the problem before you change anything.
2. Treat an `unverified` finding as a claim to check, not a fact.
3. Fix `error` and `warning` first. Fix `info` only when it is cheap.
4. When a finding has a `patch`, apply it if it still fits the code. It was applied and checked in the sandbox against the code as reviewed. It is a unified diff rooted at the repository, so `git apply` takes it.
5. After fixing, run a narrower review of the files you touched: `recoder review -p --detach --uncommitted --include "<path>" --title "<what you fixed>"`, then the loop again.
6. Tell the user which findings you fixed, which you rejected and why, and which you did not get to.

## Exit codes

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 0    | The command finished and no finding met `--fail-on`.                     |
| 1    | The review finished and a finding met `--fail-on`. Only happens with it. |
| 2    | A flag or argument was wrong. Nothing ran. Fix the command.              |
| 3    | The review did not finish, or it read no part of the change.             |
| 4    | The machine is not ready. Run `recoder doctor -p`.                       |
| 130  | A signal or `--timeout` stopped the review.                              |

`recoder result -p` exits 3 for a `failed` run and 130 for a `cancelled` one.

## Do not

- Pipe the output into `head`, `grep` or anything that closes early, and do not parse standard error. Standard error is progress text for people. The stored report is the `reportFile` in the status.
- Start several reviews of the same change at once. They repeat the same cost and return the same findings.
- Treat a `failed` or `cancelled` run as a clean result. Read `error`, then run again or tell the user.
