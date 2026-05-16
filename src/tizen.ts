import { Console, Effect, FileSystem, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process";
import { join } from "node:path";
import type { TaiznContext } from "./context.js";
import type { TizenConfig, TizenVariant } from "./config.js";
import type { TaiznEnv } from "./env.js";
import {
  appBuildEnv,
  appPath,
  baseChildEnv,
  type ChildEnv,
  defaultSdb,
  defaultTizenCli,
  getPaths,
  readPassword,
  redactCommandArgs,
  requireFile,
  withTizenPath,
} from "./runtime.js";
import {
  ApplicationNotFound,
  CommandFailed,
  FileSystemFailure,
  MissingPassword,
  MissingTizenTarget,
  MultipleApplicationsMatched,
  MultipleTargetsConnected,
  PackageNotProduced,
} from "./errors.js";
import { escapeXml, setXmlAttribute } from "./xml.js";

type Certificates = {
  readonly author: string;
  readonly distributor: string;
};

type SdbDevice = {
  readonly id: string;
  readonly label: string;
  readonly state: string;
};

type TizenApplication = {
  readonly applicationId: string;
  readonly name: string;
};

type WidgetIndexOptions = {
  readonly indexHtml: string;
  readonly injectWebapis?: boolean;
  readonly rewriteAssetUrls?: boolean;
};

type WidgetStageOptions = WidgetIndexOptions & {
  readonly excludeFiles: readonly string[];
};

type RunOptions = {
  readonly cwd?: string;
  readonly env?: ChildEnv;
};

type RunTarget = {
  readonly flag: "-s" | "-t";
  readonly value: string;
};

type ProofOptions = {
  readonly json?: boolean;
};

export const checkTizen = Effect.fn("checkTizen")(function* (env: TaiznEnv) {
  const tizenPath = yield* resolveTizenCli(env);
  const sdbPath = yield* resolveSdb(env);
  const devices = yield* listSdbDevices(sdbPath);

  yield* Console.log(`Tizen CLI: ${tizenPath}`);
  yield* Console.log(`sdb: ${sdbPath}`);

  if (devices.length === 0) {
    yield* Console.log("connected targets: none");
    return;
  }

  yield* Console.log("connected targets:");

  for (const device of devices) {
    yield* Console.log(`- ${device.id}${device.label ? ` (${device.label})` : ""}`);
  }
});

export const createProfile = Effect.fn("createProfile")(function* ({ config, env }: TaiznContext) {
  const password = yield* readPassword(env.certPassword, "Tizen certificate password: ");

  if (!password) {
    return yield* MissingPassword.make({
      action: "create the signing profile",
      variable: "TAIZN_CERT_PASSWORD",
    });
  }

  const certificates = yield* getCertificates(config);
  const distributorPassword = env.distPassword ?? password;
  const tizenPath = yield* resolveTizenCli(env);

  yield* run(
    tizenPath,
    [
      "security-profiles",
      "add",
      "-f",
      "-A",
      "-n",
      config.signing.profile,
      "-a",
      certificates.author,
      "-p",
      password,
      "-d",
      certificates.distributor,
      "-dp",
      distributorPassword,
    ],
    { env: yield* baseChildEnv() },
  );

  yield* Console.log(`Configured active Tizen signing profile: ${config.signing.profile}`);
});

export const packageWidget = Effect.fn("packageWidget")(function* ({ config, env }: TaiznContext) {
  const [command, ...args] = config.build.command;
  const tizenPath = yield* resolveTizenCli(env);
  const paths = yield* getPaths();
  const variant = getVariant(config, env.variant);

  yield* run(command, args, { env: yield* appBuildEnv() });
  yield* stageWidget(config, variant);
  yield* run(
    tizenPath,
    [
      "package",
      "-t",
      "wgt",
      "-s",
      config.signing.profile,
      "-o",
      paths.outputDir,
      "--",
      paths.stageDir,
    ],
    { env: yield* baseChildEnv() },
  );

  const built = yield* findBuiltWidget();
  const installable = join(paths.outputDir, `${variant.bundleName}.wgt`);

  if (built !== installable) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .copyFile(built, installable)
      .pipe(
        Effect.mapError((cause) =>
          FileSystemFailure.make({ cause, operation: "copy", path: installable }),
        ),
      );
  }

  yield* Console.log(`Packaged ${installable}`);
  return installable;
});

