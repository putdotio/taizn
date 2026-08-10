import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Effect, FileSystem, Predicate } from "effect";
import { FileSystemFailure, InvalidInput, InvalidJson } from "./errors.js";
import { getPaths } from "./runtime.js";

export type JsonOutputOptions = {
  readonly fields?: string;
};

export const readJsonFile = Effect.fn("readJsonFile")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs
    .readFileString(path)
    .pipe(Effect.mapError((cause) => new FileSystemFailure({ cause, operation: "read", path })));

  return yield* parseJson(source, path);
});

export const parseJson = Effect.fn("parseJson")(function* (source: string, file: string) {
  return yield* Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(source);
      return parsed;
    },
    catch: (cause) => new InvalidJson({ details: causeToMessage(cause), file }),
  });
});

export const resolveOutputPath = Effect.fn("resolveOutputPath")(function* (requestedPath: string) {
  const paths = yield* getPaths();
  const resolved = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(paths.appDir, requestedPath);
  const rel = relative(paths.appDir, resolved);

  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return yield* new InvalidInput({
      details: `output path must stay inside the app directory. Received: ${requestedPath}`,
      label: "output path",
    });
  }

  return resolved;
});

export const writeJsonArtifact = Effect.fn("writeJsonArtifact")(function* (
  requestedPath: string,
  value: unknown,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* resolveOutputPath(requestedPath);

  yield* fs
    .makeDirectory(dirname(path), { recursive: true })
    .pipe(Effect.mapError((cause) => new FileSystemFailure({ cause, operation: "mkdir", path })));
  yield* fs
    .writeFileString(path, `${JSON.stringify(value, null, 2)}\n`)
    .pipe(Effect.mapError((cause) => new FileSystemFailure({ cause, operation: "write", path })));

  return path;
});

export const jsonForOutput = Effect.fn("jsonForOutput")(function* (
  value: unknown,
  options: JsonOutputOptions = {},
) {
  const selected = yield* selectJsonFields(value, options.fields);
  return JSON.stringify(selected);
});

export const selectJsonFields = Effect.fn("selectJsonFields")(function* (
  value: unknown,
  fields: string | undefined,
) {
  const fieldPaths = yield* parseFields(fields);

  if (fieldPaths.length === 0) {
    return value;
  }

  const selected: Record<string, unknown> = {};

  for (const fieldPath of fieldPaths) {
    const segments = fieldPath.split(".");
    const fieldValue = readPath(value, segments);

    if (fieldValue !== undefined) {
      setPath(selected, segments, fieldValue);
    }
  }

  return selected;
});

export const validateAgentResourceInput = Effect.fn("validateAgentResourceInput")(function* (
  label: string,
  value: string,
) {
  if (hasControlCharacter(value)) {
    return yield* new InvalidInput({
      details: "control characters are not allowed",
      label,
    });
  }

  if (value.includes("?") || value.includes("#")) {
    return yield* new InvalidInput({
      details: "embedded query strings and fragments are not allowed",
      label,
    });
  }

  if (value.split(/[\\/]+/u).includes("..") || /%2e/iu.test(value)) {
    return yield* new InvalidInput({
      details: "path traversal segments are not allowed",
      label,
    });
  }

  return value;
});

const parseFields = Effect.fn("parseFields")(function* (fields: string | undefined) {
  if (!fields) {
    return [];
  }

  const parsed = fields
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);

  for (const field of parsed) {
    yield* validateAgentResourceInput("field mask", field);
  }

  return parsed;
});

const readPath = (source: unknown, segments: readonly string[]) => {
  let current = source;

  for (const segment of segments) {
    if (!Predicate.isObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
};

const setPath = (target: Record<string, unknown>, segments: readonly string[], value: unknown) => {
  let current = target;

  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }

    const existing = current[segment];
    const next: Record<string, unknown> = Predicate.isObject(existing) ? existing : {};
    current[segment] = next;
    current = next;
  }
};

const causeToMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const hasControlCharacter = (value: string) => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};
