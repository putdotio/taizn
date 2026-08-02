import { createHash } from "node:crypto";
import { basename } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Console, Effect, FileSystem } from "effect";
import { SaxesParser, type SaxesTagNS } from "saxes";
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
  readonly content: Buffer;
  readonly compressedSize: number;
  readonly name: string;
  readonly uncompressedSize: number;
};

type ArchiveConfig = {
  readonly applicationId?: string;
  readonly declarations: {
    readonly autoRestart: boolean;
    readonly onBoot: boolean;
    readonly ticker: boolean;
  };
  readonly features: readonly string[];
  readonly name?: string;
  readonly packageId?: string;
  readonly privileges: readonly string[];
  readonly requiredTizenVersion?: string;
  readonly version?: string;
};

type ArchivePayload = {
  readonly config?: ArchiveConfig;
  readonly entryCount: number;
  readonly file: string;
  readonly manifest: SubmissionManifest;
};

type SubmissionManifest = {
  readonly file: {
    readonly name: string;
    readonly sha256: string;
    readonly size: number;
  };
  readonly schemaVersion: 1;
  readonly signatures: {
    readonly authorPresent: boolean;
    readonly distributorPresent: boolean;
  };
  readonly widget: ArchiveConfig;
};

export const inspectWidgetArchive = Effect.fn("inspectWidgetArchive")(function* (
  path: string,
  options: InspectOptions = {},
) {
  const { entries, payload } = yield* readWidgetArchive(path);
  const result = {
    config: payload.config,
    entryCount: entries.length,
    entries: entries.map((entry) => ({
      compressedSize: entry.compressedSize,
      name: entry.name,
      uncompressedSize: entry.uncompressedSize,
    })),
    file: path,
    inspectedAt: new Date().toISOString(),
    manifest: payload.manifest,
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

export const prepareSubmission = Effect.fn("prepareSubmission")(function* (
  path: string,
  options: InspectOptions = {},
) {
  const { payload } = yield* readWidgetArchive(path);
  const manifest = payload.manifest;

  if (options.artifact) {
    yield* writeJsonArtifact(options.artifact, manifest);
  }

  if (options.json) {
    yield* Console.log(yield* jsonForOutput(manifest, { fields: options.fields }));
    return;
  }

  yield* Console.log(`Submission manifest: ${manifest.file.name}`);
  yield* Console.log(`size: ${manifest.file.size}`);
  yield* Console.log(`sha256: ${manifest.file.sha256}`);
  if (manifest.widget.applicationId) {
    yield* Console.log(`application_id: ${manifest.widget.applicationId}`);
  }
  if (manifest.widget.version) {
    yield* Console.log(`version: ${manifest.widget.version}`);
  }
  yield* Console.log(
    `author_signature: ${manifest.signatures.authorPresent ? "present" : "missing"}`,
  );
  yield* Console.log(
    `distributor_signature: ${manifest.signatures.distributorPresent ? "present" : "missing"}`,
  );
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
  const { payload } = yield* readWidgetArchive(path);
  return payload;
});

const readWidgetArchive = Effect.fn("readWidgetArchive")(function* (path: string) {
  yield* requireFile(path, "Tizen widget archive");
  const { buffer, entries } = yield* readZipArchive(path);
  const configXml = entries.find((entry) => entry.name === "config.xml")?.content.toString("utf8");
  const config = configXml ? yield* inspectConfigXml(configXml) : undefined;
  const widget: ArchiveConfig = config ?? {
    declarations: { autoRestart: false, onBoot: false, ticker: false },
    features: [],
    privileges: [],
  };
  const manifest: SubmissionManifest = {
    file: {
      name: basename(path),
      sha256: createHash("sha256").update(buffer).digest("hex"),
      size: buffer.byteLength,
    },
    schemaVersion: 1,
    signatures: {
      authorPresent: entries.some((entry) => entry.name === "author-signature.xml"),
      distributorPresent: entries.some((entry) => entry.name === "signature1.xml"),
    },
    widget,
  };

  return {
    entries,
    payload: {
      config,
      entryCount: entries.length,
      file: path,
      manifest,
    },
  };
});

const readZipArchive = Effect.fn("readZipArchive")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const bytes = yield* fs
    .readFile(path)
    .pipe(Effect.mapError((cause) => FileSystemFailure.make({ cause, operation: "read", path })));
  const buffer = Buffer.from(bytes);

  const entries = yield* Effect.try({
    try: () => parseZipEntries(buffer),
    catch: (cause) =>
      InvalidInput.make({
        details: cause instanceof Error ? cause.message : String(cause),
        label: "Tizen widget archive",
      }),
  });

  return { buffer, entries };
});

const parseZipEntries = (buffer: Buffer): readonly ZipEntry[] => {
  const endOffset = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const diskEntryCount = buffer.readUInt16LE(endOffset + 8);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const commentLength = buffer.readUInt16LE(endOffset + 20);

  if (endOffset + 22 + commentLength !== buffer.length) {
    throw new Error("ZIP end-of-central-directory comment length is inconsistent");
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount) {
    throw new Error("multi-disk ZIP archives are not supported");
  }
  if (entryCount === 0) {
    throw new Error("ZIP central directory contains no entries");
  }
  if (entryCount === 0xffff || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff) {
    throw new Error("ZIP64 archives are not supported");
  }
  if (centralOffset + centralSize !== endOffset) {
    throw new Error("ZIP central directory location is inconsistent");
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    requireZipRange(buffer, offset, 46, "central directory entry");
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP central directory entry signature is invalid");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const entryDisk = buffer.readUInt16LE(offset + 34);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const centralEntrySize = 46 + nameLength + extraLength + entryCommentLength;
    requireZipRange(buffer, offset, centralEntrySize, "central directory entry");
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (entryDisk !== 0) {
      throw new Error(`ZIP entry ${name} is stored on an unsupported disk`);
    }
    if ((flags & 0x01) !== 0) {
      throw new Error(`ZIP entry ${name} is encrypted`);
    }
    if (names.has(name)) {
      throw new Error(`ZIP entry ${name} is duplicated`);
    }
    names.add(name);

    requireZipRange(buffer, localOffset, 30, `local header for ${name}`);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`ZIP local header for ${name} is invalid`);
    }
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    requireZipRange(buffer, localNameStart, localNameLength, `local name for ${name}`);
    const localName = buffer
      .subarray(localNameStart, localNameStart + localNameLength)
      .toString("utf8");
    if (localName !== name || localFlags !== flags || localMethod !== method) {
      throw new Error(`ZIP local header for ${name} does not match its central directory entry`);
    }
    if (dataEnd > centralOffset) {
      throw new Error(`ZIP entry ${name} extends into the central directory`);
    }

    const compressed = buffer.subarray(dataStart, dataEnd);
    const content = readZipEntryContent(name, method, compressed);
    if (content.byteLength !== uncompressedSize) {
      throw new Error(`ZIP entry ${name} has an inconsistent uncompressed size`);
    }
    if (crc32(content) !== expectedCrc) {
      throw new Error(`ZIP entry ${name} failed its CRC-32 check`);
    }
    if ((flags & 0x08) === 0) {
      if (
        localCrc !== expectedCrc ||
        localCompressedSize !== compressedSize ||
        localUncompressedSize !== uncompressedSize
      ) {
        throw new Error(`ZIP local header sizes or CRC for ${name} are inconsistent`);
      }
    } else {
      validateZipDataDescriptor(
        buffer,
        dataEnd,
        centralOffset,
        name,
        expectedCrc,
        compressedSize,
        uncompressedSize,
      );
    }

    entries.push({
      compressedSize,
      content,
      name,
      uncompressedSize,
    });

    offset += centralEntrySize;
  }

  if (offset !== centralOffset + centralSize) {
    throw new Error("ZIP central directory size is inconsistent");
  }

  return entries;
};

