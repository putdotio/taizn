import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { Console, Effect, FileSystem, Schema } from "effect";
import WebSocket from "ws";
import type { TaiznEnv } from "./env.js";
import {
  FileSystemFailure,
  SellerAuthenticationRequired,
  SellerBrowserConnectionFailed,
  SellerBrowserNotFound,
  SellerPortalDrift,
  SellerPortalProtocolError,
  SellerSessionNotFound,
} from "./errors.js";
import { jsonForOutput, readJsonFile, writeJsonArtifact } from "./io.js";
import { getPaths } from "./runtime.js";

const SELLER_APPLICATIONS_URL = "https://seller.samsungapps.com/tv/tizen-application";
const SELLER_LOGIN_URL = "https://seller.samsungapps.com/tv/";
const SELLER_TIMEOUT_MS = 10_000;

export class SellerApplication extends Schema.Class<SellerApplication>("SellerApplication")({
  name: Schema.NonEmptyString,
  sellerAppId: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
  type: Schema.NonEmptyString,
  updatedAt: Schema.optionalKey(Schema.NonEmptyString),
}) {}

export class SellerApplicationsResult extends Schema.Class<SellerApplicationsResult>(
  "SellerApplicationsResult",
)({
  applications: Schema.Array(SellerApplication),
  schemaVersion: Schema.Literal(1),
}) {}

class SellerBrowserState extends Schema.Class<SellerBrowserState>("SellerBrowserState")({
  port: Schema.Number,
  schemaVersion: Schema.Literal(1),
}) {}

class CdpTarget extends Schema.Class<CdpTarget>("CdpTarget")({
  id: Schema.String,
  type: Schema.String,
  url: Schema.String,
  webSocketDebuggerUrl: Schema.optionalKey(Schema.String),
}) {}

class CdpError extends Schema.Class<CdpError>("CdpError")({
  code: Schema.Number,
  message: Schema.String,
}) {}

class CdpMessage extends Schema.Class<CdpMessage>("CdpMessage")({
  error: Schema.optionalKey(CdpError),
  id: Schema.optionalKey(Schema.Number),
  result: Schema.optionalKey(Schema.Unknown),
}) {}

class CdpRemoteObject extends Schema.Class<CdpRemoteObject>("CdpRemoteObject")({
  value: Schema.optionalKey(Schema.Unknown),
}) {}

class CdpEvaluationResult extends Schema.Class<CdpEvaluationResult>("CdpEvaluationResult")({
  result: CdpRemoteObject,
}) {}

class SellerExtraction extends Schema.Class<SellerExtraction>("SellerExtraction")({
  applications: Schema.optionalKey(Schema.Array(SellerApplication)),
  details: Schema.optionalKey(Schema.String),
  state: Schema.Literals(["loading", "ready", "signedOut", "drift"]),
}) {}

type SellerOutputOptions = {
  readonly artifact?: string;
  readonly fields?: string;
  readonly json?: boolean;
};

type SellerLoginOptions = {
  readonly dryRun?: boolean;
  readonly json?: boolean;
};

type SellerError =
  | SellerAuthenticationRequired
  | SellerBrowserConnectionFailed
  | SellerBrowserNotFound
  | SellerPortalDrift
  | SellerPortalProtocolError
  | SellerSessionNotFound;

export const loginSeller = Effect.fn("loginSeller")(function* (
  env: TaiznEnv,
  options: SellerLoginOptions = {},
) {
  const paths = yield* getPaths();
  const browser = yield* resolveSellerBrowser(env);
  const args = sellerBrowserArgs(paths.sellerProfileDir);
  const result = {
    browser,
    browserProfile: paths.sellerProfileDir,
    dryRun: options.dryRun ?? false,
    sessionState: paths.sellerStatePath,
    storesCredentials: false,
    url: SELLER_LOGIN_URL,
  };

  if (options.dryRun) {
    yield* printLoginResult(result, options.json);
    return;
  }

  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .makeDirectory(paths.sellerProfileDir, { recursive: true })
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "mkdir", path: paths.sellerProfileDir }),
      ),
    );
  yield* Effect.tryPromise({
    try: () => launchBrowser(browser, args),
    catch: (cause) => SellerBrowserConnectionFailed.make({ cause, target: browser }),
  });
  const port = yield* waitForDevToolsPort(paths.sellerDevToolsPortPath);

  yield* writeJsonArtifact(
    paths.sellerStatePath,
    SellerBrowserState.make({ port, schemaVersion: 1 }),
  );
  yield* printLoginResult(result, options.json);
});

