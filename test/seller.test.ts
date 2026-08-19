import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  SellerAuthenticationRequired,
  SellerBrowserConnectionFailed,
  SellerPortalDrift,
  SellerPortalProtocolError,
  SellerSessionNotFound,
} from "../src/errors.js";
import { TaiznSystem } from "../src/runtime.js";
import {
  decodeSellerExtraction,
  defaultSellerBrowser,
  normalizeSellerError,
  readSellerBrowserState,
  SELLER_APPLICATIONS_EXPRESSION,
  sellerBrowserArgs,
  waitForDevToolsPort,
} from "../src/seller.js";

type FakeElement = { readonly textContent: string | null };

const element = (textContent: string | null): FakeElement => ({ textContent });

type FakeCard = {
  readonly querySelector: (selector: string) => FakeElement | null;
  readonly querySelectorAll: (selector: string) => readonly FakeElement[];
};

const makeCard = (options: {
  readonly identity?: readonly (string | null)[];
  readonly status?: readonly (string | null)[];
  readonly type?: string;
}): FakeCard => ({
  querySelector: (selector) =>
    selector === ".appType" && options.type !== undefined ? element(options.type) : null,
  querySelectorAll: (selector) => {
    if (selector === ".appInfo span") return (options.identity ?? []).map(element);
    if (selector === ".appStatus span") return (options.status ?? []).map(element);
    return [];
  },
});

const evaluateSellerPage = (
  pathname: string,
  options: {
    readonly cards?: readonly FakeCard[];
    readonly headings?: readonly string[];
  } = {},
): unknown =>
  JSON.parse(
    JSON.stringify(
      runInNewContext(SELLER_APPLICATIONS_EXPRESSION, {
        document: {
          querySelectorAll: (selector: string) => {
            if (selector === ".appThumb") return options.cards ?? [];
            if (selector === "h1") return (options.headings ?? []).map(element);
            return [];
          },
        },
        location: { pathname },
      }),
    ),
  );

const systemFor = (dir: string) =>
  Layer.succeed(TaiznSystem)({
    cwd: Effect.succeed(dir),
    env: Effect.succeed({}),
    homeDir: Effect.succeed(dir),
    loadEnvFile: () => Effect.void,
    readSecret: () => Effect.succeed(""),
  });

const sellerStateFixture = (state?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "taizn-seller-state-"));

  if (state !== undefined) {
    mkdirSync(join(dir, ".taizn"), { recursive: true });
    writeFileSync(join(dir, ".taizn/seller.json"), state);
  }

  return dir;
};

