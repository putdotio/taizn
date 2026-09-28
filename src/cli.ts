import { Argument, Command, Flag } from "effect/cli";
import { Effect, Option } from "effect";
import { loadContext, type TaiznContext } from "./context.js";
import { loadEnv } from "./env.js";
import {
  diagnoseSamsungTvRemote,
  pairSamsungTvRemote,
  sendSamsungTvKeys,
  showSamsungTvInfo,
} from "./remote.js";
import { describeCli } from "./describe.js";
import { inspectWidgetArchive, prepareSubmission, validateSubmission } from "./inspect.js";
import { probeHostedAssets } from "./probe.js";
import { listSellerApplications, loginSeller } from "./seller.js";
import { listTargets, showCurrentTarget } from "./targets.js";
import {
  captureTizenLogs,
  checkTizen,
  createProfile,
  installWidget,
  launchInstalledApplication,
  listInstalledApplications,
  packageWidget,
  proveInstalledApplication,
  runWidget,
} from "./tizen.js";
import { runTvScript } from "./tv-script.js";

const booleanFlag = (name: string) => Flag.Boolean(name).pipe(Flag.withDefault(false));

const withContext = <E, R>(operation: (context: TaiznContext) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* loadContext();
    yield* operation(context);
  });

const taizn = Command.make("taizn", {}, () =>
  withContext((context) => packageWidget(context).pipe(Effect.asVoid)),
);

const check = Command.make(
  "check",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
  },
  ({ artifact, fields, json }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* checkTizen(env, {
        artifact: Option.getOrUndefined(artifact),
        fields: Option.getOrUndefined(fields),
        json,
      });
    }),
);

const apps = Command.make(
  "apps",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
    query: Argument.String("query").pipe(Argument.optional),
  },
  ({ artifact, fields, json, query }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* listInstalledApplications(env, Option.getOrUndefined(query), {
        artifact: Option.getOrUndefined(artifact),
        fields: Option.getOrUndefined(fields),
        json,
      });
    }),
);

const launch = Command.make(
  "launch",
  { dryRun: booleanFlag("dry-run"), query: Argument.String("query") },
  ({ dryRun, query }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* launchInstalledApplication(env, query, { dryRun });
    }),
);

const prove = Command.make(
  "prove",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    dryRun: booleanFlag("dry-run"),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
    query: Argument.String("query"),
  },
  ({ artifact, dryRun, fields, json, query }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* proveInstalledApplication(env, query, {
        artifact: Option.getOrUndefined(artifact),
        dryRun,
        fields: Option.getOrUndefined(fields),
        json,
      });
    }),
);

const profile = Command.make("profile", { dryRun: booleanFlag("dry-run") }, ({ dryRun }) =>
  withContext((context) => createProfile(context, { dryRun })),
);

const pack = Command.make("package", { dryRun: booleanFlag("dry-run") }, ({ dryRun }) =>
  withContext((context) => packageWidget(context, { dryRun }).pipe(Effect.asVoid)),
);

const install = Command.make("install", { dryRun: booleanFlag("dry-run") }, ({ dryRun }) =>
  withContext((context) => installWidget(context, { dryRun })),
);

const run = Command.make("run", { dryRun: booleanFlag("dry-run") }, ({ dryRun }) =>
  withContext((context) => runWidget(context, { dryRun })),
);

const tvPair = Command.make("pair", { dryRun: booleanFlag("dry-run") }, ({ dryRun }) =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* pairSamsungTvRemote(env, { dryRun });
  }),
);

const tvDoctor = Command.make(
  "doctor",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    connect: booleanFlag("connect"),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
  },
  ({ artifact, connect, fields, json }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* diagnoseSamsungTvRemote(env, {
        artifact: Option.getOrUndefined(artifact),
        connect,
        fields: Option.getOrUndefined(fields),
        json,
      });
    }),
);

const tvPress = Command.make(
  "press",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    delayMs: Flag.Int("delay-ms").pipe(Flag.withDefault(250)),
    dryRun: booleanFlag("dry-run"),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
    keys: Argument.String("key").pipe(Argument.variadic({ min: 1 })),
  },
  ({ artifact, delayMs, dryRun, fields, json, keys }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* sendSamsungTvKeys(env, keys, {
        artifact: Option.getOrUndefined(artifact),
        delayMs,
        dryRun,
        fields: Option.getOrUndefined(fields),
        json,
      });
    }),
);

const tvScript = Command.make(
  "script",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    dryRun: booleanFlag("dry-run"),
    file: Flag.String("file"),
    json: booleanFlag("json"),
  },
  ({ artifact, dryRun, file, json }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* runTvScript(env, file, {
        artifact: Option.getOrUndefined(artifact),
        dryRun,
        json,
      });
    }),
);

