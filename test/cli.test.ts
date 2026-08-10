import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, vi } from "@effect/vitest";
import { Effect, Fiber, Layer, Schema } from "effect";
import { WebSocketServer } from "ws";
import { probeAssetUrls } from "../src/assets.js";
import { TaiznEnv } from "../src/env.js";
import { fetchSamsungTvInfo, sendSamsungTvKeys } from "../src/remote.js";
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
    assert.include(result.stdout, "launch");
    assert.include(result.stdout, "package");
    assert.include(result.stdout, "prepare");
    assert.include(result.stdout, "prove");
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

  it("describes the agent-facing command surface as JSON", () => {
    const result = runTaizn(["describe"]);

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const rawDescribed = JSON.parse(result.stdout);
    assert.deepStrictEqual(Object.keys(rawDescribed).sort(), ["commands", "name", "schemaVersion"]);
    const described = parseDescribeJson(result.stdout);
    assert.strictEqual(described.name, "taizn");
    assert.strictEqual(described.schemaVersion, 2);
    assert.isTrue(described.commands.some((command) => command.command === "prove"));
    assert.isTrue(described.commands.some((command) => command.command === "probe hosted-assets"));
    assert.isTrue(described.commands.some((command) => command.command === "prepare submission"));
    assert.isFalse(described.commands.some((command) => command.command === "targets"));
    assert.isFalse(described.commands.some((command) => command.command === "tv"));
    assert.isTrue(described.commands.some((command) => command.command === "targets list"));
    assert.isTrue(described.commands.some((command) => command.command === "tv press"));
    for (const command of ["launch", "profile", "package", "install", "run"]) {
      assert.isTrue(
        described.commands.some((describedCommand) => describedCommand.command === command),
      );
    }
    const tvPair = described.commands.find((command) => command.command === "tv pair");
    assert.deepStrictEqual(tvPair?.flags, ["--dry-run"]);
    const tvPress = described.commands.find((command) => command.command === "tv press");
    assert.include(tvPress?.flags ?? [], "--delay-ms <ms>");
    const tvScript = described.commands.find((command) => command.command === "tv script");
    assert.isFalse(tvScript?.fieldMask);
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

  it("checks tooling and connected targets as JSON", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["check", "--json"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const check = parseCheckJson(result.stdout);
    assert.deepStrictEqual(check, {
      configuredTarget: "127.0.0.1:26101",
      targets: [{ id: "127.0.0.1:26101", label: "ExampleTV", state: "device" }],
      tools: {
        sdb: join(dir, "fake-sdb.mjs"),
        tizenCli: join(dir, "fake-tizen.mjs"),
      },
    });
  });

  it("lists installed Tizen applications without requiring a project config", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["apps", "example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, 'Installed Tizen applications matching "example"');
    assert.include(result.stdout, "- Example App (Example.app)");
    assert.notInclude(result.stdout, "Other App");
  });

  it("lists installed Tizen applications as JSON", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["apps", "--json", "example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const inventory = parseApplicationsJson(result.stdout);
    assert.deepStrictEqual(inventory, {
      applications: [{ id: "Example.app", name: "Example App" }],
      query: "example",
      target: "127.0.0.1:26101",
    });
  });

  it("applies field masks to structured read output", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["apps", "--json", "--fields", "target", "example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.deepStrictEqual(JSON.parse(result.stdout), { target: "127.0.0.1:26101" });
  });

  it("applies field masks through array entries", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["apps", "--json", "--fields", "applications.0.id", "example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      applications: { 0: { id: "Example.app" } },
    });
  });

  it("prints only JSON for installed applications when auto-picking one target", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["apps", "--json"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const inventory = parseApplicationsJson(result.stdout);
    assert.deepStrictEqual(inventory.applications, [
      { id: "Example.app", name: "Example App" },
      { id: "Other.app", name: "Other App" },
    ]);
    assert.strictEqual(inventory.target, "127.0.0.1:26101");
  });

  it("launches an installed Tizen application without requiring a project config", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["launch", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "fake-tizen run -p Example.app -s 127.0.0.1:26101");
    assert.include(result.stdout, "Launched Example App (Example.app) on 127.0.0.1:26101");
  });

  it("rejects ambiguous installed application launch queries", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["launch", "app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, 'Multiple installed Tizen applications matched "app"');
    assert.notInclude(result.stderr, "Error:");
  });

  it("proves an installed Tizen application without requiring a project config", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["prove", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "Tizen target: 127.0.0.1:26101");
    assert.include(result.stdout, "Installed application: Example App (Example.app)");
    assert.include(result.stdout, "fake-tizen run -p Example.app -s 127.0.0.1:26101");
    assert.include(result.stdout, "Launch proof: Example.app started on 127.0.0.1:26101");
  });

  it("prints structured proof as JSON", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["prove", "--json", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const proof = parseProofJson(result.stdout);
    assert.deepStrictEqual(proof.application, { id: "Example.app", name: "Example App" });
    assert.strictEqual(proof.launch.started, true);
    assert.include(proof.launch.output, "fake-tizen run -p Example.app -s 127.0.0.1:26101");
    assert.strictEqual(proof.target, "127.0.0.1:26101");
  });

  it("does not claim dry-run proofs launched the app", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["prove", "--dry-run", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "Launch proof dry-run");
    assert.notInclude(result.stdout, "started on");
  });

  it("returns structured errors in JSON mode", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["prove", "--json", "../Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, "");
    assert.deepStrictEqual(JSON.parse(result.stderr), {
      error: {
        message: "Invalid application query: path traversal segments are not allowed",
        type: "InvalidInput",
      },
      ok: false,
    });
  });

  it("returns structured CLI parse errors in JSON mode", () => {
    const result = runTaizn(["prove", "--json"]);

    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, "");
    assert.deepStrictEqual(JSON.parse(result.stderr), {
      error: {
        message: "Missing required argument: query",
        type: "ShowHelp",
      },
      ok: false,
    });
  });

  it("writes proof artifacts inside the app directory", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["prove", "--artifact", ".taizn/proof.json", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    const proof = parseProofJson(readFileSync(join(dir, ".taizn/proof.json"), "utf8"));
    assert.strictEqual(proof.application.id, "Example.app");
  });

  it("rejects proof artifact paths outside the app directory", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["prove", "--artifact", "../proof.json", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "output path must stay inside the app directory");
  });

  it("prints only JSON for structured proof when auto-picking one target", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["prove", "--json", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const proof = parseProofJson(result.stdout);
    assert.deepStrictEqual(proof.application, { id: "Example.app", name: "Example App" });
    assert.strictEqual(proof.target, "127.0.0.1:26101");
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

  it("reads Samsung TV info as JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-info-json-"));
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
          name: "Fixture &amp; TV",
          remote: "1.0",
          type: "Samsung SmartTV",
          uri: "http://127.0.0.1/api/v2/",
        }),
      );
    });

    try {
      await waitForHttpServer(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected TCP HTTP test server address.");
      }

      const result = await runTaiznAsync(["tv", "info", "--json"], dir, {
        TAIZN_TV_HOST: "127.0.0.1",
        TAIZN_TV_INFO_PORT: String(address.port),
      });

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stderr, "");
      const info = parseTvInfoJson(result.stdout);
      assert.deepStrictEqual(info, {
        developer: {
          enabled: true,
          ip: "127.0.0.1",
          mode: "1",
        },
        host: "127.0.0.1",
        infoPort: address.port,
        ip: "127.0.0.1",
        model: "Fixture TV",
        name: "Fixture & TV",
        remote: "1.0",
        remoteAvailable: true,
        tokenAuth: true,
        type: "Samsung SmartTV",
        uri: "http://127.0.0.1/api/v2/",
      });
    } finally {
      server.close();
    }
  });

  it("diagnoses Samsung TV remote state as JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-doctor-json-"));
    const infoServer = createServer((_request, response) => {
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
          name: "Fixture &amp; TV",
          remote: "1.0",
          type: "Samsung SmartTV",
          uri: "http://127.0.0.1/api/v2/",
        }),
      );
    });
    const requestUrls: string[] = [];

    await waitForHttpServer(infoServer);
    const remoteServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await waitForServer(remoteServer);

    const infoAddress = infoServer.address();
    const remoteAddress = remoteServer.address();

    if (!infoAddress || typeof infoAddress === "string") {
      infoServer.close();
      remoteServer.close();
      throw new Error("Expected TCP HTTP test server address.");
    }

    if (!remoteAddress || typeof remoteAddress === "string") {
      infoServer.close();
      remoteServer.close();
      throw new Error("Expected TCP websocket test server address.");
    }

    remoteServer.on("connection", (socket, request) => {
      requestUrls.push(request.url ?? "");
      socket.send(
        JSON.stringify({
          data: {
            id: "test-client",
          },
          event: "ms.channel.connect",
        }),
      );
    });

    try {
      mkdirSync(join(dir, ".taizn"), { recursive: true });
      writeFileSync(
        join(dir, ".taizn/remote.json"),
        `${JSON.stringify(
          {
            host: "127.0.0.1",
            name: "fixture",
            port: remoteAddress.port,
            protocol: "ws",
            token: "fixture-token",
          },
          null,
          2,
        )}\n`,
      );

      const result = await runTaiznAsync(["tv", "doctor", "--connect", "--json"], dir, {
        TAIZN_TV_HOST: "127.0.0.1",
        TAIZN_TV_INFO_PORT: String(infoAddress.port),
      });

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stderr, "");
      assert.notInclude(result.stdout, "fixture-token");
      assert.include(requestUrls[0] ?? "", "token=fixture-token");
      assert.deepStrictEqual(parseTvDoctorJson(result.stdout), {
        host: "127.0.0.1",
        hostSource: "env",
        info: {
          developer: {
            enabled: true,
            ip: "127.0.0.1",
            mode: "1",
          },
          ip: "127.0.0.1",
          model: "Fixture TV",
          name: "Fixture & TV",
          ok: true,
          port: infoAddress.port,
          remote: "1.0",
          remoteAvailable: true,
          tokenAuth: true,
          type: "Samsung SmartTV",
          uri: "http://127.0.0.1/api/v2/",
        },
        remote: {
          connection: {
            ok: true,
            tested: true,
            tokenReturned: true,
          },
          name: "fixture",
          port: remoteAddress.port,
          protocol: "ws",
          target: `ws://127.0.0.1:${remoteAddress.port}`,
          timeoutMs: 30000,
          tokenConfigured: true,
          tokenSource: "state",
        },
        state: {
          host: "127.0.0.1",
          name: "fixture",
          path: join(realpathSync(dir), ".taizn/remote.json"),
          port: remoteAddress.port,
          protocol: "ws",
          status: "valid",
          tokenConfigured: true,
        },
      });
    } finally {
      infoServer.close();
      remoteServer.close();
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

      const jsonPress = await runTaiznAsync(["tv", "press", "--json", "KEY_LEFT"], dir);

      assert.strictEqual(jsonPress.status, 0);
      assert.strictEqual(jsonPress.stderr, "");
      assert.deepStrictEqual(parseTvPressJson(jsonPress.stdout), {
        delayMs: 250,
        keyCount: 1,
        keys: ["KEY_LEFT"],
        target: {
          host: "127.0.0.1",
          port: address.port,
          protocol: "ws",
          url: `ws://127.0.0.1:${address.port}`,
        },
      });
      assert.lengthOf(receivedKeys, 3);
      assert.include(receivedKeys[2] ?? "", '"DataOfCmd":"KEY_LEFT"');

      writeFileSync(
        join(dir, "keys.json"),
        JSON.stringify({ delayMs: 1, steps: [{ keys: ["KEY_DOWN", "KEY_ENTER"] }] }),
      );
      const script = await runTaiznAsync(["tv", "script", "--json", "--file", "keys.json"], dir);

      assert.strictEqual(script.status, 0);
      assert.strictEqual(script.stderr, "");
      assert.strictEqual(parseTvScriptJson(script.stdout).keyCount, 2);
      assert.lengthOf(receivedKeys, 5);
      assert.include(receivedKeys[3] ?? "", '"DataOfCmd":"KEY_DOWN"');
      assert.include(receivedKeys[4] ?? "", '"DataOfCmd":"KEY_ENTER"');
    } finally {
      server.close();
    }
  });

  it("closes Samsung TV remote sockets when the Effect is interrupted", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await waitForServer(server);

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Expected TCP websocket test server address.");
    }

    const connected = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    server.once("connection", (socket) => {
      connected.resolve();
      socket.once("close", () => closed.resolve());
    });

    const env = TaiznEnv.make({
      tvHost: "127.0.0.1",
      tvPort: address.port,
      tvProtocol: "ws",
      tvTimeoutMs: 30_000,
      tvToken: "test-token",
      variant: "development",
    });
    const fiber = Effect.runFork(
      sendSamsungTvKeys(env, ["KEY_ENTER"]).pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, TaiznSystem.Live)),
      ),
    );

    try {
      await connected.promise;
      await Effect.runPromise(Fiber.interrupt(fiber));
      await Promise.race([
        closed.promise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("Interrupted websocket did not close")), 1_000),
        ),
      ]);
      assert.strictEqual(server.clients.size, 0);
    } finally {
      server.close();
    }
  });

  it("dry-runs Samsung TV remote scripts from JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-script-"));
    writeFileSync(
      join(dir, "keys.json"),
      JSON.stringify({ delayMs: 1, steps: [{ keys: ["KEY_UP", "KEY_ENTER"] }] }),
    );

    const result = runTaizn(["tv", "script", "--dry-run", "--json", "--file", "keys.json"], dir);

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const script = parseTvScriptJson(result.stdout);
    assert.strictEqual(script.dryRun, true);
    assert.strictEqual(script.keyCount, 2);
  });

  it("dry-runs Samsung TV remote keys without a paired token", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-press-dry-run-"));
    const result = runTaizn(["tv", "press", "--dry-run", "--json", "KEY_HOME"], dir, {
      TAIZN_TV_HOST: "127.0.0.1",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const press = JSON.parse(result.stdout);
    assert.strictEqual(press.dryRun, true);
    assert.strictEqual(press.keyCount, 1);
    assert.deepStrictEqual(press.keys, ["KEY_HOME"]);
    assert.strictEqual(press.target.url, "wss://127.0.0.1:8002");
  });

  it("dry-runs mutating package and run commands", () => {
    const dir = createPackageFixture();
    const packageResult = runTaizn(["package", "--dry-run"], dir, {
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });
    const runResult = runTaizn(["run", "--dry-run"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(packageResult.status, 0);
    assert.strictEqual(JSON.parse(packageResult.stdout).dryRun, true);
    assert.strictEqual(runResult.status, 0);
    assert.strictEqual(JSON.parse(runResult.stdout).dryRun, true);
  });

  it("keeps dry-run launch JSON quiet when auto-picking one target", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["launch", "--dry-run", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(JSON.parse(result.stdout).target, "127.0.0.1:26101");
  });

  it("captures target logs as JSON", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["logs", "capture", "--json", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const logs = parseLogsJson(result.stdout);
    assert.strictEqual(logs.lineCount, 1);
    assert.include(logs.lines[0] ?? "", "Example");
  });

  it("connects configured targets before log capture", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["logs", "capture", "--json", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "192.0.2.10:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(parseLogsJson(result.stdout).target, "192.0.2.10:26101");
  });

  it("honors explicit JSON log output mode", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["logs", "capture", "--output", "json", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(parseLogsJson(result.stdout).lineCount, 1);
  });

  it("captures target logs as text by default", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["logs", "capture", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.include(result.stdout, "Captured 1 log lines from 127.0.0.1:26101");
  });

  it("formats output=json errors as structured JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-json-error-"));
    const result = runTaizn(["logs", "capture", "--output=json"], dir, {
      TAIZN_SDB: "/bin/echo",
      TAIZN_TARGET: "",
    });

    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, "");
    assert.deepStrictEqual(JSON.parse(result.stderr), {
      error: {
        message: "No Tizen target is connected. Set TAIZN_TARGET or connect exactly one device.",
        type: "MissingTizenTarget",
      },
      ok: false,
    });
  });

  it("formats output ndjson errors as structured JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-ndjson-error-"));
    const result = runTaizn(["logs", "capture", "--output", "ndjson"], dir, {
      TAIZN_SDB: "/bin/echo",
      TAIZN_TARGET: "",
    });

    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, "");
    assert.deepStrictEqual(JSON.parse(result.stderr), {
      error: {
        message: "No Tizen target is connected. Set TAIZN_TARGET or connect exactly one device.",
        type: "MissingTizenTarget",
      },
      ok: false,
    });
  });

  it("honors target log capture duration", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["logs", "capture", "--json", "--duration-ms", "500"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const logs = parseLogsJson(result.stdout);
    assert.isAtLeast(logs.lineCount, 1);
    assert.include(logs.lines[0] ?? "", "streamed");
  });

  it("cleans up bounded log capture after a spawn error", () => {
    const dir = createToolingFixture();
    const brokenSdb = join(dir, "non-executable-sdb");
    writeFileSync(brokenSdb, "not executable\n");
    const startedAt = Date.now();
    const result = runTaizn(["logs", "capture", "--json", "--duration-ms", "10000"], dir, {
      TAIZN_SDB: brokenSdb,
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Command failed");
    assert.isBelow(Date.now() - startedAt, 2_000);
  });

  it("streams target logs as NDJSON", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["logs", "capture", "--output", "ndjson", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.lengthOf(lines, 1);
    assert.include(lines[0].line, "Example");
  });

  it("keeps NDJSON logs quiet when auto-picking one target", () => {
    const dir = createToolingFixture();
    const result = runTaizn(["logs", "capture", "--output", "ndjson", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.lengthOf(lines, 1);
    assert.include(lines[0].line, "Example");
  });

  it("rejects invalid log output mode before resolving device tooling", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-log-output-"));
    const result = runTaizn(["logs", "capture", "--output", "yaml"], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Invalid logs output");
    assert.notInclude(result.stderr, "sdb not found");
  });

  it("lists connected and aliased targets as JSON", () => {
    const dir = createToolingFixture();
    mkdirSync(join(dir, ".taizn"), { recursive: true });
    writeFileSync(
      join(dir, ".taizn/targets.json"),
      JSON.stringify({ targets: [{ alias: "living-room", target: "127.0.0.1:26101" }] }),
    );

    const result = runTaizn(["targets", "list", "--json"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const targets = parseTargetsJson(result.stdout);
    assert.strictEqual(targets.aliases[0]?.alias, "living-room");
    assert.strictEqual(targets.connected[0]?.id, "127.0.0.1:26101");
  });

  it("dry-runs configured hosted asset probes", () => {
    const dir = createPackageFixture();
    const result = runTaizn(["probe", "hosted-assets", "--dry-run", "--json"], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const probe = parseProbeJson(result.stdout);
    assert.deepStrictEqual(probe.urls, [
      "https://example.com/assets/main.css",
      "https://example.com/assets/main.js",
    ]);
  });

  it("validates hosted asset URLs during dry-run", () => {
    const dir = createPackageFixture();
    const result = runTaizn(["probe", "hosted-assets", "--dry-run", "--json", "not-a-url"], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Invalid asset URL");
  });

  it("fails hosted asset probes when any fetch fails", async () => {
    const dir = createPackageFixture();
    const server = createServer((_request, response) => {
      response.writeHead(404);
      response.end("missing");
    });

    try {
      await waitForHttpServer(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected TCP HTTP test server address.");
      }

      const result = await runTaiznAsync(
        ["probe", "hosted-assets", "--json", `http://127.0.0.1:${address.port}/missing.js`],
        dir,
      );

      assert.strictEqual(result.status, 1);
      const probe = JSON.parse(result.stdout);
      assert.strictEqual(probe.probes[0]?.ok, false);
      assert.include(result.stderr, "hosted asset probe");
    } finally {
      server.close();
    }
  });

  it("closes successful hosted asset response bodies", async () => {
    let resolveClosed: (() => void) | undefined;
    const responseClosed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const server = createServer((_request, response) => {
      response.once("close", () => resolveClosed?.());
      response.writeHead(200, { "content-type": "application/javascript" });
      response.write("export const ready = true;\n");
    });

    try {
      await waitForHttpServer(server);
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected TCP HTTP test server address.");
      }

      const probes = await Effect.runPromise(
        probeAssetUrls([`http://127.0.0.1:${address.port}/stream.js`]),
      );
      assert.deepStrictEqual(probes, [
        {
          ok: true,
          status: 200,
          type: "script",
          url: `http://127.0.0.1:${address.port}/stream.js`,
        },
      ]);

      await Promise.race([
        responseClosed,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("Expected asset response body to close.")), 1_000);
        }),
      ]);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("preserves successful probes when response cleanup fails", async () => {
    const body = new ReadableStream({
      cancel: () => Promise.reject(new Error("stream cleanup failed")),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(body, { status: 200 }));

    try {
      const probes = await Effect.runPromise(probeAssetUrls(["https://example.com/stream.js"]));

      assert.deepStrictEqual(probes, [
        {
          ok: true,
          status: 200,
          type: "script",
          url: "https://example.com/stream.js",
        },
      ]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("validates generic submission metadata without portal automation", () => {
    const dir = createPackageFixture();
    const result = runTaizn(["validate", "submission", "--json"], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const validation = parseSubmissionJson(result.stdout);
    assert.strictEqual(validation.ok, true);
    assert.strictEqual(validation.hostedAssets.length, 2);
  });

  it("fails submission validation when configured metadata is invalid", () => {
    const dir = createPackageFixture();
    const config = JSON.parse(readFileSync(join(dir, "taizn.json"), "utf8"));

    config.widget.variants.production.applicationId = "Bad?app";
    writeFileSync(join(dir, "taizn.json"), JSON.stringify(config, null, 2));

    const result = runTaizn(["validate", "submission", "--json"], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 1);
    const validation = JSON.parse(result.stdout);
    assert.strictEqual(validation.ok, false);
    assert.include(validation.problems[0] ?? "", "applicationId");
  });

  it("fails submission validation when Tizen identifiers contain spaces", () => {
    const dir = createPackageFixture();
    const config = JSON.parse(readFileSync(join(dir, "taizn.json"), "utf8"));

    config.widget.variants.production.applicationId = "Bad App";
    config.widget.variants.production.packageId = "Bad Package";
    writeFileSync(join(dir, "taizn.json"), JSON.stringify(config, null, 2));

    const result = runTaizn(["validate", "submission", "--json"], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 1);
    const validation = JSON.parse(result.stdout);
    assert.strictEqual(validation.ok, false);
    assert.include(validation.problems.join("\n"), "applicationId");
    assert.include(validation.problems.join("\n"), "packageId");
  });

  it("fails submission validation when archive metadata mismatches the selected variant", () => {
    const dir = createPackageFixture();
    const path = join(dir, "bad.wgt");
    writeFileSync(
      path,
      makeStoredZip([
        {
          content:
            '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets"><tizen:application id="Other.app" package="Other"/><name>Other</name></widget>',
          name: "config.xml",
        },
      ]),
    );

    const result = runTaizn(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 1);
    const validation = JSON.parse(result.stdout);
    assert.strictEqual(validation.ok, false);
    assert.include(validation.problems.join("\n"), "archive applicationId");
    assert.include(validation.problems.join("\n"), "archive packageId");
  });

  it("validates the locally provable Samsung submission checklist for a WGT", () => {
    const dir = createPackageFixture();
    const path = join(dir, "example.wgt");
    writeFileSync(path, makeValidSubmissionWgt());

    const result = runTaizn(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const validation = JSON.parse(result.stdout);
    assert.strictEqual(validation.ok, true);
    assert.deepStrictEqual(validation.problems, []);
  });

  it("rejects WGT archives without a complete ZIP directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-wgt-zip-"));
    const path = join(dir, "fixture.wgt");
    const archive = makeValidSubmissionWgt();
    writeFileSync(path, archive.subarray(0, archive.byteLength - 22));

    const result = runTaizn(["prepare", "submission", "--json", path], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "ZIP end-of-central-directory record is missing");
  });

  it("rejects inconsistent ZIP local headers and missing data descriptors", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-wgt-entries-"));
    const archive = makeValidSubmissionWgt();
    const badLocalHeader = Buffer.from(archive);
    badLocalHeader.writeUInt32LE(0, 14);
    const badLocalPath = join(dir, "bad_local.wgt");
    writeFileSync(badLocalPath, badLocalHeader);

    const missingDescriptor = Buffer.from(archive);
    const endOffset = missingDescriptor.byteLength - 22;
    const centralOffset = missingDescriptor.readUInt32LE(endOffset + 16);
    missingDescriptor.writeUInt16LE(missingDescriptor.readUInt16LE(6) | 0x08, 6);
    missingDescriptor.writeUInt16LE(
      missingDescriptor.readUInt16LE(centralOffset + 8) | 0x08,
      centralOffset + 8,
    );
    const missingDescriptorPath = join(dir, "missing_descriptor.wgt");
    writeFileSync(missingDescriptorPath, missingDescriptor);

    const localResult = runTaizn(["prepare", "submission", "--json", badLocalPath], dir);
    const descriptorResult = runTaizn(
      ["prepare", "submission", "--json", missingDescriptorPath],
      dir,
    );

    assert.strictEqual(localResult.status, 1);
    assert.include(localResult.stderr, "local header sizes or CRC");
    assert.strictEqual(descriptorResult.status, 1);
    assert.include(descriptorResult.stderr, "data descriptor");
  });

  it("rejects malformed or namespace-invalid config XML", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-wgt-xml-"));
    const path = join(dir, "fixture.wgt");
    writeFileSync(
      path,
      makeValidSubmissionWgt(
        '<widget xmlns="http://www.w3.org/ns/widgets"><tizen:application id="Example.app" package="Example"/></widget>',
      ),
    );

    const result = runTaizn(["prepare", "submission", "--json", path], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Invalid archive config.xml");
    assert.include(result.stderr, "unbound namespace prefix");
  });

  it("validates Seller Office WGT file-name characters and byte length", () => {
    const dir = createPackageFixture();
    const specialPath = join(dir, "bad#.wgt");
    const longPath = join(dir, `${"a".repeat(97)}.wgt`);
    const archive = makeValidSubmissionWgt();
    writeFileSync(specialPath, archive);
    writeFileSync(longPath, archive);

    const special = runTaizn(["validate", "submission", "--json", specialPath], dir, {
      TAIZN_VARIANT: "production",
    });
    const long = runTaizn(["validate", "submission", "--json", longPath], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(special.status, 1);
    assert.include(JSON.parse(special.stdout).problems.join("\n"), "letters, numbers");
    assert.strictEqual(long.status, 1);
    assert.include(JSON.parse(long.stdout).problems.join("\n"), "100 bytes");
  });

  it("reports actionable signed WGT submission problems", () => {
    const dir = createPackageFixture();
    const path = join(dir, "example.WGT");
    writeFileSync(
      path,
      makeStoredZip([
        {
          content:
            '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" version="1.2.3.4"><tizen:application id="Example.app" package="Example" required_version="5"/><name>Example</name><feature name="https://example.invalid/feature/screen.size.nope"/><tizen:privilege name="http://developer.samsung.com/privilege/keymanager"/><tizen:service auto-restart="true" on-boot="true"/><ticker/></widget>',
          name: "config.xml",
        },
        { content: "author", name: "author-signature.xml" },
      ]),
    );

    const result = runTaizn(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 1);
    const validation = JSON.parse(result.stdout);
    assert.include(validation.problems.join("\n"), "lowercase .wgt");
    assert.include(validation.problems.join("\n"), "widget version");
    assert.include(validation.problems.join("\n"), "required Tizen version");
    assert.include(validation.problems.join("\n"), "screen-size feature");
    assert.include(validation.problems.join("\n"), "keymanager");
    assert.include(validation.problems.join("\n"), "auto-restart");
    assert.include(validation.problems.join("\n"), "on-boot");
    assert.include(validation.problems.join("\n"), "ticker");
    assert.include(validation.problems.join("\n"), "signature1.xml");
  });

  it("decodes the default application name from config XML", () => {
    const dir = createPackageFixture();
    const config = JSON.parse(readFileSync(join(dir, "taizn.json"), "utf8"));
    config.widget.variants.production.name = "Rock & Roll";
    writeFileSync(join(dir, "taizn.json"), JSON.stringify(config, null, 2));
    const path = join(dir, "example.wgt");
    writeFileSync(
      path,
      makeValidSubmissionWgt(
        '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" xml:lang="tr" version="1.2.3"><tizen:application id="Example.app" package="Example" required_version="5.5"/><name>Yerel</name><!-- <name>Wrong</name> --><name xml:lang="">\n  Rock &amp; Roll\n</name><feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/></widget>',
      ),
    );

    const prepared = runTaizn(["prepare", "submission", "--json", path], dir);
    const validated = runTaizn(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(prepared.status, 0);
    assert.strictEqual(JSON.parse(prepared.stdout).widget.name, "Rock & Roll");
    assert.strictEqual(validated.status, 0);
  });

  it("honors defaultlocale and Unicode name whitespace", () => {
    const dir = createPackageFixture();
    const config = JSON.parse(readFileSync(join(dir, "taizn.json"), "utf8"));
    config.widget.variants.production.name = "Rock & Roll";
    writeFileSync(join(dir, "taizn.json"), JSON.stringify(config, null, 2));
    const path = join(dir, "example.wgt");
    writeFileSync(
      path,
      makeValidSubmissionWgt(
        '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" defaultlocale="en" version="1.2.3"><tizen:application id="Example.app" package="Example" required_version="5.5"/><name xml:lang="tr">Yerel</name><name xml:lang="en"> Rock\u00a0\u00a0&amp;\u3000Roll </name><feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/></widget>',
      ),
    );

    const prepared = runTaizn(["prepare", "submission", "--json", path], dir);
    const validated = runTaizn(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(prepared.status, 0);
    assert.strictEqual(JSON.parse(prepared.stdout).widget.name, "Rock & Roll");
    assert.strictEqual(validated.status, 0);
  });

  it("accepts a ZIP comment containing an EOCD signature sequence", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-wgt-comment-"));
    const path = join(dir, "fixture.wgt");
    writeFileSync(
      path,
      makeValidSubmissionWgt(undefined, Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0])),
    );

    const result = runTaizn(["prepare", "submission", "--json", path], dir);

    assert.strictEqual(result.status, 0);
  });

  it("prepares a deterministic signed WGT submission manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-prepare-submission-"));
    const path = join(dir, "fixture.wgt");
    const archive = makeValidSubmissionWgt();
    writeFileSync(path, archive);

    const first = runTaizn(
      ["prepare", "submission", "--json", "--artifact", ".taizn/submission.json", path],
      dir,
    );
    const second = runTaizn(["prepare", "submission", "--json", path], dir);

    assert.strictEqual(first.status, 0);
    assert.strictEqual(first.stderr, "");
    assert.strictEqual(second.status, 0);
    const manifest = parseSubmissionManifestJson(first.stdout);
    assert.deepStrictEqual(JSON.parse(second.stdout), JSON.parse(first.stdout));
    assert.deepStrictEqual(
      JSON.parse(readFileSync(join(dir, ".taizn/submission.json"), "utf8")),
      JSON.parse(first.stdout),
    );
    assert.deepStrictEqual(manifest, {
      file: {
        name: "fixture.wgt",
        sha256: createHash("sha256").update(archive).digest("hex"),
        size: archive.byteLength,
      },
      schemaVersion: 1,
      signatures: {
        authorPresent: true,
        distributorPresent: true,
      },
      widget: {
        applicationId: "Example.app",
        declarations: {
          autoRestart: false,
          onBoot: false,
          ticker: false,
        },
        features: ["http://tizen.org/feature/screen.size.normal.1080.1920"],
        name: "Example",
        packageId: "Example",
        privileges: ["http://tizen.org/privilege/tv.inputdevice"],
        requiredTizenVersion: "5.5",
        version: "1.2.3",
      },
    });
  });

  it("inspects Tizen widget archive metadata as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-inspect-wgt-"));
    const path = join(dir, "fixture.wgt");
    writeFileSync(
      path,
      makeStoredZip([
        {
          content:
            '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets"><tizen:application id="Example.app" package="Example"/><name>Example</name><tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/></widget>',
          name: "config.xml",
        },
        { content: "<html></html>", name: "index.html" },
      ]),
    );

    const result = runTaizn(["inspect", "wgt", "--json", path], dir);

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const inspected = parseInspectJson(result.stdout);
    assert.strictEqual(inspected.config.applicationId, "Example.app");
    assert.strictEqual(inspected.entryCount, 2);
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

    assert.include(stagedHtml, 'src="https://example.com/assets/main.js"');
    assert.include(stagedHtml, 'href="https://example.com/assets/main.css"');
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
    '<html><head><link href="https://example.com/assets/main.css" rel="stylesheet"><script src="$WEBAPIS/webapis/webapis.js"></script><script defer src="https://example.com/assets/main.js"></script></head><body></body></html>',
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

const ProofJsonSchema = Schema.Struct({
  application: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
  }),
  launch: Schema.Struct({
    output: Schema.String,
    started: Schema.Boolean,
  }),
  target: Schema.String,
});

type ProofJson = typeof ProofJsonSchema.Type;

const ApplicationsJsonSchema = Schema.Struct({
  applications: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
  ),
  query: Schema.optional(Schema.String),
  target: Schema.String,
});

type ApplicationsJson = typeof ApplicationsJsonSchema.Type;

const CheckJsonSchema = Schema.Struct({
  configuredTarget: Schema.optional(Schema.String),
  targets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      state: Schema.String,
    }),
  ),
  tools: Schema.Struct({
    sdb: Schema.String,
    tizenCli: Schema.String,
  }),
});

