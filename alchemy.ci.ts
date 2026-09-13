/**
 * The one-shot bootstrap stack that mints the scoped Cloudflare credential used
 * by GitHub Actions to deploy `alchemy.run.ts`.
 *
 * Run `bun run bootstrap:ci` from the main checkout under the elevated `admin`
 * profile. Its local state contains the token value in plaintext and must stay
 * gitignored. Alchemy returns a token value only when it is first created, so
 * this stack deliberately refuses to run from another directory or worktree.
 */
import { statSync } from "node:fs";
import * as path from "node:path";

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

const repoRoot = path.resolve(import.meta.dirname);

const isMainCheckout = (root: string): boolean => {
  try {
    return statSync(path.join(root, ".git")).isDirectory();
  } catch {
    return false;
  }
};

const misplaced = (): string | undefined => {
  if (path.resolve(process.cwd()) !== repoRoot) {
    return `it ran from ${process.cwd()}`;
  }
  if (!isMainCheckout(repoRoot)) {
    return `${repoRoot} is a worktree, which has an independent \`.alchemy/\` directory`;
  }
  return undefined;
};

const wrongLocation = misplaced();
if (wrongLocation !== undefined) {
  throw new Error(
    `alchemy.ci.ts must run from the main checkout root, but ${wrongLocation}. Run \`bun run bootstrap:ci\` from the main clone so token rotation uses its existing local state.`,
  );
}

export default Alchemy.Stack(
  "exodus-ci",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;

    const deployToken = yield* Cloudflare.ApiToken.AccountApiToken("DeployToken", {
      name: "exodus-github-actions",
      accountId,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "Workers Scripts Write",
            "Account Settings Write",
            "Secrets Store Write",
            "Workers Tail Read",
          ],
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
        },
      ],
    });

    return {
      tokenId: deployToken.tokenId,
      tokenName: deployToken.name,
      accountId,
    };
  }),
);
