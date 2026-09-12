# Exodus Time Dialation

The headless Journey Model is a Bun and TypeScript module for compiling and inspecting a
validated Centauri Cluster Scenario, simulating Interstellar Cruises between hierarchical,
Keplerian Gate worldlines, and simulating powered In-system Transfers between moving Gates.
Procedural generation, route planning, workers, and the browser application are implemented by
later tickets.

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