const withPlatform = (platform: NodeJS.Platform, use: () => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");

  if (!descriptor) {
    throw new Error("process.platform descriptor not found");
  }

  Object.defineProperty(process, "platform", { configurable: true, value: platform });

  try {
    use();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
};

describe("seller applications extraction", () => {
  it("reports signedOut on the Samsung login path", () => {
    assert.deepStrictEqual(evaluateSellerPage("/tv/login"), { state: "signedOut" });
  });

  it("reports loading away from the applications route", () => {
    assert.deepStrictEqual(evaluateSellerPage("/tv/dashboard"), { state: "loading" });
  });

  it("reports loading until the Applications heading renders", () => {
    const result = evaluateSellerPage("/tv/tizen-application", {
      cards: [makeCard({ identity: ["Example App", "1234567890123"] })],
      headings: ["Membership"],
    });

    assert.deepStrictEqual(result, { state: "loading" });
  });

  it("extracts sanitized application cards", () => {
    const result = evaluateSellerPage("/tv/tizen-application", {
      cards: [
        makeCard({
          identity: [" Example App ", "1234567890123"],
          status: ["For Sale", "|", "2026-01-02"],
          type: "Web",
        }),
        makeCard({
          identity: ["Other App", "9876543210987"],
          status: ["2026-02-03", "|", "Rejected"],
          type: "Web",
        }),
      ],
      headings: [" Applications "],
    });

    assert.deepStrictEqual(result, {
      applications: [
        {
          name: "Example App",
          sellerAppId: "1234567890123",
          status: "For Sale",
          type: "Web",
          updatedAt: "2026-01-02",
        },
        {
          name: "Other App",
          sellerAppId: "9876543210987",
          status: "Rejected",
          type: "Web",
          updatedAt: "2026-02-03",
        },
      ],
      state: "ready",
    });
  });

  it("omits updatedAt when the card has no date field", () => {
    const result = evaluateSellerPage("/tv/tizen-application", {
      cards: [
        makeCard({
          identity: ["Example App", "1234567890123"],
          status: ["Registering"],
          type: "Web",
        }),
      ],
      headings: ["Applications"],
    }) as { readonly applications: readonly Record<string, string>[] };

    assert.notProperty(result.applications[0], "updatedAt");
    assert.strictEqual(result.applications[0]?.status, "Registering");
  });

  it("reports ready with zero applications", () => {
    const result = evaluateSellerPage("/tv/tizen-application", {
      headings: ["Applications"],
    });

    assert.deepStrictEqual(result, { applications: [], state: "ready" });
  });

  it("fails closed as drift when card fields are missing", () => {
    const result = evaluateSellerPage("/tv/tizen-application", {
      cards: [makeCard({ identity: ["Example App"], status: ["For Sale"], type: "Web" })],
      headings: ["Applications"],
    });

    assert.deepStrictEqual(result, {
      details: "application card fields are missing",
      state: "drift",
    });
  });

  it("produces payloads that satisfy the extraction schema", () => {
    const raw = {
      result: {
        value: evaluateSellerPage("/tv/tizen-application", {
          cards: [
            makeCard({
              identity: ["Example App", "1234567890123"],
              status: ["For Sale", "|", "2026-01-02"],
              type: "Web",
            }),
          ],
          headings: ["Applications"],
        }),
      },
    };

    const extraction = decodeSellerExtraction(raw);

    assert.strictEqual(extraction.state, "ready");
    assert.strictEqual(extraction.applications?.length, 1);
    assert.strictEqual(extraction.applications?.[0]?.sellerAppId, "1234567890123");
  });
});

describe("decodeSellerExtraction", () => {
  it("rejects malformed evaluation payloads", () => {
    try {
      decodeSellerExtraction({ nonsense: true });
      assert.fail("expected decodeSellerExtraction to throw");
    } catch (error) {
      assert.instanceOf(error, SellerPortalProtocolError);
      assert.strictEqual(error.details, "invalid sanitized application result");
    }
  });

  it("rejects values outside the extraction contract", () => {
    try {
      decodeSellerExtraction({ result: { value: { state: "exploded" } } });
      assert.fail("expected decodeSellerExtraction to throw");
    } catch (error) {
      assert.instanceOf(error, SellerPortalProtocolError);
    }
  });
});

describe("normalizeSellerError", () => {
  it("passes portal errors through unchanged", () => {
    const authentication = SellerAuthenticationRequired.make({});
    const drift = SellerPortalDrift.make({ details: "layout changed" });
    const protocol = SellerPortalProtocolError.make({ details: "bad response" });

    assert.strictEqual(normalizeSellerError(authentication, "http://127.0.0.1:1"), authentication);
    assert.strictEqual(normalizeSellerError(drift, "http://127.0.0.1:1"), drift);
    assert.strictEqual(normalizeSellerError(protocol, "http://127.0.0.1:1"), protocol);
  });

  it("wraps unknown causes as browser connection failures", () => {
    const cause = new Error("socket hang up");
    const normalized = normalizeSellerError(cause, "http://127.0.0.1:9222");

    assert.instanceOf(normalized, SellerBrowserConnectionFailed);
    assert.strictEqual(normalized.target, "http://127.0.0.1:9222");
    assert.strictEqual((normalized as SellerBrowserConnectionFailed).cause, cause);
  });
});

describe("seller browser launch construction", () => {
  it("builds localhost-only debugging args around the operator profile", () => {
    assert.deepStrictEqual(sellerBrowserArgs("/tmp/profile"), [
      "--user-data-dir=/tmp/profile",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "https://seller.samsungapps.com/tv/",
    ]);
  });

  it("picks the platform default Chrome binary", () => {
    withPlatform("darwin", () => {
      assert.strictEqual(
        defaultSellerBrowser(),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      );
    });
    withPlatform("win32", () => {
      assert.strictEqual(
        defaultSellerBrowser(),
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      );
    });
    withPlatform("linux", () => {
      assert.strictEqual(defaultSellerBrowser(), "google-chrome");
    });
  });
});

describe("readSellerBrowserState", () => {
  it.effect("fails with SellerSessionNotFound before login", () => {
    const dir = sellerStateFixture();

    return readSellerBrowserState().pipe(
      Effect.flip,
      Effect.map((error) => {
        assert.instanceOf(error, SellerSessionNotFound);
        assert.strictEqual((error as SellerSessionNotFound).path, join(dir, ".taizn/seller.json"));
      }),
      Effect.provide(Layer.mergeAll(NodeServices.layer, systemFor(dir))),
    );
  });

  it.effect("fails when the session state misses required fields", () => {
    const dir = sellerStateFixture('{"schemaVersion":1}\n');

    return readSellerBrowserState().pipe(
      Effect.flip,
      Effect.map((error) => {
        assert.instanceOf(error, SellerPortalProtocolError);
        assert.include(
          (error as SellerPortalProtocolError).details,
          "invalid seller session state",
        );
      }),
      Effect.provide(Layer.mergeAll(NodeServices.layer, systemFor(dir))),
    );
  });

  it.effect("rejects out-of-range DevTools ports", () => {
    const dir = sellerStateFixture('{"port":0,"schemaVersion":1}\n');

    return readSellerBrowserState().pipe(
      Effect.flip,
      Effect.map((error) => {
        assert.instanceOf(error, SellerPortalProtocolError);
        assert.strictEqual(
          (error as SellerPortalProtocolError).details,
          "invalid seller browser port: 0",
        );
      }),
      Effect.provide(Layer.mergeAll(NodeServices.layer, systemFor(dir))),
    );
  });

  it.effect("rejects fractional DevTools ports", () => {
    const dir = sellerStateFixture('{"port":9222.5,"schemaVersion":1}\n');

    return readSellerBrowserState().pipe(
      Effect.flip,
      Effect.map((error) => {
        assert.instanceOf(error, SellerPortalProtocolError);
        assert.strictEqual(
          (error as SellerPortalProtocolError).details,
          "invalid seller browser port: 9222.5",
        );
      }),
      Effect.provide(Layer.mergeAll(NodeServices.layer, systemFor(dir))),
    );
  });

  it.effect("returns the stored DevTools port", () => {
    const dir = sellerStateFixture('{"port":9222,"schemaVersion":1}\n');

    return readSellerBrowserState().pipe(
      Effect.map((state) => {
        assert.strictEqual(state.port, 9222);
        assert.strictEqual(state.schemaVersion, 1);
      }),
      Effect.provide(Layer.mergeAll(NodeServices.layer, systemFor(dir))),
    );
  });
});

describe("waitForDevToolsPort", () => {
  it("resolves once the port file names a live DevTools endpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-devtools-port-"));
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ Browser: "Fixture/1.0" }));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.listen(0, "127.0.0.1");
        server.once("listening", () => resolve());
        server.once("error", reject);
      });
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected TCP HTTP test server address.");
      }

      const portPath = join(dir, "DevToolsActivePort");
      writeFileSync(portPath, `${address.port}\n/devtools/browser/fixture\n`);

      const port = await Effect.runPromise(
        waitForDevToolsPort(portPath).pipe(Effect.provide(NodeServices.layer)),
      );

      assert.strictEqual(port, address.port);
    } finally {
      server.close();
    }
  });
});
