# Review pipeline

This page traces one review from trigger to published findings and feedback. It is for an agent that operates, changes or evaluates the review process. Terms are defined in [glossary.md](glossary.md). Running a review is in [operating.md](operating.md). Flags and limits are in [configuration.md](configuration.md). Model roles are in [models.md](models.md). Measuring the pipeline is in [evaluation.md](evaluation.md). The index is [README.md](README.md).

## Stages at a glance

| #   | Stage                      | Entry function                                      | Entry file                                                 | Output type                                   |
| --- | -------------------------- | --------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| 1   | Trigger and lifecycle      | `queueReview`, `runReviewPipeline`                  | `apps/server/src/commands/pipeline.ts`                     | `ReviewStatus`, `ReviewOutcome`               |
| 2   | Checkout and sandbox       | `prepareSandbox` (two of them, see stage 2)         | `apps/server/src/review/pipeline/harness/sandbox-setup.ts` | `ReviewRevision`, `BaselineResult`            |
| 3   | Inventory and change model | `buildInventory`, `changeModelStage`                | `apps/server/src/review/pipeline/inventory.ts`             | `ReviewInventory`, `ChangeModel`              |
| 4   | Intent                     | `intentStage`                                       | `apps/server/src/review/pipeline/harness/intent-stage.ts`  | `ChangeIntent`                                |
| 5   | Reviewer slices and briefs | `cutUnits`, `partitionReviewers`, `partitionUnits`  | `apps/server/src/review/pipeline/harness/unit-stage.ts`    | `ReviewUnit`, `UnitBrief`                     |
| 6   | Reviewers, subagents       | `runUnitPool`, `runSubagents`                       | `apps/server/src/review/pipeline/harness/pool.ts`          | `ReviewerOutput`, then `CandidateFinding`     |
| 7   | Obligations (flagged)      | `deriveObligationsStage`, `runUnitsWithObligations` | `apps/server/src/review/pipeline/obligations/stage.ts`     | `ObligationReport`                            |
| 8   | Detectors                  | `detectorStage`, `diagnosticStage`                  | `apps/server/src/review/pipeline/harness/quality-stage.ts` | `DetectorResult`                              |
| 9   | Validation and repair      | `validateCandidate`, `repairCandidate`              | `apps/server/src/review/pipeline/consolidate.ts`           | `CandidateFinding`, `CandidateRepair`         |
| 10  | Verification               | `startVerification`, `finishVerification`           | `apps/server/src/review/pipeline/harness/verification.ts`  | `FindingVerification`, `BaseComparisonResult` |
| 11  | Consolidation, publication | `consolidate`, `completeReview`                     | `apps/server/src/review/pipeline/harness/consolidation.ts` | `Finding`, `ReviewFunnel`                     |
| 12  | Feedback and history       | `learnFromDecision`, `withTopics`, `carryHistory`   | `apps/server/src/review/guidelines/learned/decision-learning.ts` | `FindingDecision`, `LearnedRuleProposal`, `FindingHistory` |

The entry file is the first function's file. Each stage section names the files of the others.

The adaptive harness is `runAdaptiveReview` in `apps/server/src/review/pipeline/harness/run.ts`. Its input and result types, `AdaptiveReviewInput` and `AdaptiveReviewResult`, are in `apps/server/src/review/pipeline/harness/types.ts`. All per-review state lives on `ReviewRun`, built by `createRun` in `apps/server/src/review/pipeline/harness/context.ts`.

`AdaptiveReviewInput.lenses` limits a review to some lenses; the command line sets it and the server never does. Unset, a reviewer applies every lens that fits its slice, as described below. Set, it applies the selected lenses among those, in `LENSES` order, and its prompt names only those. A finding in a category no selected lens reports is dropped at the `category` stage, whoever reported it. A slice no selected lens fits (a documentation-only slice and a selection without rules or readability) gets no reviewer and no model call, and shows in coverage as excluded with the reason, never as reviewed. An empty list, or an id that is not a lens, makes `runAdaptiveReview` throw before any work (`assertLensSelection`). A checkpoint records the selection it was saved under (`ReviewCheckpoint.selection`, absent when none was given), and a resume under a different one throws before any work (`assertSameSelection`), since reviewers, candidates and coverage made under other lenses cannot be reused.

Execution order inside the harness, with overlaps:

1. `createRun` builds the inventory and loads dismissals and topic tallies. `understandChanges` reads developer instructions and repo guidelines.
2. `startSetup` starts package installs. `cutUnits` cuts the change into one slice per reviewer.
3. `repoInventoryStage`, then `changeModelStage`, then `intentStage` (and `deriveObligationsStage` when obligations are on), run in parallel with `ruleLedgerStage`.
4. The harness `prepareSandbox` waits for setup and starts baseline checks. `startVerification` opens the verify queue.
5. `detectorStage` and the diagnostics run in the background. The unit pool runs reviewers. Verifiers start as candidates arrive.
6. `retryFailedUnits`, then `runSubagents`. Then the harness waits for detectors, drains verification and waits for checks (`checksInTime`).
7. `finishVerification`, `consolidate`, `completeReview`.

## Token budget

A review's spend is set by one pick, `tokenBudget` (`TokenBudget` in `packages/shared/src/models.ts`: `low`, `medium`, `high`). It is saved in review settings (`effectiveTokenBudget` in `apps/server/src/review/session/review-settings.ts`, default `medium`) and returned by `GET /api/settings/models`.

