import { Effect, FileSystem, Schema } from "effect";
import { ConfigNotFound, FileSystemFailure, InvalidConfig, InvalidJson } from "./errors.js";
import { getPaths } from "./runtime.js";

export class TizenVariant extends Schema.Class<TizenVariant>("TizenVariant")({
  applicationId: Schema.NonEmptyString,
  bundleName: Schema.NonEmptyString,
  excludeFiles: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  icon: Schema.NonEmptyString,
  indexHtml: Schema.optional(Schema.NonEmptyString),
  injectWebapis: Schema.optional(Schema.Boolean),
  name: Schema.NonEmptyString,
  packageId: Schema.NonEmptyString,
  rewriteAssetUrls: Schema.optional(Schema.Boolean),
}) {}

class BuildConfig extends Schema.Class<BuildConfig>("BuildConfig")({
  command: Schema.NonEmptyArray(Schema.NonEmptyString),
  output: Schema.NonEmptyString,
  requiredFiles: Schema.optional(Schema.Array(Schema.NonEmptyString)),
}) {}

class SigningConfig extends Schema.Class<SigningConfig>("SigningConfig")({
  certificateDir: Schema.NonEmptyString,
  profile: Schema.NonEmptyString,
}) {}

class WidgetVariants extends Schema.Class<WidgetVariants>("WidgetVariants")({
  development: TizenVariant,
  production: TizenVariant,
}) {}

class WidgetConfig extends Schema.Class<WidgetConfig>("WidgetConfig")({
  configXml: Schema.NonEmptyString,
  excludeFiles: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  indexHtml: Schema.NonEmptyString,
  injectWebapis: Schema.optional(Schema.Boolean),
  rewriteAssetUrls: Schema.optional(Schema.Boolean),
  variants: WidgetVariants,
}) {}

export class TizenConfig extends Schema.Class<TizenConfig>("TizenConfig")({
  build: BuildConfig,
  signing: SigningConfig,
  widget: WidgetConfig,
}) {}

export const loadConfig = Effect.fn("loadConfig")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const exists = yield* fs
    .exists(paths.configPath)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "exists", path: paths.configPath }),
      ),
    );

  if (!exists) {
    return yield* ConfigNotFound.make({ path: paths.configPath });
  }

  const source = yield* fs
    .readFileString(paths.configPath)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "read", path: paths.configPath }),
      ),
    );

  return yield* decodeConfig(source);
});

const decodeConfig = Effect.fn("decodeConfig")(function* (source: string) {
  const json = yield* Effect.try({
    try: () => JSON.parse(source),
    catch: (cause) => InvalidJson.make({ details: causeToMessage(cause), file: "taizn.json" }),
  });

  return yield* Schema.decodeUnknownEffect(TizenConfig)(json, { errors: "all" }).pipe(
    Effect.mapError((error) => InvalidConfig.make({ details: error.message })),
  );
});

const causeToMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
