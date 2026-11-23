# Frozen local evaluation experiments

No application behavior changes. These Python tools use the provisioned local
`/home/ubuntu/eval-work` environment and its ledger/CLI-export helpers. The generic
driver was moved here from `eval-work/scripts/verifier_ab.py`; that path remains
a compatibility shim, not a second implementation.

```sh
source /home/ubuntu/eval-work/scripts/env.sh
python3 -m unittest discover -s apps/server/tests/eval/experiments -v
# One-time construction; refuses to overwrite a frozen dataset or control forge:
python3 apps/server/tests/eval/experiments/iteration5_freeze.py
VERIFIER_AB_START_PAUSED=1 python3 apps/server/tests/eval/experiments/iteration5_benchmark.py
python3 apps/server/tests/eval/experiments/iteration5_summary.py /home/ubuntu/eval-work/metrics/<completed-artifacts>
VERIFIER_AB_START_PAUSED=1 python3 apps/server/tests/eval/experiments/iteration6_benchmark.py /home/ubuntu/eval-work/metrics/<original-f1-g1-f2>
python3 apps/server/tests/eval/experiments/iteration6_summary.py /home/ubuntu/eval-work/metrics/<original-f1-g1-f2> /home/ubuntu/eval-work/metrics/<completed-detector-continuation>
python3 apps/server/tests/eval/experiments/iteration6_latency.py /home/ubuntu/eval-work/metrics/<original-f1-g1-f2> /home/ubuntu/eval-work/metrics/<detector-continuation>
```

The freeze includes all verified, published SWE-2 cases outside dev-v0 at its
selection time, not only cases already marked repository-held-out. Report those
strata separately. Four upstream controls have manual patch audits and passing
parent/head checks. Exact base/head/tree/patch hashes and provenance are in the
dataset manifest; `SHA256SUMS.json` covers all frozen files. Each arm receives its
own copy so the benchmark can queue unresolved adjudications without changing
the frozen labels. Do not edit those labels after seeing results.

A uses both opt-outs; F leaves both variables unset. A1/F1/A2/F2 use Flash Medium
review picks, SWE-2 Medium judging, no baseline cache, concurrency one. Generation
is paused and drained, exports retained, every completed report ingested, settings
restored and generation released in cleanup. Never run this against production.

Precision bounds include all published findings, with duplicates penalized and
unresolved findings explicitly unknown. An empty control label is not an automatic
false-positive verdict. Keep any post-run source/contract adjudications in an
overlay under the experiment artifacts, separate from immutable ground truth.
The summary reports raw and post-audit precision separately; overlays require
source/contract evidence and cannot overwrite planted or duplicate matches.
Rerunning it regenerates the Results section; keep narrative audit evidence in
a separate artifact before appending it to the final report.

Iteration 6 reuses the same immutable snapshot. Semantic publication deduplication
was rejected after G1 lost distinct verified claims. F2 finishes under the original
controller, then that controller is stopped before old G2 without releasing the
generation pause. The continuation validates that boundary and runs G′1/F3/G′2.
The summary combines retained reports and exports, never re-ingests old runs, and
reports F1–F3 (n=3), G′1/G′2 (n=2), and rejected G1 (n=1) separately. Different
source commits are recorded per sample. The existing F proof safeguards remain.
The remaining consolidation regression uses the actual contradictory/misindexed
G1 vote shapes as a fake model reply and asserts publication never consults it;
all four independently verified keyed-task claims retain their own proofs.
F explicitly sets `RECODER_PRECISION_FIXES=0`; detector-only G′ sets it to `1`.
The driver's restored server uses the current default with experiment flags
cleared. F retains the promoted MCP-only routing and verifier-session fixes.
Generation remains paused after this continuation for control auditing, reporting
and the promotion decision. Release its owned pause marker explicitly afterward.
The latency analyzer only reads the four completed F1/G1/F2/G′1 reports, stored
progress and model-call records. It never launches a review. Its per-PR CSV and
stage-union tables distinguish overlapping verification time from additive wall
time and keep observed provider backoff separate from internal CLI unknowns.

## Final frozen corpus

`final_omissions.py` reproduces the four accepted publication omissions;
`final_freeze.py` creates final-v1 once, with primary150 and byte-identical original
continuity146 labels. Never rerun freeze over an existing frozen set or edit it.
`final_benchmark.py` runs A1/F1/A2/F2; its `neon` mode runs the subsequent single
Neon Medium F sample. These invoke models: do not restart an existing driver.
After both drivers finish, the following is model-free:

```sh
python3 apps/server/tests/eval/experiments/final_controls.py <af-artifacts> <neon-artifacts> --output <comparison>
python3 apps/server/tests/eval/experiments/final_summary.py <af-artifacts> <neon-artifacts> --output <comparison>
python3 apps/server/tests/eval/experiments/dataset_package.py --dataset /home/ubuntu/eval-work/datasets/final-v1 --output <new-archive.tar.gz>
```

See DATASET-PACKAGE.md for offline restoration, label-view relocation and privacy.
The final report generator consumes those receipts without starting any reviews.
