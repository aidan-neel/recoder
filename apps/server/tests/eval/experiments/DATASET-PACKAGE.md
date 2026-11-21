# Portable Recoder evaluation corpus

This is a point-in-time export, not a claim that generation or the final 30-PR
evaluation has completed. `manifest.json` identifies every included published PR,
original base/head commit, public upstream URL, per-case generator allocation and
structured independent Neon defect audit. Historical Flash High injections remain
identified as Flash; they were not regenerated or silently relabeled High.
Upstream clean controls have human/source-audit provenance, not invented Neon audits.

## Format and privacy

- `bundles/*.bundle`: self-contained Git objects for selected published head/base
  refs and their reachable public upstream history. No working directories,
  `.git/config`, hooks, reflogs, private/unpublished branches or CLI auth copied.
- `patches/*.patch`: binary-capable base-to-head diffs.
- `labels/*.json`: byte-identical snapshot labels; their original local repo URIs
  are provenance, not portable paths. Defects are deliberately included as oracles.
- `frozen/heldout-v1/labels`: original frozen 15-PR label bytes, when available.
  `frozenSourceHash` identifies the original frozen hash inventory, not this archive.
- `SHA256SUMS.json`: SHA-256 of every payload file except itself. The `.tar.gz.json`
  sidecar records the complete archive SHA-256, size and snapshot counts.
- Only allowlisted metadata, labels, Git objects and structured audit conclusions
  are exported. No raw model exports, transcripts, server databases, tokens,
  settings, prompts, private regression logs or credentials are included. Source
  and public upstream history remain untrusted code; do not execute blindly.

## Restore (model-free)

Extract your trusted archive into a fresh directory, then:

```sh
python3 recoder-dataset/restore.py --output /absolute/path/to/portable-corpus
```

The script checks payload hashes and paths, clones local bundles without network,
recreates per-PR Forge metadata and original commit IDs, and writes runtime labels
with only the `repo` URI relocated. Original frozen labels remain untouched in the
archive. Output must not exist. Keep the original archive and sidecar for integrity.
This does **not** install project dependencies, configure credentials or call models.

## Benchmark later, not during generation

Use a configured Recoder checkout/server with Flash Medium review picks and SWE-2
Medium judging; the archive supplies neither credentials nor a model subscription.
Register each `repos/*` directory with the local Forge provider first: authenticated
`POST /api/repos` with `{"name":"<id>","url":"file:///absolute/path/to/portable-corpus/repos/<id>","provider":"local","defaultBranch":"<manifest.repositories[id].defaultBranch>"}`.
Check `bun run --filter @recoder/server eval:benchmark --help` for your checkout.
From the tuning branch the corresponding invocation is:

```sh
bun run --filter @recoder/server eval:benchmark -- \
  --dataset /absolute/path/to/portable-corpus --set all-published \
  --runs 1 --concurrency 1 --base http://127.0.0.1:3201 --judge devin:swe-2-medium
```

Available sets include `all-published`, `controls`, original development/heldout
membership, fixed `dev-v0`, and fixed `heldout-v1` when present. Do not confuse the
expanding repository-disjoint `heldout` with the 15-PR frozen `heldout-v1`.
Keep controls/strata separate and do not treat unresolved findings as false.

F defaults: MCP-only verifier routing and session fixes on; operation cap,
compact payloads, unused-export ablation, detector precision, dependency grounding
and discovery transitions off. Pin the Recoder commit and export snapshot hash in
results. The full-30 and Neon confirmation benchmarks are intentionally pending.
