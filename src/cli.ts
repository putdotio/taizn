import { Argument, Command, Flag } from "effect/unstable/cli";
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
    query: Argument.string("query").pipe(Argument.optional),
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
  { dryRun: Flag.boolean("dry-run"), query: Argument.string("query") },
  ({ dryRun, query }) =>
    Effect.gen(function* () {
      const env = yield* loadEnv();
      yield* launchInstalledApplication(env, query, { dryRun });
    }),
);

const prove = Command.make(
  "prove",
  {
    artifact: Flag.string("artifact").pipe(Flag.optional),
    dryRun: Flag.boolean("dry-run"),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
    query: Argument.string("query"),
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

const profile = Command.make("profile", { dryRun: Flag.boolean("dry-run") }, ({ dryRun }) =>
  withContext((context) => createProfile(context, { dryRun })),
);

const pack = Command.make("package", { dryRun: Flag.boolean("dry-run") }, ({ dryRun }) =>
  withContext((context) => packageWidget(context, { dryRun }).pipe(Effect.asVoid)),
);

const install = Command.make("install", { dryRun: Flag.boolean("dry-run") }, ({ dryRun }) =>
  withContext((context) => installWidget(context, { dryRun })),
);

const run = Command.make("run", { dryRun: Flag.boolean("dry-run") }, ({ dryRun }) =>
  withContext((context) => runWidget(context, { dryRun })),
);

const tvPair = Command.make("pair", { dryRun: Flag.boolean("dry-run") }, ({ dryRun }) =>
  Effect.gen(function* () {
    const env = yield* loadEnv();
    yield* pairSamsungTvRemote(env, { dryRun });
  }),
);

const tvDoctor = Command.make(
  "doctor",
  {
    artifact: Flag.string("artifact").pipe(Flag.optional),
    connect: Flag.boolean("connect"),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    delayMs: Flag.integer("delay-ms").pipe(Flag.withDefault(250)),
    dryRun: Flag.boolean("dry-run"),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
    keys: Argument.string("key").pipe(Argument.variadic({ min: 1 })),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    dryRun: Flag.boolean("dry-run"),
    file: Flag.string("file"),
    json: Flag.boolean("json"),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    dryRun: Flag.boolean("dry-run"),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
    urls: Argument.string("url").pipe(Argument.variadic({ min: 0 })),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
    path: Argument.string("path"),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
    path: Argument.string("path"),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
    path: Argument.string("path").pipe(Argument.optional),
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
    app: Flag.string("app").pipe(Flag.optional),
    artifact: Flag.string("artifact").pipe(Flag.optional),
    durationMs: Flag.integer("duration-ms").pipe(Flag.withDefault(0)),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
    output: Flag.string("output").pipe(Flag.withDefault("text")),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
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
    artifact: Flag.string("artifact").pipe(Flag.optional),
    fields: Flag.string("fields").pipe(Flag.optional),
    json: Flag.boolean("json"),
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
    targets,
    tv,
    validate,
  ]),
);
