import { Console, Effect, FileSystem, Schema } from "effect";
import type { TaiznEnv } from "./env.js";
import { FileSystemFailure, InvalidJson } from "./errors.js";
import { jsonForOutput, readJsonFile, writeJsonArtifact } from "./io.js";
import { getPaths } from "./runtime.js";
import { listTizenTargets } from "./tizen.js";

class TargetAlias extends Schema.Class<TargetAlias>("TargetAlias")({
  alias: Schema.NonEmptyString,
  target: Schema.NonEmptyString,
  tvHost: Schema.optional(Schema.NonEmptyString),
}) {}

class TargetsFile extends Schema.Class<TargetsFile>("TargetsFile")({
  targets: Schema.Array(TargetAlias),
}) {}

type TargetsOptions = {
  readonly artifact?: string;
  readonly fields?: string;
  readonly json?: boolean;
};

export const listTargets = Effect.fn("listTargets")(function* (
  env: TaiznEnv,
  options: TargetsOptions = {},
) {
  const paths = yield* getPaths();
  const aliases = yield* readTargetsFile();
  const connected = yield* listTizenTargets(env);
  const result = {
    aliases,
    configured: {
      target: env.target,
      tvHost: env.tvHost,
    },
    connected,
    paths: {
      targets: `${paths.taiznDir}/targets.json`,
    },
  };

  if (options.artifact) {
    yield* writeJsonArtifact(options.artifact, result);
  }

  if (options.json) {
    yield* Console.log(yield* jsonForOutput(result, { fields: options.fields }));
    return;
  }

  yield* Console.log("Tizen targets:");
  if (connected.length === 0) {
    yield* Console.log("- connected: none");
  }

  for (const target of connected) {
    yield* Console.log(`- connected: ${target.id}${target.label ? ` (${target.label})` : ""}`);
  }

  if (aliases.length === 0) {
    yield* Console.log("- aliases: none");
    return;
  }

  for (const alias of aliases) {
    yield* Console.log(`- ${alias.alias}: ${alias.target}`);
  }
});

export const showCurrentTarget = Effect.fn("showCurrentTarget")(function* (
  env: TaiznEnv,
  options: TargetsOptions = {},
) {
  const aliases = yield* readTargetsFile();
  const alias = aliases.find((candidate) => candidate.target === env.target);
  const result = {
    alias: alias?.alias,
    target: env.target,
    tvHost: env.tvHost ?? alias?.tvHost,
  };

  if (options.artifact) {
    yield* writeJsonArtifact(options.artifact, result);
  }

  if (options.json) {
    yield* Console.log(yield* jsonForOutput(result, { fields: options.fields }));
    return;
  }

  yield* Console.log(`target: ${result.target ?? "unset"}`);
  yield* Console.log(`tv_host: ${result.tvHost ?? "unset"}`);
  if (result.alias) {
    yield* Console.log(`alias: ${result.alias}`);
  }
});

const readTargetsFile = Effect.fn("readTargetsFile")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const path = `${paths.taiznDir}/targets.json`;
  const exists = yield* fs
    .exists(path)
    .pipe(Effect.mapError((cause) => new FileSystemFailure({ cause, operation: "exists", path })));

  if (!exists) {
    return [];
  }

  const json = yield* readJsonFile(path);
  const decoded = yield* Schema.decodeUnknownEffect(TargetsFile)(json, { errors: "all" }).pipe(
    Effect.mapError((error) => new InvalidJson({ details: error.message, file: path })),
  );

  return decoded.targets;
});