A review runs a few reviewers and leans on subagents for depth. Each reviewer reads one slice of the change and applies every lens to it in one agent loop (see [stage 5](#5-reviewer-slices-and-briefs)); the budget sets how many reviewers there are, how many subagents they may hand work to, how long each runs and how hard the models think. Before this shape a review ran one reviewer per lens per unit, 72 for a change of nine units, and the budget only trimmed that.

A budget has two halves:

- **Settings it writes.** `TOKEN_BUDGET_PLANS` and `budgetPatch` in `packages/shared/src/token-budget.ts` set `subagentCap`, `orchestratorEffort` and `specialistEffort` together. The client applies them, because only it knows which efforts each model offers: every budget saves the effort the model offers that is nearest to its own (`effortUnder`; the shallower of two equally near), and a model with no reasoning control is never sent one. `budgetApplies` says whether the saved cap and efforts still match the saved budget; when they do not, the apps show Custom. Custom is derived and never saved, and the review keeps running with the saved budget's limits.
- **Limits it applies to a review.** `budgetLimits` in `apps/server/src/review/session/review-policy.ts` returns a `ReviewLimits` from a table. `runReviewPipeline` reads the budget once and passes it as `AdaptiveReviewInput.tokenBudget`. `createRun` resolves it into `ReviewRun.limits` and `PoolContext.limits`. Nothing writes to `REVIEW_POLICY`, so two reviews with different budgets can run at once. An input with no budget is Medium.

| Setting or limit              | Low                | Medium (the default)                                       | High               | Read by                                                                |
| ----------------------------- | ------------------ | ---------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| Reviewers                     | 1                  | 2; 3 when the patch is over `largeChangeChars` (48,000)    | 4                  | `reviewerCount` in `reviewers.ts`                                      |
| Subagent cap                  | 3                  | 8                                                          | 12                 | `runSubagents`; each reviewer is asked for its share                   |
| Reasoning effort (both picks) | `low`              | `medium`                                                   | `high`             | `configForOrchestrator`, `configForSubagent`                           |
| `reviewerTurns`               | 8                  | 12                                                         | 16                 | `askReviewer` in `pool.ts`                                             |
| `subagentTurns`               | 5                  | 8                                                          | 10                 | `askReviewer`; `subagentCalls` in `subagent-stage.ts`                  |
| `maxModelCalls` (base)        | 80                 | 120                                                        | 160                | `scaledReviewLimits`                                                   |

The ceiling is the base, plus one call per brief unit, plus `reviewerTurns + schemaRepairAttempts` per reviewer, plus `subagentTurns + schemaRepairAttempts` per subagent the cap allows (an uncapped review is sized for 12), capped at `maxScaledModelCalls`. The analysis deadline is `analysisDeadlineMs` plus `msPerAssignment` (60 s) per reviewer and subagent. A Medium review of a change of nine units has 3 reviewers and at most 8 subagents, a ceiling of 120 + 9 + 3 × 16 + 8 × 12 = 273 calls and a deadline of 41 minutes. `tests/review/pipeline/harness-budget.test.ts` runs a review with no budget, Low, Medium and High and counts the calls each reviewer and subagent made and the ceiling.

The subagent cap is the most agents a review adds after its reviewers, second looks included. A review of 8 subagents or fewer is therefore never more than 3 + 8 = 11 agents plus its verifiers.

What the budget leaves alone, on purpose:

- **Verification.** `maxVerifications`, `maxVerifierTurns`, `maxMutationVerifierTurns`, the verifier reserves and the consolidation reserve are the same at every budget. Every valid candidate is still re-proven, and the model-call ceiling still grows by a verifier's turns when one is queued (`VerifyQueue.makeRoom`), so a low ceiling never takes a verifier's share. Verifiers do run at the budget's second-model effort.
- **Deadlines.** `analysisDeadlineMs`, `msPerAssignment` and the per-agent clocks are time limits that stop a review. They are the same at every budget, though the deadline grows with the reviewers and subagents a budget runs. They do not save tokens, and a shorter one would end reviews early rather than make them cheaper.
- **Workers.** `maxDelegationsPerAgent` and `maxWorkerTurns` only matter with a separate second model, and move work to that cheaper model rather than change how much is spent. The delegation count is also written into a prompt constant (`DELEGATE_OFFER`).
- **`maxTranscriptChars`.** About 60k tokens, above what a call reaches today, so it never fires. Lowering it would stub tool output a reviewer still needs.
- **`reportLowSeverity`.** It marks a low-severity candidate `belowBar`, which is still verified (queued after publishable ones), so it changes what is shown, not what is spent.
- **`maxFiles` and `maxDiffChars`.** Settings → Review harness saves them and `reviewLimits` returns them, but no stage reads them: `maxFileChars` is the only one that reaches the harness (`EvidenceStore` in `createRun`). They are not part of a budget.

`recordTokenBudget` in `apps/server/src/models/metrics.ts` writes the budget onto the pipeline run segment (`PipelineRun.tokenBudget`) when the harness starts. `ReviewMetrics.tokenBudget` is the latest run's, and Token usage in the app shows it. A Custom setup is recorded under the budget it started from. A benchmark's quality was measured on the old shape (one reviewer per lens and unit) and has to be measured again for these budgets. Benchmark identities carry `tokenBudget` in `limits.settings`, so reports run on different budgets do not compare as equal.

## Repo guidelines: `RECODER.md`

A repository tells Recoder what to look for in a `RECODER.md` at its root. It is the repo layer of the owner review guidelines; the global layer is edited in Settings.

- `loadRepoGuidelines` in `apps/server/src/review/pipeline/harness/understand.ts` reads it at the PR's base commit (`target`), so a pull request that edits the file is not reviewed by its own edit.
- The paths are `GUIDELINES_PATHS` in `packages/shared/src/guidelines.ts`. The first that exists is the layer: `RECODER.md`, else the older `.recoder/REVIEW.md`. The other is ignored.
- `composeGuidelines` in `apps/server/src/review/guidelines/guidelines.ts` puts it in the trusted guidelines block. It ranks below Recoder's safety rules, above `AGENTS.md`, `CLAUDE.md` and PR text (which stay untrusted), and wins over the global layer where they conflict.
- It is not in `INSTRUCTION_PATHS`, so its text reaches the prompts once. The rule ledger (`apps/server/src/review/guidelines/ledger/sources.ts`) reads it after the instruction files.
- Settings → Guidelines edits it through a pull or merge request (`apps/server/src/routes/guidelines.ts`). A repository on `.recoder/REVIEW.md` keeps that path; a new file is `RECODER.md`.

## Where candidates are lost

`DropStage` is defined in `packages/shared/src/review.ts`. `StopStage` adds `unproven` and is defined in `apps/server/src/review/pipeline/candidate-outcome.ts`. Every stopped candidate stays on `run.candidates` with `valid: false` or no verified status, so summaries and evals can count it.

| Stage       | Set by                                                             | Reason strings in code                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `location`  | `validateCandidate` (`firstDrop`)                                  | "path is not in the change inventory"; "path is excluded (reason)"; "new-side line is not associated with this change"; "file-level finding on a non-deleted file needs a line"                                                                                                            |
| `evidence`  | `validateCandidate`                                                | "cited evidence was not provided". Fires only when the finding cited evidence ids and none of them were provided. A finding that cites nothing passes.                                                                                                                                     |
| `category`  | `validateCandidate` (`categoryIssue`)                              | "category X is outside the Y lens" (or "lenses" when the reviewer applied several); "category X is outside the lenses this review applies (…)" for a selection (`AdaptiveReviewInput.lenses`); "repo-rule finding cites no rule from the ledger"; "readability finding names no smell"; "convention finding needs two examples"; "intent-mismatch finding cites no intent claim id"                                                                   |
| `dismissed` | `validateCandidate` via `matchesDismissal`                         | "a person dismissed this finding in an earlier review"                                                                                                                                                                                                                                     |
| `severity`  | `candidateOutcome` from `isHeldBack`; never written to `dropStage` | "low severity is below the reporting bar". The candidate stays `valid`; it is held back, not dropped.                                                                                                                                                                                      |
| `refuted`   | `settle` in the verification stage                                 | "refuted by the verifier: (verifier reason)"                                                                                                                                                                                                                                               |
| `covered`   | `settle` in the verification stage                                 | "covered by (id): (verifier reason)"                                                                                                                                                                                                                                                       |
| `unproven`  | `candidateOutcome` for a valid, unverified candidate               | The verification reason, else "no verifier settled it". Common reasons: "Not verified: (outcome)."; "Not run: the review ran out of time or model calls before verifying this."; "Not run: this review already verified 120 findings."; "The examples it cites are not in the repository." |

`validateCandidate` and `firstDrop` are in `apps/server/src/review/pipeline/consolidate.ts`. The order of checks is location, evidence, category, dismissed; the first failure wins. `settle` is in `apps/server/src/review/pipeline/harness/verification.ts`.

Evals add one more place. `StoppedAt` in `apps/server/src/eval/benchmark-stages.ts` is `StopStage` plus `consolidation`. It means a candidate was verified but no shown finding reports the expected defect.

## 1. Trigger and lifecycle

- Entry: routes are mounted at `/api/reviews` and `/api/webhooks` in `apps/server/src/app.ts`.
- Lifecycle routes are in `apps/server/src/routes/reviews/lifecycle.ts`. `POST /api/reviews` calls `queueReview` unless the body sets `start: false`. Otherwise it calls `createReviewSession` and `prepareDraftSession`, and the review waits as a draft.
- Other lifecycle routes: `/:id/start` (`startReviewSession`), `/:id/continue`, `/:id/replay`, `/:id/cancel`, `/:id/pause`, `/:id/resume`. Rerun and replay commands are in `apps/server/src/commands/rerun.ts`.
- The webhook route is in `apps/server/src/routes/webhooks.ts`. It accepts `pull_request` events with action opened, synchronize or reopened. It checks the signature when `GITHUB_WEBHOOK_SECRET` is set. It queues a review with trigger `webhook` for a tracked repository.
- `supersedeWebhookReviews` cancels in-flight webhook reviews of the same pull request with "Superseded by a newer push." It is in `apps/server/src/review/session/supersede.ts`.
- `queueReview`, `startReviewSession` and `runReviewPipeline` are in `apps/server/src/commands/pipeline.ts`. `queueReview` refuses when `isReviewConfigured` is false.
- Inputs: a repository, a pull request number, optional developer instructions.
- Outputs: `ReviewStatus` moves draft, queued, running, then passed or failed. It is defined in `packages/shared/src/review.ts`. The harness returns `ReviewOutcome`, `complete` or `failed`, defined in `packages/shared/src/progress.ts`. `complete` maps to passed.
- A review that runs out of time after units were cut still ends `complete`. Findings verified by then are shown, and the summary says the time ran out (`finishOutOfTime` in `apps/server/src/review/pipeline/harness/summary.ts`).
- Drops: none.
- Tests:
  - `apps/server/tests/commands/pipeline.test.ts`: cancel while reviewers run.
  - `apps/server/tests/review/session/review-session.test.ts`: drafts and start.
  - `apps/server/tests/review/session/supersede.test.ts`: a new push cancels only that pull request's webhook review.
  - `apps/server/tests/routes/reviews/lifecycle.test.ts`: list and metrics only.
  - The webhook route has no test.

## 2. Checkout and sandbox

Two functions share the name `prepareSandbox`. The first checks out the code before the harness starts. It is in `apps/server/src/sandbox/sandbox.ts`.

- `runReviewPipeline` fetches the pull request, calls that `prepareSandbox`, then `sandboxRevisionDiff`. The result is a `ReviewRevision` and the diff. `ReviewRevision` is defined in `apps/server/src/evidence/types.ts`.
- `openWorkspace` in `apps/server/src/review/pipeline/harness/context.ts` opens the exec workspace. `execUnavailableReason` explains when commands cannot run; `RECODER_EXEC=off` turns execution off.

The second `prepareSandbox` installs packages and runs baseline checks. It is in `apps/server/src/review/pipeline/harness/sandbox-setup.ts`, with `startSetup` returning a `PendingSetup`.

- `pickBaselineChecks` in `apps/server/src/review/pipeline/harness/baseline-checks.ts` picks the type check, lint and the owning packages' tests, capped by `maxBaselineChecks`.
- `preparePackages` returns a `PrepReport`. It is in `apps/server/src/review/pipeline/harness/package-prep.ts`. `RECODER_PACKAGE_PREP=0` turns it off.
- `runBaselineChecks` runs the checks on the pull request head, not the base tree. It returns `BaselineResult[]`, defined in `apps/server/src/review/pipeline/harness/types.ts`.
- Results are cached by `apps/server/src/review/pipeline/harness/baseline-cache.ts`. `RECODER_BASELINE_CACHE=off` turns the cache off.
- Drops: none. Setup notes go into `run.setupNotes`, which verifier prompts read.
- Tests:
  - `apps/server/tests/review/pipeline/harness/sandbox-setup.test.ts`
  - `apps/server/tests/review/pipeline/harness-baseline-checks.test.ts`
  - `apps/server/tests/review/pipeline/harness/baseline-cache.test.ts`
  - `apps/server/tests/review/pipeline/harness/package-prep.test.ts`: skips when no sandbox is available.
  - `apps/server/tests/review/pipeline/harness/baseline-run.test.ts`: skips when no sandbox is available.

## 3. Inventory and change model

- `buildInventory` turns the diff into a `ReviewInventory`. Both are in `apps/server/src/review/pipeline/inventory.ts`.
- Each file gets a classification and, when excluded, an `excludeReason`. The inventory also says whether the change is executable or docs-only.
- `repoInventoryStage` sets `run.repo` to a `RepoInventory`: every regular file at the PR head, with its blob id, size, classification and package. It is in `apps/server/src/review/pipeline/harness/repo-inventory-stage.ts`; `loadRepoInventory` is in `apps/server/src/review/pipeline/repo-inventory/repo-inventory.ts`. It reads git objects at the head sha, not the work tree. The change model, obligations and detectors read it, so the repo is listed once per review. `run.repo` stays null without a checkout or when git fails, and the change model and obligations are then skipped.
- `repoMap` in `apps/server/src/review/pipeline/repo-inventory/repo-map.ts` turns the inventory into a short layout for reviewer prompts: packages by manifest, their size, main languages and test location, and the folders the change touches.
- `parseRepoFiles` in `apps/server/src/review/pipeline/change-model/parsed-files.ts` parses repo files for examples and shape baselines. It keeps each file's declarations in the fact cache, keyed by parser version, blob id and path. A later review of any PR in the repo reads an unchanged file back instead of reading and parsing it again.
- `changeModelStage` sets `run.changeModel`. It is in `apps/server/src/review/pipeline/harness/change-model-stage.ts`.
- It calls `buildChangeModel` and gets a `ChangeModel`, defined in `apps/server/src/review/pipeline/change-model/types.ts`. The model is null without a checkout or on error.
- Drops: none here. Excluded paths cause a later `location` drop.
- Tests:
  - `apps/server/tests/review/pipeline/change-model/change-model.test.ts`
  - `apps/server/tests/review/pipeline/units.test.ts`: excluded files, through units.
  - `buildInventory` has no test of its own.

## 4. Intent

- `intentStage` sets `run.intent` to a `ChangeIntent` or null. It is in `apps/server/src/review/pipeline/harness/intent-stage.ts`.
- `gatherHistory` collects the recent commits that touched each modified symbol and the pull requests they landed in. `prsForCommit` in `apps/server/src/forge/pr-context.ts` keeps an answer in the fact cache when every PR in it is merged, so later reviews do not ask the host again.
- `relatedReviewSources` in `apps/server/src/forge/context/related-reviews.ts` adds `related-review` sources: findings from Recoder's reviews of the earlier PRs that history names (`pr:#N`), on files this PR changes. Only the latest passed review of each PR from before the merge base's commit time counts, so a rerun sees the same sources. Quieted findings stay out. At most `CONTEXT_CAPS.relatedReviews`.
- `distillIntent` turns the gathered sources into goals, constraints, non-goals, observed changes and open questions, plus a brief per unit.
- `ChangeIntent` and `GatheredContext` are defined in `apps/server/src/review/pipeline/intent/types.ts`.
- Each unit brief has a status of included, partial or omitted. An omitted brief records a `BriefOmission`: size, time, budget or model.
- The stage never throws. A failure leaves `run.intent` null and the review goes on.
- Drops: none.
- Tests:
  - `apps/server/tests/review/pipeline/intent/distill.test.ts`
  - `apps/server/tests/review/pipeline/intent/unit-brief.test.ts`
  - `apps/server/tests/review/pipeline/intent/history.test.ts`
  - `apps/server/tests/review/pipeline/intent/brief.test.ts`

## 5. Reviewer slices and briefs

- `partitionReviewers` cuts the inventory into one slice per reviewer, `reviewer-1`, `reviewer-2`… It is in `apps/server/src/review/pipeline/reviewers.ts`, called by `cutUnits` in `apps/server/src/review/pipeline/harness/unit-stage.ts`. `reviewerCount` picks the count: the budget's `reviewers.small`, or `reviewers.large` when the reviewable patch is over `largeChangeChars` (48,000 characters, two brief units' worth), at most one reviewer for a change of documentation only, and never more than the hunks there are to read.
- Every changed hunk is in exactly one slice, so every changed line has one reviewer. The files are taken in folder order and cut where the patch read so far passes each reviewer's share of the whole (`balancedScopes`). A file that fits a share stays whole; a larger one is cut into its hunks, so only such a file is read by two reviewers.
- Each reviewer applies every lens that fits its slice (`lensesFor` in `apps/server/src/review/pipeline/lenses/lenses.ts`): all eight, or only rules and readability for a slice of documentation. `reviewerSystemPrompt` merges their procedures into one prompt (`combinedProcedure`) and lists the union of their categories once. The defect rules and the maintainability rules both apply, each to its own categories.
- A slice can be larger than the first evidence round (24,000 characters). The reviewer's prompt names the hunks that round did not reach (`unreadHunks` in `pool.ts`), and the reviewer pages them with `readDiff` before it lists them as examined. It has more turns than a lens had for that reason. A hunk the reviewer neither examined nor reported a gap for, and that the first round did not show, is marked partially covered.
- `partitionUnits` still cuts brief units of at most `unitBudgetChars` (24,000), which the intent stage summarizes one call each (`distillIntent`). `briefBlock` adds the brief of a reviewer's files to its prompt, with the open questions for every reviewer except one of a documentation-only slice. `UnitBrief` is defined in `apps/server/src/review/pipeline/intent/unit-brief.ts`.
- Coverage has one role, `reviewer` (`COVERAGE_ROLE`). `retryFailedUnits` runs each failed reviewer once more, as `retry-reviewer-1` or the halves `retry-reviewer-1-a` and `-b`.
- With a lens selection, `partitionReviewers` keeps only the slices a selected lens fits and numbers the reviewers again; `skippedSlices` names the others, and `cutUnits` marks their hunks excluded in coverage with the reason (`CoverageLedger.exclude`). A review left with no reviewer makes no intent call.
- Drops: none.
- Tests:
  - `apps/server/tests/review/pipeline/reviewers.test.ts`: reviewer count per budget and change size, and that every hunk has exactly one reviewer.
  - `apps/server/tests/review/pipeline/units.test.ts`
  - `apps/server/tests/review/pipeline/lenses/lenses.test.ts`
  - `apps/server/tests/review/pipeline/lenses/selection.test.ts`
  - `apps/server/tests/review/pipeline/harness-lenses.test.ts`
  - `apps/server/tests/review/pipeline/harness-retries.test.ts`

## 6. Reviewers and subagents

- `runUnitPool` runs the reviewers, then the subagents. It is in `apps/server/src/review/pipeline/harness/pool.ts`.
- Reviewers use the orchestrator model config; subagents use `configForSubagent`. See [models.md](models.md). A reviewer gets `ReviewLimits.reviewerTurns` turns and a subagent `subagentTurns`, from the review's [token budget](#token-budget).
- A unit not started when budget or time runs low is skipped with "Not launched: budget or time reserved for consolidation".
- `parseReviewerOutput` and `salvageReviewerOutput` read the reviewer's answer as `ReviewerOutput`. They are in `apps/server/src/review/pipeline/reviewer.ts`. A reviewer may report up to 50 findings and 600 examined hunks.
- `applyUnitResult` and `addCandidates` handle the answer. They are in `apps/server/src/review/pipeline/harness/unit-result.ts`. `addCandidates` runs `validateCandidate` on each finding, held to the categories of the reviewer's lenses, and sends it to verification. A finding is credited (`CandidateFinding.lens`) to the first of the reviewer's lenses that owns its category.
- Every reviewer may request subagents, and is told to hand deep dives (callers elsewhere in the repo, contracts defined outside its slice, multi-module paths, repros that need their own run) to them, most important first, rather than spend its own turns. It is asked for its share of the cap, `ceil(cap / reviewers)` (`requestsPerReviewer` in `context.ts`). Answers to reviewer questions are recorded with `recordReply`.
- `runSubagents` plans subagents with `planSubagents` and `planBriefSubagents`. It is in `apps/server/src/review/pipeline/harness/subagent-stage.ts`. Requests go by rank: every reviewer's first request, then every reviewer's second, each round in reviewer order, so the cap is filled with the most valuable requests and not one reviewer's. Requests over the cap, or for the same concern on overlapping code, are merged or dropped. The brief's unsettled questions then fill what is left, then its unaddressed ones, then the second looks. With the cap at `'uncapped'`, `subagentLimit` plans as many as the model calls left can pay for in full (`ReviewLimits.subagentTurns` plus `schemaRepairAttempts` each), after holding back the consolidation reserve and the calls verifiers still waiting or running were given (`VerifyQueue.heldCalls`); the rest are dropped and named in the summary. None launches past the investigation deadline, which keeps `reserveMsForVerification`.
- With a lens selection, a subagent's or second look's prompt lists only the selected lenses and its answer schema offers only their categories, and what depends on a lens that was not selected does not run: the brief's open questions get no follow-up unless a selected lens reports bugs, a residual pass needs a lens that reports bugs, a contract check one that reports correctness, api-contract or intent-mismatch, and an obligation is investigated only when the lens that owns its trigger (`specialist`) is selected.
- Reviewers see past dismissals through `dismissalsBlock`. Subagents do not.
- Second looks (flags `RECODER_RESIDUAL`, `RECODER_CONTRACT_CHECKS`) are subagents the harness sends itself, planned by `planSecondLook` in `apps/server/src/review/pipeline/second-look/stage.ts`. They count inside the subagent cap: they take only the room the reviewers' requests and the brief's questions left under it, so the review never adds more agents than the cap, and none is sent with subagents off. A residual pass (`residual-N`) rereads one reviewer's slice for what its lenses missed. A contract check (`contract-N`) takes one readability report of a comment, name or doc that disagrees with the code and decides which side is wrong. They set `ReviewUnit.purpose`, run on the specialist model, read only (no commands, since verification runs every candidate), and record tokens under the `second-look` stage. Their clock is `secondLookFinalTurnAfterMs` (7 min) and `secondLookMaxMs` (14 min); when a residual pass starts, `makeRoomForSecondLooks` moves the review deadline out so that clock fits; contract checks are short and use the time left. Each adds `ReviewLimits.subagentTurns` plus `schemaRepairAttempts` model calls to the budget, and each of its calls gets `secondLookCallDeadlineMs` (180 s) in place of `perCallDeadlineMs` (90 s), since a CLI model prints its reply only at the end.
- Drops: candidates from this stage drop in stage 9.
- Tests:
  - `apps/server/tests/review/pipeline/subagents.test.ts`
  - `apps/server/tests/review/pipeline/harness-subagents.test.ts`
  - `apps/server/tests/review/pipeline/harness-budget.test.ts`
  - `apps/server/tests/review/pipeline/question-ledger.test.ts`
  - `apps/server/tests/review/pipeline/reviewer-normalize.test.ts`
  - `apps/server/tests/review/pipeline/second-look/stage.test.ts`
  - `apps/server/tests/review/pipeline/second-look/plan.test.ts`
  - `apps/server/tests/review/pipeline/second-look/co-change.test.ts`

## 7. Obligations

Off by default. `obligationsOn` reads `RECODER_OBLIGATIONS`, which must be exactly `1`. The flag and its limits are in `apps/server/src/review/pipeline/obligations/config.ts`.

- `deriveObligationsStage` derives obligations from the diff without a model call. It is in `apps/server/src/review/pipeline/obligations/stage.ts`.
- `deriveObligations` reads TypeScript, JavaScript and Svelte files only. `selectUnderCap` keeps at most `RECODER_OBLIGATION_CAP` (default 8), round-robin across triggers.
- The triggers are the `ObligationTrigger` values in `packages/shared/src/obligations.ts`: truthy-default, boundary, removed-guard, normalization, resource-release, count-validation, error-contract, weaker-assertion. Each has a fixed question in `QUESTIONS`. Truthy-default, boundary and normalization fire on replaced code only, and also on brand-new code when `RECODER_OBLIGATIONS_NEW_CODE` is on.
- `runUnitsWithObligations`, in the same stage file, runs investigations first in the same pool as units. Each gets `RECODER_OBLIGATION_TURNS` turns (default 8, clamped to 3 through 12).
- Each investigation ends in an `ObligationResult`: confirmed, disproved, not-applicable or unresolved. An unlaunched one is unresolved with "Not launched: budget or time reserved for consolidation".
- A confirmed answer becomes a candidate through `addCandidates` with role obligation. It then goes through stages 9 and 10 like any reviewer candidate.
- Output: `ObligationReport`, defined with `Obligation` and `ObligationAnswer` in the shared obligations file.
- Tests:
  - `apps/server/tests/review/pipeline/obligations/config.test.ts`
  - `apps/server/tests/review/pipeline/obligations/stage.test.ts`
  - `apps/server/tests/review/pipeline/obligations/lenses.test.ts`
  - `apps/server/tests/review/pipeline/obligations/derive.test.ts`
  - `apps/server/tests/review/pipeline/obligations/triggers.test.ts`

## 8. Detectors

- `ruleLedgerStage`, `detectorStage` and `diagnosticStage` are in `apps/server/src/review/pipeline/harness/quality-stage.ts`. The ledger type `RuleLedger` is in `apps/server/src/review/guidelines/ledger/types.ts`.
- `runDetectors` runs dead-code, complexity, rule-check, weakened-tests, weak-new-tests and duplication.
- `diagnosticStage` runs `runDiagnostics` on the baseline lint and type check results, then `runTypeHints`.
- It runs `runMatrix` (mutation testing) only when `testStrengthOn` is true. That reads `RECODER_TEST_STRENGTH`, which must be exactly `1`. `MatrixReport` is in `apps/server/src/review/pipeline/mutation/stage.ts`.
- Output: `DetectorResult` and `DetectorId`, defined in `apps/server/src/review/pipeline/detectors/types.ts`.
- `addDetections` turns each result into a candidate with `candidateFromDetector`. A detector candidate is verified by construction, with method `rule` for rule-check and `detector` otherwise.
- A `suspected` result is not verified by construction. It goes to a verifier and can be refuted.
- With a lens selection, a result whose category no selected lens reports is filtered out before the caps, so it never takes a slot from one that is wanted; the mutation matrix is skipped unless a selected lens reports `tests`, and the rule ledger is not built (no model call) unless one reports `repo-rule`.
- Drops: a detector candidate can drop only at `location`.
- Tests:
  - `apps/server/tests/review/pipeline/harness/lens-selection.test.ts`
  - `apps/server/tests/review/pipeline/harness/quality-stage.test.ts`
  - `apps/server/tests/review/pipeline/test-strength.test.ts`
  - `apps/server/tests/review/pipeline/mutation/matrix.test.ts`
  - `apps/server/tests/review/pipeline/harness/verification.test.ts`
  - The files under `apps/server/tests/review/pipeline/detectors/`.

## 9. Candidates, validation and repair

- `validateCandidate` turns a reviewer finding into a `CandidateFinding`, defined in `apps/server/src/review/pipeline/consolidate.ts`. It sets `valid`, `dropStage` and `dropReason`.
- A valid low-severity candidate gets `belowBar` unless `reportLowSeverity` is on. `effectiveReportLowSeverity` decides it, default true (low severity is shown). It is in `apps/server/src/review/session/review-settings.ts`. The harness itself reads `input.reportLowSeverity ?? false`, but its only caller, `commands/pipeline.ts`, always passes the setting; the `false` there is for tests that leave it out.
- Repair is on unless `RECODER_CANDIDATE_REPAIR=0`. `candidateRepairOn` and `repairCandidate` are in `apps/server/src/review/pipeline/harness/repair.ts`. At most `RECODER_REPAIR_CAP` (default 8) repairs run per review.
- A candidate whose category no selected lens reports (`AdaptiveReviewInput.lenses`) is never repaired, since the choice of lenses is not a mistake to correct, and a repair that picks a category picks among the selected lenses'.
- The verify queue sends an invalid candidate to repair first. `isRepairable` accepts only a candidate stopped at `location` or `category`, not repaired before, with a claim and usable evidence.
- `planRepair`, `applyRepair` and the `CandidateRepair` type are in `apps/server/src/review/pipeline/candidate-repair.ts`. One model call proposes changes (`changesFromAnswer`); kinds are anchor, related, category, citation and rule.
- The repaired copy is validated again. `CandidateRepair` records the result: revalidated, rejected, unsupported or not-run. A revalidated candidate joins verification.
- `candidateOutcome` reports the stage and reason for every candidate as a `CandidateOutcome`.
- Drops: see the table above.
- Tests:
  - `apps/server/tests/review/pipeline/consolidate.test.ts`
  - `apps/server/tests/review/pipeline/harness-repair.test.ts`
  - `apps/server/tests/review/pipeline/harness/repair.test.ts`
  - `apps/server/tests/review/pipeline/candidate-outcome.test.ts`
  - `apps/server/tests/review/pipeline/harness-dismissals.test.ts`

## 10. Verification

- `startVerification` and `finishVerification` are in `apps/server/src/review/pipeline/harness/verification.ts`.
- `startVerification` opens a `VerifyQueue`, defined in `apps/server/src/review/pipeline/harness/verify-queue.ts`. Verifiers run while reviewers still run.
- The queue ranks publishable candidates before below-bar ones, bugs before quality, then by severity. It verifies at most `maxVerifications` per review, two attempts each.
- A bug that `sameIssue` (`apps/server/src/review/pipeline/consolidate-merge.ts`) says consolidation would merge with a bug already in the queue gets no verifier of its own. It waits for that verifier. When it proves the bug, the waiting one takes the same verification (`shareVerdict`) and its runs lead the evidence. When it does not, the waiting one joins the queue for its own verifier. Only bugs share. Weak-test findings never do, and a below-bar bug shares only with another below-bar bug.
- Bugs are verified only where the repository's code runs. `whyCodeCannotRun` decides it once per review, after the baseline checks finish: with no workspace, with no baseline check to run, or with no baseline check that exited 0, no bug verifier runs. Each bug then gets `outcome: 'not-run'` (status `unverified`) and is published, marked unverified, not hidden (`isPublishable` in `apps/server/src/review/pipeline/consolidate.ts`). Quality findings are still verified by reading. A bug verifier always has a shell; there is no read-only bug verifier.
- A convention finding whose examples are missing stops with "The examples it cites are not in the repository." (`examplesOnDisk`).
- Quality findings settle through `settleQualityVerdict`. Bugs settle through `settleVerdict` in `apps/server/src/review/pipeline/verify/settle.ts`.
- The verifier answers confirmed, refuted or unverified. A refutation counts only with the verifier's own passing run. For a mutation finding (`isMutationFinding`) it needs a failing run. Otherwise it is inconclusive.
- `coveredByIntent` also refutes when the verifier names a non-goal id the intent holds, or a stacked pull request number. That sets `covered`.
- A confirmed verdict with a run is reproduced; one with cited reads is traced. `withOutcome` sets `VerificationOutcome`: reproduced, traced, inconclusive, refuted or not-run.
- `FindingVerification.method` is run, trace, detector, rule or convention. These types are in `packages/shared/src/findings.ts`.

Base comparison. `recordBaseline` reruns the proving command on the merge-base tree. It is in `apps/server/src/review/pipeline/harness/verify-baseline.ts`. It never changes the verdict. `compareToBase` classifies the result as one `BaseComparisonResult`:

| Class          | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| `regression`   | Base passes; head violates the same contract.                         |
| `pre-existing` | Both fail for the same cause. The only class that says it predates.   |
| `incompatible` | Base cannot execute the new API or fixture. Recorded as unavailable.  |
| `environment`  | Environment fails before the behavior check. Recorded as unavailable. |
| `worsened`     | Base already fails; the change makes it reachable or worse.           |
| `unstable`     | Repeated base runs disagree. Recorded as unavailable.                 |

A `pre-existing` result adds `SAME_ON_BASE` text to the reason. It also stops a below-bar candidate from being published as reproduced. Mutation findings skip the base run.

- `finishVerification` drains the queue, checks suggested patches (`checkPatches`), then calls `hideUnproven`. Valid, not held back, unverified candidates go to `run.hidden`, except not-run bugs, which are published. The funnel counts them as `notRun`, so raised = dropped + unproven + verified + notRun.
- Tests:
  - `apps/server/tests/review/pipeline/verify.test.ts`
  - `apps/server/tests/review/pipeline/harness-verification.test.ts`
  - `apps/server/tests/review/pipeline/harness/verify-baseline.test.ts`
  - `apps/server/tests/review/pipeline/verify/baseline.test.ts`
  - `apps/server/tests/review/pipeline/harness/verify-queue.test.ts`
  - `apps/server/tests/review/pipeline/verify/runs.test.ts`

## 11. Consolidation and publication

- `consolidate` returns `Consolidated`. It is in `apps/server/src/review/pipeline/harness/consolidation.ts`. It makes no model call.
- `confirmedFindings` calls `consolidateFindings` in `apps/server/src/review/pipeline/consolidate-merge.ts`. Only valid, verified candidates enter.
- `consolidateFindings` groups candidates at the same place (a merge key, or the file and title of a model-raised bug), and merges each group into one `Finding`. It drops a group whose members are all held back. `Finding` is defined in `packages/shared/src/findings.ts`. Quality findings are capped at medium severity.
- A below-bar candidate is published only through `publishHeldBack`, with `PublishedBy` reproduced or rule. `PUBLISHED_BY` is in `apps/server/src/review/pipeline/published-by.ts`.
- Reproduced means a verifier run that did not end the same way on base. Rule means a verified violation of a ledger rule for that file.
- `isHeldBack`, `isReportable` and `toFinding` are in the consolidate module. `toFinding` strips pipeline-only fields.
- `completeReview` builds the result and the funnel with `reviewFunnel`. Both are in `apps/server/src/review/pipeline/harness/summary.ts`. `stoppedReview` handles errors and cancellation.
- `ReviewFunnel` is defined in `packages/shared/src/review.ts`. Held-back candidates count under the severity drop. Unconfirmed is hidden plus refuted.
- Tests:
  - `apps/server/tests/review/pipeline/consolidate-merge.test.ts`
  - `apps/server/tests/review/pipeline/harness-reporting-bar.test.ts`
  - `apps/server/tests/review/pipeline/harness/summary.test.ts`
  - `apps/server/tests/eval/benchmark-stages.test.ts`
  - `apps/server/tests/review/pipeline/harness.test.ts`

## 12. Feedback

### Decisions

- A person's decision on a finding is a `FindingDecision` (`packages/shared/src/findings.ts`), saved on the finding inside the review record, so every device and the review list (`reviewListItem` keeps each finding's `kind` and `decision`) agree.
- `PUT /api/reviews/:id/findings/:findingId/decision` takes `{ "state": "accepted", "note"?: string }` or `{ "state": "dismissed", "reason": DismissalReason, "note"?: string }` (`FindingDecisionInput`) and answers the saved `FindingDecision`. `DELETE` on the same path reopens the finding and answers `{ "reopened": true }`. The routes are in `apps/server/src/routes/reviews/decisions.ts`; the decision is written with the review collection's transactional `update`.
- What a decision teaches later reviews is `learnFromDecision` in `apps/server/src/review/guidelines/learned/decision-learning.ts`. It first forgets what an earlier decision on the same finding taught (`forgetDecision`), so changing a decision never counts twice; reopening calls `forgetDecision` alone.
  - Accepted: a `useful` vote on the finding's topic.
  - Dismissed: by `DismissalReason` (`DISMISSAL_REASONS`):

