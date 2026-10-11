import { Console, DateTime, Effect, FileSystem, Option } from "effect";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
import { requireNativeOrRosetta, run } from "./tizen.js";

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
const certificateRoots = [
  "SamsungCertificate",
  ".tizen",
  "tizen-studio-data/keystore",
  "tizen-studio-data/profile",
];
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

  // Samsung's installer rejects these destinations but still exits 0.
  if (!installed && (!isInside(home, studioDir) || /[^\x21-\x7e]/.test(studioDir))) {
    return yield* new InvalidInput({
      details: `Samsung's installer needs a path inside ${home} without spaces or non-ASCII characters. Received: ${studioDir}`,
      label: "studio dir",
    });
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
  const skipped: string[] = [];

  for (const root of options.full ? fullRoots : certificateRoots) {
    const path = join(home, root);
    const kind = yield* pathKind(path);

    if (kind === "missing") {
      skipped.push(root);
      continue;
    }

    // tar stores a symlinked root as the link itself, not the signing state behind it.
    if (kind === "SymbolicLink") {
      return yield* new InvalidInput({
        details: `${path} is a symlink; the archive would hold only the link`,
        label: "backup source",
      });
    }

    included.push(root);
  }

  if (!options.json) {
    for (const root of skipped) {
      yield* Console.error(`skip missing ${join(home, root)}`);
    }
  }

  if (included.length === 0) {
    return yield* new NothingToArchive({ home, mode });
  }

  const outputDir = dirname(output);
  const resolvedOutputDir = yield* resolveExisting(outputDir);

  for (const root of included) {
    const rootPath = join(home, root);
    const resolvedRoot = yield* fs
      .realPath(rootPath)
      .pipe(Effect.mapError(fsFailure("realpath", rootPath)));

    if (isInside(resolvedRoot, resolvedOutputDir)) {
      return yield* new InvalidInput({
        details: `output must be outside the archived ${rootPath}. Received: ${output}`,
        label: "backup output",
      });
    }
  }

  // Restore rejects links that leave the backup roots, so refuse to write an
  // archive it could not restore.
  yield* validateTree(home, included);
  const result = {
    archive: output,
    dryRun: options.dryRun === true,
    mode,
    paths: included,
    skipped,
  };

  if (!result.dryRun) {
    yield* fs
      .makeDirectory(outputDir, { recursive: true })
      .pipe(Effect.mapError(fsFailure("mkdir", outputDir)));
    // Stage in a private directory beside the output, then rename into place so
    // a failed tar never leaves a partial archive.
    if ((yield* pathKind(output)) !== "missing") {
      return yield* new ArchiveExists({ path: output });
    }

    yield* Effect.scoped(
      Effect.gen(function* () {
        const staging = yield* fs
          .makeTempDirectoryScoped({ directory: outputDir, prefix: ".taizn-sdk-backup." })
          .pipe(Effect.mapError(fsFailure("mkdtemp", outputDir)));
        yield* fs.chmod(staging, 0o700).pipe(Effect.mapError(fsFailure("chmod", staging)));
        const archive = join(staging, "archive.tar.gz");
        yield* run("tar", ["-C", home, "-czf", archive, ...included], { quiet: options.json });
        yield* fs.chmod(archive, 0o600).pipe(Effect.mapError(fsFailure("chmod", archive)));
        yield* fs.rename(archive, output).pipe(Effect.mapError(fsFailure("rename", output)));
      }),
    );
  }

  if (options.json) {
    yield* Console.log(JSON.stringify(result));
    return;
  }

  yield* Console.log(`${result.dryRun ? "Would create" : "Created"} ${output} (${mode}):`);

  for (const root of included) {
    yield* Console.log(`- ${root}`);
  }

  if (!result.dryRun) {
    yield* Console.log("This archive holds signing certificates and device keys. Keep it private.");
  }
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

  // Extract into a fresh private directory, validate what tar actually wrote,
  // then rename it into home. Names, link targets, and entry types are checked
  // on disk, so nothing tar does on extraction can reach outside the staging tree.
  // Real restores stage inside home so the final renames stay on one filesystem.
  const roots = yield* Effect.scoped(
    Effect.gen(function* () {
      const staging = yield* fs
        .makeTempDirectoryScoped({
          directory: options.dryRun ? undefined : home,
          prefix: ".taizn-sdk-restore.",
        })
        .pipe(Effect.mapError(fsFailure("mkdtemp", home)));
      yield* fs.chmod(staging, 0o700).pipe(Effect.mapError(fsFailure("chmod", staging)));
      yield* run("tar", ["-C", staging, "-xzf", archive], { quiet: options.json });
      const roots = yield* fs
        .readDirectory(staging)
        .pipe(Effect.mapError(fsFailure("readdir", staging)));

      if (roots.length === 0) {
        return yield* invalidArchive("archive is empty");
      }

      yield* validateTree(staging, roots);

      if (
        roots.includes("tizen-studio") &&
        (yield* pathKind(join(home, "tizen-studio"))) !== "missing"
      ) {
        return yield* invalidArchive(
          `${join(home, "tizen-studio")} already exists; move it aside before restoring a full backup`,
        );
      }

      const moves = yield* planMoves(staging, home, roots);

      if (!options.dryRun) {
        for (const path of moves) {
          const from = join(staging, path);
          const to = join(home, path);
          yield* fs.rename(from, to).pipe(Effect.mapError(fsFailure("rename", to)));
        }
      }

      return [...roots].sort();
    }),
  );
  const result = { archive, dryRun: options.dryRun === true, home, paths: roots };

  if (options.json) {
    yield* Console.log(JSON.stringify(result));
    return;
  }

  yield* Console.log(
    [
      `${result.dryRun ? "Would restore" : "Restored"} ${archive} into ${home}:`,
      ...roots.map((root) => `- ${root}`),
    ].join("\n"),
  );
});

