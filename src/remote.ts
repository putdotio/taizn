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

type PressOptions = {
  readonly delayMs?: number;
  readonly json?: boolean;
};

type TvInfoOptions = {
  readonly json?: boolean;
};

type TvDoctorOptions = {
  readonly connect?: boolean;
  readonly json?: boolean;
};

type DiagnosticValueSource = "default" | "env" | "none" | "state" | "target";

type DiagnosticError = {
  readonly details?: string;
  readonly file?: string;
  readonly message: string;
  readonly target?: string;
  readonly type: string;
};

type RemoteStateDiagnostic =
  | {
      readonly path: string;
      readonly status: "missing";
      readonly tokenConfigured: false;
    }
  | {
      readonly host: string;
      readonly name: string;
      readonly path: string;
      readonly port: number;
      readonly protocol: "ws" | "wss";
      readonly status: "valid";
      readonly tokenConfigured: true;
    }
  | {
      readonly error: DiagnosticError;
      readonly path: string;
      readonly status: "error";
      readonly tokenConfigured: false;
    };

type RemoteStateRead = {
  readonly diagnostic: RemoteStateDiagnostic;
  readonly state?: TvRemoteState;
};

type TvInfoDiagnostic =
  | {
      readonly developer: {
        readonly enabled?: boolean;
        readonly ip?: string;
        readonly mode?: string;
      };
      readonly ip: string;
      readonly model?: string;
      readonly name: string;
      readonly ok: true;
      readonly port: number;
      readonly remote?: string;
      readonly remoteAvailable?: boolean;
      readonly tokenAuth?: boolean;
      readonly type?: string;
      readonly uri?: string;
    }
  | {
      readonly error: DiagnosticError;
      readonly ok: false;
      readonly port: number;
    };

type TvRemoteConnectionDiagnostic =
  | {
      readonly reason: string;
      readonly tested: false;
    }
  | {
      readonly ok: true;
      readonly tested: true;
      readonly tokenReturned: boolean;
    }
  | {
      readonly error: DiagnosticError;
      readonly ok: false;
      readonly tested: true;
    };

type TvDoctorResult = {
  readonly host?: string;
  readonly hostSource: DiagnosticValueSource;
  readonly info: TvInfoDiagnostic;
  readonly remote: {
    readonly connection: TvRemoteConnectionDiagnostic;
    readonly name: string;
    readonly port: number;
    readonly protocol: "ws" | "wss";
    readonly target?: string;
    readonly timeoutMs: number;
    readonly tokenConfigured: boolean;
    readonly tokenSource: DiagnosticValueSource;
  };
  readonly state: RemoteStateDiagnostic;
  readonly target?: string;
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
  pressOptions?: PressOptions,
) {
  const remoteOptions = yield* resolveRemoteOptions(env, { requireToken: true });
  const token = remoteOptions.token;
  const delayMs = Math.max(0, pressOptions?.delayMs ?? 250);

  if (!token) {
    return yield* MissingTvRemoteToken.make({});
  }

  yield* connectRemote(remoteOptions, {
    delayMs,
    keys,
  });

  if (pressOptions?.json) {
    yield* Console.log(
      JSON.stringify({
        delayMs,
        keys,
        keyCount: keys.length,
        target: {
          host: remoteOptions.host,
          port: remoteOptions.port,
          protocol: remoteOptions.protocol,
          url: remoteTarget(remoteOptions),
        },
      }),
    );
    return;
  }

  yield* Console.log(
    keys.length === 1
      ? `Sent Samsung TV remote key: ${keys[0]}`
      : `Sent Samsung TV remote keys: ${keys.join(", ")}`,
  );
});

