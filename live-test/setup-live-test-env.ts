import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLiveSetupEnv,
  parseEnvAssignments,
  redactEnvValue,
  readSigningProfileFromConfigSource,
  serializeEnvAssignments,
  type LiveSetupOptions,
} from "./setup-core.ts";

const liveTestDir = dirname(fileURLToPath(import.meta.url));
const fixtureAppDir = join(liveTestDir, "app");
const fixtureStateDir = join(fixtureAppDir, ".taizn");
const fixtureEnvPath = join(fixtureStateDir, ".env");
const fixtureCertificateDir = join(fixtureStateDir, "certificates");

type SetupArgs = LiveSetupOptions & {
  readonly from?: string;
  readonly help?: boolean;
  readonly json?: boolean;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const sourceAppDir = args.from ? resolve(args.from) : undefined;
const currentValues = existsSync(fixtureEnvPath)
  ? parseEnvAssignments(readFileSync(fixtureEnvPath, "utf8"))
  : {};
const sourceValues = sourceAppDir ? readSourceEnv(sourceAppDir) : {};
const profile = args.profile ?? (sourceAppDir ? readSourceProfile(sourceAppDir) : undefined);
const defaults = readLocalToolDefaults();
const result = buildLiveSetupEnv(currentValues, sourceValues, { ...args, profile }, defaults);
const copiedCertificates = sourceAppDir ? copySourceCertificates(sourceAppDir) : [];

mkdirSync(fixtureStateDir, { mode: 0o700, recursive: true });
writeFileSync(fixtureEnvPath, serializeEnvAssignments(result.values), { mode: 0o600 });

const summary = {
  copiedCertificates,
  envPath: fixtureEnvPath,
  keys: result.keys,
  missing: result.missing,
};

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Wrote live fixture env: ${fixtureEnvPath}`);

  if (copiedCertificates.length > 0) {
    console.log(`Copied certificates: ${copiedCertificates.join(", ")}`);
  }

  for (const key of result.keys) {
    const value = result.values[key];

    if (value) {
      console.log(`${key}=${redactEnvValue(key, value)}`);
    }
  }

  if (result.missing.length > 0) {
    console.log(`Missing for install/profile gates: ${result.missing.join(", ")}`);
  }

  if (!result.values.TAIZN_TARGET) {
    console.log("Set TAIZN_TARGET=<tv-ip>:26101 before install, smoke, or roundtrip gates.");
  }
}

function parseArgs(argv: readonly string[]): SetupArgs {
  const parsed: {
    beaconHost?: string;
    from?: string;
    help?: boolean;
    json?: boolean;
    profile?: string;
    remoteKeys?: string;
    requireRemote?: boolean;
    target?: string;
    tvHost?: string;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--") {
      continue;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--require-remote") {
      parsed.requireRemote = true;
    } else if (arg === "--from") {
      parsed.from = requireArgValue(argv, index, arg);
      index += 1;
    } else if (arg === "--target") {
      parsed.target = requireArgValue(argv, index, arg);
      index += 1;
    } else if (arg === "--tv-host") {
      parsed.tvHost = requireArgValue(argv, index, arg);
      index += 1;
    } else if (arg === "--beacon-host") {
      parsed.beaconHost = requireArgValue(argv, index, arg);
      index += 1;
    } else if (arg === "--profile") {
      parsed.profile = requireArgValue(argv, index, arg);
      index += 1;
    } else if (arg === "--remote-keys") {
      parsed.remoteKeys = requireArgValue(argv, index, arg);
      index += 1;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return parsed;
}

function requireArgValue(argv: readonly string[], index: number, option: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${option}`);
    process.exit(1);
  }

  return value;
}

function readSourceEnv(sourceAppDir: string) {
  const sourceEnvPath = join(sourceAppDir, ".taizn", ".env");

  if (!existsSync(sourceEnvPath)) {
    return {};
  }

  return parseEnvAssignments(readFileSync(sourceEnvPath, "utf8"));
}

function readSourceProfile(sourceAppDir: string) {
  const sourceConfigPath = join(sourceAppDir, "taizn.json");

  if (!existsSync(sourceConfigPath)) {
    return undefined;
  }

  return readSigningProfileFromConfigSource(readFileSync(sourceConfigPath, "utf8"));
}

function readLocalToolDefaults() {
  const defaults: Record<string, string> = {};
  const tizenCli = join(homedir(), "tizen-studio/tools/ide/bin/tizen");
  const sdb = join(homedir(), "tizen-studio/tools/sdb");

  if (existsSync(tizenCli)) {
    defaults.TAIZN_TIZEN_CLI = tizenCli;
  }

  if (existsSync(sdb)) {
    defaults.TAIZN_SDB = sdb;
  }

  return defaults;
}

function copySourceCertificates(sourceAppDir: string) {
  const sourceCertificateDir = join(sourceAppDir, ".taizn", "certificates");
  const copied: string[] = [];

  if (!existsSync(sourceCertificateDir)) {
    return copied;
  }

  mkdirSync(fixtureCertificateDir, { mode: 0o700, recursive: true });

  for (const file of ["author.crt", "author.p12", "distributor.p12"]) {
    const source = join(sourceCertificateDir, file);

    if (existsSync(source)) {
      copyFileSync(source, join(fixtureCertificateDir, file));
      copied.push(file);
    }
  }

  return copied;
}

function printHelp() {
  console.log(`Usage: node live-test/setup-live-test-env.ts [options]

Options:
  --from <app-dir>       Copy allowlisted .taizn values and certificates from a consumer app
  --target <target>      Set TAIZN_TARGET, appending :26101 when only a host is provided
  --tv-host <host>       Set TAIZN_TV_HOST for Samsung remote-control diagnostics
  --beacon-host <host>   Set TAIZN_LIVE_BEACON_HOST for roundtrip callbacks
  --profile <name>       Set TAIZN_LIVE_PROFILE instead of reading source taizn.json
  --remote-keys <keys>   Set LIVE_TEST_REMOTE_KEYS, comma or space separated
  --require-remote       Set LIVE_TEST_REQUIRE_REMOTE=1
  --json                 Print a machine-readable summary
`);
}