const findEndOfCentralDirectory = (buffer: Buffer) => {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record is missing");
};

const requireZipRange = (buffer: Buffer, offset: number, length: number, label: string) => {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`${label} extends past the archive boundary`);
  }
};

const readZipEntryContent = (name: string, method: number, compressed: Buffer) => {
  if (method === 0) {
    return compressed;
  }
  if (method === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(`ZIP entry ${name} uses unsupported compression method ${method}`);
};

const validateZipDataDescriptor = (
  buffer: Buffer,
  offset: number,
  centralOffset: number,
  name: string,
  expectedCrc: number,
  compressedSize: number,
  uncompressedSize: number,
) => {
  requireZipRange(buffer, offset, 12, `data descriptor for ${name}`);
  const valuesOffset = buffer.readUInt32LE(offset) === 0x08074b50 ? offset + 4 : offset;
  requireZipRange(buffer, valuesOffset, 12, `data descriptor for ${name}`);
  if (valuesOffset + 12 > centralOffset) {
    throw new Error(`ZIP data descriptor for ${name} extends into the central directory`);
  }
  if (
    buffer.readUInt32LE(valuesOffset) !== expectedCrc ||
    buffer.readUInt32LE(valuesOffset + 4) !== compressedSize ||
    buffer.readUInt32LE(valuesOffset + 8) !== uncompressedSize
  ) {
    throw new Error(`ZIP data descriptor for ${name} is inconsistent`);
  }
};

const crc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (buffer: Buffer) => {
  let value = 0xffff_ffff;
  for (const byte of buffer) {
    const tableValue = crc32Table[(value ^ byte) & 0xff];
    if (tableValue === undefined) {
      throw new Error("CRC-32 table lookup failed");
    }
    value = tableValue ^ (value >>> 8);
  }
  return (value ^ 0xffff_ffff) >>> 0;
};

const inspectConfigXml = Effect.fn("inspectConfigXml")(function* (source: string) {
  return yield* Effect.try({
    try: () => parseConfigXml(source),
    catch: (cause) =>
      InvalidInput.make({
        details: cause instanceof Error ? cause.message : String(cause),
        label: "archive config.xml",
      }),
  });
});

const parseConfigXml = (source: string): ArchiveConfig => {
  const features: string[] = [];
  const privileges: string[] = [];
  let applicationId: string | undefined;
  let autoRestart = false;
  let defaultName: string | undefined;
  let defaultLocale: string | undefined;
  let defaultLocaleName: string | undefined;
  let nameCapture: { language?: string; text: string } | undefined;
  let onBoot = false;
  let packageId: string | undefined;
  let requiredTizenVersion: string | undefined;
  let rootSeen = false;
  let ticker = false;
  let version: string | undefined;
  const languageStack: Array<string | undefined> = [];
  const parser = new SaxesParser({ fileName: "config.xml", xmlns: true });

  parser.on("opentag", (tag) => {
    const declaredLanguage = readXmlAttribute(tag, "lang", xmlNamespace);
    const effectiveLanguage = declaredLanguage ?? languageStack.at(-1);
    languageStack.push(effectiveLanguage);

    if (!rootSeen) {
      if (tag.local !== "widget" || tag.uri !== widgetNamespace) {
        throw new Error("root element must be a W3C widget element");
      }
      rootSeen = true;
    }

    if (tag.local === "widget" && tag.uri === widgetNamespace) {
      defaultLocale = readXmlAttribute(tag, "defaultlocale")?.toLowerCase();
      version = readXmlAttribute(tag, "version");
    } else if (tag.local === "application" && tag.uri === tizenNamespace) {
      applicationId = readXmlAttribute(tag, "id");
      packageId = readXmlAttribute(tag, "package");
      requiredTizenVersion = readXmlAttribute(tag, "required_version");
    } else if (tag.local === "feature" && tag.uri === widgetNamespace) {
      const feature = readXmlAttribute(tag, "name");
      if (feature) {
        features.push(feature);
      }
    } else if (tag.local === "privilege" && tag.uri === tizenNamespace) {
      const privilege = readXmlAttribute(tag, "name");
      if (privilege) {
        privileges.push(privilege);
      }
    } else if (tag.local === "name" && tag.uri === widgetNamespace) {
      nameCapture = {
        language: effectiveLanguage?.toLowerCase(),
        text: "",
      };
    }

    if (tag.local === "ticker") {
      ticker = true;
    }
    if (tag.local === "service" && tag.uri === tizenNamespace) {
      autoRestart ||= readXmlAttribute(tag, "auto-restart") === "true";
      onBoot ||= readXmlAttribute(tag, "on-boot") === "true";
    }
  });

  const appendNameText = (text: string) => {
    if (nameCapture) {
      nameCapture.text += text;
    }
  };
  parser.on("text", appendNameText);
  parser.on("cdata", appendNameText);
  parser.on("closetag", (tag) => {
    if (tag.local === "name" && tag.uri === widgetNamespace && nameCapture) {
      const normalizedName = normalizeXmlName(nameCapture.text);
      if (!nameCapture.language) {
        defaultName ??= normalizedName;
      } else if (nameCapture.language === defaultLocale) {
        defaultLocaleName ??= normalizedName;
      }
      nameCapture = undefined;
    }
    languageStack.pop();
  });
  parser.write(source).close();

  if (!rootSeen) {
    throw new Error("root widget element is missing");
  }

  return {
    applicationId,
    declarations: { autoRestart, onBoot, ticker },
    features,
    name: defaultName ?? defaultLocaleName,
    packageId,
    privileges,
    requiredTizenVersion,
    version,
  };
};

const readXmlAttribute = (tag: SaxesTagNS, local: string, uri = "") =>
  Object.values(tag.attributes).find(
    (attribute) => attribute.local === local && attribute.uri === uri,
  )?.value;

const normalizeXmlName = (value: string) => value.replace(/\p{White_Space}+/gu, " ").trim();

const widgetNamespace = "http://www.w3.org/ns/widgets";
const tizenNamespace = "http://tizen.org/ns/widgets";
const xmlNamespace = "http://www.w3.org/XML/1998/namespace";

const validateArchive = (
  archive: ArchivePayload | undefined,
  variant: TaiznContext["config"]["widget"]["variants"]["development"],
) => {
  if (!archive) {
    return [];
  }

  const problems = validateSubmissionManifest(archive.manifest);

  if (!archive.config) {
    return [...problems, "archive config.xml is missing"];
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

  if (archive.config.name !== variant.name) {
    problems.push(
      `archive name ${archive.config.name ?? "missing"} does not match ${variant.name}`,
    );
  }

  return problems;
};

const validateSubmissionManifest = (manifest: SubmissionManifest) => {
  const problems: string[] = [];
  const { widget } = manifest;

  if (!manifest.file.name.endsWith(".wgt")) {
    problems.push("archive file extension must be lowercase .wgt");
  }
  if (!/^[\p{L}\p{N} _]+\.wgt$/u.test(manifest.file.name)) {
    problems.push("archive file name may contain only letters, numbers, spaces, and underscores");
  }
  if (Buffer.byteLength(manifest.file.name, "utf8") > 100) {
    problems.push("archive file name must not exceed 100 bytes");
  }

  if (!widget.applicationId) {
    problems.push("archive applicationId is missing");
  }

  if (!widget.packageId) {
    problems.push("archive packageId is missing");
  }

  if (!widget.name) {
    problems.push("archive application name is missing");
  }

  if (!widget.version) {
    problems.push("archive widget version is missing");
  } else if (!isValidWidgetVersion(widget.version)) {
    problems.push(
      "archive WGT widget version must use [0-255].[0-255].[0-65535]; four-part versions belong to multi-architecture ZIP packages",
    );
  }

  if (!widget.requiredTizenVersion) {
    problems.push("archive required Tizen version is missing");
  } else if (!/^\d+\.\d+$/u.test(widget.requiredTizenVersion)) {
    problems.push("archive required Tizen version must use x.y format");
  }

  if (!widget.features.some(isCanonicalScreenSizeFeature)) {
    problems.push("archive screen-size feature is missing");
  }

  for (const privilege of widget.privileges) {
    const name = privilege.split("/").at(-1);
    if (name && unavailableSamsungPrivileges.has(name)) {
      problems.push(`archive privilege ${name} is no longer available for Samsung TV apps`);
    }
  }

  if (widget.declarations.autoRestart) {
    problems.push("archive auto-restart must not be true");
  }
  if (widget.declarations.onBoot) {
    problems.push("archive on-boot must not be true");
  }
  if (widget.declarations.ticker) {
    problems.push("archive ticker declaration is not supported on Samsung TV");
  }

  if (!manifest.signatures.authorPresent) {
    problems.push("archive author-signature.xml is missing");
  }

  if (!manifest.signatures.distributorPresent) {
    problems.push("archive signature1.xml is missing");
  }

  return problems;
};

const isValidWidgetVersion = (value: string) => {
  const segments = value.split(".");
  const limits = [255, 255, 65_535];

  if (segments.length !== 3) {
    return false;
  }

  return segments.every((segment, index) => {
    const limit = limits[index];
    return /^\d+$/u.test(segment) && limit !== undefined && Number(segment) <= limit;
  });
};

const isCanonicalScreenSizeFeature = (feature: string) =>
  /^http:\/\/tizen\.org\/feature\/screen\.size\.normal(?:\.\d+\.\d+)?$/u.test(feature);

const unavailableSamsungPrivileges = new Set(["keymanager", "systemmanager", "websetting"]);

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

const hasControlCharacter = (value: string) => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};