export const listSellerApplications = Effect.fn("listSellerApplications")(function* (
  options: SellerOutputOptions = {},
) {
  const state = yield* readSellerBrowserState();
  const target = `http://127.0.0.1:${state.port}`;
  const result = yield* Effect.tryPromise({
    try: () => readSellerApplications(target),
    catch: (cause) => normalizeSellerError(cause, target),
  });

  if (options.artifact) {
    yield* writeJsonArtifact(options.artifact, result);
  }

  if (options.json) {
    yield* Console.log(yield* jsonForOutput(result, { fields: options.fields }));
    return;
  }

  if (result.applications.length === 0) {
    yield* Console.log("Seller Office applications: none");
    return;
  }

  for (const application of result.applications) {
    yield* Console.log(
      `${application.name} (${application.sellerAppId}) — ${application.status}${application.updatedAt ? ` — ${application.updatedAt}` : ""}`,
    );
  }
});

const resolveSellerBrowser = Effect.fn("resolveSellerBrowser")(function* (env: TaiznEnv) {
  const browser = env.sellerBrowser ?? defaultSellerBrowser();

  if (!isAbsolute(browser)) {
    return browser;
  }

  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs
    .exists(browser)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "exists", path: browser }),
      ),
    );

  if (!exists) {
    return yield* SellerBrowserNotFound.make({ path: browser });
  }

  return browser;
});

const defaultSellerBrowser = () => {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  return "google-chrome";
};

const sellerBrowserArgs = (profileDir: string) => [
  `--user-data-dir=${profileDir}`,
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  SELLER_LOGIN_URL,
];

const launchBrowser = (browser: string, args: readonly string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(browser, args, {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

const waitForDevToolsPort = Effect.fn("waitForDevToolsPort")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));

    if (exists) {
      const source = yield* fs
        .readFileString(path)
        .pipe(
          Effect.mapError((cause) => FileSystemFailure.make({ cause, operation: "read", path })),
        );
      const port = Number(source.split(/\r?\n/u)[0]);

      if (Number.isInteger(port) && port > 0 && port <= 65_535) {
        const available = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
              signal: AbortSignal.timeout(500),
            });
            return response.ok;
          },
          catch: (cause) => cause,
        }).pipe(Effect.orElseSucceed(() => false));

        if (available) {
          return port;
        }
      }
    }

    yield* Effect.sleep("100 millis");
  }

  return yield* SellerBrowserConnectionFailed.make({
    cause: new Error("DevToolsActivePort was not created"),
    target: path,
  });
});

const readSellerBrowserState = Effect.fn("readSellerBrowserState")(function* () {
  const paths = yield* getPaths();
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs
    .exists(paths.sellerStatePath)
    .pipe(
      Effect.mapError((cause) =>
        FileSystemFailure.make({ cause, operation: "exists", path: paths.sellerStatePath }),
      ),
    );

  if (!exists) {
    return yield* SellerSessionNotFound.make({ path: paths.sellerStatePath });
  }

  const json = yield* readJsonFile(paths.sellerStatePath);
  const state = yield* Schema.decodeUnknownEffect(SellerBrowserState)(json, { errors: "all" }).pipe(
    Effect.mapError((error) =>
      SellerPortalProtocolError.make({ details: `invalid seller session state: ${error.message}` }),
    ),
  );

  if (!Number.isInteger(state.port) || state.port < 1 || state.port > 65_535) {
    return yield* SellerPortalProtocolError.make({
      details: `invalid seller browser port: ${state.port}`,
    });
  }

  return state;
});

