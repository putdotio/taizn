import { Console, Effect, FileSystem, Schema } from "effect";
import { dirname } from "node:path";
import WebSocket from "ws";
import type { TaiznEnv } from "./env.js";
import {
  FileSystemFailure,
  InvalidJson,
  MissingTvRemoteHost,
  MissingTvRemoteToken,
  TvRemoteConnectionFailed,
  TvRemoteProtocolError,
  TvRemoteTimeout,
  TvRemoteUnauthorized,
} from "./errors.js";
import { getPaths } from "./runtime.js";

const DEFAULT_REMOTE_NAME = "taizn";
const DEFAULT_REMOTE_PORT = 8002;
const DEFAULT_REMOTE_PROTOCOL = "wss";
const DEFAULT_TIMEOUT_MS = 30_000;
const TV_INFO_PORT = 8001;

class RemoteClientAttributes extends Schema.Class<RemoteClientAttributes>("RemoteClientAttributes")(
  {
    name: Schema.optional(Schema.String),
    token: Schema.optional(Schema.String),
  },
) {}

class RemoteClient extends Schema.Class<RemoteClient>("RemoteClient")({
  attributes: Schema.optional(RemoteClientAttributes),
  deviceName: Schema.optional(Schema.String),
  id: Schema.String,
  isHost: Schema.Boolean,
}) {}

class RemoteEventData extends Schema.Class<RemoteEventData>("RemoteEventData")({
  clients: Schema.optional(Schema.Array(RemoteClient)),
  id: Schema.optional(Schema.String),
  token: Schema.optional(Schema.String),
}) {}

class RemoteEvent extends Schema.Class<RemoteEvent>("RemoteEvent")({
  data: Schema.optional(RemoteEventData),
  event: Schema.String,
}) {}

class TvInfoDevice extends Schema.Class<TvInfoDevice>("TvInfoDevice")({
  TokenAuthSupport: Schema.optional(Schema.String),
  developerIP: Schema.optional(Schema.String),
  developerMode: Schema.optional(Schema.String),
  ip: Schema.optional(Schema.String),
  modelName: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
}) {}

class TvInfo extends Schema.Class<TvInfo>("TvInfo")({
  device: TvInfoDevice,
  isSupport: Schema.optional(Schema.String),
  name: Schema.String,
  remote: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  uri: Schema.optional(Schema.String),
}) {}

class TvRemoteState extends Schema.Class<TvRemoteState>("TvRemoteState")({
  host: Schema.String,
  name: Schema.String,
  port: Schema.Number,
  protocol: Schema.Literals(["ws", "wss"]),
  token: Schema.String,
}) {}

type RemoteOptions = {
  readonly host: string;
  readonly name: string;
  readonly port: number;
  readonly protocol: "ws" | "wss";
  readonly timeoutMs: number;
  readonly token?: string;
};

type SavedRemoteOptions = RemoteOptions & {
  readonly token: string;
};

type RemoteKeySequence = {
  readonly delayMs: number;
  readonly keys: readonly string[];
};

type TvInfoOptions = {
  readonly json?: boolean;
};

type TvRemoteError =
  | MissingTvRemoteHost
  | MissingTvRemoteToken
  | TvRemoteConnectionFailed
  | TvRemoteProtocolError
  | TvRemoteTimeout
  | TvRemoteUnauthorized;

export const pairSamsungTvRemote = Effect.fn("pairSamsungTvRemote")(function* (env: TaiznEnv) {
  const options = yield* resolveRemoteOptions(env, { ignoreToken: true });

  yield* Console.log(`Pairing Samsung TV remote: ${remoteTarget(options)}`);
  yield* Console.log("Accept the remote control prompt on the TV if it appears.");

  const token = yield* connectRemote(options);
  yield* saveRemoteState({ ...options, token });
  yield* Console.log(`Saved Samsung TV remote token to .taizn/remote.json`);
  yield* Console.log(`TAIZN_TV_TOKEN=${token}`);
});

export const sendSamsungTvKey = Effect.fn("sendSamsungTvKey")(function* (
  env: TaiznEnv,
  key: string,
) {
  yield* sendSamsungTvKeys(env, [key]);
});

export const sendSamsungTvKeys = Effect.fn("sendSamsungTvKeys")(function* (
  env: TaiznEnv,
  keys: readonly string[],
  pressOptions?: { readonly delayMs?: number },
) {
  const remoteOptions = yield* resolveRemoteOptions(env, { requireToken: true });
  const token = remoteOptions.token;

  if (!token) {
    return yield* MissingTvRemoteToken.make({});
  }

  yield* connectRemote(remoteOptions, {
    delayMs: Math.max(0, pressOptions?.delayMs ?? 250),
    keys,
  });

  yield* Console.log(
    keys.length === 1
      ? `Sent Samsung TV remote key: ${keys[0]}`
      : `Sent Samsung TV remote keys: ${keys.join(", ")}`,
  );
});

