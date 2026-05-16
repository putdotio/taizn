import { Argument, Command } from "effect/unstable/cli";
import { Effect } from "effect";
import { loadContext, type TaiznContext } from "./context.js";
import { loadEnv } from "./env.js";
import { pairSamsungTvRemote, sendSamsungTvKey, showSamsungTvInfo } from "./remote.js";
import { checkTizen, createProfile, installWidget, packageWidget, runWidget } from "./tizen.js";

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

const run = Command.make("run", {}, () => withContext((context) => runWidget(context)));

const tvPair = Command.make("pair", {}, () =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* pairSamsungTvRemote(env);
  }),
);

const tvPress = Command.make("press", { key: Argument.string("key") }, ({ key }) =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* sendSamsungTvKey(env, key);
  }),
);

const tvInfo = Command.make("info", {}, () =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* showSamsungTvInfo(env);
  }),
);

const tv = Command.make("tv", {}).pipe(Command.withSubcommands([tvPair, tvPress, tvInfo]));

export const command = taizn.pipe(
  Command.withSubcommands([check, profile, pack, install, run, tv]),
);