const tvInfo = Command.make(
  "info",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
  },
  ({ artifact, fields, json }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* showSamsungTvInfo(env, {
        artifact: Option.getOrUndefined(artifact),
        fields: Option.getOrUndefined(fields),
        json,
      });
    }),
);

const tv = Command.make("tv", {}).pipe(
  Command.withSubcommands([tvDoctor, tvPair, tvPress, tvScript, tvInfo]),
);

const probeHosted = Command.make(
  "hosted-assets",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    dryRun: booleanFlag("dry-run"),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
    urls: Argument.String("url").pipe(Argument.variadic({ min: 0 })),
  },
  ({ artifact, dryRun, fields, json, urls }) =>
    withContext((context) =>
      probeHostedAssets(context, urls, {
        artifact: Option.getOrUndefined(artifact),
        dryRun,
        fields: Option.getOrUndefined(fields),
        json,
      }),
    ),
);

const probe = Command.make("probe", {}).pipe(Command.withSubcommands([probeHosted]));

const inspectWgt = Command.make(
  "wgt",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
    path: Argument.String("path"),
  },
  ({ artifact, fields, json, path }) =>
    inspectWidgetArchive(path, {
      artifact: Option.getOrUndefined(artifact),
      fields: Option.getOrUndefined(fields),
      json,
    }),
);

const inspect = Command.make("inspect", {}).pipe(Command.withSubcommands([inspectWgt]));

const prepareSubmissionCommand = Command.make(
  "submission",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
    path: Argument.String("path"),
  },
  ({ artifact, fields, json, path }) =>
    prepareSubmission(path, {
      artifact: Option.getOrUndefined(artifact),
      fields: Option.getOrUndefined(fields),
      json,
    }),
);

const prepare = Command.make("prepare", {}).pipe(
  Command.withSubcommands([prepareSubmissionCommand]),
);

const validateSubmissionCommand = Command.make(
  "submission",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
    path: Argument.String("path").pipe(Argument.optional),
  },
  ({ artifact, fields, json, path }) =>
    withContext((context) =>
      validateSubmission(context, Option.getOrUndefined(path), {
        artifact: Option.getOrUndefined(artifact),
        fields: Option.getOrUndefined(fields),
        json,
      }),
    ),
);

const validate = Command.make("validate", {}).pipe(
  Command.withSubcommands([validateSubmissionCommand]),
);

const logsCapture = Command.make(
  "capture",
  {
    app: Flag.String("app").pipe(Flag.optional),
    artifact: Flag.String("artifact").pipe(Flag.optional),
    durationMs: Flag.Int("duration-ms").pipe(Flag.withDefault(0)),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
    output: Flag.String("output").pipe(Flag.withDefault("text")),
  },
  ({ app, artifact, durationMs, fields, json, output }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* captureTizenLogs(env, {
        app: Option.getOrUndefined(app),
        artifact: Option.getOrUndefined(artifact),
        durationMs,
        fields: Option.getOrUndefined(fields),
        json,
        output,
      });
    }),
);

const logs = Command.make("logs", {}).pipe(Command.withSubcommands([logsCapture]));

const targetsList = Command.make(
  "list",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
  },
  ({ artifact, fields, json }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* listTargets(env, {
        artifact: Option.getOrUndefined(artifact),
        fields: Option.getOrUndefined(fields),
        json,
      });
    }),
);

const targetsCurrent = Command.make(
  "current",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
  },
  ({ artifact, fields, json }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* showCurrentTarget(env, {
        artifact: Option.getOrUndefined(artifact),
        fields: Option.getOrUndefined(fields),
        json,
      });
    }),
);

const targets = Command.make("targets", {}).pipe(
  Command.withSubcommands([targetsList, targetsCurrent]),
);

const sellerLogin = Command.make(
  "login",
  {
    dryRun: booleanFlag("dry-run"),
    json: booleanFlag("json"),
  },
  ({ dryRun, json }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* loginSeller(env, { dryRun, json });
    }),
);

const sellerAppsList = Command.make(
  "list",
  {
    artifact: Flag.String("artifact").pipe(Flag.optional),
    fields: Flag.String("fields").pipe(Flag.optional),
    json: booleanFlag("json"),
  },
  ({ artifact, fields, json }) =>
    listSellerApplications({
      artifact: Option.getOrUndefined(artifact),
      fields: Option.getOrUndefined(fields),
      json,
    }),
);

const sellerApps = Command.make("apps", {}).pipe(Command.withSubcommands([sellerAppsList]));

const seller = Command.make("seller", {}).pipe(Command.withSubcommands([sellerLogin, sellerApps]));

const describe = Command.make("describe", {}, () => describeCli());

export const command = taizn.pipe(
  Command.withSubcommands([
    apps,
    check,
    describe,
    inspect,
    launch,
    logs,
    prepare,
    probe,
    prove,
    profile,
    pack,
    install,
    run,
    seller,
    targets,
    tv,
    validate,
  ]),
);