| Reason             | Stops the same finding (`recordDismissal`) | Counts toward its topic (`dismissed` vote) | Evaluation label |
| ------------------ | ------------------------------------------ | ------------------------------------------ | ---------------- |
| `wrong`            | yes                                        | yes                                        | `false`          |
| `not-worth-fixing` | yes                                        | yes                                        | none             |
| `already-handled`  | yes                                        | no                                         | none             |
| `style-preference` | yes                                        | yes                                        | none             |
| `duplicate`        | no                                         | no                                         | none             |

  - Suppression stays narrow: a remembered dismissal matches only in its repository, at its place and for its behaviour (`matchesDismissal`: the same `dismissalPlace` and a claim `sameClaim` takes for the same defect). Only reasons that judge the kind of finding count toward its topic; `already-handled` and `duplicate` judge one finding only. A `duplicate` stops nothing, because the finding it duplicates carries the decision.
  - apps/web's Dismiss button asks no reason and sends `not-worth-fixing`, which keeps what a dismissal always taught without calling the finding false.
- The dismissal key is `dismissalKey`, in `apps/server/src/review/guidelines/learned/finding-key.ts`. The store is `apps/server/src/review/guidelines/learned/dismissals.ts`, at most `MAX_DISMISSALS_PER_REPO` per repository; each `Dismissal` keeps its `reason` and `note`. A dismissal saved before reasons existed held free text in `reason`; it reads as the `note`.
- On the next review, `createRun` loads them with `listDismissals`. `validateCandidate` drops a match as `dismissed`, and reviewer prompts list them through `dismissalsBlock`.

