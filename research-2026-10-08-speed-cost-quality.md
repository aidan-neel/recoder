# Faster evals, faster reviews, fewer tokens, better recall and precision

Research notes, 2026-10-08. Nothing in the code was changed for this document.

Data sources:

- The synth-v2 full run of 2026-10-08: 25 PRs, 1 run each, gpt-6.1-sol high as the Review model, swe-2-high xhigh as the second model, Luna judge. Published recall 165/206.
- The recall-levers A/B of 2026-10-08: quick set (8 PRs), 3 runs per arm, same models.
- The eval server's event snapshots and stored metrics for every review of the full run (task timings, tool calls, candidates).

Every number below comes from those three sources unless the text says it is an estimate.

## 1. Summary

The verifier stage decides review time and most of the token cost. Recall is lost before verification, when a defect is never raised. Precision is lost in three places that can be measured offline: duplicates, the rule path, and the dead-code detector.

Ranked levers. Each one names the goals it serves (E eval speed, R review speed, T tokens, Q recall and precision) and the cheapest eval mode that measures it.

| # | Lever | Goals | Measure with | Expected effect |
| --- | --- | --- | --- | --- |
| 1 | Replay-first verification (section 3.A1) | R, T, E | `--reverify` | Corrected: applies to about 10% of verifications, so a few percent of verifier input. The original estimate counted the verifier's own run as the reviewer's. |
| 2 | Cluster candidates before verifying, verifier-declared duplicates (A2) | T, Q, R | `--reverify` | About -25% verifications, fewer duplicate findings |
| 3 | Verify only what can publish (A3) | T, Q | `--reverify` | About -10% verifier calls, up to 5 more planted defects |
| 4 | Candidates-only eval mode, partial replay by lens, concurrency 8 (E1 to E3) | E | eval harness | Reviewer experiments at about one third of today's wall time and tokens |
| 5 | Start subagents when their lens finishes (B1) | R, E | full run on the quick set | Tail of a review shorter by 5 to 10 minutes when subagents run |
| 6 | Dead-code exports, rule-path lows, severity by the verifier (C1, C2, C5) | Q | `--replay` or `--rescore` | 7 false findings gone, fewer unlabeled lows |
| 7 | Turn the measured recall levers on, paid for by 1 to 3 (F1 to F4) | Q | full run, 3 repeats | Recall +9 points on the quick set, already measured |
| 8 | Prefix order for cross-session cache hits (D1) | T | one PR, stage table | Conditional on provider cache semantics, see section 6 |
| 9 | Quality lenses on the second model (B3) | T | full run | Sol cost about -35%; a decision for the user |

Lever 1 was ranked first on a miscount (section 3.A1). It was built and measured on the Mac (see the replay results); its real reach is about a quarter of the estimate. A2 and A3 are the larger verification levers.

## 2. What the measurements say

### 2.1 Where review time goes

Timelines of the 25 reviews, minutes from review start. Each row is one review; the columns are the first start and the last end of each kind of task.

| Review | Total | Lenses | Retry | Subagents | Verification |
| --- | ---: | --- | --- | --- | --- |
| hono-1 | 20.3 | 1.2 to 7.7 | | 8.3 to 18.4 | 6.1 to 20.3 |
| hono-3 | 19.6 | 0.6 to 7.4 | | 8.0 to 13.5 | 4.8 to 19.5 |
| ky-3 | 30.9 | 1.1 to 11.9 | 11.9 to 15.2 | 15.7 to 27.5 | 2.3 to 30.8 |
| recoder-4 | 27.7 | 1.2 to 10.7 | 10.8 to 13.8 | 13.8 to 22.9 | 2.1 to 27.6 |
| sivir-3 | 41.8 | 1.3 to 8.3 | | 9.0 to 18.4 | 3.9 to 41.5 |
| sivir-5 | 37.1 | 1.5 to 7.2 | | 7.8 to 22.2 | 1.4 to 37.1 |

In 25 of 25 reviews the verification window ends when the review ends. Setup and baseline checks take about one minute (the baseline cache works). The lenses of a unit finish 5 to 8 minutes after they start. Subagents start only after every lens and retry has finished, and take 9 minutes at the median.

Task durations over all 25 reviews:

