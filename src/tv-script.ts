import { Console, Effect, Schema } from "effect";
import type { TaiznEnv } from "./env.js";
import { InvalidInput, InvalidJson } from "./errors.js";
import { readJsonFile, validateAgentResourceInput, writeJsonArtifact } from "./io.js";
import { sendSamsungTvKeys } from "./remote.js";

class TvScriptStep extends Schema.Class<TvScriptStep>("TvScriptStep")({
  delayMs: Schema.optional(Schema.Number),
  key: Schema.optional(Schema.String),
  keys: Schema.optional(Schema.Array(Schema.String)),
}) {}

class TvScript extends Schema.Class<TvScript>("TvScript")({
  delayMs: Schema.optional(Schema.Number),
  keys: Schema.optional(Schema.Array(Schema.String)),
  steps: Schema.optional(Schema.Array(TvScriptStep)),
}) {}

type TvScriptOptions = {
  readonly artifact?: string;
  readonly dryRun?: boolean;
  readonly json?: boolean;
};

type ResolvedStep = {
  readonly delayMs: number;
  readonly keys: readonly string[];
};

export const runTvScript = Effect.fn("runTvScript")(function* (
  env: TaiznEnv,
  file: string,
  options: TvScriptOptions = {},
) {
  const script = yield* loadTvScript(file);
  const steps = yield* resolveScriptSteps(script);
  const result = {
    dryRun: options.dryRun === true,
    file,
    keyCount: steps.reduce((count, step) => count + step.keys.length, 0),
    steps,
  };

  if (!options.dryRun) {
    for (const step of steps) {
      yield* sendSamsungTvKeys(env, step.keys, {
        delayMs: step.delayMs,
        json: false,
        quiet: options.json,
      });
    }
  }

  if (options.artifact) {
    yield* writeJsonArtifact(options.artifact, {
      ...result,
      completedAt: new Date().toISOString(),
    });
  }

  if (options.json) {
    yield* Console.log(JSON.stringify(result));
    return;
  }

  yield* Console.log(
    options.dryRun
      ? `TV script dry-run: ${result.keyCount} keys from ${file}`
      : `TV script sent ${result.keyCount} keys from ${file}`,
  );
  if (options.artifact) {
    yield* Console.log(`TV script artifact: ${options.artifact}`);
  }
});

const loadTvScript = Effect.fn("loadTvScript")(function* (file: string) {
  const json = yield* readJsonFile(file);

  return yield* Schema.decodeUnknownEffect(TvScript)(json, { errors: "all" }).pipe(
    Effect.mapError((error) => InvalidJson.make({ details: error.message, file })),
  );
});

const resolveScriptSteps = Effect.fn("resolveScriptSteps")(function* (script: TvScript) {
  const steps = script.steps ?? [{ delayMs: script.delayMs, keys: script.keys }];
  const resolved: ResolvedStep[] = [];

  for (const step of steps) {
    const keys = [...(step.keys ?? []), ...(step.key ? [step.key] : [])];
    const delayMs = step.delayMs ?? script.delayMs ?? 250;

    if (keys.length === 0) {
      return yield* InvalidInput.make({
        details: "each TV script step must include key or keys",
        label: "TV script",
      });
    }

    if (!Number.isInteger(delayMs) || delayMs < 0) {
      return yield* InvalidInput.make({
        details: `delayMs must be a non-negative integer. Received: ${delayMs}`,
        label: "TV script",
      });
    }

    for (const key of keys) {
      yield* validateAgentResourceInput("Samsung TV remote key", key);
    }

    resolved.push({ delayMs, keys });
  }

  return resolved;
});
