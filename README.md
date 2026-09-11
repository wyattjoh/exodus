# Exodus Time Dialation

The headless Journey Model is a Bun and TypeScript module for compiling and inspecting a
validated Centauri Cluster Scenario. Ticket 01 intentionally stops at the public model seam;
physics, procedural generation, route planning, workers, and the browser application are
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
be passed to `inspectScenario` and `formatScenarioInspection`.