| Task kind | Count | p50 | p90 | Max |
| --- | ---: | ---: | ---: | ---: |
| Verification | 619 | 213 s | 391 s | 1945 s |
| Lens reviewer | 281 | 136 s | 316 s | 748 s |
| Subagent | 36 | 548 s | 735 s | 900 s |
| Retry | 5 | 365 s | 395 s | 409 s |
| Baseline checks | 59 | 38 s | 79 s | 223 s |
| Setup | 50 | 9 s | 21 s | 31 s |

About 25 verifications per review run six at a time, so a review needs four or more verifier waves of 3 to 4 minutes each. `makeRoom` in the verify queue extends the deadline by 5 minutes per wave, so the review waits for them.

Two things are not bottlenecks:

- The sandbox command queue. Every command of a review runs through one lock (`exclusive` in `exec-workspace.ts`). The measured wait in that queue is zero at the median and at p90, 31 s at the maximum. Sandboxed commands take 0.3 s at the median and 7 minutes in total per review.
- Model capacity. The eval server log of the full run holds no capacity or rate-limit error at eval concurrency 4.

### 2.2 Where tokens go

Mean per review (passed runs, full set):

| Stage | Model | Calls | Input | Cached | Output | Share of input | Input per call |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Verifier | swe-2-high | 125 | 2.75M | 56% | 87k | 59% | 22k |
| Reviewer (lenses, retries) | gpt-6.1-sol | 64 | 1.51M | 74% | 39k | 32% | 23k |
| Subagent | swe-2-high | 11 | 0.27M | 41% | 13k | 6% | 26k |
| Worker | swe-2-high | 8 | 0.14M | 50% | 5k | 3% | 18k |
| Intent, ledger, repair | gpt-6.1-sol | 2 | 0.01M | 0% | 1k | 0% | 4k |
| Total | | 210 | 4.67M | | 146k | | |

One verification costs about 5 model calls and 110k input tokens.

Dollar split per review at Sol list rates (2 dollars per million input, 0.10 cached, 10 output). The second model is free today, so its column is what the cost would be if it were paid at the same rates.

| Model | Cost per review |
| --- | ---: |
| gpt-6.1-sol (reviewers, intent) | 1.32 |
| Second model (verifier 3.46, subagent 0.46, worker 0.19) | 4.11 |
| All | 5.43 |

The paid cost today is the Sol line. The second-model line is the risk if swe-2 stops being free.

### 2.3 What each lens buys

Shown findings are made of member candidates. This table counts members by the lens that raised them and by the class the judge and adjudications gave the finding they ended in.

| Source | Raised | Shown members | Planted | Additional | False | Unresolved | Duplicate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| api-contract lens | 133 | 129 | 86 | 13 | 0 | 10 | 20 |
| correctness lens | 133 | 127 | 80 | 9 | 0 | 15 | 23 |
| concurrency lens | 75 | 75 | 41 | 11 | 0 | 9 | 14 |
| rules lens | 85 | 63 | 6 | 22 | 1 | 26 | 8 |
| detectors | | 55 | 18 | 30 | 7 | 0 | 0 |
| retry of a failed lens | 40 | 37 | 24 | 1 | 0 | 2 | 10 |
| security lens | 35 | 33 | 15 | 8 | 0 | 6 | 4 |
| performance lens | 26 | 25 | 7 | 10 | 0 | 6 | 2 |
| subagents | 23 | 23 | 4 | 1 | 0 | 7 | 11 |
| conventions lens | 25 | 4 | 3 | 0 | 0 | 0 | 1 |
| readability lens | 35 | 1 | 0 | 0 | 0 | 0 | 1 |

Reading this:

- Three lenses (api-contract, correctness, concurrency) carry most planted defects.
- The rules lens has the lowest precision: 6 planted of 63 shown members, 26 unresolved.
- Conventions and readability raise 60 candidates and show 5 members. Their candidates are mostly low severity and are held back. They still cost two of the eight lens runs per unit and 48 verifications.
- Subagents mostly repeat what a lens found: 11 of 23 members are duplicates.
- Retries matter. Five retried lenses produced 24 planted members. The failed first attempt cost both time and, until the retry, recall.

### 2.4 Where recall is lost

41 of 206 labels were missed in the full run:

| Where | Count | Detail |
| --- | ---: | --- |
| Never raised by any candidate | 33 | Edge cases, weakened tests, and 3 omissions in files the PR did not touch |
| Raised, held as low severity | 7 | 5 trace-verified, 1 run-reproduced but blocked by a base comparison that said pre-existing, 1 unverified |
| Raised, dropped at the category gate | 1 | An intent-mismatch finding with no intent claim id |