export const installWidget = Effect.fn("installWidget")(function* (context: TaiznContext) {
  const built = yield* packageWidget(context);
  const target = yield* resolveInstallTarget(context.env);
  const sdbPath = yield* resolveSdb(context.env);
  const tizenPath = yield* resolveTizenCli(context.env);

  if (context.env.target) {
    yield* run(sdbPath, ["connect", context.env.target], { env: yield* baseChildEnv() });
  }

  const installArgs = target ? ["install", "-n", built, "-s", target] : ["install", "-n", built];

  yield* run(tizenPath, installArgs, { env: yield* baseChildEnv() });
});

export const runWidget = Effect.fn("runWidget")(function* ({ config, env }: TaiznContext) {
  const variant = getVariant(config, env.variant);
  const sdbPath = yield* resolveSdb(env);
  const tizenPath = yield* resolveTizenCli(env);

  if (env.target) {
    yield* run(sdbPath, ["connect", env.target], { env: yield* baseChildEnv() });
  }

  const target = yield* resolveRunTarget(env, sdbPath);
  // Real Samsung TVs launch web widgets here by application id; package id fails.
  const runArgs = target
    ? ["run", "-p", variant.applicationId, target.flag, target.value]
    : ["run", "-p", variant.applicationId];

  yield* run(tizenPath, runArgs, { env: yield* baseChildEnv() });
  yield* Console.log(`Launched ${variant.applicationId}`);
});

export const listInstalledApplications = Effect.fn("listInstalledApplications")(function* (
  env: TaiznEnv,
  query?: string,
) {
  const { applications: installedApplications, target } = yield* loadInstalledApplications(env);
  const queryLabel = query?.trim();
  const normalizedQuery = normalizeQuery(queryLabel);
  const applications = installedApplications.filter((application) =>
    matchesApplicationQuery(application, normalizedQuery),
  );
  const suffix = queryLabel ? ` matching "${queryLabel}"` : "";

  yield* Console.log(`Installed Tizen applications${suffix} on ${target}:`);

  if (applications.length === 0) {
    yield* Console.log("none");
    return;
  }

  for (const application of applications) {
    yield* Console.log(`- ${application.name} (${application.applicationId})`);
  }
});

export const launchInstalledApplication = Effect.fn("launchInstalledApplication")(function* (
  env: TaiznEnv,
  query: string,
) {
  const tizenPath = yield* resolveTizenCli(env);
  const { applications, target } = yield* loadInstalledApplications(env);
  const application = yield* resolveInstalledApplication(query, applications);

  yield* launchApplication(tizenPath, target, application);
  yield* Console.log(`Launched ${application.name} (${application.applicationId}) on ${target}`);
});

export const proveInstalledApplication = Effect.fn("proveInstalledApplication")(function* (
  env: TaiznEnv,
  query: string,
  options: ProofOptions = {},
) {
  const tizenPath = yield* resolveTizenCli(env);
  const { applications, target } = yield* loadInstalledApplications(env, { quiet: options.json });
  const application = yield* resolveInstalledApplication(query, applications);

  if (options.json) {
    const launchOutput = yield* launchApplication(tizenPath, target, application, {
      captureOutput: true,
    });

    yield* Console.log(
      JSON.stringify({
        application: {
          id: application.applicationId,
          name: application.name,
        },
        launch: {
          output: launchOutput.trim(),
          started: true,
        },
        target,
      }),
    );
    return;
  }

  yield* Console.log(`Tizen target: ${target}`);
  yield* Console.log(`Installed application: ${application.name} (${application.applicationId})`);
  yield* launchApplication(tizenPath, target, application);
  yield* Console.log(`Launch proof: ${application.applicationId} started on ${target}`);
});

const resolveTizenCli = Effect.fn("resolveTizenCli")(function* (env: TaiznEnv) {
  return yield* requireFile(env.tizenCli ?? (yield* defaultTizenCli()), "Tizen CLI");
});

const resolveSdb = Effect.fn("resolveSdb")(function* (env: TaiznEnv) {
  return yield* requireFile(env.sdb ?? (yield* defaultSdb()), "sdb");
});

const getVariant = (config: TizenConfig, variant: "development" | "production") =>
  config.widget.variants[variant];