type CheckJson = typeof CheckJsonSchema.Type;

const TvInfoJsonSchema = Schema.Struct({
  developer: Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
    ip: Schema.optional(Schema.String),
    mode: Schema.optional(Schema.String),
  }),
  host: Schema.String,
  infoPort: Schema.Number,
  ip: Schema.String,
  model: Schema.optional(Schema.String),
  name: Schema.String,
  remote: Schema.optional(Schema.String),
  remoteAvailable: Schema.optional(Schema.Boolean),
  tokenAuth: Schema.optional(Schema.Boolean),
  type: Schema.optional(Schema.String),
  uri: Schema.optional(Schema.String),
});

type TvInfoJson = typeof TvInfoJsonSchema.Type;

const TvPressJsonSchema = Schema.Struct({
  delayMs: Schema.Number,
  keyCount: Schema.Number,
  keys: Schema.Array(Schema.String),
  target: Schema.Struct({
    host: Schema.String,
    port: Schema.Number,
    protocol: Schema.Literals(["ws", "wss"]),
    url: Schema.String,
  }),
});

type TvPressJson = typeof TvPressJsonSchema.Type;

const DiagnosticErrorJsonSchema = Schema.Struct({
  details: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  message: Schema.String,
  target: Schema.optional(Schema.String),
  type: Schema.String,
});

