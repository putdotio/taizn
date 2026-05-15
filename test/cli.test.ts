import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const cliPath = resolve("dist/taizn.mjs");

const runTaizn = (args: string[], cwd = process.cwd()) =>
  spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
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
});
