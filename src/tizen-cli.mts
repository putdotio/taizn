#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { execFileSync, type StdioOptions } from "node:child_process";

type TizenVariant = {
  applicationId: string;
  bundleName: string;
  icon: string;
  name: string;
  packageId: string;
};

type TizenConfig = {
  build: {
    command: string[];
    output: string;
    requiredFiles?: string[];
  };
  signing: {
    certificateDir: string;
    profile: string;
  };
  widget: {
    configXml: string;
    indexHtml: string;
    injectWebapis?: boolean;
    rewriteAssetUrls?: boolean;
    variants: {
      development: TizenVariant;
      production: TizenVariant;
    };
  };
};

type Certificates = {
  author: string;
  distributor: string;
};

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
};

type SdbDevice = {
  id: string;
  label: string;
  state: string;
};

const appDir = process.cwd();
const configPath = join(appDir, "taizn.json");
const taiznDir = join(appDir, ".taizn");
const envPath = join(taiznDir, ".env");
const tizenBuildDir = join(taiznDir, "build");
const stageDir = join(tizenBuildDir, "stage");
const outputDir = join(tizenBuildDir, "output");
const defaultTizenCli = join(homedir(), "tizen-studio/tools/ide/bin/tizen");
const defaultSdb = join(homedir(), "tizen-studio/tools/sdb");
let cachedConfig: TizenConfig | null = null;

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const usage = `Usage:
  taizn profile
  taizn package
  taizn install

Config:
  taizn.json in the app directory

Environment:
  TAIZN_CERT_PASSWORD
      read from .taizn/.env or prompts interactively when missing
  TAIZN_DIST_PASSWORD
      optional; defaults to TAIZN_CERT_PASSWORD
  TAIZN_VARIANT
      development or production; defaults to development
  TAIZN_TIZEN_CLI
      defaults to ~/tizen-studio/tools/ide/bin/tizen
  TAIZN_SDB
      defaults to ~/tizen-studio/tools/sdb
  TAIZN_TARGET
      optional host[:port] for sdb connect before install
`;

const appPath = (path: string) => (isAbsolute(path) ? path : join(appDir, path));
const getCommand = () => process.argv[2] || "package";

const baseChildEnv = () => {
  const env = { ...process.env };

  // Codex/Vite+ file tracing can inject an arm64 preload dylib. The Tizen
  // CLI ships x86_64 binaries on macOS, so inherited preloads can crash it.
  delete env.DYLD_INSERT_LIBRARIES;

  return env;
};

const appBuildEnv = () => {
  const env = baseChildEnv();

  for (const key of Object.keys(env)) {
    if (key.startsWith("TAIZN_") || key.startsWith("TIZEN_")) {
      delete env[key];
    }
  }

  delete env.SDB;
  return env;
};

const fail = (message: string): never => {
  console.error(message);
  console.error("");
  console.error(usage);
  process.exit(1);
};

const getConfig = (): TizenConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (!existsSync(configPath)) {
    fail(`Config file not found: ${configPath}`);
  }

  cachedConfig = JSON.parse(readFileSync(configPath, "utf8")) as TizenConfig;
  return cachedConfig;
};

const redactCommandArgs = (args: string[]) => {
  const sensitiveValueFlags = new Set(["-p", "-dp"]);

  return args.map((arg, index) => {
    if (index > 0 && sensitiveValueFlags.has(args[index - 1])) {
      return "[redacted]";
    }

    return arg;
  });
};

const requireFile = (path: string, label: string) => {
  if (!existsSync(path)) {
    fail(`${label} not found: ${path}`);
  }

  return path;
};

