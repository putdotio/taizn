import { Effect, FileSystem } from "effect";
import { FileSystemFailure, InvalidInput } from "./errors.js";
import { appPath, getPaths } from "./runtime.js";
import type { TizenConfig, TizenVariant } from "./config.js";

export type AssetProbe = {
  readonly ok: boolean;
  readonly status?: number;
  readonly type: "fetch" | "script" | "style";
  readonly url: string;
};

export const extractAssetUrls = (source: string) => {
  const urls: string[] = [];
  const pattern = /\b(?:src|href)=["'](https?:\/\/[^"']+)["']/gu;
  let match = pattern.exec(source);

  while (match) {
    const url = match[1];
    if (url) {
      urls.push(url);
    }
    match = pattern.exec(source);
  }

  return [...new Set(urls)];
};

export const readConfiguredIndexHtml = Effect.fn("readConfiguredIndexHtml")(function* (
  config: TizenConfig,
  variant: TizenVariant,
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* getPaths();
  const indexPath = appPath(paths.appDir, variant.indexHtml ?? config.widget.indexHtml);

  return yield* fs
    .readFileString(indexPath)
    .pipe(
      Effect.mapError(
        (cause) => new FileSystemFailure({ cause, operation: "read", path: indexPath }),
      ),
    );
});

export const probeAssetUrls = Effect.fn("probeAssetUrls")(function* (urls: readonly string[]) {
  return yield* Effect.forEach(urls, probeAssetUrl, { concurrency: 4 });
});

const probeAssetUrl = Effect.fn("probeAssetUrl")(function* (url: string) {
  const parsed = yield* parseHttpUrl(url);
  const type = probeType(parsed);

  return yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(parsed, {
        cache: "no-store",
        method: "GET",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });

      try {
        return {
          ok: response.ok,
          status: response.status,
          type,
          url: parsed.href,
        } satisfies AssetProbe;
      } finally {
        await response.body?.cancel();
      }
    },
    catch: (cause) => cause,
  }).pipe(
    Effect.catch(() =>
      Effect.succeed({
        ok: false,
        type,
        url: parsed.href,
      } satisfies AssetProbe),
    ),
  );
});

export const validateAssetUrls = Effect.fn("validateAssetUrls")(function* (
  urls: readonly string[],
) {
  const validated: string[] = [];

  for (const url of urls) {
    const parsed = yield* parseHttpUrl(url);
    validated.push(parsed.href);
  }

  return validated;
});

const parseHttpUrl = Effect.fn("parseHttpUrl")(function* (url: string) {
  const parsed = yield* Effect.try({
    try: () => new URL(url),
    catch: () =>
      new InvalidInput({
        details: `expected an absolute http(s) URL. Received: ${url}`,
        label: "asset URL",
      }),
  });

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return yield* new InvalidInput({
      details: `expected an absolute http(s) URL. Received: ${url}`,
      label: "asset URL",
    });
  }

  return parsed;
});

const probeType = (url: URL): AssetProbe["type"] => {
  if (url.pathname.endsWith(".js")) {
    return "script";
  }

  if (url.pathname.endsWith(".css")) {
    return "style";
  }

  return "fetch";
};