export const showSamsungTvInfo = Effect.fn("showSamsungTvInfo")(function* (
  env: TaiznEnv,
  infoOptions: TvInfoOptions = {},
) {
  const options = yield* resolveRemoteOptions(env);
  const info = yield* fetchSamsungTvInfo(options.host, {
    port: env.tvInfoPort,
    timeoutMs: options.timeoutMs,
  });
  const support = info.isSupport ? parseSupport(info.isSupport) : undefined;

  if (infoOptions.json) {
    yield* Console.log(
      JSON.stringify({
        developer: {
          enabled: stringFlag(info.device.developerMode),
          ip: info.device.developerIP,
          mode: info.device.developerMode,
        },
        host: options.host,
        infoPort: env.tvInfoPort ?? TV_INFO_PORT,
        ip: info.device.ip ?? options.host,
        model: info.device.modelName,
        name: decodeHtml(info.name),
        remote: info.remote,
        remoteAvailable: stringFlag(support?.remote_available),
        tokenAuth: stringFlag(info.device.TokenAuthSupport),
        type: info.type,
        uri: info.uri,
      }),
    );
    return;
  }

  yield* Console.log(`Samsung TV: ${decodeHtml(info.name)}`);
  yield* Console.log(`model: ${info.device.modelName ?? "unknown"}`);
  yield* Console.log(`ip: ${info.device.ip ?? options.host}`);
  yield* Console.log(`remote: ${info.remote ?? "unknown"}`);
  yield* Console.log(`remote_available: ${support?.remote_available ?? "unknown"}`);
  yield* Console.log(`token_auth: ${info.device.TokenAuthSupport ?? "unknown"}`);
  yield* Console.log(`developer_ip: ${info.device.developerIP ?? "unknown"}`);
  yield* Console.log(`developer_mode: ${info.device.developerMode ?? "unknown"}`);
});

const resolveRemoteOptions = Effect.fn("resolveRemoteOptions")(function* (
  env: TaiznEnv,
  options?: { readonly ignoreToken?: boolean; readonly requireToken?: boolean },
) {
  const targetHost = hostFromTarget(env.target);
  const needsState =
    (!env.tvHost && !targetHost) ||
    Boolean(options?.requireToken && !options.ignoreToken && !env.tvToken);
  const state = needsState ? yield* readRemoteState() : undefined;
  const host = env.tvHost ?? state?.host ?? targetHost;

  if (!host) {
    return yield* MissingTvRemoteHost.make({});
  }

  const token = options?.ignoreToken ? undefined : (env.tvToken ?? state?.token);

  if (options?.requireToken && !token) {
    return yield* MissingTvRemoteToken.make({});
  }

  return {
    host,
    name: env.tvName ?? state?.name ?? DEFAULT_REMOTE_NAME,
    port: env.tvPort ?? state?.port ?? DEFAULT_REMOTE_PORT,
    protocol: env.tvProtocol ?? state?.protocol ?? DEFAULT_REMOTE_PROTOCOL,
    timeoutMs: env.tvTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    token,
  } satisfies RemoteOptions;
});

const readRemoteState = Effect.fn("readRemoteState")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const exists = yield* fs
    .exists(paths.remoteStatePath)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "exists", path: paths.remoteStatePath }),
      ),
    );

  if (!exists) {
    return undefined;
  }

  const source = yield* fs
    .readFileString(paths.remoteStatePath)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "read", path: paths.remoteStatePath }),
      ),
    );
  const json = yield* Effect.try({
    try: () => JSON.parse(source),
    catch: (cause) =>
      InvalidJson.make({ details: causeToMessage(cause), file: paths.remoteStatePath }),
  });

  return yield* Schema.decodeUnknownEffect(TvRemoteState)(json, { errors: "all" }).pipe(
    Effect.mapError((error) =>
      InvalidJson.make({ details: error.message, file: paths.remoteStatePath }),
    ),
  );
});

const saveRemoteState = Effect.fn("saveRemoteState")(function* (options: SavedRemoteOptions) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const state = TvRemoteState.make({
    host: options.host,
    name: options.name,
    port: options.port,
    protocol: options.protocol,
    token: options.token,
  });

  yield* fs
    .makeDirectory(dirname(paths.remoteStatePath), { recursive: true })
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "mkdir", path: dirname(paths.remoteStatePath) }),
      ),
    );
  yield* fs
    .writeFileString(paths.remoteStatePath, `${JSON.stringify(state, null, 2)}\n`)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "write", path: paths.remoteStatePath }),
      ),
    );
});

const connectRemote = Effect.fn("connectRemote")(function* (
  options: RemoteOptions,
  sequence?: RemoteKeySequence,
) {
  return yield* Effect.tryPromise({
    try: () => connectRemotePromise(options, sequence),
    catch: (cause) => normalizeRemoteError(cause, options),
  });
});