const TvDoctorJsonSchema = Schema.Struct({
  host: Schema.optional(Schema.String),
  hostSource: Schema.String,
  info: Schema.Struct({
    developer: Schema.optional(
      Schema.Struct({
        enabled: Schema.optional(Schema.Boolean),
        ip: Schema.optional(Schema.String),
        mode: Schema.optional(Schema.String),
      }),
    ),
    error: Schema.optional(DiagnosticErrorJsonSchema),
    ip: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    ok: Schema.Boolean,
    port: Schema.Number,
    remote: Schema.optional(Schema.String),
    remoteAvailable: Schema.optional(Schema.Boolean),
    tokenAuth: Schema.optional(Schema.Boolean),
    type: Schema.optional(Schema.String),
    uri: Schema.optional(Schema.String),
  }),
  remote: Schema.Struct({
    connection: Schema.Struct({
      error: Schema.optional(DiagnosticErrorJsonSchema),
      ok: Schema.optional(Schema.Boolean),
      reason: Schema.optional(Schema.String),
      tested: Schema.Boolean,
      tokenReturned: Schema.optional(Schema.Boolean),
    }),
    name: Schema.String,
    port: Schema.Number,
    protocol: Schema.Literals(["ws", "wss"]),
    target: Schema.optional(Schema.String),
    timeoutMs: Schema.Number,
    tokenConfigured: Schema.Boolean,
    tokenSource: Schema.String,
  }),
  state: Schema.Struct({
    error: Schema.optional(DiagnosticErrorJsonSchema),
    host: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    path: Schema.String,
    port: Schema.optional(Schema.Number),
    protocol: Schema.optional(Schema.Literals(["ws", "wss"])),
    status: Schema.String,
    tokenConfigured: Schema.Boolean,
  }),
  target: Schema.optional(Schema.String),
});

