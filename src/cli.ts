import { Command } from "@effect/cli";
import { Effect } from "effect";
import { loadContext } from "./context.js";
import { loadEnv } from "./env.js";
import { checkTizen, createProfile, installWidget, packageWidget } from "./tizen.js";

const runSync = (operation: (context: ReturnType<typeof loadContext>) => void) =>
  Effect.sync(() => {
    operation(loadContext());
  });

const runEnvSync = (operation: (env: ReturnType<typeof loadEnv>) => void) =>
  Effect.sync(() => {
    operation(loadEnv());
  });

const taizn = Command.make("taizn", {}, () =>
  runSync((context) => {
    packageWidget(context);
  }),
);

const check = Command.make("check", {}, () =>
  runEnvSync((env) => {
    checkTizen(env);
  }),
);

const profile = Command.make("profile", {}, () =>
  Effect.promise(async () => {
    await createProfile(loadContext());
  }),
);

const pack = Command.make("package", {}, () =>
  runSync((context) => {
    packageWidget(context);
  }),
);

const install = Command.make("install", {}, () =>
  runSync((context) => {
    installWidget(context);
  }),
);

export const command = taizn.pipe(Command.withSubcommands([check, profile, pack, install]));
