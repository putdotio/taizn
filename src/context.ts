import { Effect } from "effect";
import { loadConfig } from "./config.js";
import type { TizenConfig } from "./config.js";
import { loadEnv } from "./env.js";
import type { TaiznEnv } from "./env.js";

export type TaiznContext = {
  readonly config: TizenConfig;
  readonly env: TaiznEnv;
};

export const loadContext = Effect.fn("loadContext")(function* () {
  const config = yield* loadConfig();
  const env = yield* loadEnv();

  return { config, env };
});