export const diagnoseSamsungTvRemote = Effect.fn("diagnoseSamsungTvRemote")(function* (
  env: TaiznEnv,
  doctorOptions: TvDoctorOptions = {},
) {
  const stateRead = yield* readRemoteStateDiagnostic();
  const state = stateRead.state;
  const targetHost = hostFromTarget(env.target);
  const host = env.tvHost ?? state?.host ?? targetHost;
  const hostSource = valueSource(env.tvHost, state?.host, targetHost);
  const token = env.tvToken ?? state?.token;
  const tokenSource = valueSource(env.tvToken, state?.token, undefined);
  const remoteOptions = host
    ? {
        host,
        name: env.tvName ?? state?.name ?? DEFAULT_REMOTE_NAME,
        port: env.tvPort ?? state?.port ?? DEFAULT_REMOTE_PORT,
        protocol: env.tvProtocol ?? state?.protocol ?? DEFAULT_REMOTE_PROTOCOL,
        timeoutMs: env.tvTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        token,
      }
    : undefined;
  const infoPort = env.tvInfoPort ?? TV_INFO_PORT;
  const info = yield* readInfoDiagnostic(host, infoPort, remoteOptions?.timeoutMs);
  const connection = yield* readRemoteConnectionDiagnostic(remoteOptions, doctorOptions);
  const result: TvDoctorResult = {
    host,
    hostSource,
    info,
    remote: {
      connection,
      name: remoteOptions?.name ?? env.tvName ?? DEFAULT_REMOTE_NAME,
      port: remoteOptions?.port ?? env.tvPort ?? state?.port ?? DEFAULT_REMOTE_PORT,
      protocol:
        remoteOptions?.protocol ?? env.tvProtocol ?? state?.protocol ?? DEFAULT_REMOTE_PROTOCOL,
      target: remoteOptions ? remoteTarget(remoteOptions) : undefined,
      timeoutMs: remoteOptions?.timeoutMs ?? env.tvTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      tokenConfigured: Boolean(token),
      tokenSource,
    },
    state: stateRead.diagnostic,
    target: env.target,
  };

  if (doctorOptions.json) {
    yield* Console.log(JSON.stringify(result));
    return;
  }

  yield* Console.log(`Samsung TV doctor: ${host ?? "missing host"}`);
  yield* Console.log(`host_source: ${hostSource}`);
  yield* Console.log(`info: ${info.ok ? `ok ${info.name}` : `failed ${info.error.type}`}`);
  yield* Console.log(`remote: ${result.remote.target ?? "missing"}`);
  yield* Console.log(`token_configured: ${result.remote.tokenConfigured ? "yes" : "no"}`);
  yield* Console.log(`remote_state: ${result.state.status}`);

  if (connection.tested) {
    yield* Console.log(
      `remote_connect: ${connection.ok ? "ok" : `failed ${connection.error.type}`}`,
    );
  } else {
    yield* Console.log(`remote_connect: skipped (${connection.reason})`);
  }
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

const readRemoteStateDiagnostic = Effect.fn("readRemoteStateDiagnostic")(function* () {
  const paths = yield* getPaths();

  return yield* readRemoteState().pipe(
    Effect.match({
      onFailure: (error): RemoteStateRead => ({
        diagnostic: {
          error: diagnosticError(error),
          path: paths.remoteStatePath,
          status: "error",
          tokenConfigured: false,
        },
      }),
      onSuccess: (state): RemoteStateRead =>
        state
          ? {
              diagnostic: {
                host: state.host,
                name: state.name,
                path: paths.remoteStatePath,
                port: state.port,
                protocol: state.protocol,
                status: "valid",
                tokenConfigured: true,
              },
              state,
            }
          : {
              diagnostic: {
                path: paths.remoteStatePath,
                status: "missing",
                tokenConfigured: false,
              },
            },
    }),
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

const readInfoDiagnostic = Effect.fn("readInfoDiagnostic")(function* (
  host: string | undefined,
  port: number,
  timeoutMs: number | undefined,
) {
  if (!host) {
    return {
      error: diagnosticError(MissingTvRemoteHost.make({})),
      ok: false,
      port,
    } satisfies TvInfoDiagnostic;
  }

  return yield* fetchSamsungTvInfo(host, { port, timeoutMs }).pipe(
    Effect.match({
      onFailure: (error): TvInfoDiagnostic => ({
        error: diagnosticError(error),
        ok: false,
        port,
      }),
      onSuccess: (info): TvInfoDiagnostic => {
        const support = info.isSupport ? parseSupport(info.isSupport) : undefined;

        return {
          developer: {
            enabled: stringFlag(info.device.developerMode),
            ip: info.device.developerIP,
            mode: info.device.developerMode,
          },
          ip: info.device.ip ?? host,
          model: info.device.modelName,
          name: decodeHtml(info.name),
          ok: true,
          port,
          remote: info.remote,
          remoteAvailable: stringFlag(support?.remote_available),
          tokenAuth: stringFlag(info.device.TokenAuthSupport),
          type: info.type,
          uri: info.uri,
        };
      },
    }),
  );
});

const readRemoteConnectionDiagnostic = Effect.fn("readRemoteConnectionDiagnostic")(function* (
  options: RemoteOptions | undefined,
  doctorOptions: TvDoctorOptions,
) {
  if (!doctorOptions.connect) {
    return {
      reason: "pass --connect to test the websocket endpoint",
      tested: false,
    } satisfies TvRemoteConnectionDiagnostic;
  }

  if (!options) {
    return {
      error: diagnosticError(MissingTvRemoteHost.make({})),
      ok: false,
      tested: true,
    } satisfies TvRemoteConnectionDiagnostic;
  }

  return yield* connectRemote(options).pipe(
    Effect.match({
      onFailure: (error): TvRemoteConnectionDiagnostic => ({
        error: diagnosticError(error),
        ok: false,
        tested: true,
      }),
      onSuccess: (returnedToken): TvRemoteConnectionDiagnostic => ({
        ok: true,
        tested: true,
        tokenReturned: returnedToken.length > 0,
      }),
    }),
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

const diagnosticError = (
  error:
    | FileSystemFailure
    | InvalidJson
    | MissingTvRemoteHost
    | MissingTvRemoteToken
    | TvRemoteConnectionFailed
    | TvRemoteProtocolError
    | TvRemoteTimeout
    | TvRemoteUnauthorized,
): DiagnosticError => {
  if (error instanceof FileSystemFailure) {
    return {
      message: error.message,
      target: error.path,
      type: "FileSystemFailure",
    };
  }

  if (error instanceof InvalidJson) {
    return {
      details: error.details,
      file: error.file,
      message: error.message,
      type: "InvalidJson",
    };
  }

  if (error instanceof MissingTvRemoteHost) {
    return {
      message: error.message,
      type: "MissingTvRemoteHost",
    };
  }

  if (error instanceof MissingTvRemoteToken) {
    return {
      message: error.message,
      type: "MissingTvRemoteToken",
    };
  }

  if (error instanceof TvRemoteConnectionFailed) {
    return {
      message: error.message,
      target: error.target,
      type: "TvRemoteConnectionFailed",
    };
  }

  if (error instanceof TvRemoteProtocolError) {
    return {
      details: error.details,
      message: error.message,
      type: "TvRemoteProtocolError",
    };
  }

  if (error instanceof TvRemoteTimeout) {
    return {
      message: error.message,
      target: error.target,
      type: "TvRemoteTimeout",
    };
  }

  return {
    message: error.message,
    target: error.target,
    type: "TvRemoteUnauthorized",
  };
};

const valueSource = (
  envValue: string | undefined,
  stateValue: string | undefined,
  targetValue: string | undefined,
): DiagnosticValueSource => {
  if (envValue) {
    return "env";
  }

  if (stateValue) {
    return "state";
  }

  if (targetValue) {
    return "target";
  }

  return "none";
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
