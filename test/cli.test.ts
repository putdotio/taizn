import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { WebSocketServer } from "ws";
import { fetchSamsungTvInfo } from "../src/remote.js";
import { appBuildEnv, redactCommandArgs, TaiznSystem } from "../src/runtime.js";

const cliPath = resolve("dist/taizn.mjs");

const runTaizn = (args: string[], cwd = process.cwd(), env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

const runTaiznAsync = (args: string[], cwd = process.cwd(), env: NodeJS.ProcessEnv = {}) =>
  new Promise<{ readonly status: number | null; readonly stderr: string; readonly stdout: string }>(
    (resolve) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd,
        env: {
          ...process.env,
          ...env,
        },
      });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("close", (status) => {
        resolve({ status, stderr, stdout });
      });
    },
  );

describe("taizn cli", () => {
  it("prints help without a project config", () => {
    const result = runTaizn(["--help"]);

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "COMMANDS");
    assert.include(result.stdout, "apps");
    assert.include(result.stdout, "check");
    assert.include(result.stdout, "package");
    assert.include(result.stdout, "run");
    assert.include(result.stdout, "tv");
    assert.strictEqual(result.stderr, "");
  });

  it("prints the package version", () => {
    const result = runTaizn(["--version"]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout.trim(), /^taizn v\d+\.\d+\.\d+/);
    assert.strictEqual(result.stderr, "");
  });

  it("reports missing config without a stack trace", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-missing-config-"));
    const result = runTaizn(["package"], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Config file not found:");
    assert.notInclude(result.stderr, "Error:");
  });

  it("checks tooling without requiring a project config", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-check-"));
    const result = spawnSync(process.execPath, [cliPath, "check"], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        TAIZN_SDB: "/bin/echo",
        TAIZN_TIZEN_CLI: "/bin/echo",
      },
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "Tizen CLI: /bin/echo");
    assert.include(result.stdout, "sdb: /bin/echo");
    assert.include(result.stdout, "connected targets: none");
    assert.strictEqual(result.stderr, "");
  });

  it("lists installed Tizen applications without requiring a project config", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["apps", "put"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, 'Installed Tizen applications matching "put"');
    assert.include(result.stdout, "- put.io (Example.app)");
    assert.notInclude(result.stdout, "Other App");
  });

  it("reports schema errors with config paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-config-"));
    writeFileSync(join(dir, "taizn.json"), '{"build":{"command":[]}}\n');

    const result = runTaizn(["package"], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Invalid taizn.json:");
    assert.include(result.stderr, "command");
    assert.include(result.stderr, "widget");
    assert.notInclude(result.stderr, "ParseError");
  });

  it.effect("keeps consumer build env free of taizn and tizen variables", () =>
    appBuildEnv().pipe(
      Effect.provideService(TaiznSystem, {
        cwd: Effect.succeed(process.cwd()),
        env: Effect.succeed({
          DYLD_INSERT_LIBRARIES: "bad-preload",
          PATH: "/bin",
          SDB: "leaky-sdb",
          TAIZN_TARGET: "1.2.3.4:26101",
          TIZEN_PROFILE: "leaky-profile",
        }),
        homeDir: Effect.succeed("/Users/tester"),
        loadEnvFile: () => Effect.void,
        readSecret: () => Effect.succeed("secret"),
      }),
      Effect.map((env) => {
        assert.strictEqual(env.PATH, "/bin");
        assert.notProperty(env, "DYLD_INSERT_LIBRARIES");
        assert.notProperty(env, "SDB");
        assert.notProperty(env, "TAIZN_TARGET");
        assert.notProperty(env, "TIZEN_PROFILE");
      }),
    ),
  );

  it("redacts Tizen password command arguments", () => {
    assert.deepEqual(redactCommandArgs(["-p", "author", "-dp", "dist"]), [
      "-p",
      "[redacted]",
      "-dp",
      "[redacted]",
    ]);
  });

  it("rejects partial Samsung TV remote ports", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-port-"));
    const result = runTaizn(["tv", "info"], dir, {
      TAIZN_TV_HOST: "127.0.0.1",
      TAIZN_TV_PORT: "8002abc",
    });

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Invalid TAIZN environment:");
    assert.include(result.stderr, "TAIZN_TV_PORT must be an integer between 1 and 65535");
  });

  it("lets Samsung TV env overrides bypass malformed remote state", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-remote-invalid-"));
    mkdirSync(join(dir, ".taizn"), { recursive: true });
    writeFileSync(join(dir, ".taizn/remote.json"), "{bad\n");

    const result = runTaizn(["tv", "pair"], dir, {
      TAIZN_TV_HOST: "127.0.0.1",
      TAIZN_TV_PORT: "9",
      TAIZN_TV_PROTOCOL: "ws",
    });

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Samsung TV remote connection failed");
    assert.notInclude(result.stderr, "Invalid");
  });

  it("reads Samsung TV info from a configured info port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-info-port-"));
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          device: {
            TokenAuthSupport: "true",
            developerIP: "127.0.0.1",
            developerMode: "1",
            ip: "127.0.0.1",
            modelName: "Fixture TV",
          },
          isSupport: JSON.stringify({ remote_available: "true" }),
          name: "Fixture",
          remote: "1.0",
        }),
      );
    });

    try {
      await waitForHttpServer(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected TCP HTTP test server address.");
      }

      const result = await runTaiznAsync(["tv", "info"], dir, {
        TAIZN_TV_HOST: "127.0.0.1",
        TAIZN_TV_INFO_PORT: String(address.port),
      });

      assert.strictEqual(result.status, 0);
      assert.include(result.stdout, "Samsung TV: Fixture");
      assert.include(result.stdout, "model: Fixture TV");
    } finally {
      server.close();
    }
  });

  it("times out stalled Samsung TV info requests", async () => {
    const server = createServer((_request, _response) => {
      // Keep the request open to exercise the AbortSignal timeout path.
    });

    try {
      await waitForHttpServer(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected TCP HTTP test server address.");
      }

      let error: unknown;

      try {
        await Effect.runPromise(
          fetchSamsungTvInfo("127.0.0.1", {
            port: address.port,
            timeoutMs: 10,
          }),
        );
      } catch (cause) {
        error = cause;
      }

      assert.include(String(error), "Timed out waiting for Samsung TV remote response");
    } finally {
      server.close();
    }
  });

  it("pairs and sends Samsung TV remote keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-remote-"));
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    const receivedKeys: string[] = [];
    const requestUrls: string[] = [];

    await waitForServer(server);

    const address = server.address();

    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Expected TCP websocket test server address.");
    }

    server.on("connection", (socket, request) => {
      requestUrls.push(request.url ?? "");
      socket.send(
        JSON.stringify({
          data: {
            clients: [
              {
                attributes: { token: "other-token" },
                id: "other-client",
                isHost: false,
              },
              {
                attributes: { token: "test-token" },
                id: "test-client",
                isHost: false,
              },
            ],
            id: "test-client",
          },
          event: "ms.channel.connect",
        }),
      );
      socket.on("message", (data) => {
        receivedKeys.push(data.toString());
      });
    });

    try {
      mkdirSync(join(dir, ".taizn"), { recursive: true });
      writeFileSync(
        join(dir, ".taizn/remote.json"),
        `${JSON.stringify(
          {
            host: "127.0.0.1",
            name: "stale-name",
            port: address.port,
            protocol: "ws",
            token: "stale-token",
          },
          null,
          2,
        )}\n`,
      );

      const pair = await runTaiznAsync(["tv", "pair"], dir);

      assert.strictEqual(pair.status, 0);
      assert.include(pair.stdout, "TAIZN_TV_TOKEN=test-token");
      assert.notInclude(requestUrls[0] ?? "", "token=stale-token");
      assert.include(readFileSync(join(dir, ".taizn/remote.json"), "utf8"), "test-token");

      const press = await runTaiznAsync(
        ["tv", "press", "--delay-ms", "1", "KEY_UP", "KEY_ENTER"],
        dir,
      );

      assert.strictEqual(press.status, 0);
      assert.include(press.stdout, "Sent Samsung TV remote keys: KEY_UP, KEY_ENTER");
      assert.lengthOf(receivedKeys, 2);
      assert.include(receivedKeys[0] ?? "", '"DataOfCmd":"KEY_UP"');
      assert.include(receivedKeys[1] ?? "", '"DataOfCmd":"KEY_ENTER"');
    } finally {
      server.close();
    }
  });

  it("runs the configured widget variant on the target", () => {
    const dir = createPackageFixture();
    const result = runTaizn(["run"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "Launched Example.app");
    assert.include(readFileSync(join(dir, "run-args.json"), "utf8"), '"Example.app"');
    assert.include(readFileSync(join(dir, "run-args.json"), "utf8"), '"-s"');
    assert.include(readFileSync(join(dir, "run-args.json"), "utf8"), '"127.0.0.1:26101"');
  });

  it("uses variant widget overrides when staging the package", () => {
    const dir = createPackageFixture();

    const development = runTaizn(["package"], dir, {
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(development.status, 0);
    assert.include(
      readFileSync(join(dir, ".taizn/build/stage/index.html"), "utf8"),
      'src="./js/main.js"',
    );
    assert.include(
      readFileSync(join(dir, ".taizn/build/stage/index.html"), "utf8"),
      'href="./css/main.css"',
    );

    const production = runTaizn(["package"], dir, {
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(production.status, 0);

    const stagedHtml = readFileSync(join(dir, ".taizn/build/stage/index.html"), "utf8");

    assert.include(stagedHtml, 'src="https://tv.put.io/js/main.js"');
    assert.include(stagedHtml, 'href="https://tv.put.io/css/main.css"');
    assert.notInclude(stagedHtml, 'src="./js/main.js"');
    assert.throws(() => readFileSync(join(dir, ".taizn/build/stage/css/main.css.map")));
    assert.throws(() => readFileSync(join(dir, ".taizn/build/stage/js/main.js.map")));
  });
});

const createPackageFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "taizn-package-config-"));

  mkdirSync(join(dir, "platforms/tizen/icons"), { recursive: true });

  writeFileSync(
    join(dir, "build.mjs"),
    `
      import { mkdirSync, writeFileSync } from "node:fs";
      mkdirSync("dist/css", { recursive: true });
      mkdirSync("dist/js", { recursive: true });
      writeFileSync("dist/css/main.css", "body {}");
      writeFileSync("dist/css/main.css.map", "{}");
      writeFileSync("dist/js/main.js", "console.log('dev')");
      writeFileSync("dist/js/main.js.map", "{}");
      writeFileSync("dist/index.html", '<html><head><link href="/css/main.css" rel="stylesheet"><script defer src="/js/main.js"></script></head><body></body></html>');
    `,
  );

  writeFileSync(
    join(dir, "fake-tizen.mjs"),
    `#!/usr/bin/env node
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      if (process.argv[2] === "run") {
        writeFileSync("run-args.json", JSON.stringify(process.argv.slice(2)));
        process.exit(0);
      }
      const output = process.argv[process.argv.indexOf("-o") + 1];
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "signed.wgt"), "signed");
    `,
  );
  chmodSync(join(dir, "fake-tizen.mjs"), 0o755);
  writeFakeSdb(dir);

  writeFileSync(
    join(dir, "platforms/tizen/config.xml"),
    '<widget><tizen:application id="Old.app" package="Old"/><name>Old</name></widget>',
  );
  writeFileSync(join(dir, "platforms/tizen/icons/dev.png"), "dev");
  writeFileSync(join(dir, "platforms/tizen/icon.png"), "prod");
  writeFileSync(
    join(dir, "platforms/tizen/hosted.html"),
    '<html><head><link href="https://tv.put.io/css/main.css" rel="stylesheet"><script src="$WEBAPIS/webapis/webapis.js"></script><script defer src="https://tv.put.io/js/main.js"></script></head><body></body></html>',
  );
  writeFileSync(
    join(dir, "taizn.json"),
    JSON.stringify(
      {
        build: {
          command: [process.execPath, "build.mjs"],
          output: "dist",
          requiredFiles: ["css/main.css", "js/main.js"],
        },
        signing: {
          certificateDir: ".taizn/certificates",
          profile: "test-profile",
        },
        widget: {
          configXml: "platforms/tizen/config.xml",
          excludeFiles: ["css/main.css.map"],
          indexHtml: "dist/index.html",
          injectWebapis: true,
          rewriteAssetUrls: true,
          variants: {
            development: {
              applicationId: "ExampleDev.app",
              bundleName: "example-dev",
              icon: "platforms/tizen/icons/dev.png",
              name: "Example Dev",
              packageId: "ExampleDev",
            },
            production: {
              applicationId: "Example.app",
              bundleName: "example",
              excludeFiles: ["js/main.js.map"],
              icon: "platforms/tizen/icon.png",
              indexHtml: "platforms/tizen/hosted.html",
              injectWebapis: false,
              name: "Example",
              packageId: "Example",
              rewriteAssetUrls: false,
            },
          },
        },
      },
      null,
      2,
    ),
  );

  return dir;
};

const createToolingFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "taizn-tooling-config-"));
  writeFakeSdb(dir);
  return dir;
};

const writeFakeSdb = (dir: string) => {
  writeFileSync(
    join(dir, "fake-sdb.mjs"),
    `#!/usr/bin/env node
      const args = process.argv.slice(2);
      if (args[0] === "devices") {
        console.log("List of devices attached");
        console.log("127.0.0.1:26101\\tdevice\\tExampleTV");
        process.exit(0);
      }
      if (args[0] === "-s" && args[2] === "shell" && args[3] === "0" && args[4] === "applist") {
        console.log("\\tApplication List for user 5001");
        console.log("\\t Name \\t AppID ");
        console.log("\\t=================================================");
        console.log("\\t'put.io'\\t 'Example.app'");
        console.log("\\t'Other App'\\t 'Other.app'");
        process.exit(0);
      }
      process.exit(0);
    `,
  );
  chmodSync(join(dir, "fake-sdb.mjs"), 0o755);
};

const waitForServer = (server: WebSocketServer) =>
  new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

const waitForHttpServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1");
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
