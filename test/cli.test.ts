import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, vi } from "@effect/vitest";
import { Console, Effect, Fiber, Layer, Schema } from "effect";
import { WebSocketServer } from "ws";
import { probeAssetUrls } from "../src/assets.js";
import { TaiznEnv } from "../src/env.js";
import { SecretReadInterrupted } from "../src/errors.js";
import { runTaiznCli } from "../src/main.js";
import { fetchSamsungTvInfo, sendSamsungTvKeys } from "../src/remote.js";
import { appBuildEnv, redactCommandArgs, TaiznSystem } from "../src/runtime.js";
import { captureForDuration } from "../src/tizen.js";

const cliPath = resolve("dist/taizn.mjs");

// Kept for the boundary tests below that prove the packaged binary itself:
// boot, stream separation, and exit codes. Everything else runs the same CLI
// entry in-process through runTaiznInProcess so V8 coverage attributes it.
const spawnTaizn = (args: string[], cwd = process.cwd(), env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

const runTaiznInProcess = async (
  args: string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = {},
): Promise<{ readonly status: number; readonly stderr: string; readonly stdout: string }> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const system = Layer.succeed(TaiznSystem)({
    cwd: Effect.sync(() => realpathSync(cwd)),
    env: Effect.succeed({ ...process.env, ...env }),
    homeDir: Effect.sync(() => homedir()),
    loadEnvFile: () => Effect.void,
    readSecret: () => Effect.fail(new SecretReadInterrupted({})),
  });
  const status = await Effect.runPromise(
    runTaiznCli(args).pipe(
      Effect.provideService(Console.Console, makeCapturedConsole(stdout, stderr)),
      Effect.provide(Layer.mergeAll(NodeServices.layer, system)),
    ),
  );

  return {
    status,
    stderr: joinOutputLines(stderr),
    stdout: joinOutputLines(stdout),
  };
};

const joinOutputLines = (lines: readonly string[]) => lines.map((line) => `${line}\n`).join("");

const makeCapturedConsole = (stdout: string[], stderr: string[]): Console.Console => {
  const realConsole = globalThis.console;
  const format = (args: ReadonlyArray<unknown>) => args.map(String).join(" ");

  return {
    assert: realConsole.assert.bind(realConsole),
    clear: realConsole.clear.bind(realConsole),
    count: realConsole.count.bind(realConsole),
    countReset: realConsole.countReset.bind(realConsole),
    debug: (...args: ReadonlyArray<unknown>) => stdout.push(format(args)),
    dir: realConsole.dir.bind(realConsole),
    dirxml: realConsole.dirxml.bind(realConsole),
    error: (...args: ReadonlyArray<unknown>) => stderr.push(format(args)),
    group: realConsole.group.bind(realConsole),
    groupCollapsed: realConsole.groupCollapsed.bind(realConsole),
    groupEnd: realConsole.groupEnd.bind(realConsole),
    info: (...args: ReadonlyArray<unknown>) => stdout.push(format(args)),
    log: (...args: ReadonlyArray<unknown>) => stdout.push(format(args)),
    table: realConsole.table.bind(realConsole),
    time: realConsole.time.bind(realConsole),
    timeEnd: realConsole.timeEnd.bind(realConsole),
    timeLog: realConsole.timeLog.bind(realConsole),
    trace: realConsole.trace.bind(realConsole),
    warn: (...args: ReadonlyArray<unknown>) => stderr.push(format(args)),
  };
};

