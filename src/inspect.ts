import { basename } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Console, Effect, FileSystem } from "effect";
import type { TaiznContext } from "./context.js";
import { extractAssetUrls, readConfiguredIndexHtml } from "./assets.js";
import { FileSystemFailure, InvalidInput } from "./errors.js";
import { jsonForOutput, writeJsonArtifact } from "./io.js";
import { requireFile } from "./runtime.js";

type InspectOptions = {
  readonly artifact?: string;
  readonly fields?: string;
  readonly json?: boolean;
};

type ZipEntry = {
  readonly content?: Buffer;
  readonly compressedSize: number;
  readonly name: string;
  readonly uncompressedSize: number;
};

type ArchiveConfig = {
  readonly applicationId?: string;
  readonly name?: string;
  readonly packageId?: string;
  readonly privileges: readonly string[];
};

type ArchivePayload = {
  readonly config?: ArchiveConfig;
  readonly entryCount: number;
  readonly file: string;
};

export const inspectWidgetArchive = Effect.fn("inspectWidgetArchive")(function* (
  path: string,
  options: InspectOptions = {},
) {
  yield* requireFile(path, "Tizen widget archive");
  const entries = yield* readZipEntries(path);
  const configXml = entries.find((entry) => entry.name === "config.xml")?.content?.toString("utf8");
  const result = {
    config: configXml ? inspectConfigXml(configXml) : undefined,
    entryCount: entries.length,
    entries: entries.map((entry) => ({
      compressedSize: entry.compressedSize,
      name: entry.name,
      uncompressedSize: entry.uncompressedSize,
    })),
    file: path,
    inspectedAt: new Date().toISOString(),
  };

  if (options.artifact) {
    yield* writeJsonArtifact(options.artifact, result);
  }

  if (options.json) {
    yield* Console.log(yield* jsonForOutput(result, { fields: options.fields }));
    return;
  }

  yield* Console.log(`Widget archive: ${basename(path)}`);
  yield* Console.log(`entries: ${entries.length}`);
  if (result.config?.applicationId) {
    yield* Console.log(`application_id: ${result.config.applicationId}`);
  }
  if (result.config?.packageId) {
    yield* Console.log(`package_id: ${result.config.packageId}`);
  }
});

export const validateSubmission = Effect.fn("validateSubmission")(function* (
  { config, env }: TaiznContext,
  path: string | undefined,
  options: InspectOptions = {},
) {
  const variant = config.widget.variants[env.variant];
  const indexHtml = yield* readConfiguredIndexHtml(config, variant);
  const hostedAssets = extractAssetUrls(indexHtml);
  const archive = path ? yield* inspectArchivePayload(path) : undefined;
  const problems = [
    ...validateIdentifier("applicationId", variant.applicationId),
    ...validateIdentifier("packageId", variant.packageId),
    ...validateArchive(archive, variant),
  ];
  const result = {
    archive,
    hostedAssets,
    ok: problems.length === 0,
    problems,
    variant: {
      applicationId: variant.applicationId,
      name: variant.name,
      packageId: variant.packageId,
      selected: env.variant,
    },
    validatedAt: new Date().toISOString(),
  };

  if (options.artifact) {
    yield* writeJsonArtifact(options.artifact, result);
  }

  if (options.json) {
    yield* Console.log(yield* jsonForOutput(result, { fields: options.fields }));
    if (!result.ok) {
      return yield* InvalidInput.make({
        details: problems.join("; "),
        label: "submission validation",
      });
    }
    return;
  }

  yield* Console.log(result.ok ? "Submission validation: ok" : "Submission validation: failed");
  yield* Console.log(`variant: ${env.variant}`);
  yield* Console.log(`hosted_assets: ${hostedAssets.length}`);
  for (const problem of problems) {
    yield* Console.log(`- ${problem}`);
  }
  if (!result.ok) {
    return yield* InvalidInput.make({
      details: problems.join("; "),
      label: "submission validation",
    });
  }
});