const getWidgetStageOptions = (config: TizenConfig, variant: TizenVariant): WidgetStageOptions => ({
  excludeFiles: [...(config.widget.excludeFiles ?? []), ...(variant.excludeFiles ?? [])],
  indexHtml: variant.indexHtml ?? config.widget.indexHtml,
  injectWebapis: variant.injectWebapis ?? config.widget.injectWebapis,
  rewriteAssetUrls: variant.rewriteAssetUrls ?? config.widget.rewriteAssetUrls,
});

const getCertificates = Effect.fn("getCertificates")(function* (config: TizenConfig) {
  const paths = yield* getPaths();
  const certificatesDir = appPath(paths.appDir, config.signing.certificateDir);

  return {
    author: yield* requireFile(join(certificatesDir, "author.p12"), "Author certificate"),
    distributor: yield* requireFile(
      join(certificatesDir, "distributor.p12"),
      "Distributor certificate",
    ),
  } satisfies Certificates;
});

const rewriteConfigForWidget = Effect.fn("rewriteConfigForWidget")(function* (
  variant: TizenVariant,
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const targetPath = join(paths.stageDir, "config.xml");
  const source = yield* fs
    .readFileString(targetPath)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "read", path: targetPath }),
      ),
    );
  const withApplication = source.replace(/<tizen:application\b[^>]*\/>/, (tag) =>
    setXmlAttribute(
      setXmlAttribute(tag, "id", variant.applicationId),
      "package",
      variant.packageId,
    ),
  );
  const rewritten = withApplication.replace(
    /<name>[^<]*<\/name>/,
    `<name>${escapeXml(variant.name)}</name>`,
  );

  yield* fs
    .writeFileString(targetPath, rewritten)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "write", path: targetPath }),
      ),
    );
});

const rewriteIndexForWidget = Effect.fn("rewriteIndexForWidget")(function* (
  options: WidgetIndexOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const targetPath = join(paths.stageDir, "index.html");
  const webapisScript = '<script src="$WEBAPIS/webapis/webapis.js"></script>';
  const indexPath = appPath(paths.appDir, options.indexHtml);
  const source = yield* fs
    .readFileString(indexPath)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "read", path: indexPath }),
      ),
    );
  const withAssets = options.rewriteAssetUrls
    ? source.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./')
    : source;
  const html =
    options.injectWebapis !== false && !withAssets.includes("$WEBAPIS/webapis/webapis.js")
      ? withAssets.replace("</head>", `${webapisScript}</head>`)
      : withAssets;

  yield* fs
    .writeFileString(targetPath, html)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "write", path: targetPath }),
      ),
    );
});

const assertBuildOutput = Effect.fn("assertBuildOutput")(function* (config: TizenConfig) {
  const paths = yield* getPaths();
  const sourceDir = appPath(paths.appDir, config.build.output);

  yield* requireFile(sourceDir, "Tizen build output");

  for (const requiredFile of config.build.requiredFiles ?? []) {
    yield* requireFile(join(sourceDir, requiredFile), `Tizen build output ${requiredFile}`);
  }

  return sourceDir;
});

const removeExcludedStageFiles = Effect.fn("removeExcludedStageFiles")(function* (
  excludeFiles: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();

  for (const file of excludeFiles) {
    const path = join(paths.stageDir, file);
    yield* fs
      .remove(path, { force: true, recursive: true })
      .pipe(
        Effect.mapError((cause) => FileSystemFailure.make({ cause, operation: "remove", path })),
      );
  }
});

const stageWidget = Effect.fn("stageWidget")(function* (
  config: TizenConfig,
  variant: TizenVariant,
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const sourceDir = yield* assertBuildOutput(config);
  const options = getWidgetStageOptions(config, variant);
  const configXml = appPath(paths.appDir, config.widget.configXml);
  const icon = yield* requireFile(appPath(paths.appDir, variant.icon), "Tizen widget icon");

  yield* fs
    .remove(paths.stageDir, { force: true, recursive: true })
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "remove", path: paths.stageDir }),
      ),
    );
  yield* fs
    .remove(paths.outputDir, { force: true, recursive: true })
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "remove", path: paths.outputDir }),
      ),
    );
  yield* fs
    .makeDirectory(paths.stageDir, { recursive: true })
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "mkdir", path: paths.stageDir }),
      ),
    );
  yield* fs
    .makeDirectory(paths.outputDir, { recursive: true })
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "mkdir", path: paths.outputDir }),
      ),
    );
  yield* fs
    .copy(sourceDir, paths.stageDir)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "copy", path: paths.stageDir }),
      ),
    );
  yield* fs
    .copyFile(configXml, join(paths.stageDir, "config.xml"))
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "copy", path: configXml }),
      ),
    );
  yield* fs
    .copyFile(icon, join(paths.stageDir, "icon.png"))
    .pipe(
      Effect.mapError((cause) => FileSystemFailure.make({ cause, operation: "copy", path: icon })),
    );
  yield* removeExcludedStageFiles(options.excludeFiles);
  yield* rewriteConfigForWidget(variant);
  yield* rewriteIndexForWidget(options);
});