type TvDoctorJson = typeof TvDoctorJsonSchema.Type;

const DescribeJsonSchema = Schema.Struct({
  commands: Schema.Array(
    Schema.Struct({
      command: Schema.String,
      fieldMask: Schema.Boolean,
      flags: Schema.Array(Schema.String),
      purpose: Schema.String,
    }),
  ),
  name: Schema.String,
  schemaVersion: Schema.Literal(2),
});

type DescribeJson = typeof DescribeJsonSchema.Type;

const TvScriptJsonSchema = Schema.Struct({
  dryRun: Schema.Boolean,
  file: Schema.String,
  keyCount: Schema.Number,
  steps: Schema.Array(
    Schema.Struct({
      delayMs: Schema.Number,
      keys: Schema.Array(Schema.String),
    }),
  ),
});

type TvScriptJson = typeof TvScriptJsonSchema.Type;

const LogsJsonSchema = Schema.Struct({
  lineCount: Schema.Number,
  lines: Schema.Array(Schema.String),
  target: Schema.String,
});

type LogsJson = typeof LogsJsonSchema.Type;

const TargetsJsonSchema = Schema.Struct({
  aliases: Schema.Array(
    Schema.Struct({
      alias: Schema.String,
      target: Schema.String,
      tvHost: Schema.optional(Schema.String),
    }),
  ),
  connected: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      state: Schema.String,
    }),
  ),
});