describe("taizn cli", () => {
  it("prints help without a project config", () => {
    const result = spawnTaizn(["--help"]);

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "COMMANDS");
    assert.include(result.stdout, "apps");
    assert.include(result.stdout, "check");
    assert.include(result.stdout, "launch");
    assert.include(result.stdout, "package");
    assert.include(result.stdout, "prepare");
    assert.include(result.stdout, "prove");
    assert.include(result.stdout, "run");
    assert.include(result.stdout, "seller");
    assert.include(result.stdout, "tv");
    assert.strictEqual(result.stderr, "");
  });

  it("prints the package version", () => {
    const result = spawnTaizn(["--version"]);

    assert.strictEqual(result.status, 0);
    assert.match(result.stdout.trim(), /^taizn v\d+\.\d+\.\d+/);
    assert.strictEqual(result.stderr, "");
  });

  it("describes the agent-facing command surface as JSON", async () => {
    const result = await runTaiznInProcess(["describe"]);

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
    assert.isTrue(described.commands.some((command) => command.command === "seller apps list"));
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

  it("dry-runs the human-owned Seller Office login without storing credentials", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-seller-login-"));
    const result = await runTaiznInProcess(["seller", "login", "--dry-run", "--json"], dir, {
      TAIZN_SELLER_BROWSER: process.execPath,
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      browser: process.execPath,
      browserProfile: join(realpathSync(dir), ".taizn/seller/chrome-profile"),
      dryRun: true,
      sessionState: join(realpathSync(dir), ".taizn/seller.json"),
      storesCredentials: false,
      url: "https://seller.samsungapps.com/tv/",
    });
  });

  it("reports a missing Seller Office browser session as structured JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-seller-missing-"));
    const result = await runTaiznInProcess(["seller", "apps", "list", "--json"], dir);

    assert.strictEqual(result.status, 1);
    assert.deepStrictEqual(JSON.parse(result.stderr), {
      error: {
        message: `Seller Office browser session not found: ${join(realpathSync(dir), ".taizn/seller.json")}. Run \`taizn seller login\` first.`,
        type: "SellerSessionNotFound",
      },
      ok: false,
    });
    assert.notInclude(result.stderr, "at ");
  });

  it("lists sanitized Seller Office applications through the local browser adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-seller-apps-"));
    const fixture = await startFakeSellerBrowser(dir, {
      applications: [
        {
          name: "Example App",
          sellerAppId: "1234567890123",
          status: "For Sale",
          type: "Web",
          updatedAt: "2026-01-02",
        },
      ],
      state: "ready",
    });

    try {
      const result = await runTaiznInProcess(
        ["seller", "apps", "list", "--json", "--artifact", ".taizn/seller-apps.json"],
        dir,
      );

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stderr, "");
      const applications = parseSellerApplicationsJson(result.stdout);
      assert.deepStrictEqual(applications, {
        applications: [
          {
            name: "Example App",
            sellerAppId: "1234567890123",
            status: "For Sale",
            type: "Web",
            updatedAt: "2026-01-02",
          },
        ],
        schemaVersion: 1,
      });
      assert.deepStrictEqual(
        JSON.parse(readFileSync(join(dir, ".taizn/seller-apps.json"), "utf8")),
        applications,
      );
      assert.deepStrictEqual(fixture.methods, ["Page.navigate", "Runtime.evaluate"]);
      assert.deepStrictEqual(fixture.httpPaths, ["/json/list"]);
    } finally {
      fixture.close();
    }
  });

  it("fails clearly when Seller Office is signed out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-seller-signed-out-"));
    const fixture = await startFakeSellerBrowser(dir, { state: "signedOut" });

    try {
      const result = await runTaiznInProcess(["seller", "apps", "list", "--json"], dir);

      assert.strictEqual(result.status, 1);
      assert.strictEqual(JSON.parse(result.stderr).error.type, "SellerAuthenticationRequired");
      assert.notInclude(result.stderr, "at ");
    } finally {
      fixture.close();
    }
  });

  it("fails closed when the Seller Office application layout drifts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-seller-drift-"));
    const fixture = await startFakeSellerBrowser(dir, {
      details: "application card fields are missing",
      state: "drift",
    });

    try {
      const result = await runTaiznInProcess(["seller", "apps", "list", "--json"], dir);

      assert.strictEqual(result.status, 1);
      assert.deepStrictEqual(JSON.parse(result.stderr), {
        error: {
          message: "Seller Office portal layout changed: application card fields are missing",
          type: "SellerPortalDrift",
        },
        ok: false,
      });
    } finally {
      fixture.close();
    }
  });

  it("fails closed when Seller Office leaves a CDP request unanswered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-seller-cdp-timeout-"));
    const fixture = await startFakeSellerBrowser(dir, { state: "ready" }, ["Page.navigate"]);

    try {
      const result = await runTaiznInProcess(["seller", "apps", "list", "--json"], dir);

      assert.strictEqual(result.status, 1);
      assert.deepStrictEqual(JSON.parse(result.stderr), {
        error: {
          message:
            "Seller Office browser protocol failed: Page.navigate request 1 timed out after 10000ms",
          type: "SellerPortalProtocolError",
        },
        ok: false,
      });
      assert.deepStrictEqual(fixture.methods, ["Page.navigate"]);
    } finally {
      fixture.close();
    }
  }, 15_000);

  it("reports missing config without a stack trace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-missing-config-"));
    const result = await runTaiznInProcess(["package"], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Config file not found:");
    assert.notInclude(result.stderr, "Error:");
  });

  it("checks tooling without requiring a project config", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-check-"));
    const result = spawnTaizn(["check"], dir, {
      TAIZN_SDB: "/bin/echo",
      TAIZN_TIZEN_CLI: "/bin/echo",
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "Tizen CLI: /bin/echo");
    assert.include(result.stdout, "sdb: /bin/echo");
    assert.include(result.stdout, "connected targets: none");
    assert.strictEqual(result.stderr, "");
  });

  it("checks tooling and connected targets as JSON", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["check", "--json"], dir, {
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

  it("lists installed Tizen applications without requiring a project config", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["apps", "example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, 'Installed Tizen applications matching "example"');
    assert.include(result.stdout, "- Example App (Example.app)");
    assert.notInclude(result.stdout, "Other App");
  });

  it("lists installed Tizen applications as JSON", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["apps", "--json", "example"], dir, {
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

  it("applies field masks to structured read output", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(
      ["apps", "--json", "--fields", "target", "example"],
      dir,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
        TAIZN_TARGET: "127.0.0.1:26101",
      },
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.deepStrictEqual(JSON.parse(result.stdout), { target: "127.0.0.1:26101" });
  });

  it("applies field masks through array entries", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(
      ["apps", "--json", "--fields", "applications.0.id", "example"],
      dir,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
        TAIZN_TARGET: "127.0.0.1:26101",
      },
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      applications: { 0: { id: "Example.app" } },
    });
  });

  it("prints only JSON for installed applications when auto-picking one target", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["apps", "--json"], dir, {
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

  // Spawned: asserts the launched tool's inherited stdio reaches the CLI's own
  // stdout, which only exists at the real process boundary.
  it("launches an installed Tizen application without requiring a project config", () => {
    const dir = createToolingFixture();
    const result = spawnTaizn(["launch", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "fake-tizen run -p Example.app -s 127.0.0.1:26101");
    assert.include(result.stdout, "Launched Example App (Example.app) on 127.0.0.1:26101");
  });

  it("rejects ambiguous installed application launch queries", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["launch", "app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, 'Multiple installed Tizen applications matched "app"');
    assert.notInclude(result.stderr, "Error:");
  });

  it("proves an installed Tizen application without requiring a project config", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["prove", "Example.app"], dir, {
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

  it("prints structured proof as JSON", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["prove", "--json", "Example.app"], dir, {
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

  it("does not claim dry-run proofs launched the app", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["prove", "--dry-run", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.include(result.stdout, "Launch proof dry-run");
    assert.notInclude(result.stdout, "started on");
  });

  it("returns structured errors in JSON mode", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["prove", "--json", "../Example.app"], dir, {
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
    const result = spawnTaizn(["prove", "--json"]);

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

  it("writes proof artifacts inside the app directory", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(
      ["prove", "--artifact", ".taizn/proof.json", "Example.app"],
      dir,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
        TAIZN_TARGET: "127.0.0.1:26101",
        TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
      },
    );

    assert.strictEqual(result.status, 0);
    const proof = parseProofJson(readFileSync(join(dir, ".taizn/proof.json"), "utf8"));
    assert.strictEqual(proof.application.id, "Example.app");
  });

  it("rejects proof artifact paths outside the app directory", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(
      ["prove", "--artifact", "../proof.json", "Example.app"],
      dir,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
        TAIZN_TARGET: "127.0.0.1:26101",
        TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
      },
    );

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "output path must stay inside the app directory");
  });

  for (const kind of ["parent", "file", "dangling", "nested"] as const) {
    it(`rejects proof artifacts through an outside ${kind} symlink`, async () => {
      const dir = createToolingFixture();
      const outside = mkdtempSync(join(tmpdir(), "taizn-outside-"));
      const destination = join(outside, "proof.json");
      if (kind !== "dangling") writeFileSync(destination, "untouched");
      mkdirSync(join(dir, ".taizn"), { recursive: true });
      const artifact =
        kind === "parent" || kind === "nested" ? ".taizn/link/new/proof.json" : ".taizn/proof.json";
      if (kind === "parent" || kind === "nested") {
        symlinkSync(outside, join(dir, ".taizn/link"));
        if (kind === "nested") {
          symlinkSync(join(dir, ".taizn/link"), join(dir, ".taizn/alias"));
        }
      } else {
        symlinkSync(destination, join(dir, ".taizn/proof.json"));
      }
      const result = await runTaiznInProcess(
        [
          "prove",
          "--artifact",
          kind === "nested" ? ".taizn/alias/new/proof.json" : artifact,
          "Example.app",
        ],
        dir,
        {
          TAIZN_SDB: join(dir, "fake-sdb.mjs"),
          TAIZN_TARGET: "127.0.0.1:26101",
          TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
        },
      );
      assert.strictEqual(result.status, 1);
      assert.include(result.stderr, "output path must stay inside the app directory");
      assert.isFalse(existsSync(join(outside, "new")));
      if (kind === "dangling") assert.isFalse(existsSync(destination));
      else assert.strictEqual(readFileSync(destination, "utf8"), "untouched");
    });
  }

  it("writes artifacts through internal links in a symlinked app checkout", async () => {
    const dir = createToolingFixture();
    const parent = mkdtempSync(join(tmpdir(), "taizn-checkout-link-"));
    const checkout = join(parent, "app");
    symlinkSync(dir, checkout);
    mkdirSync(join(dir, "proofs"));
    symlinkSync(join(dir, "proofs"), join(dir, "artifacts"));
    const result = await runTaiznInProcess(
      ["prove", "--artifact", "artifacts/new/proof.json", "Example.app"],
      checkout,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
        TAIZN_TARGET: "127.0.0.1:26101",
        TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
      },
    );
    assert.strictEqual(result.status, 0);
    assert.strictEqual(
      parseProofJson(readFileSync(join(dir, "proofs/new/proof.json"), "utf8")).application.id,
      "Example.app",
    );
  });

  it("prints only JSON for structured proof when auto-picking one target", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["prove", "--json", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const proof = parseProofJson(result.stdout);
    assert.deepStrictEqual(proof.application, { id: "Example.app", name: "Example App" });
    assert.strictEqual(proof.target, "127.0.0.1:26101");
  });

  it("reports schema errors with config paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-config-"));
    writeFileSync(join(dir, "taizn.json"), '{"build":{"command":[]}}\n');

    const result = await runTaiznInProcess(["package"], dir);

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

  it("redacts Tizen password command arguments", async () => {
    assert.deepEqual(redactCommandArgs(["-p", "author", "-dp", "dist"]), [
      "-p",
      "[redacted]",
      "-dp",
      "[redacted]",
    ]);
  });

  it("rejects partial Samsung TV remote ports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-port-"));
    const result = await runTaiznInProcess(["tv", "info"], dir, {
      TAIZN_TV_HOST: "127.0.0.1",
      TAIZN_TV_PORT: "8002abc",
    });

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Invalid TAIZN environment:");
    assert.include(result.stderr, "TAIZN_TV_PORT must be an integer between 1 and 65535");
  });

  it("lets Samsung TV env overrides bypass malformed remote state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-remote-invalid-"));
    mkdirSync(join(dir, ".taizn"), { recursive: true });
    writeFileSync(join(dir, ".taizn/remote.json"), "{bad\n");

    const result = await runTaiznInProcess(["tv", "pair"], dir, {
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

      const result = await runTaiznInProcess(["tv", "info"], dir, {
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

      const result = await runTaiznInProcess(["tv", "info", "--json"], dir, {
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

      const result = await runTaiznInProcess(["tv", "doctor", "--connect", "--json"], dir, {
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

      const pair = await runTaiznInProcess(["tv", "pair"], dir);

      assert.strictEqual(pair.status, 0);
      assert.include(pair.stdout, "TAIZN_TV_TOKEN=test-token");
      assert.notInclude(requestUrls[0] ?? "", "token=stale-token");
      assert.include(readFileSync(join(dir, ".taizn/remote.json"), "utf8"), "test-token");

      const press = await runTaiznInProcess(
        ["tv", "press", "--delay-ms", "1", "KEY_UP", "KEY_ENTER"],
        dir,
      );

      assert.strictEqual(press.status, 0);
      assert.include(press.stdout, "Sent Samsung TV remote keys: KEY_UP, KEY_ENTER");
      assert.lengthOf(receivedKeys, 2);
      assert.include(receivedKeys[0] ?? "", '"DataOfCmd":"KEY_UP"');
      assert.include(receivedKeys[1] ?? "", '"DataOfCmd":"KEY_ENTER"');

      const jsonPress = await runTaiznInProcess(["tv", "press", "--json", "KEY_LEFT"], dir);

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
      const script = await runTaiznInProcess(
        ["tv", "script", "--json", "--file", "keys.json"],
        dir,
      );

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

  it("dry-runs Samsung TV remote scripts from JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-script-"));
    writeFileSync(
      join(dir, "keys.json"),
      JSON.stringify({ delayMs: 1, steps: [{ keys: ["KEY_UP", "KEY_ENTER"] }] }),
    );

    const result = await runTaiznInProcess(
      ["tv", "script", "--dry-run", "--json", "--file", "keys.json"],
      dir,
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const script = parseTvScriptJson(result.stdout);
    assert.strictEqual(script.dryRun, true);
    assert.strictEqual(script.keyCount, 2);
  });

  it("dry-runs Samsung TV remote keys without a paired token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-tv-press-dry-run-"));
    const result = await runTaiznInProcess(
      ["tv", "press", "--dry-run", "--json", "KEY_HOME"],
      dir,
      {
        TAIZN_TV_HOST: "127.0.0.1",
      },
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const press = JSON.parse(result.stdout);
    assert.strictEqual(press.dryRun, true);
    assert.strictEqual(press.keyCount, 1);
    assert.deepStrictEqual(press.keys, ["KEY_HOME"]);
    assert.strictEqual(press.target.url, "wss://127.0.0.1:8002");
  });

  it("dry-runs mutating package and run commands", async () => {
    const dir = createPackageFixture();
    const packageResult = await runTaiznInProcess(["package", "--dry-run"], dir, {
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });
    const runResult = await runTaiznInProcess(["run", "--dry-run"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(packageResult.status, 0);
    assert.strictEqual(JSON.parse(packageResult.stdout).dryRun, true);
    assert.strictEqual(runResult.status, 0);
    assert.strictEqual(JSON.parse(runResult.stdout).dryRun, true);
  });

  it("keeps dry-run launch JSON quiet when auto-picking one target", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["launch", "--dry-run", "Example.app"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(JSON.parse(result.stdout).target, "127.0.0.1:26101");
  });

  it("captures target logs as JSON", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["logs", "capture", "--json", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const logs = parseLogsJson(result.stdout);
    assert.strictEqual(logs.lineCount, 1);
    assert.include(logs.lines[0] ?? "", "Example");
  });

  it("connects configured targets before log capture", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["logs", "capture", "--json", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "192.0.2.10:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(parseLogsJson(result.stdout).target, "192.0.2.10:26101");
  });

  it("honors explicit JSON log output mode", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(
      ["logs", "capture", "--output", "json", "--app", "Example"],
      dir,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
        TAIZN_TARGET: "127.0.0.1:26101",
      },
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(parseLogsJson(result.stdout).lineCount, 1);
  });

  it("captures target logs as text by default", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(["logs", "capture", "--app", "Example"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    assert.include(result.stdout, "Captured 1 log lines from 127.0.0.1:26101");
  });

  it("formats output=json errors as structured JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-json-error-"));
    const result = await runTaiznInProcess(["logs", "capture", "--output=json"], dir, {
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

  it("formats output ndjson errors as structured JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-ndjson-error-"));
    const result = await runTaiznInProcess(["logs", "capture", "--output", "ndjson"], dir, {
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

  it("honors target log capture duration", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(
      ["logs", "capture", "--json", "--duration-ms", "500"],
      dir,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
        TAIZN_TARGET: "127.0.0.1:26101",
      },
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const logs = parseLogsJson(result.stdout);
    assert.isAtLeast(logs.lineCount, 1);
    assert.include(logs.lines[0] ?? "", "streamed");
  });

  it("cleans up bounded log capture after a spawn error", async () => {
    const dir = createToolingFixture();
    const brokenSdb = join(dir, "non-executable-sdb");
    writeFileSync(brokenSdb, "not executable\n");
    const startedAt = Date.now();
    const result = await runTaiznInProcess(
      ["logs", "capture", "--json", "--duration-ms", "10000"],
      dir,
      {
        TAIZN_SDB: brokenSdb,
        TAIZN_TARGET: "127.0.0.1:26101",
      },
    );

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Command failed");
    assert.isBelow(Date.now() - startedAt, 2_000);
  });

  it("force-closes interrupted log processes that ignore SIGTERM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-stubborn-log-"));
    const command = join(dir, "stubborn-log.mjs");
    const pidPath = join(dir, "child.pid");
    writeFileSync(
      command,
      `#!/usr/bin/env node
        import { writeFileSync } from "node:fs";
        process.on("SIGTERM", () => {});
        writeFileSync(process.argv[2], String(process.pid));
        setInterval(() => {}, 1_000);
        await new Promise(() => {});
      `,
    );
    chmodSync(command, 0o755);
    const fiber = Effect.runFork(
      captureForDuration(command, [pidPath], 30_000).pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, TaiznSystem.Live)),
      ),
    );
    const pid = Number(await waitForFile(pidPath));
    const startedAt = Date.now();

    await Effect.runPromise(Fiber.interrupt(fiber));

    assert.isAtLeast(Date.now() - startedAt, 900);
    assert.isBelow(Date.now() - startedAt, 3_000);
    assert.throws(() => process.kill(pid, 0));
  });

  it("streams target logs as NDJSON", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(
      ["logs", "capture", "--output", "ndjson", "--app", "Example"],
      dir,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
        TAIZN_TARGET: "127.0.0.1:26101",
      },
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.lengthOf(lines, 1);
    assert.include(lines[0].line, "Example");
  });

  it("keeps NDJSON logs quiet when auto-picking one target", async () => {
    const dir = createToolingFixture();
    const result = await runTaiznInProcess(
      ["logs", "capture", "--output", "ndjson", "--app", "Example"],
      dir,
      {
        TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      },
    );

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.lengthOf(lines, 1);
    assert.include(lines[0].line, "Example");
  });

  it("rejects invalid log output mode before resolving device tooling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-log-output-"));
    const result = await runTaiznInProcess(["logs", "capture", "--output", "yaml"], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Invalid logs output");
    assert.notInclude(result.stderr, "sdb not found");
  });

  it("lists connected and aliased targets as JSON", async () => {
    const dir = createToolingFixture();
    mkdirSync(join(dir, ".taizn"), { recursive: true });
    writeFileSync(
      join(dir, ".taizn/targets.json"),
      JSON.stringify({ targets: [{ alias: "living-room", target: "127.0.0.1:26101" }] }),
    );

    const result = await runTaiznInProcess(["targets", "list", "--json"], dir, {
      TAIZN_SDB: join(dir, "fake-sdb.mjs"),
      TAIZN_TARGET: "127.0.0.1:26101",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const targets = parseTargetsJson(result.stdout);
    assert.strictEqual(targets.aliases[0]?.alias, "living-room");
    assert.strictEqual(targets.connected[0]?.id, "127.0.0.1:26101");
  });

  it("dry-runs configured hosted asset probes", async () => {
    const dir = createPackageFixture();
    const result = await runTaiznInProcess(["probe", "hosted-assets", "--dry-run", "--json"], dir, {
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

  it("validates hosted asset URLs during dry-run", async () => {
    const dir = createPackageFixture();
    const result = await runTaiznInProcess(
      ["probe", "hosted-assets", "--dry-run", "--json", "not-a-url"],
      dir,
    );

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

      const result = await runTaiznInProcess(
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

  it("validates generic submission metadata without portal automation", async () => {
    const dir = createPackageFixture();
    const result = await runTaiznInProcess(["validate", "submission", "--json"], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const validation = parseSubmissionJson(result.stdout);
    assert.strictEqual(validation.ok, true);
    assert.strictEqual(validation.hostedAssets.length, 2);
  });

  it("fails submission validation when configured metadata is invalid", async () => {
    const dir = createPackageFixture();
    const config = JSON.parse(readFileSync(join(dir, "taizn.json"), "utf8"));

    config.widget.variants.production.applicationId = "Bad?app";
    writeFileSync(join(dir, "taizn.json"), JSON.stringify(config, null, 2));

    const result = await runTaiznInProcess(["validate", "submission", "--json"], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 1);
    const validation = JSON.parse(result.stdout);
    assert.strictEqual(validation.ok, false);
    assert.include(validation.problems[0] ?? "", "applicationId");
  });

  it("fails submission validation when Tizen identifiers contain spaces", async () => {
    const dir = createPackageFixture();
    const config = JSON.parse(readFileSync(join(dir, "taizn.json"), "utf8"));

    config.widget.variants.production.applicationId = "Bad App";
    config.widget.variants.production.packageId = "Bad Package";
    writeFileSync(join(dir, "taizn.json"), JSON.stringify(config, null, 2));

    const result = await runTaiznInProcess(["validate", "submission", "--json"], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 1);
    const validation = JSON.parse(result.stdout);
    assert.strictEqual(validation.ok, false);
    assert.include(validation.problems.join("\n"), "applicationId");
    assert.include(validation.problems.join("\n"), "packageId");
  });

  it("fails submission validation when archive metadata mismatches the selected variant", async () => {
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

    const result = await runTaiznInProcess(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 1);
    const validation = JSON.parse(result.stdout);
    assert.strictEqual(validation.ok, false);
    assert.include(validation.problems.join("\n"), "archive applicationId");
    assert.include(validation.problems.join("\n"), "archive packageId");
  });

  it("validates the locally provable Samsung submission checklist for a WGT", async () => {
    const dir = createPackageFixture();
    const path = join(dir, "example.wgt");
    writeFileSync(path, makeValidSubmissionWgt());

    const result = await runTaiznInProcess(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const validation = JSON.parse(result.stdout);
    assert.strictEqual(validation.ok, true);
    assert.deepStrictEqual(validation.problems, []);
  });

  it("rejects WGT archives without a complete ZIP directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-wgt-zip-"));
    const path = join(dir, "fixture.wgt");
    const archive = makeValidSubmissionWgt();
    writeFileSync(path, archive.subarray(0, archive.byteLength - 22));

    const result = await runTaiznInProcess(["prepare", "submission", "--json", path], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "ZIP end-of-central-directory record is missing");
  });

  it("rejects inconsistent ZIP local headers and missing data descriptors", async () => {
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

    const localResult = await runTaiznInProcess(
      ["prepare", "submission", "--json", badLocalPath],
      dir,
    );
    const descriptorResult = await runTaiznInProcess(
      ["prepare", "submission", "--json", missingDescriptorPath],
      dir,
    );

    assert.strictEqual(localResult.status, 1);
    assert.include(localResult.stderr, "local header sizes or CRC");
    assert.strictEqual(descriptorResult.status, 1);
    assert.include(descriptorResult.stderr, "data descriptor");
  });

  it("rejects malformed or namespace-invalid config XML", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-wgt-xml-"));
    const path = join(dir, "fixture.wgt");
    writeFileSync(
      path,
      makeValidSubmissionWgt(
        '<widget xmlns="http://www.w3.org/ns/widgets"><tizen:application id="Example.app" package="Example"/></widget>',
      ),
    );

    const result = await runTaiznInProcess(["prepare", "submission", "--json", path], dir);

    assert.strictEqual(result.status, 1);
    assert.include(result.stderr, "Invalid archive config.xml");
    assert.include(result.stderr, "unbound namespace prefix");
  });

  it("validates Seller Office WGT file-name characters and byte length", async () => {
    const dir = createPackageFixture();
    const specialPath = join(dir, "bad#.wgt");
    const longPath = join(dir, `${"a".repeat(97)}.wgt`);
    const archive = makeValidSubmissionWgt();
    writeFileSync(specialPath, archive);
    writeFileSync(longPath, archive);

    const special = await runTaiznInProcess(
      ["validate", "submission", "--json", specialPath],
      dir,
      {
        TAIZN_VARIANT: "production",
      },
    );
    const long = await runTaiznInProcess(["validate", "submission", "--json", longPath], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(special.status, 1);
    assert.include(JSON.parse(special.stdout).problems.join("\n"), "letters, numbers");
    assert.strictEqual(long.status, 1);
    assert.include(JSON.parse(long.stdout).problems.join("\n"), "100 bytes");
  });

  it("reports actionable signed WGT submission problems", async () => {
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

    const result = await runTaiznInProcess(["validate", "submission", "--json", path], dir, {
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

  it("decodes the default application name from config XML", async () => {
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

    const prepared = await runTaiznInProcess(["prepare", "submission", "--json", path], dir);
    const validated = await runTaiznInProcess(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(prepared.status, 0);
    assert.strictEqual(JSON.parse(prepared.stdout).widget.name, "Rock & Roll");
    assert.strictEqual(validated.status, 0);
  });

  it("honors defaultlocale and Unicode name whitespace", async () => {
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

    const prepared = await runTaiznInProcess(["prepare", "submission", "--json", path], dir);
    const validated = await runTaiznInProcess(["validate", "submission", "--json", path], dir, {
      TAIZN_VARIANT: "production",
    });

    assert.strictEqual(prepared.status, 0);
    assert.strictEqual(JSON.parse(prepared.stdout).widget.name, "Rock & Roll");
    assert.strictEqual(validated.status, 0);
  });

  it("accepts a ZIP comment containing an EOCD signature sequence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-wgt-comment-"));
    const path = join(dir, "fixture.wgt");
    writeFileSync(
      path,
      makeValidSubmissionWgt(undefined, Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0])),
    );

    const result = await runTaiznInProcess(["prepare", "submission", "--json", path], dir);

    assert.strictEqual(result.status, 0);
  });

  it("prepares a deterministic signed WGT submission manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-prepare-submission-"));
    const path = join(dir, "fixture.wgt");
    const archive = makeValidSubmissionWgt();
    writeFileSync(path, archive);

    const first = await runTaiznInProcess(
      ["prepare", "submission", "--json", "--artifact", ".taizn/submission.json", path],
      dir,
    );
    const second = await runTaiznInProcess(["prepare", "submission", "--json", path], dir);

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

  it("inspects Tizen widget archive metadata as JSON", async () => {
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

    const result = await runTaiznInProcess(["inspect", "wgt", "--json", path], dir);

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stderr, "");
    const inspected = parseInspectJson(result.stdout);
    assert.strictEqual(inspected.config.applicationId, "Example.app");
    assert.strictEqual(inspected.entryCount, 2);
  });

  it("runs the configured widget variant on the target", async () => {
    const dir = createPackageFixture();
    const result = await runTaiznInProcess(["run"], dir, {
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

  it("uses variant widget overrides when staging the package", async () => {
    const dir = createPackageFixture();

    const development = await runTaiznInProcess(["package"], dir, {
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

    const production = await runTaiznInProcess(["package"], dir, {
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

const SellerApplicationsJsonSchema = Schema.Struct({
  applications: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      sellerAppId: Schema.String,
      status: Schema.String,
      type: Schema.String,
      updatedAt: Schema.optionalKey(Schema.String),
    }),
  ),
  schemaVersion: Schema.Literal(1),
});

type SellerApplicationsJson = typeof SellerApplicationsJsonSchema.Type;

const CdpRequestSchema = Schema.Struct({
  id: Schema.Number,
  method: Schema.String,
});

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

const parseSellerApplicationsJson = (text: string): SellerApplicationsJson => {
  const applications: unknown = JSON.parse(text);
  return Schema.decodeUnknownSync(SellerApplicationsJsonSchema)(applications);
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

const waitForFile = async (path: string) => {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw new Error(`Timed out waiting for ${path}`);
};

const startFakeSellerBrowser = async (
  dir: string,
  extraction: unknown,
  unansweredMethods: readonly string[] = [],
) => {
  const methods: string[] = [];
  const httpPaths: string[] = [];
  const websocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await waitForServer(websocketServer);
  const websocketAddress = websocketServer.address();

  if (!websocketAddress || typeof websocketAddress === "string") {
    websocketServer.close();
    throw new Error("Expected Seller Office websocket address.");
  }

  websocketServer.on("connection", (socket) => {
    socket.on("message", (data) => {
      const json: unknown = JSON.parse(data.toString());
      const request = Schema.decodeUnknownSync(CdpRequestSchema)(json);
      methods.push(request.method);

      if (unansweredMethods.includes(request.method)) {
        return;
      }

      socket.send(
        JSON.stringify({
          id: request.id,
          result:
            request.method === "Runtime.evaluate"
              ? { result: { type: "object", value: extraction } }
              : { frameId: "fixture" },
        }),
      );
    });
  });

  const httpServer = createServer((request, response) => {
    httpPaths.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify([
        {
          id: "fixture-page",
          type: "page",
          url: "about:blank",
          webSocketDebuggerUrl: `ws://127.0.0.1:${websocketAddress.port}`,
        },
      ]),
    );
  });
  await waitForHttpServer(httpServer);
  const httpAddress = httpServer.address();

  if (!httpAddress || typeof httpAddress === "string") {
    httpServer.close();
    websocketServer.close();
    throw new Error("Expected Seller Office HTTP address.");
  }

  mkdirSync(join(dir, ".taizn"), { recursive: true });
  writeFileSync(
    join(dir, ".taizn/seller.json"),
    `${JSON.stringify({ port: httpAddress.port, schemaVersion: 1 }, null, 2)}\n`,
  );

  return {
    close: () => {
      httpServer.close();
      websocketServer.close();
    },
    httpPaths,
    methods,
  };
};

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
