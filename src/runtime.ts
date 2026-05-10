import { execFileSync, type StdioOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
};

export const appDir = process.cwd();
export const configPath = join(appDir, "taizn.json");
export const taiznDir = join(appDir, ".taizn");
export const envPath = join(taiznDir, ".env");
export const stageDir = join(taiznDir, "build", "stage");
export const outputDir = join(taiznDir, "build", "output");

export const appPath = (path: string) => (isAbsolute(path) ? path : join(appDir, path));

export const loadLocalEnv = () => {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
};

export const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

export const requireFile = (path: string, label: string) => {
  if (!existsSync(path)) {
    fail(`${label} not found: ${path}`);
  }

  return path;
};

export const baseChildEnv = () => {
  const env = { ...process.env };

  // Codex/Vite+ file tracing can inject an arm64 preload dylib. The Tizen
  // CLI ships x86_64 binaries on macOS, so inherited preloads can crash it.
  delete env.DYLD_INSERT_LIBRARIES;

  return env;
};

export const appBuildEnv = () => {
  const env = baseChildEnv();

  for (const key of Object.keys(env)) {
    if (key.startsWith("TAIZN_") || key.startsWith("TIZEN_")) {
      delete env[key];
    }
  }

  delete env.SDB;
  return env;
};

export const run = (command: string, args: string[], options: RunOptions = {}) => {
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

export const tizenCli = (path: string | undefined) =>
  requireFile(path || join(homedir(), "tizen-studio/tools/ide/bin/tizen"), "Tizen CLI");

export const sdb = (path: string | undefined) =>
  requireFile(path || join(homedir(), "tizen-studio/tools/sdb"), "sdb");

export const readPassword = async (value: string | undefined, prompt: string): Promise<string> => {
  if (value) {
    return value;
  }

  return readSecret(prompt);
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