### Votes and learned rules

- Votes count decisions toward a finding's topic (`FindingTopic` in `packages/shared/src/findings.ts`): the ledger rule it cites, keyed by a hash of the rule's text (`ruleTopicId`), else its smell, else its category. The store is `apps/server/src/review/guidelines/learned/votes.ts`, one vote per finding fingerprint, at most `MAX_VOTES_PER_REPO` per repository. The learned stores live in `learned-table.ts`: a local file in the server data directory, or a shared setting (`dismissals`, `finding-votes`, `learned-rules`) under PostgreSQL, so every replica learns from the same decisions. Both are read through the table's schema.
  - `PUT /api/reviews/:id/useful/:findingId` records a `useful` vote when a person sends a finding on; `DELETE` removes only a `useful` vote. The routes are in `apps/server/src/routes/reviews/feedback.ts`.
  - `createRun` loads `topicTallies`. `ruleLedgerStage` orders the ledger with `rankRules`: rules people act on first, rules they keep dismissing (`isDismissedOften`) last. `ledgerBlock` notes a rule's `standing` in the prompts of reviewers that apply the rules lens. Rule ids stay the same.
- A topic with at least 3 dismissals and at least 4 dismissals per useful vote (`isDismissedOften`) is only proposed for quieting: the dismissal that crosses the bar calls `proposeQuieting` (`apps/server/src/review/guidelines/learned/proposals.ts`), which stores a `LearnedRuleProposal` (`packages/shared/src/guidelines.ts`) in state `proposed`. A rule applies only once a person approves it.
  - `GET /api/repos/:repoId/learned-rules` lists the repository's proposals in every state. `PUT /api/repos/:repoId/learned-rules/:topicId` with `{ "state": "approved" | "rejected" }` decides one and answers it. The routes are in `apps/server/src/routes/learned-rules.ts`. A decided proposal is never proposed again by later dismissals; a person can still change it.
  - `topicTallies` marks approved topics `quietApproved`. `confirmedFindings` sets each finding's topic with `withTopics`, which marks it `quieted` only when its topic is approved, unless a run proved the finding. Quieted findings are verified and stored like the rest. The summary, the review list (`reviewListItem`, `reviewTally`) and past-review context leave them out, and the app lists them apart.
  - `DELETE /api/reviews/:id/quieted/:topicId` turns a topic back on: it forgets the topic's dismissed votes and its proposal, and clears `quieted` on the review's findings of that topic.