const run = (command: string, args: string[], options: RunOptions = {}) => {
  const env = options.env || baseChildEnv();

  try {
    execFileSync(command, args, {
      cwd: options.cwd || appDir,
      env: {
        ...env,
        PATH: `${join(homedir(), "tizen-studio/tools/ide/bin")}:${join(
          homedir(),
          "tizen-studio/tools",
        )}:${env.PATH || ""}`,
      },
      stdio: options.stdio || "inherit",
    });
  } catch {
    fail(`Command failed: ${command} ${redactCommandArgs(args).join(" ")}`);
  }
};

const readSecret = (prompt: string) =>
  new Promise<string>((resolve) => {
    if (!process.stdin.isTTY) {
      resolve("");
      return;
    }

    let value = "";

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (char: string) => {
      if (char === "\u0003") {
        process.stdout.write("\n");
        process.exit(130);
      }

      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
        return;
      }

      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += char;
    };

    process.stdin.on("data", onData);
  });

const readPassword = async (value: string | undefined, prompt: string): Promise<string> => {
  if (value) {
    return value;
  }

  return readSecret(prompt);
};

const tizenCli = () => requireFile(process.env.TAIZN_TIZEN_CLI || defaultTizenCli, "Tizen CLI");
const sdb = () => requireFile(process.env.TAIZN_SDB || defaultSdb, "sdb");

const getVariantName = () => {
  const variant = process.env.TAIZN_VARIANT || "development";

  if (variant === "development" || variant === "production") {
    return variant;
  }

  return fail("TAIZN_VARIANT must be either development or production.");
};

const getVariant = () => getConfig().widget.variants[getVariantName()];

const getCertificates = (): Certificates => {
  const certificatesDir = appPath(getConfig().signing.certificateDir);

  return {
    author: requireFile(join(certificatesDir, "author.p12"), "Author certificate"),
    distributor: requireFile(join(certificatesDir, "distributor.p12"), "Distributor certificate"),
  };
};

