#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { CliError, Command } from "effect/unstable/cli";
import { Console, Effect, FileSystem, Layer, Schema } from "effect";
import { fileURLToPath } from "node:url";
import { command } from "./cli.js";
import { type TaiznError, renderError } from "./errors.js";
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
  yield* Command.run(command, { version });
}).pipe(Effect.catch(handleMainError), Effect.provide(appLayer));

NodeRuntime.runMain(program);

function handleMainError(error: TaiznError | CliError.CliError) {
  if (CliError.isCliError(error)) {
    if (error._tag === "ShowHelp" && error.errors.length === 0) {
      return Effect.void;
    }

    return markFailed;
  }

  return Console.error(renderError(error)).pipe(Effect.andThen(markFailed));
}

const markFailed = Effect.sync(() => {
  process.exitCode = 1;
});