### History across pushes

- `finalizeReview` (`apps/server/src/commands/finalize-review.ts`) passes a passed review's findings through `withFindingHistory` (`apps/server/src/review/history/history.ts`). It sets them against the newest earlier passed review of the same pull request (`earlierReviews`); the first review of a pull request keeps no history.
- A defect's identity is `defectIdentity` in `apps/server/src/review/history/identity.ts`: its file, its enclosing symbol and its claim terms (`claimTerms`: trigger, consequence, violated contract, rule or smell, title, body). Line and category are left out, so a moved line or a re-filed category keeps the defect, and two different claims in one symbol stay apart (`sameDefect`). `Finding.fingerprint` is unchanged and still keys votes, saved reviews and evaluations.
- What the commits since did to a finding's code is `codeChange` in `apps/server/src/review/history/code-change.ts`, read from the two pull request diffs: `untouched` when the hunk around it reads the same (perhaps moved), `touched` otherwise, `gone` when the pull request no longer changes its file.
- `carryHistory` (`apps/server/src/review/history/carry.ts`) sets `FindingHistory`:
  - raised again: it keeps the earlier finding's id; `rechecked` when its code was touched (and open again), else `carried` with the earlier decision;
  - not raised, untouched: the earlier finding is `carried` as it was, moved with its code;
  - not raised, touched: it goes to `Review.resolved` (`ResolvedFinding`) only on new evidence, a verifier refuting the same defect in this review or the pull request no longer changing its file; otherwise it is `carried` where it was;
  - every other finding is `new` at this head.