Verification lost about 3 (hidden 35 candidates, 10 matched a label, 3 of those were not shown by another finding). Refuted: 12 of 677 candidates.

Of the 7 held lows, 4 are documentation-versus-code contradictions. No run shows those. They were recovered in the A/B by the contract-checks lever, not by the verifier.

### 2.5 Where precision is lost

415 shown findings: 165 planted, 91 additional (true, not planted), 8 false, 74 unresolved, 77 duplicates. Precision is between 62% (planted plus additional) and 80% (everything but false and duplicates).

- 7 of the 8 false findings are the dead-code detector on exported public types.
- 77 duplicates remain after consolidation merged 157 of 572 member candidates. Each of those 157 was verified on its own before it was merged.
- 74 unresolved, 34 of them on control PRs. This is an adjudication backlog as much as a pipeline problem. Until the control findings are labeled, precision is a band.
- The rule path published 59 lows; 46 are unlabeled; 23 are one multiline rule (block bodies) on sivir.

By verification method, the share of shown findings that were planted: run 49%, trace 29%, detector 29%, rule 10%. By severity: error 66%, warning 42%, info 21%.

### 2.6 Run-to-run noise

Off arm of the A/B, 3 runs on 65 defects: 49, 52 and 49 published. 43 defects were found in all 3 runs, 9 in 2 runs, 3 in 1 run. Two single runs of the same tree differ by about 8 defects (symmetric difference). So one run per arm cannot see a change smaller than about 6 published defects on the quick set, and a change of 1 or 2 defects on one PR is noise.

The comparison primitive that works is the one in the A/B summary: per defect, published count in each arm over the repeats, then defect-runs gained and lost. The on arm showed +20 gained and -2 lost over 3 repeats; that was visible after 2 repeats. Keep 3 repeats when the expected change is under 10 defect-runs.

## 3. Levers

Each lever says what to build, the evidence, the expected effect, which earlier decision it touches, and how to measure it.

### A. Verification

#### A1. Replay-first verification

Evidence (corrected 2026-10-08). The first version of this section said that 355 of 413 run-proven bugs were proven by a command the reviewer had already run and seen fail. That count was wrong. Verification puts the verifier's own proving run first in the candidate's cited evidence (`leadWithProof`), and the count took that run for the reviewer's. A recount on the 25 kept checkpoints, which tells owners apart by agent id, gives:

| Bug candidates (465) | Count |
| --- | --- |
| Cite a reviewer run that failed on an assertion | 65 |
| Cite only reviewer runs that exited 0 (print-only repros) | 272 |
| Cite no reviewer run | 128 |
| Run-proven bugs whose proof is a command the reviewer ran | 0 of 413 |

So verifiers always write their own repro today, and only about 14% of bugs have a failing reviewer run to replay. After the 300-call progress cap, about 50 of those 65 have scratch files that can be recovered for an offline replay.

What to build. When a bug candidate cites a run that its own reviewer made and that failed on the code under test (the `ownRuns` and `brokeInSetup` rules in `verify/runs.ts` already decide this), the verification stage does three steps before it starts an agentic verifier:

1. The harness reruns the cited command itself, in the verifier's agent context, with the reviewer's scratch files in place. Scratch files are kept per owner until the workspace is cleaned up (`exec-workspace.ts`, `scratch`), so the rerun is possible today. The result is a `run` evidence record made by the verification stage, not by the reviewer.
2. If the rerun fails the same way (`showsDefect` against the claim), one model call with no tools audits it: given the claim, the scratch test or script, and the output, does the failing assertion show the claimed defect, or does it show something else (a setup error, a wrong expectation, an unrelated failure)? The audit answers confirmed or unsure, and quotes the output line.
3. Confirmed: the candidate is verified, method run, outcome reproduced, with the harness rerun as proof. The base rerun (`recordBaseline`) runs as today. Unsure, or a rerun that does not fail the same way: the full agentic verifier runs as today.

Weak-test (mutation) findings and quality findings keep the current verifier.

What it keeps. Every finding is still proven by a run; the proof is still a run evidence record that the verification stage made; a refutation still needs a passing run; the base comparison is unchanged; nothing is skipped and no finding is published unverified. This is not the fast mode that was rejected. What it gives up is the independence of the assertion: the verifier no longer writes its own repro when the reviewer's already fails. The audit call and the fallback are what buy that back.

