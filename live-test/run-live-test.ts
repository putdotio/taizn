import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  envFlagEnabled,
  failedFetchProbes,
  fetchProbeFailureLabel,
  isRecord,
  parseBeaconTimeoutMs,
  parseRemoteDelayMs,
  parseRemoteKeys,
  resolveFetchProbeUrls,
  resolveFixtureProofQuery,
  resolvePackageId,
  resolveProofQuery,
  resolveSmokeTarget,
  selectBeaconHost,
} from "./harness-core.ts";

const liveTestDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(liveTestDir, "app");
const cliPath = resolve(liveTestDir, "..", "dist", "taizn.mjs");
const envPath = join(appDir, ".taizn", ".env");
const iconPath = join(appDir, "tizen", "icon.png");
const configPath = join(appDir, "taizn.json");
const configTemplatePath = join(appDir, "taizn.template.json");
const remoteArtifactPath = join(appDir, ".taizn", "live-remote.json");
const roundtripArtifactPath = join(appDir, ".taizn", "live-roundtrip.json");
const smokeArtifactPath = join(appDir, ".taizn", "live-smoke.json");
const args = process.argv.slice(2);
const mode = resolveMode(args);

type LiveTestMode =
  | "doctor"
  | "install"
  | "package"
  | "profile"
  | "prove"
  | "remote"
  | "roundtrip"
  | "smoke";

type TaiznMode = Exclude<LiveTestMode, "remote" | "roundtrip" | "smoke">;

type TextResult = {
  readonly command: readonly string[];
  readonly name: string;
  readonly status: number;
  readonly stderr: string;
  readonly stdout: string;
};

type BeaconEvent = {
  readonly fetches?: unknown;
  readonly method?: string;
  readonly receivedAt: string;
  readonly url: string;
  readonly userAgent?: string;
};

type BeaconServer = {
  readonly close: () => Promise<void>;
  readonly host: string;
  readonly timeoutMs: number;
  readonly url: string;
  readonly waitForEvent: () => Promise<BeaconEvent | null>;
};

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

applyCliEnvOverrides();

if (!existsSync(cliPath)) {
  console.error("Packed CLI not found. Run `vp run build` first.");
  process.exit(1);
}

if (mode !== "doctor" && mode !== "remote" && mode !== "smoke") {
  writeFixtureIcon();
  writeFixtureConfig();
}

if (mode === "smoke") {
  runSmoke();
} else if (mode === "roundtrip") {
  await runRoundtrip();
} else if (mode === "remote") {
  runRemoteDiagnostic();
} else {
  runTaizn(mode);
}

function writeFixtureConfig() {
  const profile = resolveProfile();
  const template = readFileSync(configTemplatePath, "utf8");

  writeFileSync(configPath, template.replaceAll("__TAIZN_PROFILE__", profile));
  console.log(`Using Tizen signing profile: ${profile}`);
}

function resolveMode(args: readonly string[]): LiveTestMode {
  if (args.includes("--doctor")) {
    return "doctor";
  }

  if (args.includes("--smoke")) {
    return "smoke";
  }

  if (args.includes("--roundtrip")) {
    return "roundtrip";
  }

  if (args.includes("--remote")) {
    return "remote";
  }

  if (args.includes("--profile")) {
    return "profile";
  }

  if (args.includes("--prove")) {
    return "prove";
  }

  if (args.includes("--install")) {
    return "install";
  }

  return "package";
}

