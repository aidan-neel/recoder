# Review pipeline

This page traces one review from trigger to published findings and feedback. It is for an agent that operates, changes or evaluates the review process. Terms are defined in [glossary.md](glossary.md). Running a review is in [operating.md](operating.md). Flags and limits are in [configuration.md](configuration.md). Model roles are in [models.md](models.md). Measuring the pipeline is in [evaluation.md](evaluation.md). The index is [README.md](README.md).

## Stages at a glance

| #   | Stage                      | Entry function                                      | Entry file                                                 | Output type                                   |
| --- | -------------------------- | --------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| 1   | Trigger and lifecycle      | `queueReview`, `runReviewPipeline`                  | `apps/server/src/commands/pipeline.ts`                     | `ReviewStatus`, `ReviewOutcome`               |
| 2   | Checkout and sandbox       | `prepareSandbox` (two of them, see stage 2)         | `apps/server/src/review/pipeline/harness/sandbox-setup.ts` | `ReviewRevision`, `BaselineResult`            |
| 3   | Inventory and change model | `buildInventory`, `changeModelStage`                | `apps/server/src/review/pipeline/inventory.ts`             | `ReviewInventory`, `ChangeModel`              |
| 4   | Intent                     | `intentStage`                                       | `apps/server/src/review/pipeline/harness/intent-stage.ts`  | `ChangeIntent`                                |
| 5   | Units and briefs           | `cutUnits`, `partitionUnits`                        | `apps/server/src/review/pipeline/harness/unit-stage.ts`    | `ReviewUnit`, `UnitBrief`                     |
| 6   | Lens reviewers, subagents  | `runUnitPool`, `runSubagents`                       | `apps/server/src/review/pipeline/harness/pool.ts`          | `ReviewerOutput`, then `CandidateFinding`     |
| 7   | Obligations (flagged)      | `deriveObligationsStage`, `runUnitsWithObligations` | `apps/server/src/review/pipeline/obligations/stage.ts`     | `ObligationReport`                            |
| 8   | Detectors                  | `detectorStage`, `diagnosticStage`                  | `apps/server/src/review/pipeline/harness/quality-stage.ts` | `DetectorResult`                              |
| 9   | Validation and repair      | `validateCandidate`, `repairCandidate`              | `apps/server/src/review/pipeline/consolidate.ts`           | `CandidateFinding`, `CandidateRepair`         |
| 10  | Verification               | `startVerification`, `finishVerification`           | `apps/server/src/review/pipeline/harness/verification.ts`  | `FindingVerification`, `BaseComparisonResult` |
| 11  | Consolidation, publication | `consolidate`, `completeReview`                     | `apps/server/src/review/pipeline/harness/consolidation.ts` | `Finding`, `ReviewFunnel`                     |
| 12  | Feedback                   | `recordDismissal`, `listDismissals`                 | `apps/server/src/review/guidelines/learned/dismissals.ts`  | `Dismissal`                                   |

The entry file is the first function's file. Each stage section names the files of the others.

The adaptive harness is `runAdaptiveReview` in `apps/server/src/review/pipeline/harness/run.ts`. Its input and result types, `AdaptiveReviewInput` and `AdaptiveReviewResult`, are in `apps/server/src/review/pipeline/harness/types.ts`. All per-review state lives on `ReviewRun`, built by `createRun` in `apps/server/src/review/pipeline/harness/context.ts`.

Execution order inside the harness, with overlaps:

1. `createRun` builds the inventory and loads dismissals. `understandChanges` reads developer instructions and repo guidelines.
2. `startSetup` starts package installs. `cutUnits` cuts units and assigns lenses.
3. `changeModelStage`, then `intentStage` (and `deriveObligationsStage` when obligations are on), run in parallel with `ruleLedgerStage`.
4. The harness `prepareSandbox` waits for setup and starts baseline checks. `startVerification` opens the verify queue.
5. `detectorStage` and the diagnostics run in the background. The unit pool runs reviewers. Verifiers start as candidates arrive.
6. `retryFailedUnits`, then `runSubagents`. Then the harness waits for detectors, drains verification and waits for checks (`checksInTime`).
7. `finishVerification`, `consolidate`, `completeReview`.