- Because a carried finding keeps its id, `findingForgeStanding` (`apps/server/src/review/history/forge-standing.ts`) answers the forge publisher: the comment already posted for the finding by this or an earlier review of the pull request, and its `ResolvedFinding` when this review closed it. An unrelated commit does not post it again.

### Evaluation labels

- `findingLabel` in `apps/server/src/eval/benchmark-labels.ts` labels a finding `false` when no human adjudication exists and the finding's saved decision is a `wrong` dismissal. No other reason is a false-positive label.

- Tests:
  - `apps/server/tests/routes/reviews/decisions.test.ts`
  - `apps/server/tests/routes/reviews/feedback.test.ts`
  - `apps/server/tests/routes/learned-rules.test.ts`
  - `apps/server/tests/review/guidelines/learned/votes.test.ts`
  - `apps/server/tests/review/guidelines/learned/topics.test.ts`
  - `apps/server/tests/review/guidelines/learned/dismissals.test.ts`
  - `apps/server/tests/review/history/identity.test.ts`
  - `apps/server/tests/review/history/carry.test.ts`
  - `apps/server/tests/review/history/history.test.ts`
  - `apps/server/tests/review/pipeline/harness-dismissals.test.ts`
  - `apps/server/tests/eval/benchmark-labels.test.ts`