const readSellerApplications = async (target: string) => {
  const page = await findBrowserPage(target);

  if (!page.webSocketDebuggerUrl) {
    throw SellerPortalProtocolError.make({ details: "browser page has no debugger URL" });
  }

  return await withCdp(page.webSocketDebuggerUrl, async (send) => {
    await send("Page.navigate", { url: SELLER_APPLICATIONS_URL });
    await delay(200);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      let raw: unknown;

      try {
        raw = await send("Runtime.evaluate", {
          expression: SELLER_APPLICATIONS_EXPRESSION,
          returnByValue: true,
        });
      } catch (cause) {
        if (attempt === 49) {
          throw cause;
        }

        await delay(200);
        continue;
      }

      const extraction = decodeSellerExtraction(raw);

      if (extraction.state === "signedOut") {
        throw SellerAuthenticationRequired.make({});
      }

      if (extraction.state === "drift") {
        throw SellerPortalDrift.make({
          details: extraction.details ?? "application list did not match the expected contract",
        });
      }

      if (extraction.state === "ready") {
        return SellerApplicationsResult.make({
          applications: extraction.applications ?? [],
          schemaVersion: 1,
        });
      }

      await delay(200);
    }

    throw SellerPortalDrift.make({ details: "application list did not become ready" });
  });
};

const findBrowserPage = async (target: string) => {
  const response = await fetch(`${target}/json/list`, {
    signal: AbortSignal.timeout(SELLER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DevTools HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  const pages = Schema.decodeUnknownSync(Schema.Array(CdpTarget))(json).filter(
    (candidate) => candidate.type === "page",
  );
  const page =
    pages.find((candidate) => candidate.url.includes("seller.samsungapps.com/tv")) ?? pages[0];

  if (!page) {
    throw SellerPortalProtocolError.make({ details: "browser has no page target" });
  }

  return page;
};

const decodeSellerExtraction = (raw: unknown) => {
  try {
    const evaluated = Schema.decodeUnknownSync(CdpEvaluationResult)(raw);
    return Schema.decodeUnknownSync(SellerExtraction)(evaluated.result.value);
  } catch {
    throw SellerPortalProtocolError.make({
      details: "invalid sanitized application result",
    });
  }
};

const withCdp = <A>(
  url: string,
  use: (send: (method: string, params: unknown) => Promise<unknown>) => Promise<A>,
) =>
  new Promise<A>((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: SELLER_TIMEOUT_MS });
    let nextId = 1;
    let settled = false;
    const rejectPendingRequests = new Set<(cause: unknown) => void>();

    const rejectPending = (cause: unknown) => {
      for (const rejectRequest of rejectPendingRequests) {
        rejectRequest(cause);
      }
    };

    const fail = (cause: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      rejectPending(cause);
      socket.close();
      reject(cause);
    };

    const succeed = (value: A) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.close();
      resolve(value);
    };

    const send = (method: string, params: unknown) => {
      const id = nextId;
      nextId += 1;

      return new Promise<unknown>((resolveRequest, rejectRequest) => {
        let requestSettled = false;
        const cleanup = () => {
          clearTimeout(timeout);
          socket.off("message", onMessage);
          rejectPendingRequests.delete(failRequest);
        };
        const failRequest = (cause: unknown) => {
          if (requestSettled) {
            return;
          }

          requestSettled = true;
          cleanup();
          rejectRequest(cause);
        };
        const succeedRequest = (result: unknown) => {
          if (requestSettled) {
            return;
          }

          requestSettled = true;
          cleanup();
          resolveRequest(result);
        };
        const onMessage = (data: WebSocket.RawData) => {
          try {
            const json: unknown = JSON.parse(data.toString());
            const message = Schema.decodeUnknownSync(CdpMessage)(json);

            if (message.id !== id) {
              return;
            }

            if (message.error) {
              failRequest(
                SellerPortalProtocolError.make({
                  details: `${method}: ${message.error.message}`,
                }),
              );
              return;
            }

            succeedRequest(message.result);
          } catch {
            failRequest(SellerPortalProtocolError.make({ details: "invalid DevTools response" }));
          }
        };
        const timeout = setTimeout(() => {
          const cause = new Error(`DevTools request ${id} did not receive a response`);
          failRequest(
            SellerPortalProtocolError.make({
              cause,
              details: `${method} request ${id} timed out after ${SELLER_TIMEOUT_MS}ms`,
            }),
          );
        }, SELLER_TIMEOUT_MS);

        rejectPendingRequests.add(failRequest);
        socket.on("message", onMessage);
        socket.send(JSON.stringify({ id, method, params }), (cause) => {
          if (cause) {
            failRequest(cause);
          }
        });
      });
    };

    socket.once("open", () => {
      use(send).then(succeed, fail);
    });
    socket.once("error", fail);
    socket.once("close", () => {
      if (!settled) {
        fail(new Error("DevTools websocket closed"));
      }
    });
  });

