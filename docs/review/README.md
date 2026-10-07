# Review process docs for agents

Reader: an AI agent that has to understand, operate, change or evaluate Recoder's review. Every statement here was checked against the code on this branch. File paths are repository-relative.

## Read in this order

| File                                 | Read it to                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| [pipeline.md](pipeline.md)           | follow one review stage by stage: entry function, types, drops, tests           |
| [models.md](models.md)               | see how model calls are resolved, locked, limited and recorded                  |
| [configuration.md](configuration.md) | find every environment variable the server reads and which are experiment flags |
| [benchmark-overview.md](benchmark-overview.md) | get the idea of the benchmark and the current results                |
| [evaluation.md](evaluation.md)       | measure a review with the benchmark and compare reports validly                 |
| [operating.md](operating.md)         | run one review locally, end to end, through the API                             |
| [glossary.md](glossary.md)           | look up a term and the file that defines it                                     |

Find a term first in the glossary, then open the file it names.

## Map of the pipeline

Execution order. The entry for the whole run is `runAdaptiveReview` in `apps/server/src/review/pipeline/harness/run.ts`. Details and types are in [pipeline.md](pipeline.md).

| Stage                                    | Entry file                                                 | Output type                                   |
| ---------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Trigger and lifecycle                    | `apps/server/src/commands/pipeline.ts`                     | `ReviewStatus`, `ReviewOutcome`               |
| Checkout and sandbox                     | `apps/server/src/review/pipeline/harness/sandbox-setup.ts` | `ReviewRevision`, `BaselineResult`            |
| Inventory and change model               | `apps/server/src/review/pipeline/inventory.ts`             | `ReviewInventory`, `ChangeModel`              |
| Intent                                   | `apps/server/src/review/pipeline/harness/intent-stage.ts`  | `ChangeIntent`                                |
| Units and briefs                         | `apps/server/src/review/pipeline/harness/unit-stage.ts`    | `ReviewUnit`, `UnitBrief`                     |
| Lens reviewers, subagents                | `apps/server/src/review/pipeline/harness/pool.ts`          | `ReviewerOutput`, then `CandidateFinding`     |
| Obligations (flag `RECODER_OBLIGATIONS`) | `apps/server/src/review/pipeline/obligations/stage.ts`     | `ObligationReport`                            |
| Detectors                                | `apps/server/src/review/pipeline/harness/quality-stage.ts` | `DetectorResult`                              |
| Validation and repair                    | `apps/server/src/review/pipeline/consolidate.ts`           | `CandidateFinding`, `CandidateRepair`         |
| Verification                             | `apps/server/src/review/pipeline/harness/verification.ts`  | `FindingVerification`, `BaseComparisonResult` |
| Consolidation, publication               | `apps/server/src/review/pipeline/harness/consolidation.ts` | `Finding`, `ReviewFunnel`                     |
| Feedback                                 | `apps/server/src/review/guidelines/learned/dismissals.ts`  | `Dismissal`                                   |

Reviewers, detectors and verifiers overlap in time. Verifiers take each candidate as it is reported.

## Invariants to keep when you change the pipeline

These come from `AGENTS.md` and from conventions visible in the code.

- Files stay under 500 lines, tests included. Split along real seams and keep the original path as the entry.
- Comments are JSDoc (`/** ... */`) only. No `//` comments.
- Tests live under `apps/server/tests/`, mirroring `apps/server/src/`. Write one for a parser of outside input, a security boundary, concurrency or retry logic, persisted state, or a bug you fixed. Use fake models and a temporary `RECODER_DATA_DIR`. Never call a real model in a unit test.
- No dead or duplicated code. `bun run deadcode` must pass.
- An experiment flag defaults off. With it unset, the review must behave exactly as before. `obligationsOn` in `apps/server/src/review/pipeline/obligations/config.ts` and `testStrengthOn` in `apps/server/src/review/pipeline/test-strength.ts` show the pattern. The flags are listed in [configuration.md](configuration.md).
- Add a stage test next to the stage you change, in `apps/server/tests/review/pipeline/`. Name the `stoppedAt` reason a new drop records, and keep `DropStage` in `packages/shared/src/review.ts` in step.
- Use bun only.

Checks before you finish: `bun run --filter @recoder/server check`, `test` and `lint`, then `bun run deadcode` from the root.

## Do not

- Do not read or print the settings or token files in the data directory.
- Do not put private evaluation data in the repository.
- Do not stop servers you did not start. Stop yours by pid.
