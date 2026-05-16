import { existsSync, readFileSync } from "node:fs";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import { configPath, fail } from "./runtime.js";

const TizenVariantSchema = Schema.Struct({
  applicationId: Schema.NonEmptyString,
  bundleName: Schema.NonEmptyString,
  excludeFiles: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  icon: Schema.NonEmptyString,
  indexHtml: Schema.optional(Schema.NonEmptyString),
  injectWebapis: Schema.optional(Schema.Boolean),
  name: Schema.NonEmptyString,
  packageId: Schema.NonEmptyString,
  rewriteAssetUrls: Schema.optional(Schema.Boolean),
});

const TizenConfigSchema = Schema.Struct({
  build: Schema.Struct({
    command: Schema.NonEmptyArray(Schema.NonEmptyString),
    output: Schema.NonEmptyString,
    requiredFiles: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  }),
  signing: Schema.Struct({
    certificateDir: Schema.NonEmptyString,
    profile: Schema.NonEmptyString,
  }),
  widget: Schema.Struct({
    configXml: Schema.NonEmptyString,
    excludeFiles: Schema.optional(Schema.Array(Schema.NonEmptyString)),
    indexHtml: Schema.NonEmptyString,
    injectWebapis: Schema.optional(Schema.Boolean),
    rewriteAssetUrls: Schema.optional(Schema.Boolean),
    variants: Schema.Struct({
      development: TizenVariantSchema,
      production: TizenVariantSchema,
    }),
  }),
});

export type TizenConfig = Schema.Schema.Type<typeof TizenConfigSchema>;
export type TizenVariant = Schema.Schema.Type<typeof TizenVariantSchema>;

export const loadConfig = (): TizenConfig => {
  if (!existsSync(configPath)) {
    fail(`Config file not found: ${configPath}`);
  }

  return decodeConfig(readFileSync(configPath, "utf8"));
};

const decodeConfig = (source: string): TizenConfig => {
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(TizenConfigSchema), { errors: "all" })(source);
  } catch (error) {
    if (ParseResult.isParseError(error)) {
      return fail(`Invalid taizn.json:\n${formatParseIssues(error)}`);
    }

    const message = error instanceof Error ? error.message : String(error);
    return fail(`Invalid taizn.json: ${message}`);
  }
};

const formatParseIssues = (error: ParseResult.ParseError) =>
  ParseResult.ArrayFormatter.formatErrorSync(error)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "taizn.json";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