type TargetsJson = typeof TargetsJsonSchema.Type;

const ProbeJsonSchema = Schema.Struct({
  urls: Schema.Array(Schema.String),
});

type ProbeJson = typeof ProbeJsonSchema.Type;

const SubmissionJsonSchema = Schema.Struct({
  hostedAssets: Schema.Array(Schema.String),
  ok: Schema.Boolean,
});

type SubmissionJson = typeof SubmissionJsonSchema.Type;

const InspectJsonSchema = Schema.Struct({
  config: Schema.Struct({
    applicationId: Schema.String,
    name: Schema.String,
    packageId: Schema.String,
    privileges: Schema.Array(Schema.String),
  }),
  entryCount: Schema.Number,
});

type InspectJson = typeof InspectJsonSchema.Type;

const SubmissionManifestJsonSchema = Schema.Struct({
  file: Schema.Struct({
    name: Schema.String,
    sha256: Schema.String,
    size: Schema.Number,
  }),
  schemaVersion: Schema.Literal(1),
  signatures: Schema.Struct({
    authorPresent: Schema.Boolean,
    distributorPresent: Schema.Boolean,
  }),
  widget: Schema.Struct({
    applicationId: Schema.String,
    declarations: Schema.Struct({
      autoRestart: Schema.Boolean,
      onBoot: Schema.Boolean,
      ticker: Schema.Boolean,
    }),
    features: Schema.Array(Schema.String),
    name: Schema.String,
    packageId: Schema.String,
    privileges: Schema.Array(Schema.String),
    requiredTizenVersion: Schema.String,
    version: Schema.String,
  }),
});

