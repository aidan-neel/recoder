# Final frozen benchmark

Identical reviews are judged once against primary labels. Continuity is a deterministic subset projection of those fixed matches, not a second stochastic judging run. Confirmed omission hits are additional true findings under continuity, never false. No derived view is ingested again.

Cells: mean [min, max], with two samples for A/F and one for Neon. Cached input is within input; known token subtotals exclude judging and exclude unknown-usage calls in full. Unresolved findings are not automatically false. These are descriptive results, not confidence intervals.

## Primary (150 labels)

| Metric | A | F |
|---|---:|---:|
| Candidate /150 | 120.5 [119, 122] | 127 [124, 130] |
| Verified /150 | 99.5 [99, 100] | 110 [108, 112] |
| Published /150 | 113 [113, 113] | 125.5 [123, 128] |
| Adjudicated false | 0 [0, 0] | 0 [0, 0] |
| Unresolved | 204.5 [204, 205] | 208.5 [208, 209] |
| Duplicate | 11.5 [11, 12] | 19 [13, 25] |
| Control false findings | 0 [0, 0] | 0 [0, 0] |
| Control unresolved findings | 32 [31, 33] | 33 [31, 35] |
| Findings/control | 3.56 [3.44, 3.67] | 3.67 [3.44, 3.89] |
| Controls with false findings /9 | 0 [0, 0] | 0 [0, 0] |
| p50 seconds | 398.13 [379.22, 417.03] | 219.86 [208.64, 231.09] |
| p95 seconds | 726.45 [653.6, 799.3] | 513.26 [512.71, 513.81] |
| Benchmark wall minutes | 231.71 [230.84, 232.58] | 144.8 [135.59, 154.01] |
| Known input subtotal | 120,453,109 [110,591,662, 130,314,556] | 25,594,162 [25,348,081, 25,840,243] |
| Known cached subtotal | 90,522,880 [80,092,288, 100,953,472] | 8,909,696 [8,616,704, 9,202,688] |
| Known output subtotal | 1,889,498 [1,822,336, 1,956,660] | 1,150,251 [1,110,026, 1,190,476] |
| Excluded unknown calls | 8 [1, 15] | 0 [0, 0] |
| Verifier operations | 2,069.5 [1,954, 2,185] | 1,639.5 [1,606, 1,673] |
| Verifier sessions | 212.5 [211, 214] | 217.5 [210, 225] |
| Failed model calls | 3 [1, 5] | 0 [0, 0] |
| Exhausted verifier sessions | 0 [0, 0] | 0 [0, 0] |
| MCP gate refusals | 1,175.5 [1,080, 1,271] | 2 [1, 3] |
| Refusals/session | 5.54 [5.05, 6.02] | 0.01 [0, 0.01] |
| Observed verifier built-in denials | 2,022 [1,975, 2,069] | 0 [0, 0] |
| Scored not found /150 | 29.5 [28, 31] | 23 [20, 26] |
| Found but unverified /150 | 21 [20, 22] | 17 [16, 18] |
| Verified but unpublished /150 | 0 [0, 0] | 0 [0, 0] |
| Published without runtime verification /150 | 13.5 [13, 14] | 15.5 [15, 16] |
| overall precision lower % | 34.35 [34.24, 34.45] | 35.56 [35.36, 35.76] |
| overall precision upper % | 96.5 [96.36, 96.65] | 94.66 [93.09, 96.22] |
| controls precision lower % | 0 [0, 0] | 0 [0, 0] |
| controls precision upper % | 100 [100, 100] | 100 [100, 100] |
| repository:repo-disjoint found /60 | 53.5 [52, 55] | 54 [52, 56] |
| repository:repo-disjoint verified /60 | 50.5 [50, 51] | 53.5 [52, 55] |
| repository:repo-disjoint published /60 | 50.5 [50, 51] | 53.5 [52, 55] |
| evaluation:held-out found /62 | 49.5 [49, 50] | 52 [49, 55] |
| evaluation:held-out verified /62 | 47 [46, 48] | 51.5 [49, 54] |
| evaluation:held-out published /62 | 47 [46, 48] | 51.5 [49, 54] |
| generator:Flash-injected found /30 | 29 [29, 29] | 29 [29, 29] |
| generator:Flash-injected verified /30 | 23.5 [23, 24] | 25 [25, 25] |
| generator:Flash-injected published /30 | 27 [26, 28] | 29 [29, 29] |
| generator:SWE-2-High found /120 | 91.5 [90, 93] | 98 [95, 101] |
| generator:SWE-2-High verified /120 | 76 [75, 77] | 85 [83, 87] |
| generator:SWE-2-High published /120 | 86 [85, 87] | 96.5 [94, 99] |
| evaluation:new found /61 | 45.5 [45, 46] | 49.5 [49, 50] |
| evaluation:new verified /61 | 32.5 [32, 33] | 37 [36, 38] |
| evaluation:new published /61 | 42.5 [42, 43] | 48.5 [48, 49] |
| repository:tuned-repo found /90 | 67 [67, 67] | 73 [72, 74] |
| repository:tuned-repo verified /90 | 49 [49, 49] | 56.5 [56, 57] |
| repository:tuned-repo published /90 | 62.5 [62, 63] | 72 [71, 73] |
| evaluation:dev-v0 found /27 | 25.5 [25, 26] | 25.5 [25, 26] |
| evaluation:dev-v0 verified /27 | 20 [19, 21] | 21.5 [21, 22] |
| evaluation:dev-v0 published /27 | 23.5 [23, 24] | 25.5 [25, 26] |

## Continuity (146 labels)

Published 112 (A) vs 123.5 (F) of 146; every other metric matches the primary view. The full continuity table is in the run archive (`final-comparison-af/comparison.md`).
