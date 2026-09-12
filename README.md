# Exodus Time Dialation

The headless Journey Model is a Bun and TypeScript module for compiling and inspecting a
validated Centauri Cluster Scenario, simulating Interstellar Cruises between hierarchical,
Keplerian Gate worldlines, simulating powered In-system Transfers between moving Gates, and
planning earliest-arrival Journeys through a finite explicit Gate network. The CPU reference
also generates deterministic, provenance-marked Cluster regions; workers and the browser
application are implemented by later tickets.

## Commands

Install dependencies with:

```sh
bun install
```

Run the deterministic minimal Scenario demonstration:

```sh
bun run demo
```

Format, lint, type-check, and test independently with:

```sh
bun run format
bun run lint
bun run typecheck
bun test
```

The CI-equivalent local gate is:

```sh
bun run check
```

The public interface is exported from `src/index.ts`. `compileScenario` accepts an unknown
value so malformed imported data produces structured `ValidationIssue` values rather than an
unexpected exception. Successful compilation returns a read-only `CompiledScenario`, which can
be passed to `inspectScenario`, `formatScenarioInspection`, and `simulateJourney`. The simulation
accepts paired Gates and returns a read-only Journey Timeline with zero-duration ZPZ transitions,
a cruise at exactly `0.999c`, a convergent intercept against the destination Gate's future
worldline, cumulative Cluster Coordinate Time, Ship Proper Time, and Aging Difference. The
intercept reports position and time residuals; refinement uses a relative position factor of
`1e-13` and a base absolute time bracket tolerance of `1e-7` seconds. At long horizons the
reported time residual is bounded by the greater of that base and the representable IEEE-754
spacing at the duration and absolute arrival epoch; the search horizon is `1e16` seconds. The
3.8-light-year analytic fixture is checked within 0.0001 cluster years and 0.05 ship days of the
documented nominal values.

`simulateInSystemTransfer` (or a `kind: "in-system-transfer"` request through
`simulateJourney`) starts comoving with its departure Gate, solves a moving-target powered
trajectory with constant proper-acceleration thrust during acceleration and braking, inserts a speed-capped
coast when required, and reports phase clocks, peak speed, and terminal position/velocity
residuals. Successful transfers require finite residuals within 1 m of position and 1e-6 m/s of
velocity; the base time tolerance is 1e-7 s and all three tolerances plus the bounded search
horizon are exported from `src/index.ts`. Infeasible profiles and non-convergent solves are
distinct structured failures.

A tagged `kind: "journey"` request with ordered `legs` composes
Interstellar Cruises, powered In-system Transfers, and Gate-comoving Dwells into one
`MultiLegJourneyTimeline`. Each phase records its absolute start and end Scenario epochs plus
cumulative Cluster Coordinate Time, Ship Proper Time, and Aging Difference. Cruise transitions
remain explicit zero-duration phases, powered transfer detail is retained in each leg, and Dwell
proper time is integrated from the Gate worldline. Its cumulative clocks are exposed through
`timeline.clocks`; `multiLegJourneyScenario` and `multiLegJourneyRequest` provide a deterministic
end-to-end public-seam fixture.

`planJourney` (also exported as `planRoute` and available on `createJourneyModel()`) searches a
finite explicit Gate network. Every compiled Gate must belong to exactly one bidirectional Gate
Connection; changing to another Gate in one System inserts a powered In-system Transfer before
the next Cruise. Requests may select Gate Dwells, which are carried into every candidate
simulation, and must provide a finite `latestArrivalCoordinateTime` or `maximumStrategicWait`
horizon. Within that bounded wait horizon, the planner evaluates deterministic strategic-Dwell
candidates and inserts a Dwell only when it improves the route's final nominal arrival. Each
inserted Dwell reports its Gate, duration, clock effects, and arrival-time benefit. The successful
result ranks nominal final Cluster Coordinate Time, returns the complete winning
`MultiLegJourneyTimeline`, selected `gateIds` and `connectionIds`, conservative arrival bounds,
and a capped set of non-winning `alternatives`. `RouteSensitivity` entries identify retained
alternatives whose possible arrival ranges overlap or beat the nominal winner. Route uncertainty
is scoped to the physical properties used by each candidate, and `provenanceFilter` can exclude
route data without assigning generated links a hidden cost penalty. `refinementQuality` is
`exact` when no strategic wait is searched and `bounded-strategic-dwell` when the finite grid and
local refinement are used, making the bounded nature of continuous-wait optimization explicit;
`strategicDwellSearchComplete` remains false for that approximate continuous-wait domain.

The finite search has a `RoutePlanningSearchBudget` (10,000 candidates and 100,000 search states
by default), and strategic-wait evaluation has its own fixed candidate ceiling. If either budget
is exhausted, the planner returns an `incomplete` structured outcome without presenting a partial
plan as globally earliest. `maxAlternatives` only limits retained output and never limits the
search. Disconnected topology and invalid requests are returned as structured failure outcomes.

