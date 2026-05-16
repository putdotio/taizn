import { Effect, Schema } from "effect";
import { InvalidEnvironment } from "./errors.js";
import { TaiznSystem } from "./runtime.js";

const RawTaiznEnv = Schema.Struct({
  certPassword: Schema.optional(Schema.String),
  distPassword: Schema.optional(Schema.String),
  sdb: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tizenCli: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.Literals(["development", "production"])),
});

export class TaiznEnv extends Schema.Class<TaiznEnv>("TaiznEnv")({
  certPassword: Schema.optional(Schema.String),
  distPassword: Schema.optional(Schema.String),
  sdb: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tizenCli: Schema.optional(Schema.String),
  variant: Schema.Literals(["development", "production"]),
}) {}

export const loadEnv = Effect.fn("loadEnv")(function* () {
  const system = yield* TaiznSystem;
  const env = yield* system.env;
  const raw = yield* Schema.decodeUnknownEffect(RawTaiznEnv)(
    {
      certPassword: env.TAIZN_CERT_PASSWORD,
      distPassword: env.TAIZN_DIST_PASSWORD,
      sdb: env.TAIZN_SDB,
      target: env.TAIZN_TARGET,
      tizenCli: env.TAIZN_TIZEN_CLI,
      variant: env.TAIZN_VARIANT,
    },
    { errors: "all" },
  ).pipe(Effect.mapError((error) => InvalidEnvironment.make({ details: error.message })));

  return TaiznEnv.make({
    ...raw,
    variant: raw.variant ?? "development",
  });
});
