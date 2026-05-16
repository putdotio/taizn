import { homedir } from "node:os";
import { Context, Effect, FileSystem, Layer } from "effect";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { SecretReadInterrupted, FileSystemFailure, MissingFile } from "./errors.js";

export type TaiznPaths = {
  readonly appDir: string;
  readonly configPath: string;
  readonly envPath: string;
  readonly outputDir: string;
  readonly stageDir: string;
  readonly taiznDir: string;
};

export type ChildEnv = Record<string, string | undefined>;

export class TaiznSystem extends Context.Service<
  TaiznSystem,
  {
    readonly cwd: Effect.Effect<string>;
    readonly env: Effect.Effect<NodeJS.ProcessEnv>;
    readonly homeDir: Effect.Effect<string>;
    readonly loadEnvFile: (path: string) => Effect.Effect<void>;
    readonly readSecret: (prompt: string) => Effect.Effect<string, SecretReadInterrupted>;
  }
>()("taizn/TaiznSystem") {
  static readonly Live = Layer.succeed(TaiznSystem)({
    cwd: Effect.sync(() => process.cwd()),
    env: Effect.sync(() => process.env),
    homeDir: Effect.sync(() => homedir()),
    loadEnvFile: (path) =>
      Effect.sync(() => {
        if (existsSync(path)) {
          process.loadEnvFile(path);
        }
      }),
    readSecret: (prompt) =>
      Effect.tryPromise({
        try: () => readSecret(prompt),
        catch: () => SecretReadInterrupted.make({}),
      }),
  });
}

export const makePaths = (appDir: string): TaiznPaths => {
  const taiznDir = join(appDir, ".taizn");

  return {
    appDir,
    configPath: join(appDir, "taizn.json"),
    envPath: join(taiznDir, ".env"),
    outputDir: join(taiznDir, "build", "output"),
    stageDir: join(taiznDir, "build", "stage"),
    taiznDir,
  };
};

export const getPaths = Effect.fn("getPaths")(function* () {
  const system = yield* TaiznSystem;
  const appDir = yield* system.cwd;
  return makePaths(appDir);
});

export const appPath = (appDir: string, path: string) =>
  isAbsolute(path) ? path : join(appDir, path);

export const loadLocalEnv = Effect.fn("loadLocalEnv")(function* () {
  const paths = yield* getPaths();
  const system = yield* TaiznSystem;
  yield* system.loadEnvFile(paths.envPath);
});

export const requireFile = Effect.fn("requireFile")(function* (path: string, label: string) {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs
    .exists(path)
    .pipe(Effect.mapError((cause) => FileSystemFailure.make({ cause, operation: "exists", path })));

  if (!exists) {
    return yield* MissingFile.make({ label, path });
  }

  return path;
});

export const baseChildEnv = Effect.fn("baseChildEnv")(function* () {
  const system = yield* TaiznSystem;
  const source = yield* system.env;
  const env: ChildEnv = { ...source };

  delete env.DYLD_INSERT_LIBRARIES;
  return env;
});

export const appBuildEnv = Effect.fn("appBuildEnv")(function* () {
  const env = yield* baseChildEnv();

  for (const key of Object.keys(env)) {
    if (key.startsWith("TAIZN_") || key.startsWith("TIZEN_")) {
      delete env[key];
    }
  }

  delete env.SDB;
  return env;
});

export const withTizenPath = Effect.fn("withTizenPath")(function* (env: ChildEnv) {
  const system = yield* TaiznSystem;
  const home = yield* system.homeDir;

  return {
    ...env,
    PATH: `${join(home, "tizen-studio/tools/ide/bin")}:${join(home, "tizen-studio/tools")}:${
      env.PATH ?? ""
    }`,
  };
});

export const defaultTizenCli = Effect.fn("defaultTizenCli")(function* () {
  const system = yield* TaiznSystem;
  const home = yield* system.homeDir;
  return join(home, "tizen-studio/tools/ide/bin/tizen");
});

export const defaultSdb = Effect.fn("defaultSdb")(function* () {
  const system = yield* TaiznSystem;
  const home = yield* system.homeDir;
  return join(home, "tizen-studio/tools/sdb");
});

export const readPassword = Effect.fn("readPassword")(function* (
  value: string | undefined,
  prompt: string,
) {
  if (value) {
    return value;
  }

  const system = yield* TaiznSystem;
  return yield* system.readSecret(prompt);
});

export const redactCommandArgs = (args: ReadonlyArray<string>) => {
  const sensitiveValueFlags = new Set(["-p", "-dp"]);

  return args.map((arg, index) => {
    if (index > 0 && sensitiveValueFlags.has(args[index - 1] ?? "")) {
      return "[redacted]";
    }

    return arg;
  });
};

const readSecret = (prompt: string) =>
  new Promise<string>((resolve, reject) => {
    if (!process.stdin.isTTY) {
      resolve("");
      return;
    }

    let value = "";

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    };

    const onData = (char: string) => {
      if (char === "\u0003") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("interrupted"));
        return;
      }

      if (char === "\r" || char === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }

      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += char;
    };

    process.stdin.on("data", onData);
  });
