import { Argument, Command, Flag } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import { loadContext, type TaiznContext } from "./context.js";
import { loadEnv } from "./env.js";
import { pairSamsungTvRemote, sendSamsungTvKeys, showSamsungTvInfo } from "./remote.js";
import {
  checkTizen,
  createProfile,
  installWidget,
  launchInstalledApplication,
  listInstalledApplications,
  packageWidget,
  proveInstalledApplication,
  runWidget,
} from "./tizen.js";

const withContext = <E, R>(operation: (context: TaiznContext) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* loadContext();
    yield* operation(context);
  });

const taizn = Command.make("taizn", {}, () =>
  withContext((context) => packageWidget(context).pipe(Effect.asVoid)),
);

const check = Command.make("check", { json: Flag.boolean("json") }, ({ json }) =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* checkTizen(env, { json });
  }),
);

const apps = Command.make(
  "apps",
  { json: Flag.boolean("json"), query: Argument.string("query").pipe(Argument.optional) },
  ({ json, query }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* listInstalledApplications(env, Option.getOrUndefined(query), { json });
    }),
);

const launch = Command.make("launch", { query: Argument.string("query") }, ({ query }) =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* launchInstalledApplication(env, query);
  }),
);

const prove = Command.make(
  "prove",
  { json: Flag.boolean("json"), query: Argument.string("query") },
  ({ json, query }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* proveInstalledApplication(env, query, { json });
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

const tvPress = Command.make(
  "press",
  {
    delayMs: Flag.integer("delay-ms").pipe(Flag.withDefault(250)),
    keys: Argument.string("key").pipe(Argument.variadic({ min: 1 })),
  },
  ({ delayMs, keys }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* sendSamsungTvKeys(env, keys, { delayMs });
    }),
);

const tvInfo = Command.make("info", { json: Flag.boolean("json") }, ({ json }) =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* showSamsungTvInfo(env, { json });
  }),
);

const tv = Command.make("tv", {}).pipe(Command.withSubcommands([tvPair, tvPress, tvInfo]));

export const command = taizn.pipe(
  Command.withSubcommands([apps, check, launch, prove, profile, pack, install, run, tv]),
);
