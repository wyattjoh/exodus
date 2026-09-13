import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

/**
 * The static Vite application served from `exodus.wyattjoh.workers.dev`.
 *
 * The fixed Worker name makes the workers.dev hostname stable. Production
 * commands therefore pin `--stage prod`; deploying another live stage from
 * this stack would target the same Cloudflare Worker name.
 */
export const Website = Cloudflare.Website.Vite("Website", {
  name: "exodus",
  assets: {
    notFoundHandling: "single-page-application",
  },
  dev: { port: 5173 },
});

export default Alchemy.Stack(
  "ExodusTimeDialation",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const website = yield* Website;
    return { url: website.url };
  }),
);
