import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaiznContext } from "./context.js";
import type { TizenConfig, TizenVariant } from "./config.js";
import {
  appBuildEnv,
  appDir,
  appPath,
  baseChildEnv,
  fail,
  outputDir,
  readPassword,
  requireFile,
  run,
  sdb,
  stageDir,
  tizenCli,
} from "./runtime.js";
import { escapeXml, setXmlAttribute } from "./xml.js";

type Certificates = {
  author: string;
  distributor: string;
};

type SdbDevice = {
  id: string;
  label: string;
  state: string;
};

export const createProfile = async ({ config, env }: TaiznContext) => {
  const password = await readPassword(env.certPassword, "Tizen certificate password: ");

  if (!password) {
    fail("TAIZN_CERT_PASSWORD is required to create the signing profile.");
  }

  const certificates = getCertificates(config);
  const distributorPassword = env.distPassword || password;

  run(tizenCli(env.tizenCli), [
    "security-profiles",
    "add",
    "-f",
    "-A",
    "-n",
    config.signing.profile,
    "-a",
    certificates.author,
    "-p",
    password,
    "-d",
    certificates.distributor,
    "-dp",
    distributorPassword,
  ]);

  console.log(`Configured active Tizen signing profile: ${config.signing.profile}`);
};

export const packageWidget = ({ config, env }: TaiznContext): string => {
  const [command, ...args] = config.build.command;

  run(command, args, { env: appBuildEnv() });
  stageWidget(config, getVariant(config, env.variant));
  run(tizenCli(env.tizenCli), [
    "package",
    "-t",
    "wgt",
    "-s",
    config.signing.profile,
    "-o",
    outputDir,
    "--",
    stageDir,
  ]);

  const built = findBuiltWidget();
  const installable = join(outputDir, `${getVariant(config, env.variant).bundleName}.wgt`);

  if (built !== installable) {
    copyFileSync(built, installable);
  }

  console.log(`Packaged ${installable}`);
  return installable;
};

export const installWidget = (context: TaiznContext) => {
  const built = packageWidget(context);
  const target = resolveInstallTarget(context.env);

  if (context.env.target) {
    run(sdb(context.env.sdb), ["connect", context.env.target]);
  }

  const installArgs = ["install", "-n", built];

  if (target) {
    installArgs.push("-s", target);
  }

  run(tizenCli(context.env.tizenCli), installArgs);
};

const getVariant = (config: TizenConfig, variant: "development" | "production") =>
  config.widget.variants[variant];

const getCertificates = (config: TizenConfig): Certificates => {
  const certificatesDir = appPath(config.signing.certificateDir);

  return {
    author: requireFile(join(certificatesDir, "author.p12"), "Author certificate"),
    distributor: requireFile(join(certificatesDir, "distributor.p12"), "Distributor certificate"),
  };
};

const rewriteConfigForWidget = (variant: TizenVariant) => {
  const targetPath = join(stageDir, "config.xml");
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

const rewriteIndexForWidget = (config: TizenConfig) => {
  const targetPath = join(stageDir, "index.html");
  const webapisScript = '<script src="$WEBAPIS/webapis/webapis.js"></script>';
  let html = readFileSync(appPath(config.widget.indexHtml), "utf8");

  if (config.widget.rewriteAssetUrls) {
    html = html.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./');
  }

  if (config.widget.injectWebapis !== false && !html.includes("$WEBAPIS/webapis/webapis.js")) {
    html = html.replace("</head>", `${webapisScript}</head>`);
  }

  writeFileSync(targetPath, html);
};

const assertBuildOutput = (config: TizenConfig) => {
  const sourceDir = appPath(config.build.output);

  requireFile(sourceDir, "Tizen build output");

  for (const requiredFile of config.build.requiredFiles || []) {
    requireFile(join(sourceDir, requiredFile), `Tizen build output ${requiredFile}`);
  }

  return sourceDir;
};

const stageWidget = (config: TizenConfig, variant: TizenVariant) => {
  const sourceDir = assertBuildOutput(config);

  rmSync(stageDir, { force: true, recursive: true });
  rmSync(outputDir, { force: true, recursive: true });
  mkdirSync(stageDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  cpSync(sourceDir, stageDir, { recursive: true });
  copyFileSync(appPath(config.widget.configXml), join(stageDir, "config.xml"));
  copyFileSync(requireFile(appPath(variant.icon), "Tizen widget icon"), join(stageDir, "icon.png"));
  rewriteConfigForWidget(variant);
  rewriteIndexForWidget(config);
};

const findBuiltWidget = () => {
  const built = execFileSync("find", [outputDir, "-maxdepth", "1", "-name", "*.wgt", "-print"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .at(0);

  if (typeof built === "string") {
    return built;
  }

  return fail(`No .wgt package was produced in ${outputDir}`);
};

const listSdbDevices = (sdbPath: string | undefined): SdbDevice[] => {
  const output = execFileSync(sdb(sdbPath), ["devices"], {
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
    .map(parseSdbDevice)
    .filter((device) => device.id && device.state === "device");
};

const parseSdbDevice = (line: string): SdbDevice => {
  const [id = "", state = "", label = ""] = line.split(/\s+/, 3);
  return { id, label, state };
};

const resolveInstallTarget = (env: TaiznContext["env"]) => {
  if (env.target) {
    return env.target;
  }

  const devices = listSdbDevices(env.sdb);

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
