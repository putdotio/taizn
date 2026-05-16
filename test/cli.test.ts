import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

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

describe("taizn cli", () => {
  it("prints help without a project config", () => {
    const result = runTaizn(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("COMMANDS");
    expect(result.stdout).toContain("check");
    expect(result.stdout).toContain("package");
    expect(result.stderr).toBe("");
  });

  it("prints the package version", () => {
    const result = runTaizn(["--version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.stderr).toBe("");
  });

  it("reports missing config without a stack trace", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-missing-config-"));
    const result = runTaizn(["package"], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Config file not found:");
    expect(result.stderr).not.toContain("Error:");
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

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Tizen CLI: /bin/echo");
    expect(result.stdout).toContain("sdb: /bin/echo");
    expect(result.stdout).toContain("connected targets: none");
    expect(result.stderr).toBe("");
  });

  it("reports schema errors with config paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "taizn-invalid-config-"));
    writeFileSync(join(dir, "taizn.json"), '{"build":{"command":[]}}\n');

    const result = runTaizn(["package"], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid taizn.json:");
    expect(result.stderr).toContain("build.command.0:");
    expect(result.stderr).toContain("widget:");
    expect(result.stderr).not.toContain("ParseError");
  });

  it("uses variant widget overrides when staging the package", () => {
    const dir = createPackageFixture();

    const development = runTaizn(["package"], dir, {
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
    });

    expect(development.status).toBe(0);
    expect(readFileSync(join(dir, ".taizn/build/stage/index.html"), "utf8")).toContain(
      'src="./js/main.js"',
    );
    expect(readFileSync(join(dir, ".taizn/build/stage/index.html"), "utf8")).toContain(
      'href="./css/main.css"',
    );

    const production = runTaizn(["package"], dir, {
      TAIZN_TIZEN_CLI: join(dir, "fake-tizen.mjs"),
      TAIZN_VARIANT: "production",
    });

    expect(production.status).toBe(0);

    const stagedHtml = readFileSync(join(dir, ".taizn/build/stage/index.html"), "utf8");

    expect(stagedHtml).toContain('src="https://tv.put.io/js/main.js"');
    expect(stagedHtml).toContain('href="https://tv.put.io/css/main.css"');
    expect(stagedHtml).not.toContain('src="./js/main.js"');
    expect(() => readFileSync(join(dir, ".taizn/build/stage/css/main.css.map"))).toThrow();
    expect(() => readFileSync(join(dir, ".taizn/build/stage/js/main.js.map"))).toThrow();
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
      const output = process.argv[process.argv.indexOf("-o") + 1];
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "signed.wgt"), "signed");
    `,
  );
  chmodSync(join(dir, "fake-tizen.mjs"), 0o755);

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
