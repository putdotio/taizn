import { Console, DateTime, Effect, FileSystem, Option } from "effect";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  ArchiveExists,
  FileSystemFailure,
  InvalidInput,
  MissingFile,
  NothingToArchive,
  TizenStudioIncomplete,
  UnsupportedPlatform,
} from "./errors.js";
import { getPaths, requireFile, TaiznSystem } from "./runtime.js";
import { capture, requireNativeOrRosetta, run } from "./tizen.js";

export type SdkInstallOptions = {
  readonly downloadDir?: string;
  readonly dryRun?: boolean;
  readonly installerUrl?: string;
  readonly packages?: string;
  readonly proxy: string;
  readonly sdkVersion: string;
  readonly showPackages?: boolean;
  readonly studioDir?: string;
};

export type SdkBackupOptions = {
  readonly dryRun?: boolean;
  readonly full?: boolean;
  readonly json?: boolean;
};

export type SdkRestoreOptions = {
  readonly dryRun?: boolean;
  readonly json?: boolean;
};

// Tizen Studio's default home-relative layout. Certificate mode keeps signing
// state only; full mode adds the SDK, its data, extensions, and workspace.
const certificateRoots = ["SamsungCertificate", ".tizen", "tizen-studio-data/profile"];
const fullRoots = [
  "SamsungCertificate",
  ".tizen",
  "tizen-studio",
  "tizen-studio-data",
  "tizen-studio-extensions",
  "tizen-studio-workspace",
];
const restorableRoots = new Set(fullRoots);

const installerPlatforms: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macos-64.bin",
  linux: "ubuntu-64.bin",
};

const fsFailure = (operation: string, path: string) => (cause: unknown) =>
  new FileSystemFailure({ cause, operation, path });

const isExecutableFile = Effect.fn("isExecutableFile")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(path).pipe(Effect.option);
  return Option.isSome(info) && info.value.type === "File" && (info.value.mode & 0o111) !== 0;
});

