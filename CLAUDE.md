# Exodus Time Dialation

## Commands

- `bun run dev` starts the application through Alchemy's Cloudflare development environment.
- `bun run browser:dev` starts Vite directly when Cloudflare bindings are unnecessary.
- `bun run check` runs formatting, linting, typechecking, and tests.
- `bun run build` creates the production Vite build.

## Deployment

- Production deployment commands are pinned to the `prod` Alchemy stage.
- The Cloudflare Worker name is fixed to `exodus`, which serves `exodus.wyattjoh.workers.dev`.
- Run `bun run bootstrap:ci` only from the main checkout to create or rotate the scoped GitHub Actions credential.