const findBuiltWidget = Effect.fn("findBuiltWidget")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const entries = yield* fs
    .readDirectory(paths.outputDir)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "readDirectory", path: paths.outputDir }),
      ),
    );
  const built = entries
    .filter((entry) => entry.endsWith(".wgt"))
    .map((entry) => join(paths.outputDir, entry))
    .at(0);

  if (built) {
    return built;
  }

  return yield* PackageNotProduced.make({ outputDir: paths.outputDir });
});

const listSdbDevices = Effect.fn("listSdbDevices")(function* (sdbPath: string) {
  const output = yield* capture(sdbPath, ["devices"]);

  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseSdbDevice)
    .filter((device) => device.id && device.state === "device");
});

const parseSdbDevice = (line: string): SdbDevice => {
  const [id = "", state = "", label = ""] = line.split(/\s+/, 3);
  return { id, label, state };
};

const resolveInstallTarget = Effect.fn("resolveInstallTarget")(function* (env: TaiznEnv) {
  if (env.target) {
    return env.target;
  }

  const devices = yield* listSdbDevices(yield* resolveSdb(env));

  if (devices.length === 1) {
    const device = devices[0];
    if (device) {
      yield* Console.log(
        `Using connected Tizen target: ${device.id}${device.label ? ` (${device.label})` : ""}`,
      );

      return device.id;
    }
  }

  if (devices.length > 1) {
    return yield* MultipleTargetsConnected.make({
      targets: devices.map((device) => device.id),
    });
  }

  return undefined;
});

const resolveRunTarget = Effect.fn("resolveRunTarget")(function* (env: TaiznEnv, sdbPath: string) {
  if (env.target) {
    return { flag: "-s", value: env.target } satisfies RunTarget;
  }

  const devices = yield* listSdbDevices(sdbPath);

  if (devices.length === 1) {
    const device = devices[0];
    if (device) {
      yield* Console.log(
        `Using connected Tizen target: ${device.id}${device.label ? ` (${device.label})` : ""}`,
      );

      return { flag: "-s", value: device.id } satisfies RunTarget;
    }
  }

  if (devices.length > 1) {
    return yield* MultipleTargetsConnected.make({
      targets: devices.map((device) => device.id),
    });
  }

  return undefined;
});

const resolveRequiredSdbTarget = Effect.fn("resolveRequiredSdbTarget")(function* (
  env: TaiznEnv,
  sdbPath: string,
  options: { readonly quiet?: boolean } = {},
) {
  if (env.target) {
    return env.target;
  }

  const devices = yield* listSdbDevices(sdbPath);

  if (devices.length === 1) {
    const device = devices[0];
    if (device) {
      if (!options.quiet) {
        yield* Console.log(
          `Using connected Tizen target: ${device.id}${device.label ? ` (${device.label})` : ""}`,
        );
      }

      return device.id;
    }
  }

  if (devices.length > 1) {
    return yield* MultipleTargetsConnected.make({
      targets: devices.map((device) => device.id),
    });
  }

  return yield* MissingTizenTarget.make({});
});

const loadInstalledApplications = Effect.fn("loadInstalledApplications")(function* (
  env: TaiznEnv,
  options: { readonly quiet?: boolean } = {},
) {
  const sdbPath = yield* resolveSdb(env);

  if (env.target) {
    if (options.quiet) {
      yield* capture(sdbPath, ["connect", env.target]);
    } else {
      yield* run(sdbPath, ["connect", env.target], { env: yield* baseChildEnv() });
    }
  }

  const target = yield* resolveRequiredSdbTarget(env, sdbPath, { quiet: options.quiet });
  const output = yield* capture(sdbPath, ["-s", target, "shell", "0", "applist"]);

  return { applications: parseInstalledApplications(output), target };
});

