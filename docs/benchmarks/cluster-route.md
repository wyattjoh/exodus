# Hierarchical Cluster route benchmark

Run the CPU reference benchmark with:

```sh
bun run benchmark:cluster-route
```

The script uses seed `cluster-route-benchmark-6`, generator version `globular-v1`, a 64-System
materialization request, and route refinement depths 0, 3, and 6. It reports JSON for 100,000,
1,000,000, and 10,000,000 logical Systems. The report includes hierarchy node count and latency,
process RSS deltas, finite materialization latency, route latency, materialized route-system count,
arrival bounds, candidate count, and refinement score.

## Sample evidence

This worktree's local run produced the following rounded values. Latency and RSS are observations
from one developer machine, not acceptance thresholds:

| Logical Systems | Hierarchy nodes | Hierarchy ms | Hierarchy RSS Δ (bytes) | Materialization ms | Materialization RSS Δ (bytes) | Depth-0 route ms | Route Systems |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100,000 | 41 | 0.83 | 3,522,560 | 32.27 | 29,327,360 | 454.95 | 18 |
| 1,000,000 | 329 | 0.68 | 32,768 | 17.54 | 114,688 | 656.57 | 21 |
| 10,000,000 | 3,145 | 4.61 | 49,152 | 17.79 | 458,752 | 980.06 | 24 |

All three populations remained at zero materialized Systems while creating the hierarchy, and
all route calls materialized at most the configured 256-System route budget. For 100,000 and
1,000,000 Systems this seed added no shortcut candidate, so depths 0/3/6 preserved the same upper
bound and bound-tightness score. At 10,000,000 Systems, depth 3 reduced the nominal upper bound
from about `12.40e9 s` to `0.72e9 s` and increased the score from about `0.0265` to `0.4583`; depth
6 preserved that result. This is evidence that refinement can tighten or preserve a bound, not a
promise that every seed has a useful shortcut. Re-run the command after generator or route changes
to obtain current target-machine regression evidence.

RSS deltas are deliberately labelled process-level observations because allocator reuse and garbage
collection make them unsuitable as universal memory limits. The benchmark is a measurement aid;
functional limits are enforced by the exported materialization and route budgets and by the test
suite.
