export type LiveSetupOptions = {
  readonly beaconHost?: string;
  readonly profile?: string;
  readonly remoteKeys?: string;
  readonly requireRemote?: boolean;
  readonly target?: string;
  readonly tvHost?: string;
};

export type LiveSetupResult = {
  readonly keys: readonly string[];
  readonly missing: readonly string[];
  readonly values: Readonly<Record<string, string>>;
};

export const liveSetupEnvKeys: readonly string[] = [
  "TAIZN_CERT_PASSWORD",
  "TAIZN_DIST_PASSWORD",
  "TAIZN_LIVE_BEACON_HOST",
  "TAIZN_LIVE_BEACON_TIMEOUT_MS",
  "TAIZN_LIVE_PROFILE",
  "TAIZN_SDB",
  "TAIZN_TARGET",
  "TAIZN_TIZEN_CLI",
  "TAIZN_TV_HOST",
  "TAIZN_TV_INFO_PORT",
  "TAIZN_TV_NAME",
  "TAIZN_TV_PORT",
  "TAIZN_TV_PROTOCOL",
  "TAIZN_TV_TIMEOUT_MS",
  "TAIZN_TV_TOKEN",
  "LIVE_TEST_FETCH_URLS",
  "LIVE_TEST_REMOTE_DELAY_MS",
  "LIVE_TEST_REMOTE_KEYS",
  "LIVE_TEST_REQUIRE_REMOTE",
];

export function parseEnvAssignments(source: string) {
  const values: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
      values[key] = unquoteEnvValue(value);
    }
  }

  return values;
}

export function buildLiveSetupEnv(
  currentValues: Readonly<Record<string, string>>,
  sourceValues: Readonly<Record<string, string>>,
  options: LiveSetupOptions,
  defaults: Readonly<Record<string, string>> = {},
): LiveSetupResult {
  const values: Record<string, string> = {};

  copyAllowedValues(values, currentValues);
  copyAllowedValues(values, sourceValues);

  for (const key of liveSetupEnvKeys) {
    if (!values[key] && defaults[key]) {
      values[key] = defaults[key];
    }
  }

  if (options.profile) {
    values.TAIZN_LIVE_PROFILE = options.profile;
  }

  if (options.target) {
    values.TAIZN_TARGET = normalizeTizenTarget(options.target);
  }

  if (options.tvHost) {
    values.TAIZN_TV_HOST = options.tvHost;
  }

  if (options.beaconHost) {
    values.TAIZN_LIVE_BEACON_HOST = options.beaconHost;
  }

  if (options.remoteKeys) {
    values.LIVE_TEST_REMOTE_KEYS = options.remoteKeys;
  }

  if (options.requireRemote) {
    values.LIVE_TEST_REQUIRE_REMOTE = "1";
  }

  const missing = requiredLiveSetupKeys.filter((key) => !values[key]);
  const keys = liveSetupEnvKeys.filter((key) => Boolean(values[key]));

  return { keys, missing, values };
}

export function serializeEnvAssignments(values: Readonly<Record<string, string>>) {
  const lines = liveSetupEnvKeys.flatMap((key) => {
    const value = values[key];

    return value ? [`${key}=${quoteEnvValue(value)}`] : [];
  });

  return `${lines.join("\n")}\n`;
}

export function readSigningProfileFromConfigSource(source: string) {
  const parsed: unknown = JSON.parse(source);

  if (!isRecord(parsed) || !isRecord(parsed.signing)) {
    return undefined;
  }

  return typeof parsed.signing.profile === "string" ? parsed.signing.profile : undefined;
}

export function normalizeTizenTarget(value: string) {
  const target = value.trim();

  if (!target || target.includes(":")) {
    return target;
  }

  return `${target}:26101`;
}

export function redactEnvValue(key: string, value: string) {
  if (/PASSWORD|TOKEN|SECRET|KEY/.test(key)) {
    return "<redacted>";
  }

  return value;
}

const requiredLiveSetupKeys: readonly string[] = ["TAIZN_CERT_PASSWORD", "TAIZN_DIST_PASSWORD"];

function copyAllowedValues(
  target: Record<string, string>,
  source: Readonly<Record<string, string>>,
) {
  for (const key of liveSetupEnvKeys) {
    const value = source[key];

    if (value) {
      target[key] = value;
    }
  }
}

function quoteEnvValue(value: string) {
  if (/^[A-Za-z0-9_./:@{}-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function unquoteEnvValue(value: string) {
  if (value.length < 2) {
    return value;
  }

  const quote = value.at(0);

  if ((quote !== `"` && quote !== "'") || value.at(-1) !== quote) {
    return value;
  }

  if (quote === `"`) {
    try {
      const parsed: unknown = JSON.parse(value);

      return typeof parsed === "string" ? parsed : value.slice(1, -1);
    } catch {
      return value.slice(1, -1);
    }
  }

  return value.slice(1, -1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