function applyCliEnvOverrides() {
  if (args.includes("--production")) {
    process.env.TAIZN_VARIANT = "production";
  } else if (args.includes("--development")) {
    process.env.TAIZN_VARIANT = "development";
  }
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

function runTaizn(command: TaiznMode) {
  const commandArgs =
    command === "prove"
      ? ["prove", resolveProofQuery(configTemplatePath)]
      : command === "doctor"
        ? ["tv", "doctor", "--json", ...(args.includes("--connect") ? ["--connect"] : [])]
        : [command];
  const result = spawnSync(process.execPath, [cliPath, ...commandArgs], {
    cwd: appDir,
    env: {
      ...process.env,
      TAIZN_VARIANT: process.env.TAIZN_VARIANT || "development",
    },
    stdio: "inherit",
    ...(command === "prove" || command === "doctor"
      ? { timeout: 120_000, killSignal: "SIGKILL" as const }
      : {}),
  });

  if (result.error) console.error(`taizn ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runSmoke() {
  const artifact = buildSmokeArtifact();

  writeArtifact(smokeArtifactPath, artifact);
}

function runRemoteDiagnostic() {
  const precheck = runTaiznJson("precheck", ["check", "--json"]);
  const target = resolveSmokeTarget(precheck.json);
  const remoteEnv: Record<string, string> = target ? { TAIZN_TARGET: target } : {};
  const doctor = runTaiznJson("doctor", ["tv", "doctor", "--connect", "--json"], remoteEnv);
  const remoteReady = remoteConnectionOk(doctor.json);
  const tokenConfigured = remoteTokenConfigured(doctor.json);
  const keys = parseRemoteKeys(process.env.LIVE_TEST_REMOTE_KEYS);
  const delayMs = resolveRemoteDelayMs();
  const requireRemote = envFlagEnabled(process.env.LIVE_TEST_REQUIRE_REMOTE);
  const steps = [precheck, doctor];

  warnIfSmokeDoctorMissedTv(doctor.json);

  if (keys.length > 0) {
    if (!remoteReady) {
      const artifact = {
        createdAt: new Date().toISOString(),
        delayMs,
        keys,
        remoteReady,
        tokenConfigured,
        steps,
      };

      writeArtifact(remoteArtifactPath, artifact);
      console.error("Cannot send LIVE_TEST_REMOTE_KEYS because Samsung TV remote is not ready.");
      process.exit(1);
    }

    if (!tokenConfigured) {
      const artifact = {
        createdAt: new Date().toISOString(),
        delayMs,
        keys,
        remoteReady,
        tokenConfigured,
        steps,
      };

      writeArtifact(remoteArtifactPath, artifact);
      console.error(
        "Cannot send LIVE_TEST_REMOTE_KEYS without a configured Samsung TV remote token. Run `taizn tv pair` first.",
      );
      process.exit(1);
    }

    steps.push(
      runTaiznJson(
        "press",
        ["tv", "press", "--json", "--delay-ms", String(delayMs), ...keys],
        remoteEnv,
      ),
    );
  }

  const artifact = {
    createdAt: new Date().toISOString(),
    delayMs,
    keys,
    remoteReady,
    tokenConfigured,
    steps,
  };

  writeArtifact(remoteArtifactPath, artifact);

  if (requireRemote && !remoteReady) {
    console.error("Expected Samsung TV remote connection to be ready.");
    process.exit(1);
  }
}

async function runRoundtrip() {
  const precheck = runTaiznJson("precheck", ["check", "--json"]);
  const target = resolveSmokeTarget(precheck.json);
  const roundtripEnv: Record<string, string> = target ? { TAIZN_TARGET: target } : {};
  const predoctor = runTaiznJson("predoctor", ["tv", "doctor", "--json"], roundtripEnv);

  warnIfSmokeDoctorMissedTv(predoctor.json);

  const beacon = await startBeaconServer(
    resolveBeaconHost(predoctor.json, roundtripEnv.TAIZN_TARGET),
    resolveBeaconTimeoutMs(),
  );

  try {
    const beaconServer = {
      host: beacon.host,
      name: "beaconServer",
      timeoutMs: beacon.timeoutMs,
      url: beacon.url,
    };
    const fetchUrls = resolveFetchProbeUrls(process.env, args.includes("--tv-assets"));
    const install = runInstallWithRetry(
      {
        ...roundtripEnv,
        LIVE_TEST_BEACON_URL: beacon.url,
        LIVE_TEST_FETCH_URLS: fetchUrls.join(","),
      },
      precheck.json,
    );
    const smoke = buildSmokeArtifact(
      roundtripEnv,
      resolveFixtureProofQuery(configTemplatePath),
      false,
    );
    const beaconEvent = await beacon.waitForEvent();

    if (!beaconEvent) {
      console.error(`Timed out waiting for live fixture beacon: ${beacon.url}`);
      process.exit(1);
    }

    const failedFetches = failedFetchProbes(beaconEvent.fetches);
    const artifact = {
      createdAt: new Date().toISOString(),
      failedFetches,
      fetchUrls,
      query: smoke.query,
      steps: [
        precheck,
        predoctor,
        beaconServer,
        install,
        ...smoke.steps,
        { event: beaconEvent, name: "beacon" },
      ],
    };

    writeArtifact(roundtripArtifactPath, artifact);

    if (failedFetches.length > 0) {
      console.error(
        `Live fixture fetch probe failed: ${failedFetches.map(fetchProbeFailureLabel).join(", ")}`,
      );
      process.exit(1);
    }
  } finally {
    await beacon.close();
  }
}

function buildSmokeArtifact(
  env: Record<string, string> = {},
  query: string = resolveProofQuery(configTemplatePath),
  requireDoctorInfo = true,
) {
  const check = runTaiznJson("check", ["check", "--json"], env);
  const target = resolveSmokeTarget(check.json);
  const smokeEnv = target ? { ...env, TAIZN_TARGET: target } : env;
  const apps = runTaiznJson("apps", ["apps", "--json", query], smokeEnv);
  const prove = runTaiznJson("prove", ["prove", "--json", query], smokeEnv);
  const doctor = runTaiznJson("doctor", ["tv", "doctor", "--json"], smokeEnv);

  if (requireDoctorInfo) {
    assertSmokeDoctorReachedTv(doctor.json);
  } else {
    warnIfSmokeDoctorMissedTv(doctor.json);
  }

  const steps = [check, apps, prove, doctor];

  return {
    createdAt: new Date().toISOString(),
    query,
    steps,
  };
}

function runInstallWithRetry(env: Record<string, string>, checkJson: unknown) {
  const first = runTaiznTextResult("install", ["install"], env);

  if (first.status === 0) {
    return textResultStep(first);
  }

  if (!isAuthorCertificateMismatch(first) || !env.TAIZN_TARGET) {
    exitWithTextResult(first);
  }

  const uninstall = uninstallFixturePackage(env.TAIZN_TARGET, checkJson);
  const second = runTaiznTextResult("install", ["install"], env);

  if (second.status !== 0) {
    exitWithTextResult(second);
  }

  return {
    attempts: [textResultStep(first), uninstall, textResultStep(second)],
    command: ["taizn", "install"],
    name: "install",
    retried: true,
  };
}

function runTaiznJson(
  name: string,
  commandArgs: readonly string[],
  env: Record<string, string> = {},
) {
  const result = spawnSync(process.execPath, [cliPath, ...commandArgs], {
    cwd: appDir,
    encoding: "utf8",
    timeout: 120_000,
    killSignal: "SIGKILL",
    env: {
      ...process.env,
      ...env,
      TAIZN_VARIANT: process.env.TAIZN_VARIANT || "development",
    },
  });
  const stdout = result.stdout.trim();
  const stderr = [result.stderr.trim(), result.error?.message].filter(Boolean).join("\n");

  if (result.status !== 0) {
    if (stdout) {
      console.error(stdout);
    }

    if (stderr) {
      console.error(stderr);
    }

    process.exit(result.status ?? 1);
  }

  return {
    command: ["taizn", ...commandArgs],
    json: parseJson(stdout, name),
    name,
  };
}

function runTaiznTextResult(
  name: string,
  commandArgs: readonly string[],
  env: Record<string, string> = {},
) {
  const result = spawnSync(process.execPath, [cliPath, ...commandArgs], {
    cwd: appDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      TAIZN_VARIANT: process.env.TAIZN_VARIANT || "development",
    },
  });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  return {
    command: ["taizn", ...commandArgs],
    name,
    status: result.status ?? 1,
    stderr,
    stdout,
  };
}

function uninstallFixturePackage(target: string, checkJson: unknown) {
  const sdbPath = resolveSdbPath(checkJson);
  const packageId = resolvePackageId(configTemplatePath);
  const result = spawnSync(sdbPath, ["-s", target, "uninstall", packageId], {
    cwd: appDir,
    encoding: "utf8",
  });
  const step = {
    command: ["sdb", "-s", target, "uninstall", packageId],
    name: "uninstall",
    status: result.status ?? 1,
    stderr: result.stderr.trim(),
    stdout: result.stdout.trim(),
  };

  if (step.status !== 0) {
    exitWithTextResult(step);
  }

  return step;
}

function resolveSdbPath(checkJson: unknown) {
  if (isRecord(checkJson) && isRecord(checkJson.tools) && typeof checkJson.tools.sdb === "string") {
    return checkJson.tools.sdb;
  }

  return process.env.TAIZN_SDB || join(homedir(), "tizen-studio/tools/sdb");
}

function isAuthorCertificateMismatch(result: TextResult) {
  return `${result.stdout}\n${result.stderr}`.includes("Author certificate not match");
}

function textResultStep(result: TextResult) {
  return {
    command: result.command,
    name: result.name,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function exitWithTextResult(result: TextResult) {
  if (result.stdout) {
    console.error(result.stdout);
  }

  if (result.stderr) {
    console.error(result.stderr);
  }

  process.exit(result.status);
}

function writeArtifact(path: string, artifact: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact));
  console.log(`Wrote live artifact: ${path}`);
}

async function startBeaconServer(host: string, timeoutMs: number): Promise<BeaconServer> {
  let event: BeaconEvent | undefined;
  let resolveWaiting: ((event: BeaconEvent | null) => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  const server = createServer((request, response) => {
    const requestUrl = request.url ?? "/";
    event = {
      fetches: parseBeaconFetches(requestUrl),
      method: request.method,
      receivedAt: new Date().toISOString(),
      url: requestUrl,
      userAgent: headerValue(request.headers["user-agent"]),
    };

    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    response.end();

    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (resolveWaiting) {
      resolveWaiting(event);
      resolveWaiting = undefined;
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "0.0.0.0");
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    console.error("Could not determine live fixture beacon port.");
    process.exit(1);
  }

  return {
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    host,
    timeoutMs,
    url: `http://${host}:${address.port}/taizn-live-ready`,
    waitForEvent: () => {
      if (event) {
        return Promise.resolve(event);
      }

      return new Promise<BeaconEvent | null>((resolveEvent) => {
        resolveWaiting = resolveEvent;
        timer = setTimeout(() => {
          resolveWaiting = undefined;
          resolveEvent(null);
        }, timeoutMs);
      });
    },
  };
}

function parseBeaconFetches(requestUrl: string) {
  const url = new URL(requestUrl, "http://localhost");
  const fetches = url.searchParams.get("fetches");

  if (!fetches) {
    return undefined;
  }

  return parseJson(fetches, "beacon fetch results");
}

function headerValue(value: string | readonly string[] | undefined) {
  if (typeof value === "string") {
    return value;
  }

  return value?.at(0);
}

function resolveBeaconHost(doctorJson: unknown, target: string | undefined) {
  if (process.env.TAIZN_LIVE_BEACON_HOST) {
    return process.env.TAIZN_LIVE_BEACON_HOST;
  }

  if (
    isRecord(doctorJson) &&
    isRecord(doctorJson.info) &&
    isRecord(doctorJson.info.developer) &&
    typeof doctorJson.info.developer.ip === "string"
  ) {
    return doctorJson.info.developer.ip;
  }

  return selectBeaconHost(externalIpv4Addresses(), target) ?? "127.0.0.1";
}

function externalIpv4Addresses() {
  const externalAddresses: string[] = [];

  for (const addresses of Object.values(networkInterfaces())) {
    if (!addresses) {
      continue;
    }

    for (const address of addresses) {
      if (address.family === "IPv4" && !address.internal) {
        externalAddresses.push(address.address);
      }
    }
  }

  return externalAddresses;
}

function resolveBeaconTimeoutMs() {
  try {
    return parseBeaconTimeoutMs(process.env.TAIZN_LIVE_BEACON_TIMEOUT_MS);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exit(1);
  }
}

function resolveRemoteDelayMs() {
  try {
    return parseRemoteDelayMs(process.env.LIVE_TEST_REMOTE_DELAY_MS);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exit(1);
  }
}

function assertSmokeDoctorReachedTv(doctorJson: unknown) {
  if (isRecord(doctorJson) && isRecord(doctorJson.info) && doctorJson.info.ok === true) {
    return;
  }

  console.error(JSON.stringify(doctorJson));
  console.error("Expected smoke doctor to reach the selected TV info endpoint.");
  process.exit(1);
}

function warnIfSmokeDoctorMissedTv(doctorJson: unknown) {
  if (isRecord(doctorJson) && isRecord(doctorJson.info) && doctorJson.info.ok === true) {
    return;
  }

  console.warn(
    "TV info endpoint did not respond; continuing with the selected Tizen target or diagnostic artifact.",
  );
}

function remoteConnectionOk(doctorJson: unknown) {
  return (
    isRecord(doctorJson) &&
    isRecord(doctorJson.remote) &&
    isRecord(doctorJson.remote.connection) &&
    doctorJson.remote.connection.ok === true
  );
}

function remoteTokenConfigured(doctorJson: unknown) {
  return (
    isRecord(doctorJson) &&
    isRecord(doctorJson.remote) &&
    doctorJson.remote.tokenConfigured === true
  );
}

function parseJson(source: string, name: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    console.error(source);
    console.error(`Expected ${name} to return JSON.`);
    process.exit(1);
  }
}