export const installSdk = Effect.fn("installSdk")(function* (options: SdkInstallOptions) {
  const system = yield* TaiznSystem;
  const paths = yield* getPaths();
  const fs = yield* FileSystem.FileSystem;
  const home = yield* system.homeDir;
  const platform = yield* system.platform;
  const installerSuffix = installerPlatforms[platform];

  if (!installerSuffix || (platform === "linux" && !(yield* system.canRunX86_64))) {
    return yield* new UnsupportedPlatform({
      operation: "taizn sdk install",
      platform,
      supported: "macOS and x86_64 Linux",
    });
  }

  const installerName = `web-cli_Tizen_SDK_${options.sdkVersion}_${installerSuffix}`;
  const installerUrl =
    options.installerUrl ??
    `https://download.tizen.org/sdk/Installer/tizen-sdk_${options.sdkVersion}/${installerName}`;
  const downloadDir = options.downloadDir ? resolve(paths.appDir, options.downloadDir) : undefined;
  const defaultStudioDir = join(home, "tizen-studio");
  const studioDir = options.studioDir ? resolve(paths.appDir, options.studioDir) : defaultStudioDir;
  const packageManager = join(studioDir, "package-manager/package-manager-cli.bin");
  const tizenCli = join(studioDir, "tools/ide/bin/tizen");
  const sdb = join(studioDir, "tools/sdb");
  const packages = options.packages?.trim() || undefined;
  const installed = yield* isExecutableFile(packageManager);

  if (
    !installed &&
    (yield* fs.exists(studioDir).pipe(Effect.mapError(fsFailure("exists", studioDir))))
  ) {
    return yield* new TizenStudioIncomplete({ path: studioDir });
  }

  if (options.dryRun) {
    yield* Console.log(
      JSON.stringify({
        dryRun: true,
        installer: installed ? undefined : { downloadDir, url: installerUrl },
        packages: packages?.split(",") ?? [],
        proxy: options.proxy,
        studioDir,
        studioInstalled: installed,
        tools: { packageManager, sdb, tizenCli },
      }),
    );
    return;
  }

  if (installed) {
    yield* Console.log(`Tizen Studio already installed at ${studioDir}`);
  } else {
    // Without --download-dir the installer lands in a private mkdtemp directory
    // so nobody else can swap it between download and execution.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const directory =
          downloadDir ??
          (yield* fs
            .makeTempDirectoryScoped({ prefix: "taizn-tizen-sdk-" })
            .pipe(Effect.mapError(fsFailure("mkdtemp", "taizn-tizen-sdk-"))));
        const installerPath = join(directory, installerName);
        yield* fs
          .makeDirectory(directory, { recursive: true })
          .pipe(Effect.mapError(fsFailure("mkdir", directory)));
        yield* Console.log(`Downloading ${installerUrl}`);
        yield* run(
          "curl",
          [
            "-fL",
            "-C",
            "-",
            "--retry",
            "20",
            "--retry-delay",
            "5",
            "--retry-all-errors",
            "-o",
            installerPath,
            installerUrl,
          ],
          {},
        );
        yield* fs
          .chmod(installerPath, 0o755)
          .pipe(Effect.mapError(fsFailure("chmod", installerPath)));

        if (platform === "darwin") {
          yield* run("xattr", ["-c", installerPath], {}).pipe(Effect.ignore);
        }

        yield* requireNativeOrRosetta(installerPath, "Tizen SDK installer");
        yield* Console.log(`Installing Tizen SDK ${options.sdkVersion} into ${studioDir}`);
        yield* run(installerPath, ["--accept-license", "--no-java-check", studioDir], {});
      }),
    );

    if (!(yield* isExecutableFile(packageManager))) {
      return yield* new MissingFile({ label: "Tizen package manager", path: packageManager });
    }
  }

  // The package manager reuses a JDK cached here; a stale one breaks package installs.
  const jdkCache = join(home, ".package-manager/jdk");
  yield* fs
    .remove(jdkCache, { force: true, recursive: true })
    .pipe(Effect.mapError(fsFailure("remove", jdkCache)));

  if (packages) {
    yield* Console.log(`Installing Tizen packages: ${packages}`);
    yield* run(
      packageManager,
      ["install", "--accept-license", "--no-java-check", "--proxy", options.proxy, packages],
      {},
    );
  }

  yield* requireFile(tizenCli, "Tizen CLI");
  yield* requireNativeOrRosetta(tizenCli, "Tizen CLI", { bundledJava: true });
  yield* requireFile(sdb, "sdb");
  yield* requireNativeOrRosetta(sdb, "sdb");
  yield* run(tizenCli, ["version"], { finite: true });
  yield* run(sdb, ["version"], { finite: true });

  if (options.showPackages) {
    yield* Console.error("Samsung's package catalog download can be slow or hang.");
    yield* run(packageManager, ["show-pkgs", "--proxy", options.proxy, "--tree"], {});
  }

  yield* Console.log(`Tizen SDK ready at ${studioDir}`);

  if (studioDir !== defaultStudioDir) {
    yield* Console.log(`Set TAIZN_TIZEN_CLI=${tizenCli} and TAIZN_SDB=${sdb} to use this install.`);
  }
});