type SubmissionManifestJson = typeof SubmissionManifestJsonSchema.Type;

const parseDescribeJson = (text: string): DescribeJson => {
  const described: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(DescribeJsonSchema)(described);
};

const parseProofJson = (text: string): ProofJson => {
  const proof: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(ProofJsonSchema)(proof);
};

const parseApplicationsJson = (text: string): ApplicationsJson => {
  const inventory: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(ApplicationsJsonSchema)(inventory);
};

const parseCheckJson = (text: string): CheckJson => {
  const check: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(CheckJsonSchema)(check);
};

const parseTvInfoJson = (text: string): TvInfoJson => {
  const info: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(TvInfoJsonSchema)(info);
};

const parseTvPressJson = (text: string): TvPressJson => {
  const press: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(TvPressJsonSchema)(press);
};

const parseTvDoctorJson = (text: string): TvDoctorJson => {
  const doctor: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(TvDoctorJsonSchema)(doctor);
};

const parseTvScriptJson = (text: string): TvScriptJson => {
  const script: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(TvScriptJsonSchema)(script);
};

const parseLogsJson = (text: string): LogsJson => {
  const logs: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(LogsJsonSchema)(logs);
};

const parseTargetsJson = (text: string): TargetsJson => {
  const targets: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(TargetsJsonSchema)(targets);
};

