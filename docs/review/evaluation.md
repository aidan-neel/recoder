# How Reviews Are Measured

The benchmark reviews labeled PRs, judges each run's findings against planted defects, and writes a report.
The report records the conditions it ran under (its identity), so two reports can be compared field by field.
All eval CLIs live in `apps/server/src/eval/`. Most have a script in `apps/server/package.json`.

## Running a Benchmark

```sh
bun run --filter @recoder/server eval:benchmark -- --dataset <dir> [flags]
```

Flags come from `parseOptions` in `apps/server/src/eval/benchmark.ts` and `parseEvalArgs` in `apps/server/src/eval/cli.ts`.

- `--dataset <dir>`: required. The dataset directory (see Dataset Layout).
- `--only <id,id>`: review only these label ids. Task set name `only`.
- `--set <name>`: review only the ids in `<dataset>/sets/<name>.json`. Cannot combine with `--only`.
- `--judge review|second|<model id>`: default `review`. `review` uses the orchestrator model's config. `second` uses the specialist (subagent) model's config. Anything else is a model id: a settings model entry id, or an `opencode:` or `claude-code:` id.
- `--judge-effort <effort>`: one of `REASONING_EFFORTS` in `packages/shared/src/models.ts` (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Applies only to a model id judge.
- `--runs <n>`: runs per PR. Default 1.
- `--repeat <k>`: this is repeat `k`. Run indices start after `(k - 1) * runs` (`runOffset`). Default 1.
- `--concurrency <n>`: reviews at once. Default 3.
- `--timeout <minutes>`: each review's time limit, in minutes. Default 45. Recorded as `execution.timeoutMs`.
- `--base <url>`: the server. Default `http://localhost:3001`.
- `--no-baseline-cache`: every baseline check runs again instead of using the baseline cache. Recorded as `execution.baselineCache: false`.
- `--resume <report.json>`: keep that report's judged runs and run only the missing or failed ones.
- `--replay <report.json>`: replay each passed review of that report from its kept checkpoint, without reviewers. Verification verdicts are kept. Runs with no passed review are skipped.
- `--reverify <report.json>`: like `--replay`, but every candidate is verified again. This calls models.
- `--mode auto --since <report.json>`: pick the cheapest mode that covers what changed since that report.
- `--allow-diff <field,field>`: identity fields this run may differ in from the report it reuses.
- `--shard i/n`: review only part `i` (1-based) of `n` of the chosen tasks.

Flag rules, enforced by `parseOptions`:

- `--replay` and `--reverify` are exclusive. Neither combines with `--resume`.
- `--mode` only takes `auto`, needs `--since`, and does not combine with `--resume`.
- `--allow-diff` needs `--resume`, `--replay`, `--reverify` or `--mode auto`.
- An explicit `--replay` or `--reverify` wins over `--mode auto` (`resolvePlan` in `apps/server/src/eval/auto-plan.ts`).

`--mode auto` (`chooseMode` in `apps/server/src/eval/auto-mode.ts`) diffs the tree against the report's `harness` record.
Each changed path maps to a mode by prefix in `apps/server/src/eval/change-map.ts`.
The modes, cheapest first, are `rescore`, `replay`, `reverify`, `full`. An unmapped path needs `full`.
A report with no harness record, or a tree git cannot compare, gets `full`.
When auto picks `rescore`, the benchmark judges the saved runs again and starts no review. `--runs` is then the origin's `runsPerPr`.

A replay updates the review in place. Replaying a report twice replays the first replay's result.
A reuse refuses a report of another repeat (`checkRepeat`). Pass the `--repeat` and `--runs` it ran with.
`--shard` refuses more shards than tasks. Shards cut tasks ordered by codebase, then id (`apps/server/src/eval/shard.ts`).

The report is saved to `evals/benchmark-<dataset>-<startedAt>.json` under the harness's data directory (`writeEvalFile` in `apps/server/src/eval/report.ts`).
It is rewritten after every run.

## Dataset Layout

A dataset is a directory:

- `labels/`: one JSON file per labeled PR. Each is a `PrLabel` (`apps/server/src/eval/task-set.ts`): `id`, `codebase`, `repo`, `pull`, `headSha`, `verified`, `defects`.
- `repo` is the local forge repo's `file://` URL. Several labels can share one repo.
- Each defect is a `LabeledDefect` (`apps/server/src/eval/benchmark-score.ts`): `id`, `kind` (`bug` or `quality`), `category`, `file`, `line`, `endLine`, `title`, `description`, `fix`.
- A label with no defects is a control PR. It only measures what a review publishes wrongly.
- `sets/`: named task sets, `<name>.json`. Schema `TaskSet`: `name`, `tasks`, `sources`, `selectedAt`, `rule`. The name is lowercase letters, digits and dashes, and not `full` or `only`. `eval:select-set` writes them.
- adjudications.json: human decisions (`adjudicationPath` in `apps/server/src/eval/benchmark-labels.ts`). See Adjudications.

A set or `--only` id with no label file refuses the run.

### Registering forge repos

The server must track each label's forge repo before a benchmark.
Register a repo with `POST /api/repos` (`apps/server/src/routes/repos.ts`). Body: `name`, `url`, `provider` (`github`, `gitlab` or `local`), `defaultBranch`.
A `file://` URL needs `provider: "local"`, and the server checks it is a git repository.
Nothing registers a PR. The benchmark starts each review with `POST /api/reviews` and the repo id plus `pull`.

`resolveRepo` (`apps/server/src/eval/client.ts`) reads `GET /api/repos` once per distinct label `repo`.
It matches a tracked repo by id, by name, by URL (ignoring `.git` and a trailing slash), or by a URL ending in `/<query>`.
No match throws and lists the tracked repos.

### Adjudications

The adjudications file has two kinds of entries:

- Finding labels, keyed by `findingKey` (`<pr>:<fingerprint>`, or `<pr>:<file>:<line>:<category>` without a fingerprint). Value: `label` (`additional`, `false` or `unresolved`), `file`, `line`, `title`, `note`.
- Match corrections, keyed `match:<pr>:<defect id>:<16-hex claim hash>` (`matchKey`). Value: `reports`, `reason`. They override the judge's call on that claim and defect.

The judge decides `planted` and `duplicate`. A finding with no label is `unresolved`.
The benchmark adds every unlabeled finding to the file as `unresolved` (`queueUnresolved`) and writes it back.
`eval:rescore` reads the file and never writes it.

## Identity

`RunIdentity` in `apps/server/src/eval/identity.ts` records what decides a result. `captureIdentity` in `apps/server/src/eval/identity-capture.ts` fills it.

`hash` covers only the `EXPERIMENT` fields:

- `dataset`: `name`; `labels`, a hash of every file in `labels/`; `adjudications`, a hash of the human decisions, `unresolved` entries left out; `forges`, each codebase's forge `head` and a `metadata` hash.
- `code`: `harness` and `server`. Each is `source:<hash>` of `apps/server/src/`, `packages/shared/src/`, the two package manifests and `bun.lock`, by content (`sourceVersion`).
- `models`: `orchestrator` and `specialist`, each `model`, `provider`, `effort`, `sampling`, `contextSize`.
- `judge`: `model`, `provider`, `effort`, `version` (`JUDGE_VERSION`), `seed` (`JUDGE_SEED`).
- `flags`: every set `RECODER_*` variable except keys, endpoints, paths and sandbox sizing (`capturedEnv`).
- `limits`: `settings` (reviewer settings) and `policy` (review policy budgets).
- `caches`: each server cache's format version, plus `benchmark-judge`.
- `tools`: `bun`, `node`, `opencode` versions.

Checked but outside the hash:

- `tasks`: each `taskId` (`<id>@<headSha>`) with its `base` commit.
- `taskSet`: `full`, `only`, or a set name.
- `shard`: `index`, `count`, `tasks` (this shard's task ids), `all` (every task id of the set).

Recorded and shown, never checked (informational):

- `host`: `name`, `os`, `arch`, `cpus`, `sandbox`, `sandboxFlags`, `serverCommit`, `inference`.
- `execution`: `mode` (`full`, `partial`, `resume`, `replay`, `reverify`, `rescore`), `auto`, `concurrency`, `timeoutMs`, `runsPerPr`, `baselineCache`, `repeat`.
- `unavailable`: why a field is `unknown`.

`runs` counts the report's runs by the identity hash each was reviewed under. A reused run keeps its own hash.
A server with no `GET /health/identity` route leaves `code.server`, `flags`, `limits.policy`, `caches` and `tools` as `unknown`.

## Checking Compatibility

`checkCompatibility` in `apps/server/src/eval/identity.ts` sorts the differences between two identities for one operation.
`eval:compare` (`apps/server/src/eval/compare.ts`), `eval:merge` and benchmark reuse (`checkReuse` in `apps/server/src/eval/benchmark-reuse.ts`) all call it.

- A checked field that differs refuses, unless the operation exempts it or `--allow-diff` declares it.
- A checked field outside the exemptions that is `unknown` on either side refuses, even when both are `unknown`. Only `--allow-diff` lets it through.
- An `--allow-diff` name that is no field of either identity refuses, so a typo never declares nothing.
- `--allow-diff` takes a section or a dotted field under `identity`, `runs`, `reviewer`, `tasks`, `taskSet`, `shard`, or an `EXPERIMENT` section.

Exempt fields per operation (`EXEMPT`):

- `resume`: `dataset.adjudications`.
- `replay`: `dataset.adjudications`, `dataset.labels`, `judge`, `code`, `limits.policy`, `caches`.
- `compare`: `dataset.adjudications`.
- `merge`: `tasks`, `shard.index`, `shard.tasks`.

`checkReuse` uses `resume` for `--resume` and `replay` for every other reuse (replay, reverify, auto rescore).

Only compare and merge (`RUN_CHECKED`) also check runs and reviewers:

- A report holding runs reviewed under another hash than its own is unverifiable unless `--allow-diff runs`.
- A report whose `summary.mixedReviewer` is `true` refuses unless `--allow-diff reviewer`.

A report with no identity:

- `eval:compare` warns and still prints the counts.
- `eval:merge` always refuses it.
- A reuse refuses it unless `--allow-diff identity`.

`eval:compare <a.json> <b.json> [--allow-diff field,field]` exits 1 when a field is refused or unverifiable, or an `--allow-diff` name is no field.
It also exits 1 when a merge into either report declared a difference this compare does not declare. Declare `shard` for a shard field, and the field plus `runs` for an experiment field.
Otherwise it prints planted defects by codebase as candidate/verified/published of planted, and exits 0.

## Judge Versioning

`JUDGE_VERSION` in `apps/server/src/eval/benchmark-judge.ts` is 2. It is bumped when the judge prompt or scoring changes.
It is part of the judge cache key, `identity.judge.version` and `identity.caches.benchmark-judge`. Old verdicts are never reused under a new version.
The judge runs at temperature 0 with `JUDGE_SEED` (`apps/server/src/eval/benchmark-scoring.ts`).
A finding counts for a defect only when the judge says both its behavior and its cause are the defect's.
A judge version change differs in `judge` and `caches`. Compare and merge refuse it unless declared. A replay, reverify or auto rescore reuse exempts it.

## Rescoring

```sh
bun run --filter @recoder/server eval:rescore -- <in-report.json> <out-report.json> [--judge <model id>] [--judge-effort <effort>] [--dataset <dir>]
```

`apps/server/src/eval/rescore.ts` judges a saved report again from its saved findings and candidate pools.

- It starts no review and contacts no server. A run with no saved pool gets no stages.
- `--judge` defaults to the input's judge. That works only for an OpenCode judge (`judgeChoice`). Otherwise pass `--judge`.
- `--judge-effort` defaults to the input judge's effort. `--dataset` defaults to the dataset named by `report.dataset` under the user's recoder directory.
- It refuses an output that exists or equals the input.
- Labels come from the dataset. A PR with no label file refuses the rescore.
- Each run's `reviewer` and `summary.mixedReviewer` are kept.

The new identity rewrites `dataset.labels`, `dataset.adjudications`, `code.harness`, `judge`, `caches.benchmark-judge`, and sets `execution.mode` to `rescore` and `execution.auto` to `false`.
`code.server` is kept. Each run keeps the hash it was reviewed under.
The report gets `rescoredFrom` (`RescoredFrom`): `path`, `sha256`, `judge` (input judge with its `version`), `rescoredBy` (new judge with `version`), `withoutPool`, `withoutIds`.
`derivedFrom` gets a `rescore` entry.

## Merging

```sh
bun run --filter @recoder/server eval:merge -- <out.json> <report.json>... [--partial] [--allow-diff field,field]
```

`apps/server/src/eval/merge.ts` combines shard and repeat reports of one experiment. It judges nothing again.
It exits 1, listing every reason (`mergeProblems`, `mergeReports`), when:

- the output exists;
- a report has no identity;
- an identity differs from the first in an undeclared or unverifiable field;
- an `--allow-diff` name is no field;
- one PR appears at two heads;
- a run id is listed twice under one report id, or a task repeat is held by more than one report;
- tasks or runs are missing and `--partial` is not passed.

With `--partial`, missing runs set `summary.partial`, `summary.missingTasks` and `summary.missingRuns`.
The merged report (`MergedReport`) keeps the first report's identity without `shard`, the union of tasks, and a new `reportId`.
`merge` holds `judging`, `reports` (each source's shard, repeat, host, base, `startedAt`, `finishedAt`, `elapsedMs`, `runIds`), and `declared` differences.
Shards run with `execution.mode` `partial`. When they cover the `full` task set with no missing run, the merged mode is `full`.

## Report Shape

`BenchmarkReport` in `apps/server/src/eval/benchmark-report.ts`:

- `dataset`, `base`, `runsPerPr`.
- `judge`: `JudgeModel` (`model`, `provider`, `effort`).
- `reviewer`: `ReviewerManifest` from the server settings.
- `harness`: `HarnessRecord`, `tree` (the tree that wrote the report) and `reviewers` (the tree the reviewers ran on).
- `reportId`: minted on a fresh start, kept by resume, replay, reverify and rescore.
- `identity`, `runIds`, `derivedFrom` (`Derivation` list: `operation`, `report`, `identity`, `declared`), `rescoredFrom`.
- `startedAt`, `finishedAt`: ISO timestamps.
- `prs`, `summary`.

`summary` (`BenchmarkSummary` in `apps/server/src/eval/benchmark-score.ts`):

- `overall`, `byCodebase`, `byKind`, `byCategory`: `Totals` (`planted`, `found`) over passed runs' shown findings. This is published recall.
- `defectStability`: of defects found in some run, the share found in every run.
- `hidden`: `candidates`, `matched`, `lost` for candidates verification hid.
- `stages`: `StageTotals` (`planted`, `found`, `verified`, `published`, `stoppedAt`). `found` means some candidate reported the defect.
- `lows`: `LowTotals`, published below-the-bar findings by reason, each `published`, `matched`, `duplicates`, `unlabeled`.
- `labels`: `LabelSummary`, finding classes (`planted`, `additional`, `false`, `unresolved`, `duplicate`) overall, by codebase, by evidence, and for control PRs.
- `taskSet`, `mixedReviewer`.

`PrResult`: `id`, `taskId`, `baseSha`, `codebase`, `pull`, `verified` (copied from the label), `defects`, `control`, `staleHead` (a run reviewed another head), `agreement` (`strict` by fingerprint, `loose` by file, category and symbol), `runs`.

`ScoredRun` is a `RunRecord` (`apps/server/src/eval/report.ts`) plus scoring:

- From the review: `index`, `reviewId`, `outcome` (`passed`, `failed`, `cancelled`, `timeout`), `headSha`, `durationMs`, `summary`, `findings`, `findingIds`, `hidden`, `unconfirmed`, `funnel`, `candidates`, `cachedChecks`.
- `runId`: `<taskId>#<index>`.
- `cache`: `RunCache`, with `review` one of `fresh`, `resume`, `replay`, `reverify`, `rescore`.
- `identity`: the hash the run was reviewed under. `judge`: the judge that scored it.
- `reviewer`: see Reviewer Audit.
- `score`: `PrScore`: `found` (defect id to finding index), `reasons`, `missed`, `duplicates`, `unlabeled`, `repeats`, `notes`, `adjudicated`.
- `hiddenScore`: the same for hidden candidates.
- `pool`: every candidate with the stage that stopped it.
- `stages`: per defect a `DefectStage`: `found`, `verified`, `published`, `stoppedAt`, `reason`, `matches`, `lost`.
- `lows`, `labeled` (classes from the adjudications), `judgeError`.

Only `passed` runs are judged. A failed run, or one the judge failed on, has `score: null`.

## Reviewer Audit

Each run's `reviewer` is a `RunReviewer` (`apps/server/src/eval/run-reviewer.ts`).
The benchmark reads it from `GET /api/reviews/<id>/metrics/stored` after the review (`readReviewer`).

- `orchestrator`, `specialist`: the last pipeline run's locked picks, or `not recorded`.
- `pipelineRuns`, `lockMisses`, `unlockedCalls`, `calledModels`.
- `verdict`: `CLEAN`, `MIXED` or `MISSING` (no stored metrics).
- `mixed`: `true` when the verdict is `MIXED` or a locked pick differs from the declared model.
- `reasons`: why it is mixed.

A review is `MIXED` when a pipeline call used a model outside its run's picks or the declared models, when its pipeline runs locked different picks, or when it has lock misses or unlocked calls.
`summary.mixedReviewer` is `true` if any run is mixed, `false` if every recorded run is clean, and `not recorded` if none is recorded.

`apps/server/src/eval/reviewer-audit.ts` audits a report against the server's SQLite store directly. It has no package script:

```sh
cd apps/server && bun src/eval/reviewer-audit.ts <report.json> <recoder.db> [--snapshot]
```

- It opens the store read-only. `--snapshot` opens it immutable. Use that only on a copy nobody writes to.
- It prints each run's segments (one per pipeline run), calls by model, lock misses and verdict, then a summary.
- Exit codes: 0 when no run is `MIXED`, 1 when any run is `MIXED`, 2 on a usage error. `MISSING` runs do not fail it.

## Rules for a Valid Comparison

Enforced by `checkCompatibility`, run by `apps/server/src/eval/compare.ts` and `apps/server/src/eval/merge.ts`:

- Same `dataset` name, labels, forges and decided adjudications. Adjudications are exempt for compare, not for merge.
- Same `code.harness` and `code.server`.
- Same `models`, `judge` (including `version` and `seed`), `flags`, `limits`, `caches`, `tools`.
- Same `tasks`, `taskSet` and `shard`, except the merge exemptions.
- No `unknown` checked field, unless declared.
- Every run reviewed under its report's hash, unless `--allow-diff runs`.
- No mixed reviewer, unless `--allow-diff reviewer`.

Enforced by `apps/server/src/eval/merge.ts` only:

- No run counted twice. Each repeat needs its own `--repeat`.
- One head per PR.
- No missing tasks or runs, unless `--partial`.

Free to differ: `host`, `execution` (mode, concurrency, timeout, runs per PR, baseline cache, repeat) and `unavailable`.

Policy, not enforced by code:

- Read `derivedFrom` and every declared difference before trusting a comparison.
- A partial merge or a subset task set is no full-set score. The printouts say so; do not report it as one.
