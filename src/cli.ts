import { Command } from "effect/unstable/cli";
import { Effect } from "effect";
import { loadContext, type TaiznContext } from "./context.js";
import { loadEnv } from "./env.js";
import { checkTizen, createProfile, installWidget, packageWidget } from "./tizen.js";

const withContext = <E, R>(operation: (context: TaiznContext) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* loadContext();
    yield* operation(context);
  });

const taizn = Command.make("taizn", {}, () =>
  withContext((context) => packageWidget(context).pipe(Effect.asVoid)),
);

const check = Command.make("check", {}, () =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* checkTizen(env);
  }),
);

const profile = Command.make("profile", {}, () => withContext((context) => createProfile(context)));

const pack = Command.make("package", {}, () =>
  withContext((context) => packageWidget(context).pipe(Effect.asVoid)),
);

const install = Command.make("install", {}, () => withContext((context) => installWidget(context)));

export const command = taizn.pipe(Command.withSubcommands([check, profile, pack, install]));
