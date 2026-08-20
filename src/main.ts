import { CliError, Command } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Schema } from "effect";
import { fileURLToPath } from "node:url";
import { command } from "./cli.js";
import { type TaiznError, renderError, renderErrorJson } from "./errors.js";
import { loadLocalEnv } from "./runtime.js";

class PackageJson extends Schema.Class<PackageJson>("PackageJson")({
  version: Schema.String,
}) {}

const getPackageVersion = Effect.fn("getPackageVersion")(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(
      fileURLToPath(new URL("../package.json", import.meta.url)),
    );
    const json = yield* Effect.try({
      try: () => JSON.parse(source),
      catch: () => undefined,
    });
    const parsed = yield* Schema.decodeUnknownEffect(PackageJson)(json).pipe(
      Effect.catch(() => Effect.succeed(PackageJson.make({ version: "0.0.0" }))),
    );

    return parsed.version;
  },
  Effect.catch(() => Effect.succeed("0.0.0")),
);

export const runTaiznCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* loadLocalEnv();
    const version = yield* getPackageVersion();
    const runCommand = Command.runWith(command, { version })(args);

    if (wantsStructuredErrors(args)) {
      return yield* runWithBufferedConsole(runCommand, args);
    }

    yield* runCommand;
    return 0;
  }).pipe(Effect.catch(handleMainError(args)));

const handleMainError =
  (args: ReadonlyArray<string>) => (error: TaiznError | CliError.CliError) => {
    if (CliError.isCliError(error)) {
      if (error._tag === "ShowHelp" && error.errors.length === 0) {
        return Effect.succeed(0);
      }

      return Effect.succeed(1);
    }

    const rendered = wantsStructuredErrors(args) ? renderErrorJson(error) : renderError(error);

    return Console.error(rendered).pipe(Effect.as(1));
  };

type BufferedConsole = {
  readonly console: Console.Console;
  readonly stderr: readonly string[];
  readonly stdout: readonly string[];
};

const runWithBufferedConsole = <R>(
  effect: Effect.Effect<void, TaiznError | CliError.CliError, R>,
  args: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const outerConsole = yield* Console.Console;
    const buffered = makeBufferedConsole(outerConsole);

    return yield* effect.pipe(
      Effect.provideService(Console.Console, buffered.console),
      Effect.as(0),
      Effect.tap(() => flushBufferedConsole(buffered, outerConsole)),
      Effect.catch((error) => handleBufferedError(error, buffered, outerConsole, args)),
    );
  });

const handleBufferedError = (
  error: TaiznError | CliError.CliError,
  buffered: BufferedConsole,
  outerConsole: Console.Console,
  args: ReadonlyArray<string>,
) => {
  if (CliError.isCliError(error)) {
    if (error._tag === "ShowHelp") {
      if (error.errors.length === 0) {
        return flushBufferedConsole(buffered, outerConsole).pipe(Effect.as(0));
      }

      return Console.error(renderCliErrorJson(error)).pipe(Effect.as(1));
    }

    return Console.error(renderCliErrorJson(error)).pipe(Effect.as(1));
  }

  return flushBufferedConsole(buffered, outerConsole).pipe(
    Effect.andThen(handleMainError(args)(error)),
  );
};

const renderCliErrorJson = (error: CliError.CliError) =>
  JSON.stringify({
    error: {
      message:
        error._tag === "ShowHelp"
          ? error.errors.map((cliError) => cliError.message).join("\n")
          : error.message,
      type: error._tag,
    },
    ok: false,
  });

const flushBufferedConsole = (buffered: BufferedConsole, outerConsole: Console.Console) =>
  Effect.sync(() => {
    for (const line of buffered.stdout) {
      outerConsole.log(line);
    }

    for (const line of buffered.stderr) {
      outerConsole.error(line);
    }
  });

const makeBufferedConsole = (realConsole: Console.Console): BufferedConsole => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const format = (args: ReadonlyArray<unknown>) => args.map(String).join(" ");

  return {
    console: {
      assert: realConsole.assert.bind(realConsole),
      clear: realConsole.clear.bind(realConsole),
      count: realConsole.count.bind(realConsole),
      countReset: realConsole.countReset.bind(realConsole),
      debug: (...args: ReadonlyArray<unknown>) => stdout.push(format(args)),
      dir: realConsole.dir.bind(realConsole),
      dirxml: realConsole.dirxml.bind(realConsole),
      error: (...args: ReadonlyArray<unknown>) => stderr.push(format(args)),
      group: realConsole.group.bind(realConsole),
      groupCollapsed: realConsole.groupCollapsed.bind(realConsole),
      groupEnd: realConsole.groupEnd.bind(realConsole),
      info: (...args: ReadonlyArray<unknown>) => stdout.push(format(args)),
      log: (...args: ReadonlyArray<unknown>) => stdout.push(format(args)),
      table: realConsole.table.bind(realConsole),
      time: realConsole.time.bind(realConsole),
      timeEnd: realConsole.timeEnd.bind(realConsole),
      timeLog: realConsole.timeLog.bind(realConsole),
      trace: realConsole.trace.bind(realConsole),
      warn: (...args: ReadonlyArray<unknown>) => stderr.push(format(args)),
    },
    stderr,
    stdout,
  };
};

const wantsStructuredErrors = (args: ReadonlyArray<string>) =>
  args.includes("--json") ||
  args.includes("--output=json") ||
  args.includes("--output=ndjson") ||
  args.some(
    (arg, index) =>
      arg === "--output" && (args[index + 1] === "json" || args[index + 1] === "ndjson"),
  );