const createProfile = async () => {
  const password = await readPassword(
    process.env.TAIZN_CERT_PASSWORD,
    "Tizen certificate password: ",
  );

  if (!password) {
    fail("TAIZN_CERT_PASSWORD is required to create the signing profile.");
  }

  const certificates = getCertificates();
  const distributorPassword = process.env.TAIZN_DIST_PASSWORD || password;

  run(tizenCli(), [
    "security-profiles",
    "add",
    "-f",
    "-A",
    "-n",
    getConfig().signing.profile,
    "-a",
    certificates.author,
    "-p",
    password,
    "-d",
    certificates.distributor,
    "-dp",
    distributorPassword,
  ]);

  console.log(`Configured active Tizen signing profile: ${getConfig().signing.profile}`);
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const setXmlAttribute = (tag: string, attribute: string, value: string) => {
  const escapedValue = escapeXml(value);
  const attributePattern = new RegExp(`\\b${attribute}="[^"]*"`);

  if (attributePattern.test(tag)) {
    return tag.replace(attributePattern, `${attribute}="${escapedValue}"`);
  }

  return tag.replace(/\/?>$/, ` ${attribute}="${escapedValue}"$&`);
};

const rewriteConfigForWidget = () => {
  const targetPath = join(stageDir, "config.xml");
  const variant = getVariant();
  let widgetConfig = readFileSync(targetPath, "utf8");

  widgetConfig = widgetConfig.replace(/<tizen:application\b[^>]*\/>/, (tag) =>
    setXmlAttribute(
      setXmlAttribute(tag, "id", variant.applicationId),
      "package",
      variant.packageId,
    ),
  );
  widgetConfig = widgetConfig.replace(
    /<name>[^<]*<\/name>/,
    `<name>${escapeXml(variant.name)}</name>`,
  );

  writeFileSync(targetPath, widgetConfig);
};

const rewriteIndexForWidget = () => {
  const targetPath = join(stageDir, "index.html");
  const webapisScript = '<script src="$WEBAPIS/webapis/webapis.js"></script>';
  let html = readFileSync(appPath(getConfig().widget.indexHtml), "utf8");

  if (getConfig().widget.rewriteAssetUrls) {
    html = html.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./');
  }

  if (getConfig().widget.injectWebapis !== false && !html.includes("$WEBAPIS/webapis/webapis.js")) {
    html = html.replace("</head>", `${webapisScript}</head>`);
  }

  writeFileSync(targetPath, html);
};

const assertBuildOutput = () => {
  const sourceDir = appPath(getConfig().build.output);

  requireFile(sourceDir, "Tizen build output");

  for (const requiredFile of getConfig().build.requiredFiles || []) {
    requireFile(join(sourceDir, requiredFile), `Tizen build output ${requiredFile}`);
  }

  return sourceDir;
};

const stageWidget = () => {
  const sourceDir = assertBuildOutput();
  const variant = getVariant();

  rmSync(stageDir, { force: true, recursive: true });
  rmSync(outputDir, { force: true, recursive: true });
  mkdirSync(stageDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  cpSync(sourceDir, stageDir, { recursive: true });
  copyFileSync(appPath(getConfig().widget.configXml), join(stageDir, "config.xml"));
  copyFileSync(requireFile(appPath(variant.icon), "Tizen widget icon"), join(stageDir, "icon.png"));
  rewriteConfigForWidget();
  rewriteIndexForWidget();
};

const packageWidget = (): string => {
  const [command, ...args] = getConfig().build.command;

  if (!command) {
    fail("taizn.json build.command must include a command.");
  }

  run(command, args, { env: appBuildEnv() });
  stageWidget();
  run(tizenCli(), [
    "package",
    "-t",
    "wgt",
    "-s",
    getConfig().signing.profile,
    "-o",
    outputDir,
    "--",
    stageDir,
  ]);

  const built = execFileSync("find", [outputDir, "-maxdepth", "1", "-name", "*.wgt", "-print"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .at(0);

  if (!built) {
    return fail(`No .wgt package was produced in ${outputDir}`);
  }

  const installable = join(outputDir, `${getVariant().bundleName}.wgt`);

  if (built !== installable) {
    copyFileSync(built, installable);
  }

  console.log(`Packaged ${installable}`);
  return installable;
};

const listSdbDevices = (): SdbDevice[] => {
  const output = execFileSync(sdb(), ["devices"], {
    cwd: appDir,
    encoding: "utf8",
    env: {
      ...baseChildEnv(),
      PATH: `${join(homedir(), "tizen-studio/tools")}:${process.env.PATH || ""}`,
    },
  });

  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = "", state = "", label = ""] = line.split(/\s+/, 3);
      return { id, label, state };
    })
    .filter((device) => device.id && device.state === "device");
};

const resolveInstallTarget = () => {
  if (process.env.TAIZN_TARGET) {
    return process.env.TAIZN_TARGET;
  }

  const devices = listSdbDevices();

  if (devices.length === 1) {
    const [device] = devices;
    console.log(
      `Using connected Tizen target: ${device.id}${device.label ? ` (${device.label})` : ""}`,
    );

    return device.id;
  }

  if (devices.length > 1) {
    fail(
      `Multiple Tizen targets are connected: ${devices.map((device) => device.id).join(", ")}. Set TAIZN_TARGET explicitly.`,
    );
  }

  return null;
};

const installWidget = () => {
  const built = packageWidget();
  const target = resolveInstallTarget();

  if (process.env.TAIZN_TARGET) {
    run(sdb(), ["connect", process.env.TAIZN_TARGET]);
  }

  const installArgs = ["install", "-n", built];

  if (target) {
    installArgs.push("-s", target);
  }

  run(tizenCli(), installArgs);
};

switch (getCommand()) {
  case "profile":
    await createProfile();
    break;

  case "package":
    packageWidget();
    break;

  case "install":
    installWidget();
    break;

  case "--help":
  case "-h":
  case "help":
    console.log(usage);
    break;

  default:
    fail(`Unknown Tizen command: ${getCommand()}`);
}
