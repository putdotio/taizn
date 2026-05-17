#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { CliError, Command } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Layer, Schema } from "effect";
import { fileURLToPath } from "node:url";
import { command } from "./cli.js";
import { type TaiznError, renderError, renderErrorJson } from "./errors.js";
import { loadLocalEnv, TaiznSystem } from "./runtime.js";

class PackageJson extends Schema.Class<PackageJson>("PackageJson")({
  version: Schema.String,
}) {}

const appLayer = Layer.mergeAll(NodeServices.layer, TaiznSystem.Live);

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

const program = Effect.gen(function* () {
  yield* loadLocalEnv();
  const version = yield* getPackageVersion();
  const runCommand = Command.run(command, { version });

  if (wantsStructuredErrors()) {
    yield* runWithBufferedConsole(runCommand);
    return;
  }

  yield* runCommand;
}).pipe(Effect.catch(handleMainError), Effect.provide(appLayer));

NodeRuntime.runMain(program);

function handleMainError(error: TaiznError | CliError.CliError) {
  if (CliError.isCliError(error)) {
    if (error._tag === "ShowHelp" && error.errors.length === 0) {
      return Effect.void;
    }

    return markFailed;
  }

  const rendered = wantsStructuredErrors() ? renderErrorJson(error) : renderError(error);

  return Console.error(rendered).pipe(Effect.andThen(markFailed));
}

type BufferedConsole = {
  readonly console: Console.Console;
  readonly stderr: readonly string[];
  readonly stdout: readonly string[];
};

const runWithBufferedConsole = <R>(
  effect: Effect.Effect<void, TaiznError | CliError.CliError, R>,
) => {
  const buffered = makeBufferedConsole();

  return effect.pipe(
    Effect.provideService(Console.Console, buffered.console),
    Effect.tap(() => flushBufferedConsole(buffered)),
    Effect.catch((error) => handleBufferedError(error, buffered)),
  );
};

const handleBufferedError = (error: TaiznError | CliError.CliError, buffered: BufferedConsole) => {
  if (CliError.isCliError(error)) {
    if (error._tag === "ShowHelp") {
      if (error.errors.length === 0) {
        return flushBufferedConsole(buffered);
      }

      return Console.error(renderCliErrorJson(error)).pipe(Effect.andThen(markFailed));
    }

    return Console.error(renderCliErrorJson(error)).pipe(Effect.andThen(markFailed));
  }

  return flushBufferedConsole(buffered).pipe(Effect.andThen(handleMainError(error)));
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

const flushBufferedConsole = (buffered: BufferedConsole) =>
  Effect.sync(() => {
    for (const line of buffered.stdout) {
      globalThis.console.log(line);
    }

    for (const line of buffered.stderr) {
      globalThis.console.error(line);
    }
  });

const makeBufferedConsole = (): BufferedConsole => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const realConsole = globalThis.console;
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

const markFailed = Effect.sync(() => {
  process.exitCode = 1;
});

const wantsStructuredErrors = () =>
  process.argv.includes("--json") ||
  process.argv.includes("--output=json") ||
  process.argv.includes("--output=ndjson") ||
  process.argv.some(
    (arg, index) =>
      arg === "--output" &&
      (process.argv[index + 1] === "json" || process.argv[index + 1] === "ndjson"),
  );
