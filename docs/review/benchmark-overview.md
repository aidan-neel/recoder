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
