import { readFileSync } from "node:fs";

type LiveTestEnv = Record<string, string | undefined>;
type LiveTestVariant = "development" | "production";

export const tvPutioAssetUrls = ["https://tv.put.io/js/main.js", "https://tv.put.io/css/main.css"];

export type FetchProbeFailure = {
  readonly error?: string;
  readonly reason: string;
  readonly url?: string;
};

export function resolveFixtureProofQuery(
  configTemplatePath: string,
  env: LiveTestEnv = process.env,
) {
  const variant = resolveVariant(env);
  const applicationId = readTemplateVariantString(configTemplatePath, variant, "applicationId");

  if (applicationId) {
    return applicationId;
  }

  return variant === "production" ? "TaiznLiveP.taizn" : "TaiznLiveD.taizn";
}

export function resolveProofQuery(configTemplatePath: string, env: LiveTestEnv = process.env) {
  if (env.TAIZN_LIVE_PROVE_APP) {
    return env.TAIZN_LIVE_PROVE_APP;
  }

  return resolveFixtureProofQuery(configTemplatePath, env);
}

export function resolvePackageId(configTemplatePath: string, env: LiveTestEnv = process.env) {
  const variant = resolveVariant(env);
  const packageId = readTemplateVariantString(configTemplatePath, variant, "packageId");

  if (packageId) {
    return packageId;
  }

  return variant === "production" ? "TaiznLiveP" : "TaiznLiveD";
}

export function resolveSmokeTarget(checkJson: unknown) {
  if (!isRecord(checkJson)) {
    return undefined;
  }

  if (typeof checkJson.configuredTarget === "string") {
    return checkJson.configuredTarget;
  }

  if (!Array.isArray(checkJson.targets) || checkJson.targets.length !== 1) {
    return undefined;
  }

  const [target] = checkJson.targets;

  if (!isRecord(target) || typeof target.id !== "string") {
    return undefined;
  }

  return target.id;
}

export function selectBeaconHost(
  interfaceAddresses: readonly string[],
  target: string | undefined,
) {
  const targetHost = parseTargetHost(target);
  const sameSubnetAddress = targetHost
    ? interfaceAddresses.find((address) => sameIpv4Subnet(address, targetHost))
    : undefined;

  return sameSubnetAddress ?? interfaceAddresses.find(isPrivateIpv4) ?? interfaceAddresses.at(0);
}

export function parseBeaconTimeoutMs(value: string | undefined) {
  if (!value) {
    return 15_000;
  }

  const parsed = Number(value);

  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`TAIZN_LIVE_BEACON_TIMEOUT_MS must be a positive integer. Received: ${value}`);
  }

  return parsed;
}

export function parseFetchUrls(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(/[\n,]/)
    .map((url) => url.trim())
    .filter(Boolean);
}

export function resolveFetchProbeUrls(env: LiveTestEnv, useTvAssetDefaults: boolean) {
  const configuredUrls = parseFetchUrls(env.LIVE_TEST_FETCH_URLS);

  if (configuredUrls.length > 0) {
    return configuredUrls;
  }

  return useTvAssetDefaults ? tvPutioAssetUrls : [];
}

export function parseRemoteKeys(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(/[\s,]+/)
    .map((key) => key.trim())
    .filter(Boolean);
}

export function parseRemoteDelayMs(value: string | undefined) {
  if (!value) {
    return 250;
  }

  const parsed = Number(value);

  if (!/^\d+$/.test(value) || !Number.isInteger(parsed)) {
    throw new Error(`LIVE_TEST_REMOTE_DELAY_MS must be a non-negative integer. Received: ${value}`);
  }

  return parsed;
}

export function failedFetchProbes(fetches: unknown): readonly FetchProbeFailure[] {
  if (fetches === undefined) {
    return [];
  }

  if (!Array.isArray(fetches)) {
    return [{ reason: "fetches was not an array" }];
  }

  return fetches.flatMap((fetchResult) => {
    if (!isRecord(fetchResult)) {
      return [{ reason: "fetch result was not an object" }];
    }

    if (fetchResult.ok === true) {
      return [];
    }

    return [
      {
        error: typeof fetchResult.error === "string" ? fetchResult.error : undefined,
        reason: "fetch probe returned ok:false",
        url: typeof fetchResult.url === "string" ? fetchResult.url : undefined,
      },
    ];
  });
}

export function fetchProbeFailureLabel(failure: FetchProbeFailure) {
  const label = failure.url ?? "unknown URL";

  if (failure.error) {
    return `${label}: ${failure.error}`;
  }

  return `${label}: ${failure.reason}`;
}

export function envFlagEnabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

export function jsonForHtmlScript(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function readTemplateVariantString(
  configTemplatePath: string,
  variant: LiveTestVariant,
  key: string,
) {
  return readTemplateVariantStringFromSource(
    readFileSync(configTemplatePath, "utf8"),
    variant,
    key,
  );
}

export function readTemplateVariantStringFromSource(
  source: string,
  variant: LiveTestVariant,
  key: string,
) {
  const parsed: unknown = JSON.parse(source);

  if (!isRecord(parsed)) {
    return null;
  }

  const widget = parsed.widget;

  if (!isRecord(widget)) {
    return null;
  }

  const variants = widget.variants;

  if (!isRecord(variants)) {
    return null;
  }

  const variantConfig = variants[variant];

  if (!isRecord(variantConfig) || typeof variantConfig[key] !== "string") {
    return null;
  }

  return variantConfig[key];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveVariant(env: LiveTestEnv): LiveTestVariant {
  return env.TAIZN_VARIANT === "production" ? "production" : "development";
}

function parseTargetHost(target: string | undefined) {
  if (!target) {
    return undefined;
  }

  const [host] = target.split(":");

  return isIpv4(host) ? host : undefined;
}

function sameIpv4Subnet(address: string, targetHost: string) {
  if (!isIpv4(address) || !isIpv4(targetHost)) {
    return false;
  }

  return address.split(".").slice(0, 3).join(".") === targetHost.split(".").slice(0, 3).join(".");
}

function isPrivateIpv4(address: string) {
  if (!isIpv4(address)) {
    return false;
  }

  const parts = address.split(".").map(Number);
  const [first = 0, second = 0] = parts;

  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isIpv4(value: string | undefined): value is string {
  return value !== undefined && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}
