# WebGPU scale and compatibility benchmark

The Cluster scale target is a bounded, compute-generated point cloud. JavaScript submits a logical
population, an integer LOD range, and a six-plane frustum; it never allocates one JavaScript object
per star. The GPU compacts visible points into a 32-byte storage record and renders that record
with an indirect point draw. The hard output cap is 1,000,000 points per frame.

## Deterministic checks

Run the pure CPU/WGSL contract and resource checks with:

```sh
bun run benchmark:webgpu-scale:reference
```

The browser driver is intentionally separate:

```sh
bun run benchmark:webgpu-scale
```

It builds the production app, starts an ephemeral localhost server, launches installed Chrome with
an isolated temporary profile, drives `/webgpu-scale-benchmark.html` through CDP, validates the
numeric/exact-text fixture readback and one-million-point count, and cleans up the browser/server.
`--require-webgpu` turns unavailable or failing browser hardware into a nonzero exit. Use
`--write-result PATH` for the terminal JSON and `--write-baseline PATH` for a measured baseline
that can be compared only with compatible browser, adapter, host model/chip/memory/OS, contract,
scene, and timing-source records. A missing browser or browser without an adapter is reported as
unavailable, not as a made-up timing sample. Browser discovery is platform-aware: `WEBGPU_BROWSER`
/`WEBGPU_CHROME`, `WEBGPU_EDGE`, `WEBGPU_FIREFOX`, and `WEBGPU_SAFARI` (with the corresponding
`*_PATH` aliases) are explicit overrides; otherwise the driver checks platform application roots
and PATH. An inaccessible override is reported missing rather than silently selecting another
installation. Safari is discovered only where the target platform provides it, while an installed
Edge or Firefox without an aggregate driver remains `automation-unavailable`. The page uses
`timestamp-query` only after a real resolved sample and validates `GPUDevice.limits.timestampPeriod`
as nanoseconds per timestamp tick; any timestamp resolve, copy, or map failure downgrades to
`request-animation-frame` without turning a valid render into an error.

The checked-in `docs/benchmarks/webgpu-scale-baseline.json` contains acceptance thresholds, not a
claim about universal hardware. Target-machine evidence is kept separately in
`docs/benchmarks/webgpu-scale-m4-max-baseline.json`; it records detected model, chip, memory, OS,
WebGPU/API adapter identity, fixed 30/60 warm-up/sample counts, result pass/fail, and calculated
GPU allocation semantics. A threshold failure remains a failure and must not be rewritten as a
passing baseline. The browser page reports only the canonical threshold comparison; the trusted
benchmark driver recomputes any loaded measured-baseline comparison, so a real regression remains a
measured failure rather than an automation-unavailable result and page-provided baseline JSON is
never authoritative.

For a full stable-browser matrix, run:

```sh
bun run benchmark:webgpu-scale:conformance -- --write-result .scratch/webgpu-scale-conformance.json
```