const normalizeSellerError = (cause: unknown, target: string): SellerError => {
  if (
    cause instanceof SellerAuthenticationRequired ||
    cause instanceof SellerPortalDrift ||
    cause instanceof SellerPortalProtocolError
  ) {
    return cause;
  }

  return SellerBrowserConnectionFailed.make({ cause, target });
};

const printLoginResult = Effect.fn("printLoginResult")(function* (
  result: {
    readonly browser: string;
    readonly browserProfile: string;
    readonly dryRun: boolean;
    readonly sessionState: string;
    readonly storesCredentials: boolean;
    readonly url: string;
  },
  json: boolean | undefined,
) {
  if (json) {
    yield* Console.log(JSON.stringify(result));
    return;
  }

  if (result.dryRun) {
    yield* Console.log(`Seller Office login browser: ${result.browser}`);
    yield* Console.log(`Seller Office browser profile: ${result.browserProfile}`);
    return;
  }

  yield* Console.log("Opened Seller Office in a dedicated local Chrome profile.");
  yield* Console.log(
    "Complete Samsung login in the visible browser, then run `taizn seller apps list`.",
  );
});

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const SELLER_APPLICATIONS_EXPRESSION = String.raw`(() => {
  if (location.pathname.includes("/login")) {
    return { state: "signedOut" };
  }

  if (location.pathname !== "/tv/tizen-application") {
    return { state: "loading" };
  }

  const cards = Array.from(document.querySelectorAll(".appThumb"));
  const headingPresent = Array.from(document.querySelectorAll("h1")).some(
    (heading) => heading.textContent?.trim() === "Applications",
  );

  if (!headingPresent) {
    return { state: "loading" };
  }

  const applications = cards.map((card) => {
    const identity = Array.from(card.querySelectorAll(".appInfo span"))
      .map((element) => element.textContent?.trim() ?? "")
      .filter(Boolean);
    const statusFields = Array.from(card.querySelectorAll(".appStatus span"))
      .map((element) => element.textContent?.trim() ?? "")
      .filter((value) => value !== "" && value !== "|");
    const status = statusFields.find((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value)) ?? "";
    const updatedAt = statusFields.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));

    return {
      name: identity[0] ?? "",
      sellerAppId: identity[1] ?? "",
      status,
      type: card.querySelector(".appType")?.textContent?.trim() ?? "",
      ...(updatedAt ? { updatedAt } : {}),
    };
  });

  if (
    applications.some(
      (application) =>
        application.name === "" ||
        application.sellerAppId === "" ||
        application.status === "" ||
        application.type === "",
    )
  ) {
    return { details: "application card fields are missing", state: "drift" };
  }

  return { applications, state: "ready" };
})()`;