export const backupSdk = Effect.fn("backupSdk")(function* (
  requestedOutput: string | undefined,
  options: SdkBackupOptions = {},
) {
  const system = yield* TaiznSystem;
  const paths = yield* getPaths();
  const fs = yield* FileSystem.FileSystem;
  const home = yield* system.homeDir;
  const platform = yield* system.platform;

  // Windows ignores POSIX modes, so the archive could not be made owner-only.
  if (platform === "win32") {
    return yield* new UnsupportedPlatform({
      operation: "taizn sdk backup",
      platform,
      supported: "macOS and Linux",
    });
  }

  const mode = options.full ? "full" : "certificates";
  const timestamp = DateTime.formatIso(yield* DateTime.now)
    .replaceAll(/\D/g, "")
    .slice(0, 14);
  const output = requestedOutput
    ? resolve(paths.appDir, requestedOutput)
    : join(home, `tizen-${options.full ? "full" : "certs"}-${timestamp}.tar.gz`);
  const included: string[] = [];

  for (const root of options.full ? fullRoots : certificateRoots) {
    const path = join(home, root);

    if (!(yield* fs.exists(path).pipe(Effect.mapError(fsFailure("exists", path))))) {
      yield* Console.error(`skip missing ${path}`);
      continue;
    }

    // tar stores a symlinked root as the link itself, not the signing state behind it.
    if ((yield* pathKind(path)) === "link") {
      return yield* new InvalidInput({
        details: `${path} is a symlink; the archive would hold only the link`,
        label: "backup source",
      });
    }

    included.push(root);
  }

  if (included.length === 0) {
    return yield* new NothingToArchive({ home, mode });
  }

  const requireOutsideRoots = Effect.fn("requireOutsideRoots")(function* (directory: string) {
    for (const root of included) {
      const rootPath = join(home, root);
      const resolvedRoot = yield* fs
        .realPath(rootPath)
        .pipe(Effect.mapError(fsFailure("realpath", rootPath)));

      if (isInside(rootPath, directory) || isInside(resolvedRoot, directory)) {
        return yield* new InvalidInput({
          details: `output must be outside the archived ${rootPath}. Received: ${output}`,
          label: "backup output",
        });
      }
    }
  });

  yield* requireOutsideRoots(dirname(output));

  if (options.dryRun) {
    const plan = { archive: output, dryRun: true, mode, paths: included };
    yield* Console.log(
      options.json
        ? JSON.stringify(plan)
        : [`Would create ${output} (${mode}):`, ...included.map((root) => `- ${root}`)].join("\n"),
    );
    return;
  }

  const outputDir = dirname(output);
  yield* fs
    .makeDirectory(outputDir, { recursive: true })
    .pipe(Effect.mapError(fsFailure("mkdir", outputDir)));
  yield* requireOutsideRoots(
    yield* fs.realPath(outputDir).pipe(Effect.mapError(fsFailure("realpath", outputDir))),
  );
  // Stage privately beside the output, then hard-link into place: link() never
  // replaces an existing entry and a failed tar never leaves a partial archive.
  yield* Effect.scoped(
    Effect.gen(function* () {
      const staging = yield* fs
        .makeTempDirectoryScoped({ directory: outputDir, prefix: ".taizn-sdk-backup." })
        .pipe(Effect.mapError(fsFailure("mkdtemp", outputDir)));
      yield* fs.chmod(staging, 0o700).pipe(Effect.mapError(fsFailure("chmod", staging)));
      const archive = join(staging, "archive.tar.gz");
      yield* fs
        .writeFileString(archive, "", { flag: "wx", mode: 0o600 })
        .pipe(Effect.mapError(fsFailure("write", archive)));
      yield* run("tar", ["-C", home, "-czf", archive, ...included], {});
      yield* fs.chmod(archive, 0o600).pipe(Effect.mapError(fsFailure("chmod", archive)));
      yield* fs
        .link(archive, output)
        .pipe(
          Effect.mapError((cause) =>
            cause.reason._tag === "AlreadyExists"
              ? new ArchiveExists({ path: output })
              : new FileSystemFailure({ cause, operation: "link", path: output }),
          ),
        );
    }),
  );

  if (options.json) {
    yield* Console.log(JSON.stringify({ archive: output, dryRun: false, mode, paths: included }));
    return;
  }

  yield* Console.log(`Created ${output}`);
  yield* Console.log(`mode: ${mode}`);
  yield* Console.log("contains:");

  for (const root of included) {
    yield* Console.log(`- ${root}`);
  }

  yield* Console.log("This archive holds signing certificates and device keys. Keep it private.");
});

