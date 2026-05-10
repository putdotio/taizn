import { loadConfig, type TizenConfig } from "./config.js";
import { loadEnv, type TaiznEnv } from "./env.js";

export type TaiznContext = {
  readonly config: TizenConfig;
  readonly env: TaiznEnv;
};

export const loadContext = (): TaiznContext => ({
  config: loadConfig(),
  env: loadEnv(),
});