const connectRemotePromise = (options: RemoteOptions, sequence?: RemoteKeySequence) =>
  new Promise<string>((resolve, reject) => {
    const url = remoteUrl(options);
    const ws = new WebSocket(url, {
      handshakeTimeout: options.timeoutMs,
      rejectUnauthorized: false,
    });
    const timer = setTimeout(() => {
      reject(TvRemoteTimeout.make({ target: remoteTarget(options) }));
      ws.terminate();
    }, options.timeoutMs);
    let settled = false;

    const succeed = (token: string) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(token);
      ws.close();
    };

    const fail = (error: TvRemoteError) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
      ws.close();
    };

    const sendSequence = (token: string) => {
      const keys = sequence?.keys ?? [];

      if (keys.length === 0) {
        succeed(token);
        return;
      }

      let index = 0;
      const sendNext = () => {
        const key = keys[index];

        if (!key) {
          succeed(token);
          return;
        }

        ws.send(JSON.stringify(remoteKeyPayload(key)));
        index += 1;

        if (index >= keys.length) {
          setTimeout(() => succeed(token), 500);
          return;
        }

        setTimeout(sendNext, sequence?.delayMs ?? 250);
      };

      sendNext();
    };

    ws.on("message", (data) => {
      let event: RemoteEvent;

      try {
        event = parseRemoteEvent(data.toString(), options);
      } catch (cause) {
        fail(normalizeRemoteError(cause, options));
        return;
      }

      if (event.event === "ms.channel.unauthorized") {
        fail(TvRemoteUnauthorized.make({ target: remoteTarget(options) }));
        return;
      }

      if (event.event !== "ms.channel.connect") {
        return;
      }

      const token = remoteEventToken(event) ?? options.token;

      if (!token) {
        fail(
          TvRemoteProtocolError.make({
            details: "connect event did not include a token",
          }),
        );
        return;
      }

      sendSequence(token);
    });

    ws.on("error", (cause) => {
      fail(TvRemoteConnectionFailed.make({ cause, target: remoteTarget(options) }));
    });

    ws.on("close", () => {
      if (!settled) {
        fail(
          TvRemoteConnectionFailed.make({
            cause: new Error("remote websocket closed before connecting"),
            target: remoteTarget(options),
          }),
        );
      }
    });
  });

export const fetchSamsungTvInfo = Effect.fn("fetchSamsungTvInfo")(function* (
  host: string,
  options?: { readonly port?: number; readonly timeoutMs?: number },
) {
  const url = `http://${host}:${options?.port ?? TV_INFO_PORT}/api/v2/`;
  const json = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    },
    catch: (cause) =>
      isAbortError(cause)
        ? TvRemoteTimeout.make({ target: url })
        : TvRemoteConnectionFailed.make({ cause, target: url }),
  });

  return yield* Schema.decodeUnknownEffect(TvInfo)(json, { errors: "all" }).pipe(
    Effect.mapError((error) => TvRemoteProtocolError.make({ details: error.message })),
  );
});

const isAbortError = (cause: unknown) =>
  cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError");

const parseRemoteEvent = (source: string, options: RemoteOptions) => {
  try {
    return Schema.decodeUnknownSync(RemoteEvent)(JSON.parse(source));
  } catch (cause) {
    throw TvRemoteProtocolError.make({
      details: `${remoteTarget(options)} sent an unexpected message: ${causeToMessage(cause)}`,
    });
  }
};

const parseSupport = (source: string) => {
  try {
    return Schema.decodeUnknownSync(
      Schema.Struct({ remote_available: Schema.optional(Schema.String) }),
    )(JSON.parse(source));
  } catch {
    return undefined;
  }
};

const remoteUrl = (options: RemoteOptions) => {
  const params = new URLSearchParams({
    name: Buffer.from(options.name).toString("base64"),
  });

  if (options.token) {
    params.set("token", options.token);
  }

  return `${options.protocol}://${options.host}:${options.port}/api/v2/channels/samsung.remote.control?${params.toString()}`;
};

const remoteTarget = (options: RemoteOptions) =>
  `${options.protocol}://${options.host}:${options.port}`;

const remoteKeyPayload = (key: string) => ({
  method: "ms.remote.control",
  params: {
    Cmd: "Click",
    DataOfCmd: key,
    Option: "false",
    TypeOfRemote: "SendRemoteKey",
  },
});

const remoteEventToken = (event: RemoteEvent) => {
  const data = event.data;

  if (!data) {
    return undefined;
  }

  const matchingClientToken = data.id
    ? data.clients?.find((client) => client.id === data.id)?.attributes?.token
    : undefined;

  return (
    data.token ??
    matchingClientToken ??
    data.clients?.find((client) => client.attributes?.token)?.attributes?.token
  );
};

const normalizeRemoteError = (cause: unknown, options: RemoteOptions): TvRemoteError => {
  if (
    cause instanceof MissingTvRemoteHost ||
    cause instanceof MissingTvRemoteToken ||
    cause instanceof TvRemoteConnectionFailed ||
    cause instanceof TvRemoteProtocolError ||
    cause instanceof TvRemoteTimeout ||
    cause instanceof TvRemoteUnauthorized
  ) {
    return cause;
  }

  return TvRemoteConnectionFailed.make({ cause, target: remoteTarget(options) });
};

const hostFromTarget = (target: string | undefined) => {
  if (!target) {
    return undefined;
  }

  return target.split(":").at(0);
};

const causeToMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const decodeHtml = (value: string) => value.replaceAll("&quot;", '"').replaceAll("&amp;", "&");

const stringFlag = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return undefined;
};