const inspectArchivePayload = Effect.fn("inspectArchivePayload")(function* (path: string) {
  yield* requireFile(path, "Tizen widget archive");
  const entries = yield* readZipEntries(path);
  const configXml = entries.find((entry) => entry.name === "config.xml")?.content?.toString("utf8");

  return {
    config: configXml ? inspectConfigXml(configXml) : undefined,
    entryCount: entries.length,
    file: path,
  };
});

const readZipEntries = Effect.fn("readZipEntries")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const bytes = yield* fs
    .readFile(path)
    .pipe(Effect.mapError((cause) => FileSystemFailure.make({ cause, operation: "read", path })));
  const buffer = Buffer.from(bytes);

  return yield* Effect.try({
    try: () => parseZipEntries(buffer),
    catch: (cause) =>
      InvalidInput.make({
        details: cause instanceof Error ? cause.message : String(cause),
        label: "Tizen widget archive",
      }),
  });
});

const parseZipEntries = (buffer: Buffer): readonly ZipEntry[] => {
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);

    if (signature !== 0x04034b50) {
      break;
    }

    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if ((flags & 0x08) !== 0) {
      throw new Error("archives with data descriptors are not supported");
    }

    if (dataEnd > buffer.length) {
      throw new Error("archive entry extends past end of file");
    }

    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataEnd);
    const content =
      method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : undefined;

    entries.push({
      compressedSize,
      content,
      name,
      uncompressedSize,
    });

    offset = dataEnd;
  }

  if (entries.length === 0) {
    throw new Error("no ZIP local file headers found");
  }

  return entries;
};

const inspectConfigXml = (source: string) => ({
  applicationId: matchXmlAttribute(source, "tizen:application", "id"),
  name: matchXmlText(source, "name"),
  packageId: matchXmlAttribute(source, "tizen:application", "package"),
  privileges: matchXmlAttributes(source, "tizen:privilege", "name"),
});

const validateArchive = (
  archive: ArchivePayload | undefined,
  variant: TaiznContext["config"]["widget"]["variants"]["development"],
) => {
  if (!archive) {
    return [];
  }

  const problems: string[] = [];

  if (!archive.config) {
    return ["archive config.xml is missing"];
  }

  if (archive.config.applicationId !== variant.applicationId) {
    problems.push(
      `archive applicationId ${archive.config.applicationId ?? "missing"} does not match ${variant.applicationId}`,
    );
  }

  if (archive.config.packageId !== variant.packageId) {
    problems.push(
      `archive packageId ${archive.config.packageId ?? "missing"} does not match ${variant.packageId}`,
    );
  }

  return problems;
};

const validateIdentifier = (label: string, value: string) => {
  const problems: string[] = [];

  if (hasControlCharacter(value)) {
    problems.push(`${label} contains control characters`);
  }

  if (value.includes("?") || value.includes("#")) {
    problems.push(`${label} contains query or fragment characters`);
  }

  if (value.split(/[\\/]+/u).includes("..") || /%2e/iu.test(value)) {
    problems.push(`${label} contains path traversal segments`);
  }

  if (!/^[A-Za-z][A-Za-z0-9._-]*$/u.test(value)) {
    problems.push(
      `${label} must start with a letter and contain only letters, numbers, dots, underscores, or hyphens`,
    );
  }

  return problems;
};

const matchXmlAttribute = (source: string, tagName: string, attribute: string) => {
  const tag = source.match(new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, "u"))?.[0];
  return tag?.match(new RegExp(`\\b${escapeRegExp(attribute)}=["']([^"']+)["']`, "u"))?.[1];
};

const matchXmlAttributes = (source: string, tagName: string, attribute: string) => {
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, "gu");
  const values: string[] = [];
  let match = pattern.exec(source);

  while (match) {
    const value = match[0].match(
      new RegExp(`\\b${escapeRegExp(attribute)}=["']([^"']+)["']`, "u"),
    )?.[1];
    if (value) {
      values.push(value);
    }
    match = pattern.exec(source);
  }

  return values;
};

const matchXmlText = (source: string, tagName: string) =>
  source.match(
    new RegExp(`<${escapeRegExp(tagName)}>([^<]+)</${escapeRegExp(tagName)}>`, "u"),
  )?.[1];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const hasControlCharacter = (value: string) => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};