`generateClusterRegion` (also exported as `generateClusterScenario` and
`generateRoutableClusterRegion`, and available on `createJourneyModel()`) accepts a logical
population, seed, and generator version. It
materializes a finite region—64 Systems by default for a large logical population and at most
4,096 Systems per request (never more than the logical population)—using a truncated Plummer
radial profile, a deterministic nearest-neighbour connectivity backbone, and
rare deterministic long-distance shortcuts. Every generated System, Orbital Anchor, Gate, and
Gate Connection has a stable seed/version-derived identifier and designation. Numeric seeds and
string seeds are type-tagged separately; string seed text, including surrounding whitespace, is
significant. The logical population is retained as a provisional Scenario property; the finite
sample's observed and expected truncated-Plummer concentration statistics and topology accounting
are returned explicitly, so a finite sample is not presented as a proof of an infinite-population
distribution. `topology.localLinkFraction` uses endpoint distance rather than connection labels:
links no farther than one quarter of `regionRadius` are local, while shortcut selection targets
links at least 45% of the region radius apart.

The generator compiles its output through `compileScenario` and immediately calls `planJourney`
for a paired generated Gate endpoint, returning the complete `RoutePlan` and
`MultiLegJourneyTimeline` in `plan`/`journeyTimeline`. An optional canonical base Scenario is
copied without changing canonical identities; missing physical properties receive generated
property-level Provenance. When no Ship Profile is supplied, the route uses the explicit
provisional 1g ZPZ-capable profile `ship:generated-survey`. Changing the seed changes generated
IDs and values while leaving copied canonical entities unchanged.

`generateHierarchicalCluster` creates the same seeded population as a lazy hierarchy of bounded
logical regions. A hierarchy for a ten-million-System population contains only region descriptors
and reports `materializedSystemCount: 0`; `materializeClusterRegion` (or the descriptor's
`materialize` method) realizes one node or an explicit logical-index selection, capped at
`MAX_CLUSTER_MATERIALIZED_SYSTEM_COUNT`. Materialization is immutable and repeatable, so repeated
requests with the same seed, generator version, node, and selection produce the same entities.

`planClusterRoute` plans between exact deterministic hierarchical Gate endpoints without expanding
the logical population. `refinementDepth`, `maxMaterializedSystems`, and `maxCandidateRoutes`
form a finite refinement budget. The result reports `bestKnownUpperBound` (the nominal arrival of
a feasible simulated plan), an admissible `earliestArrivalLowerBound`, conservative uncertainty
bounds, `refinementScore` (the normalized tightness of that reported interval), and
`optimality: "best-known-upper-bound"`; it never reports a hierarchical result as globally
optimal. Deeper requests add candidate edges to the shallower
candidate graph, preserving the best-known upper bound while retaining the normal route planner's
uncertainty, Provenance filtering, exact endpoint, horizon, Dwell, and strategic-wait behavior.
Generated `region-*` endpoint identities are accepted only after the hierarchy has emitted those
exact Gates through materialization; canonical/base Gate IDs route through the compiled base
Scenario, while mixed canonical/generated endpoints are rejected without rewriting either ID.
`maxCandidateRoutes` is an end-to-end cap on inner candidate Route Plans across the bounded query;
`search.candidateRoutesEvaluated` reports the actual count, and `refinement.searchExhausted` marks
when optional refinement could not be completed within that cap.

Run the representative CPU benchmark with:

```sh
bun run benchmark:cluster-route
```

It emits JSON for 100k, 1m, and 10m logical populations, including hierarchy node count and
latency, process RSS deltas for hierarchy construction and 64-System materialization, route
latency at refinement depths 0/3/6, materialized counts, lower/upper arrival bounds, and
refinement scores. RSS and latency are machine-specific evidence rather than universal timing
assertions; use the output to compare regressions on the target machine.

## Provenance, claims, and uncertainty

The public model keeps source metadata at property level. Use `novelProvenance` or
`supplementaryOfficialProvenance` with citations for sourced values, and use
`provisionalProvenance` or `generatedProvenance` for assumptions and deterministic generated
properties. A compiled entity's `canonicalIdentity` is independent from its `properties`, so a
canonical System can retain its identity while its missing coordinates are generated.

Canonical facts remain explicit through `exactClaim`, `rangeClaim`, and `qualitativeClaim`.
`rangeClaim` retains inclusive `lower`, `upper`, and selected `nominal` values; `selectNominal`
changes only the calculation selection and never discards the source range. Compiled properties
expose the selected `value`/`nominal`, optional `claim`, `provenance`, `bounds`, and
`displayPrecision`. Journey phases and totals expose conservative bounds through `bounds` (also
available as `totalBounds`/`clockBounds`) and precision metadata derived from source precision or
uncertainty rather than floating-point representation.

Preserve disagreements instead of correcting the source: `compareCanonicalClaim` returns a
`CanonDiscrepancy` containing the unchanged Canonical Claim and Derived Result. Scenario edits use
immutable ordered layers created by `createScenarioOverrideLayer`; apply them with
`applyScenarioOverrides`, inspect changes with `compareScenarioOverrides`, and remove one with
`revertScenarioOverride`. The original compiled Scenario remains available as the override base.
