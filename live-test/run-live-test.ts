import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const liveTestDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(liveTestDir, "app");
const cliPath = resolve(liveTestDir, "..", "dist", "taizn.mjs");
const envPath = join(appDir, ".taizn", ".env");
const iconPath = join(appDir, "tizen", "icon.png");
const configPath = join(appDir, "taizn.json");
const configTemplatePath = join(appDir, "taizn.template.json");
const mode = process.argv.includes("--profile")
  ? "profile"
  : process.argv.includes("--install")
    ? "install"
    : "package";

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

if (!existsSync(cliPath)) {
  console.error("Packed CLI not found. Run `vp run build` first.");
  process.exit(1);
}

writeFixtureIcon();
writeFixtureConfig();
runTaizn(mode);

function writeFixtureConfig() {
  const profile = resolveProfile();
  const template = readFileSync(configTemplatePath, "utf8");

  writeFileSync(configPath, template.replaceAll("__TAIZN_PROFILE__", profile));
  console.log(`Using Tizen signing profile: ${profile}`);
}

function resolveProfile() {
  if (process.env.TAIZN_LIVE_PROFILE) {
    return process.env.TAIZN_LIVE_PROFILE;
  }

  if (mode !== "profile") {
    const activeProfile = findActiveProfile();

    if (activeProfile) {
      return activeProfile;
    }
  }

  return "taizn-live-test";
}

function findActiveProfile() {
  const tizenCli =
    process.env.TAIZN_TIZEN_CLI || join(homedir(), "tizen-studio/tools/ide/bin/tizen");
  const result = spawnSync(tizenCli, ["security-profiles", "list"], {
    cwd: appDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.match(/^(\S+)\s+O\s*$/mu)?.[1] || null;
}

function writeFixtureIcon() {
  if (existsSync(iconPath)) {
    return;
  }

  mkdirSync(dirname(iconPath), { recursive: true });
  writeFileSync(
    iconPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAWklEQVR4nO3PQQ0AIBDAsAP/nuGNAvZoFSzZnZk9d7QH7G0HSA9ID0gPSA9ID0gPSA9ID0gPSA9ID0gPSA9ID0gPSA9ID0gPSA9ID0gPSA9ID0gPSA9ID0gPQB9hAU35WcM4AAAAAElFTkSuQmCC",
      "base64",
    ),
  );
}

function runTaizn(command: "install" | "package" | "profile") {
  const result = spawnSync(process.execPath, [cliPath, command], {
    cwd: appDir,
    env: {
      ...process.env,
      TAIZN_VARIANT: process.env.TAIZN_VARIANT || "development",
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