const isInside = (parent: string, path: string) => {
  const fromParent = relative(parent, path);
  return !fromParent.startsWith("..") && !isAbsolute(fromParent);
};

type PathKind = "missing" | FileSystem.File.Type;

// FileSystem has no lstat: readLink tells links apart, stat types everything else.
const pathKind = Effect.fn("pathKind")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const link = yield* fs.readLink(path).pipe(
    Effect.as("link" as const),
    Effect.catch((cause) =>
      Effect.succeed(cause.reason._tag === "NotFound" ? ("missing" as const) : ("other" as const)),
    ),
  );

  if (link === "link") {
    return "SymbolicLink" satisfies PathKind;
  }

  if (link === "missing") {
    return "missing" satisfies PathKind;
  }

  const info = yield* fs.stat(path).pipe(Effect.mapError(fsFailure("stat", path)));
  return info.type satisfies PathKind;
});

const invalidArchive = (details: string) => new InvalidInput({ details, label: "SDK archive" });

// Walks `roots` under `base` without following links. Only regular files,
// directories, and relative symlinks that stay inside the backup roots pass.
const validateTree = Effect.fn("validateTree")(function* (base: string, roots: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const pending = [...roots];

  while (pending.length > 0) {
    const entry = pending.pop() ?? "";
    const path = join(base, entry);

    if (!restorableRoots.has(entry.split(sep)[0] ?? "")) {
      return yield* invalidArchive(
        `unexpected entry ${JSON.stringify(entry)}; only ${fullRoots.join(", ")} are restored`,
      );
    }

    const kind = yield* pathKind(path);

    if (kind === "Directory") {
      const children = yield* fs
        .readDirectory(path)
        .pipe(Effect.mapError(fsFailure("readdir", path)));
      pending.push(...children.map((child) => join(entry, child)));
    } else if (kind === "SymbolicLink") {
      const target = yield* fs.readLink(path).pipe(Effect.mapError(fsFailure("readlink", path)));
      const resolved = relative(base, resolve(dirname(path), target));

      if (isAbsolute(target) || !restorableRoots.has(resolved.split(sep)[0] ?? "")) {
        return yield* invalidArchive(`symlink ${entry} points outside the backup paths`);
      }
    } else if (kind !== "File") {
      return yield* invalidArchive(
        `${entry} is a ${kind}; only files, directories, and symlinks are restored`,
      );
    }
  }
});

const resolveExisting = Effect.fn("resolveExisting")(function* (
  path: string,
): Effect.fn.Return<string, FileSystemFailure, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const resolved = yield* fs.realPath(path).pipe(Effect.option);

  if (Option.isSome(resolved)) {
    return resolved.value;
  }

  const parent = dirname(path);
  return parent === path ? path : join(yield* resolveExisting(parent), relative(parent, path));
});

// Plans the renames that publish the staged tree into home. Missing destinations
// take the whole staged subtree; existing directories are merged. rename()
// replaces an existing file or symlink without following it, but a staged
// directory over an existing symlink or a file/directory clash stops the
// restore before anything moves.
const planMoves = Effect.fn("planMoves")(function* (
  staging: string,
  home: string,
  names: readonly string[],
  prefix = "",
): Effect.fn.Return<readonly string[], FileSystemFailure | InvalidInput, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const moves: string[] = [];

  for (const name of names) {
    const path = join(prefix, name);
    const target = join(home, path);
    const existing = yield* pathKind(target);

    if (existing === "missing") {
      moves.push(path);
      continue;
    }

    const staged = yield* pathKind(join(staging, path));

    if (existing === "SymbolicLink" && staged === "Directory") {
      return yield* invalidArchive(`refusing to extract through symlinked ${target}`);
    }

    if (staged === "Directory" && existing === "Directory") {
      const children = yield* fs
        .readDirectory(join(staging, path))
        .pipe(Effect.mapError(fsFailure("readdir", join(staging, path))));
      moves.push(...(yield* planMoves(staging, home, children, path)));
    } else if (staged !== "Directory" && (existing === "File" || existing === "SymbolicLink")) {
      moves.push(path);
    } else {
      return yield* invalidArchive(`${target} exists as a ${existing}; it cannot be replaced`);
    }
  }

  return moves;
});