export const restoreSdk = Effect.fn("restoreSdk")(function* (
  requestedArchive: string,
  options: SdkRestoreOptions = {},
) {
  const system = yield* TaiznSystem;
  const paths = yield* getPaths();
  const fs = yield* FileSystem.FileSystem;
  const home = yield* system.homeDir;
  const archive = resolve(paths.appDir, requestedArchive);
  const info = yield* fs.stat(archive).pipe(Effect.option);

  if (Option.isNone(info) || info.value.type !== "File") {
    return yield* new MissingFile({ label: "SDK archive", path: archive });
  }

  // Validate and extract one private copy so the archive cannot change in between.
  const roots = yield* Effect.scoped(
    Effect.gen(function* () {
      const staging = yield* fs
        .makeTempDirectoryScoped({ prefix: "taizn-sdk-restore-" })
        .pipe(Effect.mapError(fsFailure("mkdtemp", "taizn-sdk-restore-")));
      const copy = join(staging, "archive.tar.gz");
      yield* fs.copyFile(archive, copy).pipe(Effect.mapError(fsFailure("copy", archive)));
      const listing = yield* capture("tar", ["-tzf", copy], { unbounded: true });
      const entries = yield* archiveEntries(listing);
      yield* requireNoSymlinkedTargets(home, entries);
      const roots = [...new Set(entries.map((entry) => entry.split("/")[0] ?? ""))];

      if (!options.dryRun) {
        yield* run("tar", ["-C", home, "-xzf", copy], {});
      }

      return roots;
    }),
  );
  const result = { archive, dryRun: options.dryRun === true, home, paths: roots };

  yield* Console.log(options.json ? JSON.stringify(result) : describeRestore(result));
});

const describeRestore = (result: {
  readonly archive: string;
  readonly dryRun: boolean;
  readonly home: string;
  readonly paths: readonly string[];
}) =>
  [
    `${result.dryRun ? "Would restore" : "Restored"} ${result.archive} into ${result.home}:`,
    ...result.paths.map((path) => `- ${path}`),
  ].join("\n");

const isInside = (parent: string, path: string) => {
  const fromParent = relative(parent, path);
  return !fromParent.startsWith("..") && !isAbsolute(fromParent);
};

const pathKind = Effect.fn("pathKind")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readLink(path).pipe(
    Effect.as("link" as const),
    Effect.catch((cause) =>
      cause.reason._tag === "NotFound"
        ? Effect.succeed("missing" as const)
        : Effect.succeed("other" as const),
    ),
  );
});

// tar writes through existing symlinks on the extraction path, so refuse any
// existing destination component that is one.
const requireNoSymlinkedTargets = Effect.fn("requireNoSymlinkedTargets")(function* (
  home: string,
  entries: readonly string[],
) {
  const kinds = new Map<string, "link" | "missing" | "other">();

  for (const entry of entries) {
    const segments = entry.split("/").filter(Boolean);

    for (let index = 1; index <= segments.length; index++) {
      const path = segments.slice(0, index).join("/");
      const kind = kinds.get(path) ?? (yield* pathKind(join(home, path)));
      kinds.set(path, kind);

      if (kind === "link") {
        return yield* new InvalidInput({
          details: `refusing to extract through symlinked ${join(home, path)}`,
          label: "SDK archive",
        });
      }

      if (kind === "missing") {
        break;
      }
    }
  }
});

const archiveEntries = Effect.fn("archiveEntries")(function* (listing: string) {
  const entries: string[] = [];

  for (const line of listing.split("\n")) {
    const entry = line.trim().replace(/^(\.\/)+/u, "");

    if (entry === "" || entry === ".") {
      continue;
    }

    const segments = entry.split("/");
    const root = segments[0] ?? "";

    if (isAbsolute(entry) || segments.includes("..") || !restorableRoots.has(root)) {
      return yield* new InvalidInput({
        details: `unexpected entry ${line}; only ${fullRoots.join(", ")} are restored`,
        label: "SDK archive",
      });
    }

    entries.push(entry);
  }

  if (entries.length === 0) {
    return yield* new InvalidInput({ details: "archive is empty", label: "SDK archive" });
  }

  return entries;
});