## Where candidates are lost

`DropStage` is defined in `packages/shared/src/review.ts`. `StopStage` adds `unproven` and is defined in `apps/server/src/review/pipeline/candidate-outcome.ts`. Every stopped candidate stays on `run.candidates` with `valid: false` or no verified status, so summaries and evals can count it.

| Stage       | Set by                                                             | Reason strings in code                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `location`  | `validateCandidate` (`firstDrop`)                                  | "path is not in the change inventory"; "path is excluded (reason)"; "new-side line is not associated with this change"; "file-level finding on a non-deleted file needs a line"                                                                                                            |
| `evidence`  | `validateCandidate`                                                | "cited evidence was not provided". Fires only when the finding cited evidence ids and none of them were provided. A finding that cites nothing passes.                                                                                                                                     |
| `category`  | `validateCandidate` (`categoryIssue`)                              | "category X is outside the Y lens"; "repo-rule finding cites no rule from the ledger"; "readability finding names no smell"; "convention finding needs two examples"; "intent-mismatch finding cites no intent claim id"                                                                   |
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
- `changeModelStage` sets `run.changeModel`. It is in `apps/server/src/review/pipeline/harness/change-model-stage.ts`.
- It calls `buildChangeModel` and gets a `ChangeModel`, defined in `apps/server/src/review/pipeline/change-model/types.ts`. The model is null without a checkout or on error.
- Drops: none here. Excluded paths cause a later `location` drop.
- Tests:
  - `apps/server/tests/review/pipeline/change-model/change-model.test.ts`
  - `apps/server/tests/review/pipeline/units.test.ts`: excluded files, through units.
  - `buildInventory` has no test of its own.

## 4. Intent

- `intentStage` sets `run.intent` to a `ChangeIntent` or null. It is in `apps/server/src/review/pipeline/harness/intent-stage.ts`.
- `gatherHistory` collects the recent commits that touched each modified symbol and the pull requests they landed in.
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

## 5. Units and briefs

- `partitionUnits` cuts the inventory into `ReviewUnit[]` with ids like unit-1. It is in `apps/server/src/review/pipeline/units.ts`. The size budget is `unitBudgetChars`.
- `cutUnits` assigns lenses with `lensAssignments`. It is in `apps/server/src/review/pipeline/harness/unit-stage.ts`. Docs-only units get the rules and readability lenses only.
- `briefBlock` adds the unit's brief to the reviewer prompt. Questions are included only for non-quality lenses.
- `UnitBrief` is defined in `apps/server/src/review/pipeline/intent/unit-brief.ts`.
- `retryFailedUnits` runs each failed unit once more.
- Drops: none.
- Tests:
  - `apps/server/tests/review/pipeline/units.test.ts`
  - `apps/server/tests/review/pipeline/lenses/lenses.test.ts`
  - `apps/server/tests/review/pipeline/harness-retries.test.ts`

## 6. Lens reviewers and subagents