Expected effect (corrected). At most about 65 of 619 verifications (about 10%) can take the short path, not 57%. Verifier input falls by a few percent, not half, and the review tail barely moves. The larger pool is the 272 bugs whose reviewer printed the defect with an exit-0 run. Replaying those would replace the verifier's own repro with an audit of the reviewer's print output. That is a second loosening of the strict-verifier decision, so it is the user's call and is not built.

Measured (2026-10-09, Mac mini, branch `feat/replay-first-verify`, `RECODER_REPLAY_VERIFY=1`). Both arms replayed the 18 full-run reviews that hold the 65 eligible bugs, with only those 65 verdicts cleared, and with Sol as the second model in both arms (Devin's free limit was exhausted). Replay settled 25 of the 65: 49 reruns failed on the code, the audit confirmed 25 and answered unsure on 24, mostly for the right reasons (a test that broke in setup, a missing test file, a port Vitest could not bind, a failing assertion that did not test the claim). 16 reruns did not fail on the code (10 for missing scratch files or setup, 2 passed). All 25 replay-confirmed bugs were also confirmed by the full verifier in the control arm and published in both; 7 carry a judge label in both arms. Nothing was refuted in either arm. On the 17 PRs the judge scored in both arms, planted labels found were 71 (flag on) and 72 (off) of 87. A replayed verification cost 1 audit call instead of about 4.9 verifier calls and 46k input tokens, so the 25 saved about 1.1M verifier input, but 14 extra candidates from re-run failed assignments in the flag-on arm hid that in the totals (4.20M vs 4.30M). A replayed verification took 46 s at p50 against 73 s for the same candidates in the control: the rerun, the audit and the base comparison all queue for sandbox slots. Review wall time did not move once two control-arm outliers from re-run assignments are set aside. At review level the lever reaches about 4% of verifications.

Status. Parked by the user on 2026-10-09 after the measurement. The branch `feat/replay-first-verify` keeps the code behind its flag, unmerged. The exit-0 print-repro extension was not pursued.

Risk. An audit that accepts a wrong repro. Today 12 of 677 candidates are refuted and 7 are inconclusive after a confirmed verdict. Those are the numbers to watch; both are in the report.

Measure. `--reverify` on the full-run report: zero reviewer calls, every candidate verified again. Compare published planted, refuted, unresolved, verifier tokens by stage, and verifier task p50. One reverify run on the Mac costs about 2 hours at concurrency 4 today, and less after A1 itself.

#### A2. Cluster before verifying, and verifier-declared duplicates

Evidence. 157 member candidates (27% of shown members) were merged after each one was verified alone. 77 shown findings are still duplicates (19%). 47 of the duplicates share file and symbol.

What to build. Two parts.

1. The verify queue groups a new candidate with a queued or running one when the consolidation rules would merge them later: same merge key, or same title key with `sameClaim` true (`consolidate-merge.ts`). The group gets one verifier. Members inherit the verdict. This only joins candidates that consolidation would merge anyway, so no finding is lost that is shown today.
2. The verifier prompt lists the candidates already confirmed in the same file and symbol (title, line, one sentence). The verdict schema gets an optional `sameAs: <candidateId>`. A confirmed verdict with `sameAs` and its own run merges the candidate into that finding at consolidation. No extra call.

Decision it touches. The 2026-10-04 rule "merge only on the same fingerprint and the same starting line; a duplicate costs less than a lost bug" stays for part 1. Part 2 is the verifier's call, made with the code and a run in front of it, and it is recorded in the pool so an eval can count the merges and the judge can check them.

Expected effect. About -25% verifications and verifier tokens. Duplicates from 77 toward about 40 (estimate). 

Measure. `--reverify` for part 1 and 2; `--replay` for the consolidation half. The judge's duplicate count and the planted count are the two numbers.

#### A3. Verify only what can publish

Evidence. 64 candidates below the reporting bar were verified: 48 traced, 15 unverified, 1 run-reproduced. A below-bar bug publishes only when a run reproduces it (`raiseReproduced`); a below-bar quality finding publishes only through the rule path. The 48 traced lows could never publish and cost about 48 × 5 calls. On the recall side, 5 of the 7 held-low misses were trace-verified.

What to build.

- A below-bar bug candidate gets a verifier only when code can run, and its prompt says the finding is published only if a run reproduces it, so a trace is not worth the turns.
- A below-bar quality candidate gets no verifier. The rule path uses the rule detector, not the verifier.
- A below-bar candidate still runs last, as today.

Expected effect. About -10% verifier calls. Up to 5 more planted defects if the run-insisting attempt reproduces the traced lows. 4 of those 5 are documentation-versus-code contradictions, which a run cannot show; the contract-checks lever (F2) covers them, so count on 1 to 2 here.

Measure. `--reverify`.

#### A4. Smaller and shared verifier prompts

The verifier's first turn is about 22k tokens: system prompt, the candidate, up to four cited evidence records of 4000 characters each, the intent block, the setup notes. The shared parts (system, setup notes, intent) come after the candidate, so no two verifiers of one review share a prefix. Put the shared parts first and the candidate last. Cut cited evidence to the lines around the quoted span (the `observedExcerpt` rule already does this for the stored verification). Expected: fewer uncached tokens per verification; the size of the gain depends on D1.

### B. Reviewer stage

#### B1. Subagents overlap the lenses

Evidence. `runSubagents` starts after every lens and retry. Subagents take 9 minutes at the median and start 6 to 20 minutes into the review. In reviews that run subagents (about 70%), they end 11 to 28 minutes in, often after the last verifier would have finished without them.

What to build. A reviewer's subagent request joins the unit pool as soon as that reviewer finishes, under the same cap, so it runs beside the other lenses. The brief-question subagents (unsettled and unaddressed questions) start after the last defect lens of the unit, not after the whole pool. The checkpoint already stores planned subagents; planning becomes incremental.

Expected effect. Review tail shorter by 5 to 10 minutes where subagents run. No token change.

Also worth a decision. Subagents produced 23 shown members: 4 planted, 11 duplicates, 7 unresolved; 9 of 36 errored. Obligations (F1) produced more planted defects per token in the A/B. If obligations go on by default, cap reviewer-requested subagents to questions that name a symbol outside the unit, which is their stated purpose.

Measure. Full run on the quick set, 1 repeat is enough for time; 3 for recall.

#### B2. Lens failures

Evidence. 20 of 281 lens assignments ended in error or partial. The 5 retries took 6 minutes each and produced 24 planted members. A failed first attempt costs its time, the retry's time, and the recall until the retry.

What to do. The assignment records hold the failure text (`currentOperation`). Pull the 20 reasons from the full run's checkpoints, group them (schema, deadline, provider error, output limit), and fix the top cause. No numbers can be promised before the reasons are read.

#### B3. Quality lenses on the second model

Evidence. Rules, conventions and readability are 3 of the 8 lens runs per unit, about 38% of Sol reviewer calls, about 0.48 dollars per review at list rates. They show 68 members: 9 planted, 22 additional, 27 unresolved, 1 false. They do not run code (`QUALITY_RULES` says so).

What to build. Run the three quality lenses on the second model (`configForSubagent`) at low effort with `maxLensTurns` 3. The eight lenses stay; only the model and the turn count change. This follows the 2026-10-08 instruction to keep token uptick on the subagent models.

Decision it touches. The quality track (2026-10-03) and the restored eight lenses (2026-10-04). This lever changes neither the lens list nor what they report. It does change which model writes quality findings, so the user decides.

Expected effect. Sol input about -35%, Sol cost about -0.45 dollars per review. Quality recall may move; the full set has 47 quality labels.

Measure. Full run, 3 repeats, by kind (bug and quality are reported apart).

### C. Precision, measurable offline

#### C1. Dead-code detector on exported types

7 of 8 false findings. Treat a symbol as used when it is exported from a package entry point: an index barrel, a path in `package.json` `exports`, or a public type file. Measure with `--replay` on the full-run report; the false count should go to about 1.

#### C2. Rule-path lows

59 published lows through the rule path, 46 unlabeled, 23 from one multiline rule on sivir while the written rules "always braces" and "llm.md is prose" were missed. Publish a low through the rule path only when the rule has a mechanical check (the branch already adds `require-braces` as a tree-sitter check), or when the ledger marks the rule as a must (always, never). Hold the rest with the other lows. Measure with `--replay` and `--rescore`.

#### C3. Severity set by the verifier

Precision by severity is error 66%, warning 42%, info 21%. The reviewer sets severity before anything ran. The verifier sees the reproduced effect. Let a confirming verifier rate severity for bugs (reproduced is at least medium, as `raiseReproduced` already does), and let the reporting bar apply to that rating. Measure with `--reverify`; the numbers are the planted count and the info-severity share.

#### C4. Unresolved findings on controls

34 unresolved findings sit on control PRs. Labeling them (additional or false) is adjudication work, not code. Until then every precision number is a band. The bench devtool can present them for a decision.

### D. Tokens and caching

#### D1. Prefix order for cross-session cache hits

Evidence. Within one session the provider cache works: reviewer input is 74% cached, verifier 56%. Across sessions nothing is shared, because the prompts differ from their first bytes. The eight lens reviewers of a unit have different system prompts (the procedure) and the same user prompt (PR, intent, unit, declarations, brief, patch). Verifiers start with the candidate.

What to build. Keep one system prompt for every defect lens (the contract) and move the lens procedure to the end of the user message, after the patch. Then the first 15k to 20k tokens of all eight lens calls of a unit are identical. For verifiers, put system, setup notes and intent first and the candidate last (A4).

Condition. The gain exists only when the provider serves a cached prefix to a different session. What a check of the OpenCode source (dev branch, 1.18.35) found:

- For `@ai-sdk/openai` providers, and for `opencode*` providers with gpt-5 models, OpenCode sends `promptCacheKey` set to the session id (`provider/transform.ts`, `options()`). Sibling sessions never share a key. For OpenRouter and custom openai-compatible providers no key is sent.
- OpenAI's prompt-caching guide says the key is a routing hint: about 15 requests per minute per key before overflow routing, and on GPT-5.6 and later routing is automatic and the key is not needed. So for Sol (gpt-6.1) an identical prefix across sessions should already hit the cache; the per-session key should not block it. This is the guide's statement, not a measurement.
- A static override is possible: `promptCacheKey` in the model's `options`, in an agent's options, or in a variant wins over the session id (`session/llm/request.ts` merge order). A per-review key would need an OpenCode plugin with the `chat.params` hook; the HTTP API takes no provider options per request, only `agent` and `variant` names from the config.
- For Anthropic models OpenCode puts cache breakpoints on the first two system messages and the last two non-system messages, and builds one system message with its own prompt and an env block first and the caller's `system` last. The env block holds today's date, so the prefix changes daily, which is fine.
- Devin's caching is not documented. The adapter sends the whole transcript on every call (`agents/devin/devin.ts`), and the verifier's 56% cached share shows Devin caches a repeated prefix across calls. Whether it does so across verifiers is unknown.

So D1 is likely to work on Sol as the prompts stand, and it is unknown on the second model. A one-PR test settles it.

Expected effect if it works. Reviewer uncached input from 0.39M to about 0.2M per review (Sol about -0.35 dollars per review); verifier uncached input down by the shared part of each first turn.

Measure. One PR, stage token table, cached share before and after; no judge needed.

#### D2. Output tokens

Output is 146k per review and costs 10 dollars per million at Sol rates: about 1.46 dollars of the 5.43. The reader-facing `message` on every reviewer and verifier turn, the finding bodies and the reasoning are most of it. Cutting `message` to one line on action turns is a small, safe cut; measure with the stage table.

### E. Eval speed

#### E1. Concurrency and hosts

Evidence. The full run was 25 reviews at concurrency 4: 600 review-minutes, 192 minutes of wall time. No capacity or rate-limit error in the server log. Sandbox queue wait was zero. Sandboxed commands ran for 7 minutes in total per 24-minute review, so 8 reviews at once keep about 2.5 of the Mac's 6 run slots busy.

What to do. Run the Mac at `--concurrency 8` and keep the Devin concurrency cap at 12 or above it. Split full runs across the Mac and the PC with `--shard` and merge. Expected full-set wall time: about 100 minutes today, and less after B1 (the A1 share of this estimate rested on the miscount in 3.A1).

#### E2. Candidates-only mode for raise-stage experiments

Evidence. 33 of 41 misses were never raised. A reviewer or obligation experiment is answered by the candidate pool, not by verification. Verification is 59% of tokens and the whole tail of every review.

What to build. An eval-server-only flag that skips verification and consolidation of model-raised candidates: reviewers, obligations and detectors run, the pool is saved, the review ends. The benchmark judges the pool against the labels and reports `found` per defect, as the stage totals do today. `published` is not reported in this mode, and the report records the mode in its identity so it never compares with a full run.

Decision it touches. The 2026-09-25 rule: no read-only default or fast mode without asking. This flag is for an eval server only, defaults off, and never reaches the product. It needs the user's yes.

Expected effect. About half the wall time and 40% of the tokens of a full run for the experiments that move recall.

#### E3. Partial replay by assignment

What to build. Hash each lens assignment's prompt inputs (lens procedure, system contract, the flags that shape the prompt). `--replay` gets `--rerun <lens id,lens id>`: the harness restores the checkpoint, drops the candidates of those assignments, reruns only them, verifies only the new candidates, and consolidates. Other candidates keep their verdicts.

Expected effect. A one-lens prompt change costs one eighth of the reviewer calls and only the new candidates' verifications. A1 shortens only the few verifications it reaches (3.A1).

#### E4. Runs and statistics

Use the gained-and-lost table from the A/B as the standard output of `eval:compare` for two arms with repeats, with a bootstrap interval over PRs. Rules from the noise in 2.6: one run per arm cannot see a change under 6 published defects on the quick set; 2 runs per arm show a 10-point change; keep 3 runs when the expected change is under 10 defect-runs. A change that is real on the quick set still needs one full run before it becomes a milestone number.

#### E5. Review time is eval time

Every minute cut from a review (A1, B1) is cut from every eval. The full set is 600 review-minutes today. The earlier estimate of about 350 after A1 and B1 counted A1 at its miscounted reach (3.A1); B1 is now the main term.

### F. Recall

The A/B already measured these on the quick set (recall 76.9% to 86.2%, +20 defect-runs gained, 2 lost, second-model input +55%). A2 and A3 pay for most of that token increase; A1 is small (3.A1).

- F1. Obligations on by default. Sole source of 5 labels in the A/B. Cost: investigators were 15% of input on the on arm. Keep the cap at 8.
- F2. Contract checks on by default. Recovered ky-5/d7; covers the 4 doc-versus-code lows of 2.4.
- F3. Boundary obligations in pure-addition hunks (on the branch).
- F4. Test strength on. Gained ky-4/d7 and sivir-5/d8; the mutation matrix needs the test-targeting fix first.
- F5. Residual second looks: 0 planted in 3 runs, 1.2M input per run. Drop them.
- F6. A hypothesis to test, not a recommendation: retries found 24 planted members from 40 candidates, so a second sample of a lens finds defects the first did not. Run the correctness and api-contract lenses twice on the quick set and compare planted per token with obligations. Measure in candidates-only mode (E2).
- F7. The 3 omissions in untouched files need repository history (co-change). The synth forge repos have one squashed commit, so this cannot be measured on synth-v2. Measure on the Martian set or on real repositories.

## 4. The levers by goal

| Goal | Levers in order |
| --- | --- |
| Faster evals | A1, E1, E2, E3, B1, E4 |
| Faster reviews | A1, B1, A2, A3, B2 |
| Fewer tokens, same quality | A1, A2, A3, A4, D1 (conditional), B3 (decision), D2 |
| Recall and precision | F1 to F4, A3, C1, C2, C3, A2, C4 |

## 5. Suggested order

1. A1 replay-first verification. Built on `feat/replay-first-verify`; its reach is about 10% of verifications (corrected count in section 3.A1), so its gain is small.
2. A2 and A3 in the same reverify loop.
3. C1 and C2 with `--replay`. C3 with `--reverify`.
4. E1 now (no code). E3 and E2 next, since every later step uses them. E2 needs the user's yes.
5. B1 and B2, measured on the quick set.
6. F1 to F4 on by default, F5 off, measured with 3 full repeats against the 165/206 baseline. Watch second-model tokens; A1 to A3 should leave them below today's.
7. D1 after the cache check in section 6 says it can work.
8. B3 if the user wants the Sol cut.

## 6. What was not verified

- Cross-session prompt-cache behavior was checked in the OpenCode source and OpenAI's guide (D1), not measured. The Devin CLI's behavior across sessions is unknown. D1 and A4 stay conditional until a one-PR test shows the cached share going up.
- The reasons for the 20 lens failures (B2). The texts are in the checkpoints and were not read for this document.
- The audit call's error rate (A1). It can only be measured by building it.
- All effects marked estimate. The measured numbers are the ones with a source table above.
