import { Effect, Schema } from "effect";
import { InvalidEnvironment } from "./errors.js";
import { TaiznSystem } from "./runtime.js";

const RawTaiznEnv = Schema.Struct({
  certPassword: Schema.optional(Schema.String),
  distPassword: Schema.optional(Schema.String),
  sdb: Schema.optional(Schema.String),
  sellerBrowser: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tizenCli: Schema.optional(Schema.String),
  tvHost: Schema.optional(Schema.String),
  tvInfoPort: Schema.optional(Schema.String),
  tvName: Schema.optional(Schema.String),
  tvPort: Schema.optional(Schema.String),
  tvProtocol: Schema.optional(Schema.Literals(["ws", "wss"])),
  tvTimeoutMs: Schema.optional(Schema.String),
  tvToken: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.Literals(["development", "production"])),
});

export class TaiznEnv extends Schema.Class<TaiznEnv>("TaiznEnv")({
  certPassword: Schema.optional(Schema.String),
  distPassword: Schema.optional(Schema.String),
  sdb: Schema.optional(Schema.String),
  sellerBrowser: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tizenCli: Schema.optional(Schema.String),
  tvHost: Schema.optional(Schema.String),
  tvInfoPort: Schema.optional(Schema.Number),
  tvName: Schema.optional(Schema.String),
  tvPort: Schema.optional(Schema.Number),
  tvProtocol: Schema.optional(Schema.Literals(["ws", "wss"])),
  tvTimeoutMs: Schema.optional(Schema.Number),
  tvToken: Schema.optional(Schema.String),
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
      sellerBrowser: env.TAIZN_SELLER_BROWSER,
      target: env.TAIZN_TARGET,
      tizenCli: env.TAIZN_TIZEN_CLI,
      tvHost: env.TAIZN_TV_HOST,
      tvInfoPort: env.TAIZN_TV_INFO_PORT,
      tvName: env.TAIZN_TV_NAME,
      tvPort: env.TAIZN_TV_PORT,
      tvProtocol: env.TAIZN_TV_PROTOCOL,
      tvTimeoutMs: env.TAIZN_TV_TIMEOUT_MS,
      tvToken: env.TAIZN_TV_TOKEN,
      variant: env.TAIZN_VARIANT,
    },
    { errors: "all" },
  ).pipe(Effect.mapError((error) => new InvalidEnvironment({ details: error.message })));
  const tvInfoPort = raw.tvInfoPort
    ? yield* parsePort(raw.tvInfoPort, "TAIZN_TV_INFO_PORT")
    : undefined;
  const tvPort = raw.tvPort ? yield* parseTvPort(raw.tvPort) : undefined;
  const tvTimeoutMs = raw.tvTimeoutMs
    ? yield* parsePositiveInteger(raw.tvTimeoutMs, "TAIZN_TV_TIMEOUT_MS")
    : undefined;

  return TaiznEnv.make({
    ...raw,
    tvInfoPort,
    tvPort,
    tvTimeoutMs,
    variant: raw.variant ?? "development",
  });
});

const parseTvPort = Effect.fn("parseTvPort")(function* (value: string) {
  return yield* parsePort(value, "TAIZN_TV_PORT");
});

const parsePort = Effect.fn("parsePort")(function* (value: string, variable: string) {
  const port = Number(value);

  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return yield* new InvalidEnvironment({
      details: `${variable} must be an integer between 1 and 65535. Received: ${value}`,
    });
  }

  return port;
});

const parsePositiveInteger = Effect.fn("parsePositiveInteger")(function* (
  value: string,
  variable: string,
) {
  const parsed = Number(value);

  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1) {
    return yield* new InvalidEnvironment({
      details: `${variable} must be a positive integer. Received: ${value}`,
    });
  }

  return parsed;
});
