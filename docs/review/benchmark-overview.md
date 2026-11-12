# Benchmark Overview

Reader: a person who wants to know how Recoder's review quality is measured and what the numbers are today.
The commands, flags and report fields are in [evaluation.md](evaluation.md). This file gives the idea and the results.

## What is measured

The dataset `synth-v1` has 25 PRs from four small open-source style repositories. Each PR has bugs planted in it, 134 in total. Five PRs are controls with no planted bug.
Recoder reviews every PR. A judge model then checks each planted bug: did a published finding describe it? The score is the number of planted bugs found, out of 134.
Other numbers the report keeps: candidate, verified and published recall, where each missed bug was dropped (`stoppedAt`), review time (p50 and p95), and which models made the calls.
The dataset and its labels stay outside the repository.

## Rules that keep a number honest

- A run is valid only when one reviewer model made every call. The audit (`apps/server/src/eval/reviewer-audit.ts`) is run before any score is read.
- A run with a provider quota failure is a failed run. It is kept and labeled, never hidden.
- The judge is frozen inside a comparison. A report judged by the reviewer model itself is labeled self-judged and interim.
- Run-to-run spread is about 7 bugs, so a difference below 7 between two single runs is not evidence.
- An important comparison needs at least 3 runs. Runs are reported one by one and never merged into one score.
- A subset of PRs is no full-set score.

## Results (as of 2026-10-07)

Tree: `main` at 4690770 unless noted. Judge v2.

| Reviewer | PRs | Runs | Found | Judge | Note |
| --- | --- | --- | --- | --- | --- |
| Muse Spark 1.3 Contributor, xhigh | 25 | 4 valid | 108, 109, 101, 102 of 134 | Luna | Base tree, before the later changes. Two of the four had the briefs change. |
| Claude Sonnet 5.5, high (Claude Code) | 25 | 1 | 111 of 134 | Sonnet 5.5 | Self-judged, interim. Same score when rescored with the same judge. |
| Claude Sonnet 5.5, high (Claude Code) | 8 | 1 | 38 of 49 | Sonnet 5.5 | The `quick` set, a subset, no full-set score. |

Runs that did not produce a result: GPT 6.1 Sol (usage limit), GLM 5.3 (rate limit after three reviews), Claude Opus 5.5 (stopped after four minutes, adapter failures; fixed for Claude Code since), two Muse runs (quota).

## What the numbers do not show

- The earlier 75 of 134 came from a run that mixed reviewer models. It is void, and so is the old target of 110.
- Sonnet 5.5 is above the Muse range by less than the run-to-run spread, and it is self-judged. It is not a proven gain.
- Precision is not summarized here. Check the control PRs and the unresolved findings in a report before you quote recall.
- Recoder has to work with locally hosted open models of about 400B. A result on a hosted model does not show that.

## The accuracy plan of issue #63 is closed

Issue #63 set a target of 110 published defects out of 134 and listed the work to get there. This section records how it ended.

Later results, on the dataset `synth-v2` (the same 134 planted bugs plus 72 labels that reviews found, 206 in total):

| Date | Tree and reviewer | PRs | Runs | Found | Judge |
| --- | --- | --- | --- | --- | --- |
| 2026-10-08 | `main`, GPT 6.1 Sol high with SWE-2 as the second model | 25 | 1 | 165 of 206; 115 of the 134 planted | Luna |
| 2026-10-08 | Recall levers off (obligations, contract checks, test strength) | 8 (`quick`) | 3 | 49, 52, 49 of 65 | Luna |
| 2026-10-08 | Recall levers on | 8 (`quick`) | 3 | 55, 56, 57 of 65 | Luna |

- One full run found 115 of the 134 planted bugs. That is above 110, but it is one run, and the rule above asks for three. The three-run comparison exists only on the `quick` set, which is no full-set score.
- With the levers on, the second model read 55% more input and a review took about 10 minutes longer. Labeled precision fell a little (duplicates and unresolved findings went up; no false finding came from a lever).
- On 2026-10-09 the owner parked accuracy tuning to work on review quality and the interface first. The target of 110 is not pursued as a number any more.

What the plan's open items became:

- Finding history and decisions (#72), the rule ledger with verified quotes and levels (#71), evidence classes and rule citations on findings (#74), the bounded mutation matrix (#94), history sources on the run record (#98) and state-transition obligations (#99) are in the tree. The specialist tree and the independent second pass (#95) are experiment arms behind `RECODER_REVIEW_VARIANT`; no run has measured them yet.
- When accuracy work starts again, the first two levers are known from the 2026-10-09 comparison with other tools: leave quality findings out of posted comments, and add a "worth a comment" gate for minor bugs. Measure each with three full-set runs.