const parseProbeJson = (text: string): ProbeJson => {
  const probe: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(ProbeJsonSchema)(probe);
};

const parseSubmissionJson = (text: string): SubmissionJson => {
  const submission: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(SubmissionJsonSchema)(submission);
};

const parseInspectJson = (text: string): InspectJson => {
  const inspected: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(InspectJsonSchema)(inspected);
};

const parseSubmissionManifestJson = (text: string): SubmissionManifestJson => {
  const manifest: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(SubmissionManifestJsonSchema)(manifest);
};

const createToolingFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "taizn-tooling-config-"));
  writeFakeSdb(dir);
  writeFakeTizen(dir);
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
      if (args[0] === "connect") {
        console.log(args[1] + " is already connected");
        process.exit(0);
      }
      if (args[0] === "-s" && args[2] === "shell" && args[3] === "0" && args[4] === "applist") {
        console.log("\\tApplication List for user 5001");
        console.log("\\t Name \\t AppID ");
        console.log("\\t=================================================");
        console.log("\\t'Example App'\\t 'Example.app'");
        console.log("\\t'Other App'\\t 'Other.app'");
        process.exit(0);
      }
      if (args[0] === "-s" && args[2] === "dlog" && args[3] === "-d") {
        console.log("I/Example: launched");
        console.log("I/Other: idle");
        process.exit(0);
      }
      if (args[0] === "-s" && args[2] === "dlog") {
        console.log("I/Example: streamed");
        setInterval(() => console.log("I/Other: streamed"), 5);
        await new Promise(() => {});
      }
      process.exit(0);
    `,
  );
  chmodSync(join(dir, "fake-sdb.mjs"), 0o755);
};

const writeFakeTizen = (dir: string) => {
  writeFileSync(
    join(dir, "fake-tizen.mjs"),
    `#!/usr/bin/env node
      console.log(["fake-tizen", ...process.argv.slice(2)].join(" "));
      process.exit(0);
    `,
  );
  chmodSync(join(dir, "fake-tizen.mjs"), 0o755);
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

const makeStoredZip = (
  entries: readonly { readonly content: string; readonly name: string }[],
  comment = Buffer.alloc(0),
) => {
  const localEntries: Buffer[] = [];
  const directoryEntries: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const localEntry = makeStoredZipEntry(entry);
    localEntries.push(localEntry);
    directoryEntries.push(makeStoredZipDirectoryEntry(entry, localOffset));
    localOffset += localEntry.byteLength;
  }

  const directory = Buffer.concat(directoryEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(comment.byteLength, 20);

  return Buffer.concat([...localEntries, directory, end, comment]);
};

const makeValidSubmissionWgt = (
  configXml = '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" xmlns:vendor="https://example.com/widgets" version="1.2.3"><tizen:application id="Example.app" package="Example" required_version="5.5"/><name>Example</name><feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/><tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/><vendor:component auto-restart="true" on-boot="true"/></widget>',
  comment = Buffer.alloc(0),
) =>
  makeStoredZip(
    [
      {
        content: configXml,
        name: "config.xml",
      },
      {
        content: '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>',
        name: "author-signature.xml",
      },
      {
        content: '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>',
        name: "signature1.xml",
      },
      { content: "<html></html>", name: "index.html" },
    ],
    comment,
  );

const makeStoredZipEntry = (entry: { readonly content: string; readonly name: string }) => {
  const name = Buffer.from(entry.name);
  const content = Buffer.from(entry.content);
  const header = Buffer.alloc(30);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(testCrc32(content), 14);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, name, content]);
};

const makeStoredZipDirectoryEntry = (
  entry: { readonly content: string; readonly name: string },
  localOffset: number,
) => {
  const name = Buffer.from(entry.name);
  const content = Buffer.from(entry.content);
  const header = Buffer.alloc(46);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt32LE(testCrc32(content), 16);
  header.writeUInt32LE(content.byteLength, 20);
  header.writeUInt32LE(content.byteLength, 24);
  header.writeUInt16LE(name.byteLength, 28);
  header.writeUInt32LE(localOffset, 42);

  return Buffer.concat([header, name]);
};

const testCrc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const testCrc32 = (buffer: Buffer) => {
  let value = 0xffff_ffff;
  for (const byte of buffer) {
    const tableValue = testCrc32Table[(value ^ byte) & 0xff];
    if (tableValue === undefined) {
      throw new Error("CRC-32 table lookup failed");
    }
    value = tableValue ^ (value >>> 8);
  }
  return (value ^ 0xffff_ffff) >>> 0;
};