const parseInstalledApplications = (output: string): readonly TizenApplication[] =>
  output.split("\n").flatMap((line) => {
    const match = line.match(/^\s*'([^']*)'\s+'([^']*)'\s*$/);
    const name = match?.[1]?.trim();
    const applicationId = match?.[2]?.trim();

    return name && applicationId ? [{ applicationId, name }] : [];
  });

const normalizeQuery = (query: string | undefined) => query?.trim().toLowerCase();

const matchesApplicationQuery = (
  application: TizenApplication,
  normalizedQuery: string | undefined,
) =>
  !normalizedQuery ||
  application.name.toLowerCase().includes(normalizedQuery) ||
  application.applicationId.toLowerCase().includes(normalizedQuery);

const resolveInstalledApplication = Effect.fn("resolveInstalledApplication")(function* (
  query: string,
  applications: readonly TizenApplication[],
) {
  const queryLabel = query.trim();
  const normalizedQuery = normalizeQuery(queryLabel);

  if (!normalizedQuery) {
    return yield* ApplicationNotFound.make({ query });
  }

  const exactMatch = applications.find(
    (application) => application.applicationId.toLowerCase() === normalizedQuery,
  );

  if (exactMatch) {
    return exactMatch;
  }

  const exactNameMatches = applications.filter(
    (application) => application.name.toLowerCase() === normalizedQuery,
  );

  if (exactNameMatches.length === 1) {
    const [match] = exactNameMatches;
    if (match) {
      return match;
    }
  }

  if (exactNameMatches.length > 1) {
    return yield* MultipleApplicationsMatched.make({
      matches: exactNameMatches.map(
        (application) => `${application.name} (${application.applicationId})`,
      ),
      query: queryLabel,
    });
  }

  const matches = applications.filter((application) =>
    matchesApplicationQuery(application, normalizedQuery),
  );

  if (matches.length === 1) {
    const [match] = matches;
    if (match) {
      return match;
    }
  }

  if (matches.length > 1) {
    return yield* MultipleApplicationsMatched.make({
      matches: matches.map((application) => `${application.name} (${application.applicationId})`),
      query: queryLabel,
    });
  }

  return yield* ApplicationNotFound.make({ query: queryLabel });
});

const launchApplication = Effect.fn("launchApplication")(function* (
  tizenPath: string,
  target: string,
  application: TizenApplication,
  options: { readonly captureOutput?: boolean } = {},
) {
  if (options.captureOutput) {
    return yield* capture(tizenPath, ["run", "-p", application.applicationId, "-s", target]);
  }

  yield* run(tizenPath, ["run", "-p", application.applicationId, "-s", target], {
    env: yield* baseChildEnv(),
  });
  return "";
});

const run = Effect.fn("run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions,
) {
  const paths = yield* getPaths();
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const env = yield* withTizenPath(options.env ?? (yield* baseChildEnv()));
  const exitCode = yield* spawner
    .exitCode(
      ChildProcess.make(command, args, {
        cwd: options.cwd ?? paths.appDir,
        env,
        stderr: "inherit",
        stdin: "inherit",
        stdout: "inherit",
      }),
    )
    .pipe(Effect.mapError(() => CommandFailed.make({ args: redactCommandArgs(args), command })));

  if (exitCode !== 0) {
    return yield* CommandFailed.make({ args: redactCommandArgs(args), command });
  }
});

const capture = Effect.fn("capture")(function* (command: string, args: ReadonlyArray<string>) {
  const output = yield* Effect.scoped(
    Effect.gen(function* () {
      const paths = yield* getPaths();
      const env = yield* withTizenPath(yield* baseChildEnv());
      const process = yield* ChildProcess.make(command, args, {
        cwd: paths.appDir,
        env,
        stderr: "inherit",
      }).pipe(
        Effect.mapError(() => CommandFailed.make({ args: redactCommandArgs(args), command })),
      );
      const output = yield* process.stdout
        .pipe(Stream.decodeText, Stream.mkString)
        .pipe(
          Effect.mapError(() => CommandFailed.make({ args: redactCommandArgs(args), command })),
        );
      const exitCode = yield* process.exitCode.pipe(
        Effect.mapError(() => CommandFailed.make({ args: redactCommandArgs(args), command })),
      );

      return { exitCode, output };
    }),
  );

  if (output.exitCode !== 0) {
    return yield* CommandFailed.make({ args: redactCommandArgs(args), command });
  }

  return output.output;
});
