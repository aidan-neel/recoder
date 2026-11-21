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
VERIFIER_AB_START_PAUSED=1 python3 apps/server/tests/eval/experiments/iteration6_benchmark.py
python3 apps/server/tests/eval/experiments/iteration6_summary.py /home/ubuntu/eval-work/metrics/<completed-artifacts>
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

Iteration 6 reuses the same immutable snapshot and report implementation, with
F1/G1/F2/G2. F explicitly sets `RECODER_PRECISION_FIXES=0`; G sets it to `1`.
The driver's restored server uses the current default with experiment flags
cleared. F retains the promoted MCP-only routing and verifier-session fixes.
