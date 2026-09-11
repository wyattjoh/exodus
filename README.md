# Exodus Time Dialation

The headless Journey Model is a Bun and TypeScript module for compiling and inspecting a
validated Centauri Cluster Scenario and simulating one fixed-gate Interstellar Cruise. Orbital
transfers, procedural generation, route planning, workers, and the browser application are
implemented by later tickets.

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
accepts paired stationary Gates and returns a read-only Journey Timeline with zero-duration ZPZ
transitions, a cruise at exactly `0.999c`, cumulative Cluster Coordinate Time, Ship Proper Time,
and Aging Difference. The 3.8-light-year analytic fixture is checked within 0.0001 cluster years
and 0.05 ship days of the documented nominal values.
