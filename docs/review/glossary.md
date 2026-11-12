# Glossary

Terms as the code uses them, each with the file that defines it. For how they fit together, read [pipeline.md](pipeline.md). For measurement terms, also read [evaluation.md](evaluation.md).

## Review objects

**Review.** One run of the pipeline over one pull request at one head. Type `Review`, with `ReviewStatus` (`draft`, `queued`, `running`, `passed`, `failed`) in `packages/shared/src/review.ts`.

**Finding.** A problem a developer sees. Type `Finding` in `packages/shared/src/findings.ts`. `severity` is `FindingSeverity` (`info`, `warning`, `error`). `kind` is `FindingKind` (`bug`, `quality`), derived from `category` by `findingKind`.

**Candidate.** A claim a reviewer, subagent or detector reported, before validation and verification. Type `CandidateFinding` (a `Finding` plus `candidateId`, `valid`, `dropReason`, `dropStage`, `belowBar`, `publishedBy`, `refuted`, `repair`) in `apps/server/src/review/pipeline/consolidate.ts`. Candidates that survive and merge become findings (`toFinding`).

**Unit.** A slice of the change cut from the inventory without a model call. Type `ReviewUnit` in `apps/server/src/review/pipeline/units.ts`. Ids are `reviewer-1` (a reviewer's slice, retried as `retry-reviewer-1`), `unit-1` (a brief unit), `subagent-1`, and the second looks `residual-1` and `contract-1`.

**Inventory.** The changed files and their hunks, built from the diff. Type `ReviewInventory` in `apps/server/src/review/pipeline/inventory.ts`.

**Repo inventory.** Every regular file at the PR head, with its blob id, listed once per review. Type `RepoInventory` in `apps/server/src/review/pipeline/repo-inventory/repo-inventory.ts`. Its reviewer summary is the repo map (`apps/server/src/review/pipeline/repo-inventory/repo-map.ts`).

**Fact cache.** Facts that never change once known, kept across reviews and PRs in `<data dir>/cache/facts.db`: parsed declarations per blob and merged commit-to-PR answers. A fact unused for 14 days is dropped. Code in `apps/server/src/util/fact-cache.ts`.

**Lens.** A fixed review procedure with its own categories. Type `Lens`, ids in `LensId`, in `apps/server/src/review/pipeline/lenses/types.ts`. The lenses are `correctness`, `security`, `concurrency`, `api-contract`, `performance`, `rules`, `conventions`, `readability`. A reviewer applies every lens that fits its slice in one prompt and reports the categories of those lenses; a finding in any other category is dropped.

**Lens selection.** The optional subset of lenses a run is limited to, set by `AdaptiveReviewInput.lenses` in `apps/server/src/review/pipeline/harness/types.ts`; unset means every lens. A reviewer applies only the selected lenses that fit its slice, a finding in a category no selected lens reports is dropped at the `category` stage, a slice no selected lens fits shows as excluded in coverage, and a checkpoint (`ReviewCheckpoint.selection`) saved under one selection is refused under another.

**Assignment.** One agent's job: one reviewer over its slice, or one subagent. Type `ReviewAssignment` in `packages/shared/src/progress.ts`.

**Subagent.** An extra agent a reviewer hands a deep dive to, to settle one question. State in `SubagentState` in `apps/server/src/review/pipeline/subagents.ts`. The cap is `SubagentCap` (`0`, `3`, `8`, `12`, `'uncapped'`) in `packages/shared/src/models.ts`; `'uncapped'` is a string so it survives JSON.

**Token budget.** The Low, Medium or High pick that sets how many tokens a review may spend: the number of reviewers (1 on Low, 2 or 3 on Medium, 4 on High), the subagent cap (3, 8 or 12), both reasoning efforts, turns per reviewer and subagent and the model-call ceiling. Type `TokenBudget` in `packages/shared/src/models.ts`; settings in `packages/shared/src/token-budget.ts`; limits `ReviewLimits` in `apps/server/src/review/session/review-policy.ts`. Custom is what the apps show when the cap or an effort no longer matches the saved budget; it is never saved. See [pipeline.md](pipeline.md#token-budget).

**Second look.** A subagent the harness sends itself, not one a reviewer asked for: a residual pass per reviewer slice or a contract check per readability report of a comment that disagrees with the code. Set by `ReviewUnit.purpose` (`SecondLookPurpose`) in `apps/server/src/review/pipeline/units.ts`. Counts inside the subagent cap, only when `RECODER_RESIDUAL` or `RECODER_CONTRACT_CHECKS` is on.

**Detector.** A deterministic check that raises candidates without a model. Code in `apps/server/src/review/pipeline/detectors/`. Its candidates carry `lens` like `detector:duplication`.

**Change model.** The parsed symbols, references and callers of the diff. Code in `apps/server/src/review/pipeline/change-model/`.

**Intent.** The goals and constraints distilled from the PR and its history. Claims have ids like `A1`, `C1`, `G1`, `N1`. Code in `apps/server/src/review/pipeline/intent/`.

**Brief.** The text a reviewer reads first: intent, the change and its open questions. Built under `apps/server/src/review/pipeline/intent/` (`apps/server/src/review/pipeline/intent/brief.ts`, `apps/server/src/review/pipeline/intent/unit-brief.ts`).

**Brief question.** An open question the brief pins to a changed line, ids `Q1`, `Q2`. Type `BriefQuestion` in `packages/shared/src/questions.ts`. Result is `BriefQuestionResult`: `confirmed`, `disproved`, `unresolved`. The ledger is `apps/server/src/review/pipeline/question-ledger.ts`.

**Obligation.** A question about changed behavior derived mechanically from the change model, never a finding. Type `Obligation` in `packages/shared/src/obligations.ts`. Triggers are `ObligationTrigger`: eight kinds, and state-transition with `RECODER_OBLIGATIONS_TRANSITIONS`. Result is `ObligationResult`: `confirmed`, `disproved`, `not-applicable`, `unresolved`. Runs only when `RECODER_OBLIGATIONS` is on.

**Checkpoint.** A review's saved progress, so it can continue or replay. Type `ReviewCheckpoint` in `apps/server/src/review/session/review-checkpoint.ts`.

**Replay.** Rerunning a passed review from its kept checkpoint without its reviewers. `replayReviewSession` in `apps/server/src/commands/rerun.ts`.

**Funnel.** How many candidates a review raised and where each went. Type `ReviewFunnel` in `packages/shared/src/review.ts`.

## Verification

**Verification.** Whether a candidate was proven. Type `FindingVerification` in `packages/shared/src/findings.ts`.

- `status`: `verified` or `unverified`.
- `method`: `run`, `trace`, `detector`, `rule`, `convention`.
- `outcome` (`VerificationOutcome`): `reproduced`, `traced`, `inconclusive`, `refuted`, `not-run`.

**Proof.** The evidence behind a `verified` status. Type `VerificationEvidence`: the `command`, `exitCode`, `expected`, an `observed` excerpt taken by the harness, and the `evidenceId` of the recorded run. The store is `apps/server/src/evidence/store.ts`.

**Baseline.** The same proving command run on the merge-base tree, to tell a regression from a failure that predates the change. Type `VerificationBaseline` in `packages/shared/src/findings.ts`. Code in `apps/server/src/review/pipeline/harness/verify-baseline.ts`.

**Baseline check.** A repo-wide command run on the PR head and cached across reviews by commit and install inputs. Code in `apps/server/src/review/pipeline/harness/baseline-checks.ts`. Cache in `apps/server/src/review/pipeline/harness/baseline-cache.ts`.

**Base comparison result.** Type `BaseComparisonResult`: `regression`, `pre-existing`, `incompatible`, `environment`, `worsened`, `unstable`. Only `pre-existing` says the head's failure predates the change.

**Refuted.** A verifier showed the candidate wrong. `CandidateFinding.refuted`, and `DropStage` `refuted`.

**Unproven.** No verifier settled the candidate. It is kept out of `findings` and held in `Review.unconfirmed`.

**Not run.** A bug in a review where no baseline check passed (or none could run), so no verifier tried it. It is published, marked unverified (`outcome: 'not-run'`), and counted as `ReviewFunnel.notRun`. Decided by `whyCodeCannotRun` in `apps/server/src/review/pipeline/harness/verification.ts`.

**Below the bar.** A low-severity candidate held back when Settings keeps reviews to medium and above (`belowBar`). Low severity is shown by default. `publishedBy` (`PublishedBy`: `reproduced`, `rule`) says why one is published anyway. Defined in `apps/server/src/review/pipeline/published-by.ts`.

## Where a candidate stopped

**DropStage.** The stage that dropped a candidate. In `packages/shared/src/review.ts`: `location`, `evidence`, `category`, `severity`, `dismissed`, `refuted`, `covered`.

**StopStage.** `DropStage` plus `unproven`. Type `StopStage`, and the record `CandidateOutcome` (`stage`, `reason`, `verified`, `publishedBy`, `repair`), in `apps/server/src/review/pipeline/candidate-outcome.ts`. A `null` stage means the candidate reached consolidation.

**stoppedAt.** In a benchmark report, the `StopStage` that stopped a planted defect's best candidate, or `consolidation` when it was lost while merging. Type `StoppedAt` in `apps/server/src/eval/benchmark-stages.ts`.

**Repair.** The one attempt to fix a candidate that failed location or category validation. Type `CandidateRepair` in `apps/server/src/review/pipeline/candidate-repair.ts`.

## Evaluation

**Planted label.** A defect a dataset's label file says was planted in a PR. Type `LabeledDefect` in `apps/server/src/eval/benchmark-score.ts`. A review's found, verified and published counts are over planted labels.

**Control PR.** A labeled PR with no planted defects. A benchmark counts what a review publishes on it as noise. `control` in `apps/server/src/eval/benchmark.ts` and `ControlTotals` in `apps/server/src/eval/benchmark-labels.ts`.

**Finding label.** A person's call on a finding that matches no planted defect: `additional`, `false` or `unresolved`. Stored in the dataset's adjudications file, read by `apps/server/src/eval/benchmark-labels.ts`.

**Judge.** The model that decides which findings report which planted defects. Version in `JUDGE_VERSION` in `apps/server/src/eval/benchmark-judge.ts`.

**Identity.** Everything that decides a result, hashed so two reports can be told apart. Type `RunIdentity` in `apps/server/src/eval/identity.ts`.

**Defect stage.** How far one planted defect got in one run: `found`, `verified`, `published`. Type `DefectStage` in `apps/server/src/eval/benchmark-stages.ts`.

**Independent pass.** The `independent-pass` arm of `RECODER_REVIEW_VARIANT`: a second reviewer per slice (`independent-reviewer-N`) that never sees the first pass's findings. Built by `independentPassUnits` in `apps/server/src/review/pipeline/variants/independent-pass.ts`.

**Specialist tree.** The `specialist-tree` arm of `RECODER_REVIEW_VARIANT`: a coordinator assigns slices to one-lens specialists (`specialist-<lens>`), each with at most 3 subagents. Planned by `planSpecialists` in `apps/server/src/review/pipeline/variants/specialist-plan.ts`; its record is `SpecialistPlan`.
