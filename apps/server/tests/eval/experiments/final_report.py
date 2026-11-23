"""Fill the historical report's final sections from saved, dual-view benchmark receipts."""
import argparse
import json
from pathlib import Path
import statistics


ROOT = Path('/home/ubuntu/eval-work')


def build(history, comparison, archive, restoration, destination):
    result = json.loads((comparison/'comparison.json').read_text())
    package = json.loads(archive.with_suffix(archive.suffix+'.json').read_text())
    restored = json.loads(restoration.read_text())
    samples = result['samples']['primary']
    def mean(arm, key):
        return statistics.mean(key(s) for s in samples if s['arm'] == arm)
    def published(arm): return mean(arm, lambda s: s['recall']['published'])
    neon = next(s for s in samples if s['arm'] == 'Neon')
    neon_report = next(json.loads(Path(p).read_text()) for p in result['sources']
                       if json.loads(Path(p).read_text())['reviewer']['model'] == 'gemini-4-neon-medium')
    neon_review_minutes = sum(r['durationMs'] for p in neon_report['prs'] for r in p['runs'])/60000
    prefix = history.read_text().split('## Packaging and current generation ETA')[0].split('## Final corpus')[0]
    start = prefix.index('Status:'); end = prefix.index('## Executive summary')
    prefix = prefix[:start]+'''Status: **final, 2026-11-22**. Generation completed; all 170 final reviews
passed and were ingested exactly once. F remains the default. Both label views,
Neon confirmation, final packaging and offline restoration are complete.

'''+prefix[end:]
    prefix = prefix.replace('— draft final report', '— final report')
    prefix = prefix.replace('The branch has now merged upstream main; the final benchmark must record the new\nsource identity rather than implying the historical F executable is unchanged.',
        'The final benchmark used application commit 60037a84b90383614f78352cda74956ee23e2ce6;\napplication F behavior was not changed during final evaluation. Final scripts and\nreport are delivered separately on devin/recoder-eval-tuning.')
    prefix = prefix.replace('currently **21 published /114 audited\n  defects**. Target 30 includes five planned generated clean controls; 29 scheduled',
        '**30 published /146 original audited\n  labels**, including five generated clean controls; 29 scheduled')
    table = (comparison/'comparison.md').read_text().replace('# Final frozen benchmark', '## Final benchmark tables', 1)
    table = table.replace('## Primary', '### Primary').replace('## Continuity', '### Continuity')
    body = f'''## Final corpus

`datasets/final-v1`: **34 PRs**, comprising 30 generated published PRs (25 buggy,
five generated controls) and four upstream controls. Nine controls have no scored
planted defects; that is not a guarantee that every review suggestion is false.
Generated source-only PRs can legitimately attract missing-test/design advice.
Membership: **dev-v0 6 / prior-held-out 15 / new 13**. Historical injection
provenance: **Flash High 7 / SWE-2 High 23 / upstream controls 4**. The High group
includes five High-implemented controls without injection. New PRs in a tuned
repository are not repository-disjoint generalization evidence.

Final inventory SHA-256: `{result['frozenHash']}`.
Strict label/ref/audit/changed-line validation passed **primary 150** and
**continuity 146**. Historical frozen sets were untouched. The apparent 146-count
validation receipt was the continuity validation, not a failed 150-label freeze.
All 34 primary/continuity case heads and memberships are identical.

### Four independently reproduced audit omissions

| Case / defect | Reachable failure at the published head |
|---|---|
| p-queue-3/d2 | Reprioritizing a paused grouped task changes group size 1→0 |
| python-slugify-3/d2 | Legacy silently accepts modern-only options instead of ValueError |
| p-limit-4/d3 | Cancelling the keyed pending task leaves pendingCount at 1 instead of 0 |
| p-queue-4/d7 | clear() retains the dedupe key; replacement rejects with AbortError |

Every changed builder file matched its published head before each bounded
30-second reproduction. Root primary labels add these four only, marked
`audit-omission-confirmed`, anchored to reachable changed behavior. Continuity is
the original **146 labels byte-for-byte**, not rewritten to improve scores.
All four omissions confirmed; none remain unconfirmed. Exact programs, outputs,
source parity, original proposals and changed-line anchors are in
`provenance/omissions.json` inside the freeze/archive.

**Disclosed generator-gate gap:** p-queue-3 and python-slugify-5 audits say
`overall: reject` while accepting every proposal and listing no additional defects
or spec issues. The buggy-case gate checked per-defect acceptance/counts but not
that contradictory summary. Original audits and this disclosure are preserved in
the dataset README. The standard validator alone did not catch omitted proposals;
the independent audit-to-label cross-check did.

The original coordinator drained naturally at 29 because p-limit-6's specification
included readme.md, rejected by the source-only file gate. After it exited, a
source-only Neon correction and serial High implementation/audit recovered that
control. The invalid checkpoint was preserved; the coordinator was not interrupted.
The earlier ~116-minute ETA was an estimate, not a completed-generation claim.

## Final protocol and interpretation

Exact A/F order **A1/F1/A2/F2**, two samples each, concurrency **1**. The existing
driver was not restarted. Then **Neon1**, one F sample with all four review picks
`devin:gemini-4-neon-medium` (**Medium reasoning**); judge stayed
`devin:swe-2-medium`. Medium balances frontier capacity and practical confirmation
cost; it is not a maximum-reasoning claim. Flash A/F used
`devin:swe-2-flash-medium`. All optional G′/H/I flags were explicitly off.

All **170 unique reviews** are ledger-ingested exactly once; all samples passed,
each ingestion exited 0. No second review/judge run was used to score continuity.
Fixed primary matches are projected to the subset; omitted real-bug hits become
additional true findings under continuity, not false positives. This projection is
not an independently sampled continuity judge. Both tables include all requested
repository, evaluation-membership and historical-generator strata.

**Neon infrastructure interruption:** the original driver exited after disk
exhaustion (`ENOSPC`) during chi-2 judging/report persistence. The JSON write was
truncated, but both completed chi-1/chi-2 records were intact. Their original
review IDs were retained; chi-1's judgement was retained, and only chi-2's failed
judge was repeated from its saved findings/candidate pool. Native `--resume`
continued with chi-3 after freeing rebuildable per-review Go compiler caches.
No reviewer was replayed, no benchmark arm was restarted, and identity checking
accepted the continuation without an override. Original truncated bytes, recovery
receipt and cache-only deletion inventory are retained with the private metrics.
The Neon wall row includes the recovery interruption, so it is **not** an
uninterrupted model-throughput comparison. Its review-duration sum is
**{neon_review_minutes:.2f} minutes**, excluding that between-review interruption;
per-review quantiles and model usage still have possible infrastructure noise.

Control auditing is occurrence-level and conservative: the Go TestRequestSize
unused warning is a framework false alarm, and both NAME warnings predate the
annotation-only Tenacity control. F2 also asserts an early ContentLength rejection
that the actual RequestSize implementation does not perform. Other conditional
coverage/contract/design/duplication advice remains unresolved, never silently
false. `control-audit.json` retains every control review, including empty ones;
`adjudication-overlay.json` records each decision without changing raw findings.

Verified and published are **not a strictly nested runtime-proof funnel**. The
existing scorer permits published trace-backed claims whose saved exact candidates
are not runtime-verified; the explicit row reports these, without inventing proof.
F improves published recall {published('A'):g}→{published('F'):g}/150, but its
control-false mean {mean('F',lambda s:s['controls']['classes'].get('false',0)):g}
versus A's {mean('A',lambda s:s['controls']['classes'].get('false',0)):g} does not
demonstrate a precision improvement. Unresolved findings dominate the uncertainty.

'''
    assessment = f'''## Neon frontier-reviewer assessment

Neon published **{published('Neon'):g}/150**, versus Flash F's two-sample mean
**{published('F'):g}/150**. See continuity below the primary table for the unchanged
146-label comparison. Neon p50/p95: **{neon['latency_ms']['0.5']/1000:.2f}s /
{neon['latency_ms']['0.95']/1000:.2f}s**; wall **{neon['wall_seconds']/60:.2f}min**.
Known input/output: **{neon['tokens']['input']:,} / {neon['tokens']['output']:,}**;
cached within input **{neon['tokens']['cached']:,}**; unknown calls excluded
**{neon['unknown_calls']}**. Failed model calls **{neon['failed_calls']}**;
exhausted verifier sessions **{neon['verifier']['exhausted']}**. Control false /
unresolved: **{neon['controls']['classes'].get('false',0)} /
{neon['controls']['classes'].get('unresolved',0)}**.
Raw verifier export coverage: **{neon['raw_verifier_sessions']} observed exports /
{neon['verifier']['sessions']} recorded sessions**;
**{neon['unreadable_exports']} unreadable exports**. Unobserved internal behavior
is unknown, not zero; aggregate session and export counts need not be one-to-one.

This single frontier sample cannot establish superiority or noninferiority.
The disk interruption further limits any speed comparison: the recorded wall
time is recovery-contaminated, not evidence of Neon model slowness by itself.
The same judge is a controlled component, not infallible truth; Neon also provided
the generator's independent audits, so model-family independence is limited.
Stage misses, unverified claims, trace-only publication and unresolved control
advice remain failure modes even when the full run succeeds. Known subtotals
exclude judging and unknown usage, so they do not establish billing savings.
Flash F remains the practical default, with neither frontier confirmation nor the
rejected optional settings silently promoted. Default Flash Medium picks are
restored after the confirmation. Saved review metrics quantify the speed/usage
trade-off rather than attributing every latency difference to model reasoning.

## Final portable archive and offline restore

Archive: `{archive}`

**{package['bytes']:,} bytes ({package['bytes']/1024**2:.2f} MiB)**; SHA-256
`{package['sha256']}`. Includes all 34 published heads/base commits, binary patches,
self-contained bundles, primary/continuity labels, per-case provenance and models,
all original structured Neon audits, omission reproductions, clean controls,
frozen manifests/sets/hash inventories, README and standalone restoration script.
No private raw exports, server/auth/settings, secrets or private logs are included.
Original freeze is byte-preserved under `frozen/final-v1`; runtime repo URIs alone
are relocated. Restoring requires no network, model call or generation rerun.

Offline receipt: **{restored['heads']} heads, {restored['patches']} patches,
{restored['primaryDefects']} primary / {restored['continuityDefects']} continuity
defects, {restored['frozenFiles']} byte-identical final frozen files**.
Run instructions: `apps/server/tests/eval/experiments/DATASET-PACKAGE.md` and the
archive README; use `--set final-v1` and either restored root or
`views/continuity`. Source histories remain untrusted public code.

## Delivery and checks

Branch: `devin/recoder-eval-tuning`. Evaluated application SHA:
`60037a84b90383614f78352cda74956ee23e2ce6`. The final delivery commit is reported in
the completion message and `metrics/final-delivery.json` (a commit cannot contain
its own hash). No PR was created. Final verification/merge receipts are recorded
in that delivery file; the earlier historical merge required no manual conflicts.
No UI source changed in the final phase. Database-dependent HA integration is
not claimed without isolated PostgreSQL URLs.

Saved artifacts: `{comparison}`; original A/F and Neon directories are listed in
its `comparison.json`. Private model exports are deliberately not distributed.
'''
    destination.write_text(prefix+body+table+'\n'+assessment)
    print(f'Final report generated: {destination} ({len(destination.read_text().splitlines())} lines)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--history', type=Path, required=True)
    parser.add_argument('--comparison', type=Path, default=ROOT/'metrics/final-comparison')
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--restoration', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); build(args.history, args.comparison, args.archive, args.restoration, args.output)