- `runUnitPool` runs one reviewer per unit and lens. It is in `apps/server/src/review/pipeline/harness/pool.ts`.
- Lens reviewers use the orchestrator model config; subagents use `configForSubagent`. See [models.md](models.md).
- A unit not started when budget or time runs low is skipped with "Not launched: budget or time reserved for consolidation".
- `parseReviewerOutput` and `salvageReviewerOutput` read the reviewer's answer as `ReviewerOutput`. They are in `apps/server/src/review/pipeline/reviewer.ts`.
- `applyUnitResult` and `addCandidates` handle the answer. They are in `apps/server/src/review/pipeline/harness/unit-result.ts`. `addCandidates` runs `validateCandidate` on each finding and sends it to verification.
- Only the correctness lens may request subagents. Answers to reviewer questions are recorded with `recordReply`.
- `runSubagents` plans subagents with `planSubagents` and `planBriefSubagents`. It is in `apps/server/src/review/pipeline/harness/subagent-stage.ts`. Requests over the cap, or for the same concern on overlapping code, are merged or dropped.
- Lens reviewers see past dismissals through `dismissalsBlock`. Subagents do not.
- Second looks (flags `RECODER_RESIDUAL`, `RECODER_CONTRACT_CHECKS`) are subagents the harness sends itself, planned by `planSecondLook` in `apps/server/src/review/pipeline/second-look/stage.ts` after the reviewer and brief subagents, outside the cap. A residual pass (`residual-N`) rereads one unit for what its lenses missed. A contract check (`contract-N`) takes one readability report of a comment, name or doc that disagrees with the code and decides which side is wrong. They set `ReviewUnit.purpose`, run on the specialist model, read only (no commands, since verification runs every candidate), and record tokens under the `second-look` stage. Their clock is `secondLookFinalTurnAfterMs` (7 min) and `secondLookMaxMs` (14 min); when a residual pass starts, `makeRoomForSecondLooks` moves the review deadline out so that clock fits; contract checks are short and use the time left. Each adds `maxSubagentTurns` plus `schemaRepairAttempts` model calls to the budget, and each of its calls gets `secondLookCallDeadlineMs` (180 s) in place of `perCallDeadlineMs` (90 s), since a CLI model prints its reply only at the end.
- Drops: candidates from this stage drop in stage 9.
- Tests:
  - `apps/server/tests/review/pipeline/subagents.test.ts`
  - `apps/server/tests/review/pipeline/harness-subagents.test.ts`
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
- Drops: a detector candidate can drop only at `location`.
- Tests:
  - `apps/server/tests/review/pipeline/harness/quality-stage.test.ts`
  - `apps/server/tests/review/pipeline/test-strength.test.ts`
  - `apps/server/tests/review/pipeline/mutation/matrix.test.ts`
  - `apps/server/tests/review/pipeline/harness/verification.test.ts`
  - The files under `apps/server/tests/review/pipeline/detectors/`.

## 9. Candidates, validation and repair

- `validateCandidate` turns a reviewer finding into a `CandidateFinding`, defined in `apps/server/src/review/pipeline/consolidate.ts`. It sets `valid`, `dropStage` and `dropReason`.
- A valid low-severity candidate gets `belowBar` unless `reportLowSeverity` is on. `effectiveReportLowSeverity` decides it, default true (low severity is shown). It is in `apps/server/src/review/session/review-settings.ts`. The harness itself reads `input.reportLowSeverity ?? false`, but its only caller, `commands/pipeline.ts`, always passes the setting; the `false` there is for tests that leave it out.
- Repair is on unless `RECODER_CANDIDATE_REPAIR=0`. `candidateRepairOn` and `repairCandidate` are in `apps/server/src/review/pipeline/harness/repair.ts`. At most `RECODER_REPAIR_CAP` (default 8) repairs run per review.
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

- `POST /api/reviews/:id/dismissals` records a dismissal with `recordDismissal`. The route is in `apps/server/src/routes/reviews/dismissals.ts`.
- The fingerprint is `dismissalKey`, in `apps/server/src/review/guidelines/learned/finding-key.ts`.
- Deleting `/api/reviews/:id/dismissals/:findingId` removes it with `removeDismissal`.
- The store is `apps/server/src/review/guidelines/learned/dismissals.ts`. It keeps at most `MAX_DISMISSALS_PER_REPO` per repository in the server data directory. The `Dismissal` type is defined there too.
- On the next review, `createRun` loads them with `listDismissals`. `validateCandidate` drops a match as `dismissed`, and lens prompts list them through `dismissalsBlock`.
- Tests:
  - `apps/server/tests/routes/reviews/dismissals.test.ts`
  - `apps/server/tests/review/guidelines/learned/dismissals.test.ts`
  - `apps/server/tests/review/pipeline/harness-dismissals.test.ts`
