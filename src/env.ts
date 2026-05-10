import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import { fail } from "./runtime.js";

const TaiznEnvSchema = Schema.Struct({
  certPassword: Schema.optional(Schema.String),
  distPassword: Schema.optional(Schema.String),
  sdb: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tizenCli: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.Literal("development", "production")),
});

export type TaiznEnv = Schema.Schema.Type<typeof TaiznEnvSchema> & {
  readonly variant: "development" | "production";
};

export const loadEnv = (): TaiznEnv => {
  try {
    const env = Schema.decodeUnknownSync(TaiznEnvSchema)({
      certPassword: process.env.TAIZN_CERT_PASSWORD,
      distPassword: process.env.TAIZN_DIST_PASSWORD,
      sdb: process.env.TAIZN_SDB,
      target: process.env.TAIZN_TARGET,
      tizenCli: process.env.TAIZN_TIZEN_CLI,
      variant: process.env.TAIZN_VARIANT,
    });

    return {
      ...env,
      variant: env.variant ?? "development",
    };
  } catch (error) {
    if (ParseResult.isParseError(error)) {
      return fail(`Invalid TAIZN environment:\n${formatParseIssues(error)}`);
    }

    const message = error instanceof Error ? error.message : String(error);
    return fail(`Invalid TAIZN environment: ${message}`);
  }
};

const formatParseIssues = (error: ParseResult.ParseError) =>
  ParseResult.ArrayFormatter.formatErrorSync(error)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "TAIZN environment";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