The aggregate command reuses the production build and records the stable-target Chrome, Edge,
Firefox, and Safari outcomes. Its aggregate `releaseChannel` is derived from the browser rows:
`stable` requires at least one executed pass/fail row and no `unknown` row claim, `mixed` records
stable and unknown claims together, and `unknown` is reported when no browser actually executes or
all claims are unknown. Missing and installed-but-unautomatable rows do not manufacture stable
evidence. The checked-in target-machine Chrome result is
`docs/benchmarks/webgpu-scale-chrome-m4-max-2026-09-13.json`, and the matrix report is
`docs/benchmarks/webgpu-scale-conformance-m4-max-2026-09-13.json`. The report distinguishes a measured pass/fail from
`browser-webgpu-unavailable`, `browser-missing`, and `automation-unavailable` (for example,
Safari's remote-automation permission). Browser-version and host-identity subprocesses use one bounded
runner with finite exit/read deadlines, graceful-then-force kill cleanup, and per-stream output caps.
Each browser row includes the exact procedure, release version, OS, adapter identity when available,
capability/fixture/performance result, and reason.

## Browser conformance matrix

The aggregate command runs the browser benchmark page and injected capability/rendering tests for
every browser below against the current stable desktop release. The test page uses a secure origin
(`https://` or trusted `localhost`), requests a high-performance adapter, creates the bounded scale
renderer, reads back the checked-in numeric and exact-text seed fixtures, and records the JSON
result. An unavailable or insufficient adapter is a valid **compatibility result**, not a passing
performance measurement. Automation permission failures are recorded separately from capability
failures. Browser installation is checked first: an absent Edge/Firefox/Chrome/Safari is
`browser-missing`, while an installed browser without a supported automation adapter is
`automation-unavailable`. Host `machine.hostGraphicsApi` (for example, Metal 4) is separate from
the WebGPU adapter architecture (for example, `metal-3`).

| Desktop browser | Standards-conforming path | Required evidence |
| --- | --- | --- |
| Chrome (stable) | WebGPU adapter + `bgra8unorm`/`rgba8unorm` canvas | Capability diagnostics, fixture positions/keys, one-million-point benchmark when limits pass |
| Edge (stable) | WebGPU adapter + `bgra8unorm`/`rgba8unorm` canvas | Same evidence as Chrome; record the Edge version separately |
| Firefox (stable) | WebGPU adapter where the stable build exposes it | Same fixture/diagnostic run; record `unavailable` when the stable build or platform does not expose WebGPU |
| Safari (stable desktop) | WebGPU adapter + canvas on a supported macOS release | Same fixture/diagnostic run; record OS and adapter because support is platform-sensitive |

The compatibility check must inspect secure context, adapter and device features, every required
numeric limit, canvas format, shader assumptions, and the one-million-point resource budget before
showing the 3D experience. Preparation crosses the renderer boundary only with a module-private
identity brand; a spoofed or Proxy-wrapped preparation is rejected before any adversarial property
trap is inspected. Scale CPU overlays are separately snapshotted and bounded at 4,096 points and
4,096 connection segments (with a 256 KiB GPU-buffer budget, including alignment padding) before
typed-array conversion or GPU upload. Replacement uploads also account for the old and new GPU
buffers plus conversion staging before allocating; compatible capacities are reused and transient
over-cap growth is rejected without changing the prior overlay. Failure output includes the required and observed value for each failed fact. There is
no WebGL, 2D, or reduced-feature fallback.

## Target scene and regression policy

The repeatable target scene is one million logical/visible points, a `64`-invocation compute
workgroup, a 32-byte generated-point stride, a 16-byte indirect draw command, and a 256-byte
uniform block. The acceptance gates are at least 900,000 visible points, sustained average cadence
of at least 59.5 FPS (the approximately-60-FPS target), generation latency no greater than 1,000
ms, and no more than 64 MiB of estimated resources. The nominal 60-FPS target and 16.67 ms ideal
vsync reference remain in the evidence. RequestAnimationFrame p95 and p95 FPS are reported
separately as display-scheduling jitter: they are not renderer-throughput gates because a 60-Hz
browser can report fractional-vsync intervals above 16.67 ms without missing a frame. In rAF
mode this is a presentation-cadence claim, not a claim about an isolated GPU execution time;
timestamp-query mode is used when a real resolved GPU sample is available. Compatible measured
baselines still compare p50/p95/p99/maximum/average frame times and sustained average FPS
strictly within documented measurement tolerances (1 ms for frame fields, 0.5 FPS for cadence,
and 10 ms for generation to cover one-off browser/GPU queue setup noise); p95 FPS is derived from the separately reported p95 jitter. Meaningful
regressions remain failures without treating single-sample scheduling noise as a regression. These values are checked by the pure benchmark
module and are not substituted for a target-machine measurement.

The pure result classifier accepts a bounded visible-count floor of 900,000 for reusable fixture
construction, but the real benchmark terminal parser requires exactly 30 warm-up frames, exactly
60 measured frames, an enum timing source (`gpu-timestamp` or `request-animation-frame`), one
million visible points, and the fixed target resource shape. This prevents a partial or
reduced-feature run from becoming target evidence.

Keep measured browser records outside the acceptance baseline unless they were produced on the
same documented target machine and have compatible metadata. The measured baseline's resource
semantics are explicit: point bytes equal `visibleCapacity × pointStrideBytes`, total bytes equal
the sum of point/indirect/uniform/seed buffers, and the scope is GPU buffer allocations only;
RSS is process-level evidence and is reported separately. Allocator reuse and browser GPU
processes make RSS unsuitable as a universal memory limit. A device-loss result must include its
browser reason/message and confirm that renderer buffers, timestamp queries, and the device were
released before retrying.
