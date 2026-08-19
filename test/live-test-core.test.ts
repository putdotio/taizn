import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import {
  envFlagEnabled,
  failedFetchProbes,
  fetchProbeFailureLabel,
  jsonForHtmlScript,
  parseBeaconTimeoutMs,
  parseFetchUrls,
  parseRemoteDelayMs,
  parseRemoteKeys,
  resolveFetchProbeUrls,
  readTemplateVariantStringFromSource,
  resolveFixtureProofQuery,
  resolvePackageId,
  resolveProofQuery,
  resolveSmokeTarget,
  selectBeaconHost,
} from "../live-test/harness-core.ts";
import {
  buildLiveSetupEnv,
  normalizeTizenTarget,
  parseEnvAssignments,
  readSigningProfileFromConfigSource,
  serializeEnvAssignments,
} from "../live-test/setup-core.ts";

describe("live test harness core", () => {
  it("keeps roundtrip proof tied to the selected fixture variant", () => {
    const templatePath = writeTemplate();
    const env = {
      TAIZN_LIVE_PROVE_APP: "SomeInstalledApp.app",
      TAIZN_VARIANT: "production",
    };

    assert.strictEqual(resolveProofQuery(templatePath, env), "SomeInstalledApp.app");
    assert.strictEqual(resolveFixtureProofQuery(templatePath, env), "TaiznLiveP.taizn");
  });

  it("resolves fixture package IDs from the selected variant", () => {
    const templatePath = writeTemplate();

    assert.strictEqual(
      resolvePackageId(templatePath, { TAIZN_VARIANT: "development" }),
      "TaiznLiveD",
    );
    assert.strictEqual(
      resolvePackageId(templatePath, { TAIZN_VARIANT: "production" }),
      "TaiznLiveP",
    );
  });

  it("falls back to built-in fixture IDs when a template variant omits optional values", () => {
    const templatePath = writeTemplate({
      widget: {
        variants: {
          development: {},
          production: {},
        },
      },
    });

    assert.strictEqual(
      resolveFixtureProofQuery(templatePath, { TAIZN_VARIANT: "development" }),
      "TaiznLiveD.taizn",
    );
    assert.strictEqual(
      resolveFixtureProofQuery(templatePath, { TAIZN_VARIANT: "production" }),
      "TaiznLiveP.taizn",
    );
    assert.strictEqual(
      resolvePackageId(templatePath, { TAIZN_VARIANT: "development" }),
      "TaiznLiveD",
    );
    assert.strictEqual(
      resolvePackageId(templatePath, { TAIZN_VARIANT: "production" }),
      "TaiznLiveP",
    );
  });

  it("selects an explicit target before auto-picking a single connected target", () => {
    assert.strictEqual(
      resolveSmokeTarget({
        configuredTarget: "configured:26101",
        targets: [{ id: "connected:26101" }],
      }),
      "configured:26101",
    );
    assert.strictEqual(
      resolveSmokeTarget({ targets: [{ id: "connected:26101" }] }),
      "connected:26101",
    );
    assert.strictEqual(
      resolveSmokeTarget({
        targets: [{ id: "one:26101" }, { id: "two:26101" }],
      }),
      undefined,
    );
  });

  it("prefers a beacon host reachable from the selected Tizen target subnet", () => {
    assert.strictEqual(
      selectBeaconHost(["203.0.113.88", "192.0.2.107"], "192.0.2.99:26101"),
      "192.0.2.107",
    );
    assert.strictEqual(selectBeaconHost(["203.0.113.88", "10.0.0.12"], undefined), "10.0.0.12");
    assert.strictEqual(selectBeaconHost(["203.0.113.88"], undefined), "203.0.113.88");
  });

  it("parses beacon timeouts with actionable validation", () => {
    assert.strictEqual(parseBeaconTimeoutMs(undefined), 15_000);
    assert.strictEqual(parseBeaconTimeoutMs("15000"), 15_000);

    assert.throws(
      () => parseBeaconTimeoutMs("0"),
      /TAIZN_LIVE_BEACON_TIMEOUT_MS must be a positive integer/,
    );
    assert.throws(
      () => parseBeaconTimeoutMs("12ms"),
      /TAIZN_LIVE_BEACON_TIMEOUT_MS must be a positive integer/,
    );
  });

  it("parses fetch probe URLs from comma or newline separated env values", () => {
    assert.deepStrictEqual(parseFetchUrls(undefined), []);
    assert.deepStrictEqual(
      parseFetchUrls(" https://example.com/assets/app.js,https://example.com/assets/app.css\n"),
      ["https://example.com/assets/app.js", "https://example.com/assets/app.css"],
    );
  });

  it("resolves the hosted asset preset unless explicit fetch URLs are configured", () => {
    assert.deepStrictEqual(resolveFetchProbeUrls({}, false), []);
    assert.deepStrictEqual(resolveFetchProbeUrls({}, true), [
      "https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css",
    ]);
    assert.deepStrictEqual(
      resolveFetchProbeUrls({ LIVE_TEST_FETCH_URLS: "https://example.test/app.js" }, true),
      ["https://example.test/app.js"],
    );
  });

  it("treats failed or malformed fetch probe results as roundtrip failures", () => {
    assert.deepStrictEqual(failedFetchProbes(undefined), []);
    assert.deepStrictEqual(
      failedFetchProbes([{ ok: true, url: "https://example.com/assets/app.js" }]),
      [],
    );
    assert.deepStrictEqual(failedFetchProbes({ ok: true }), [
      { reason: "fetches was not an array" },
    ]);
    assert.deepStrictEqual(failedFetchProbes(["wat"]), [
      { reason: "fetch result was not an object" },
    ]);
    assert.deepStrictEqual(
      failedFetchProbes([
        {
          error: "Load failed",
          ok: false,
          url: "https://example.com/assets/app.css",
        },
      ]),
      [
        {
          error: "Load failed",
          reason: "fetch probe returned ok:false",
          url: "https://example.com/assets/app.css",
        },
      ],
    );
    assert.strictEqual(
      fetchProbeFailureLabel({
        error: "Load failed",
        reason: "fetch probe returned ok:false",
        url: "https://example.com/assets/app.css",
      }),
      "https://example.com/assets/app.css: Load failed",
    );
  });

  it("parses remote probe keys and delay settings", () => {
    assert.deepStrictEqual(parseRemoteKeys(undefined), []);
    assert.deepStrictEqual(parseRemoteKeys(" KEY_UP,KEY_ENTER\nKEY_BACK "), [
      "KEY_UP",
      "KEY_ENTER",
      "KEY_BACK",
    ]);
    assert.strictEqual(parseRemoteDelayMs(undefined), 250);
    assert.strictEqual(parseRemoteDelayMs("0"), 0);
    assert.strictEqual(parseRemoteDelayMs("750"), 750);
    assert.throws(
      () => parseRemoteDelayMs("fast"),
      /LIVE_TEST_REMOTE_DELAY_MS must be a non-negative integer/,
    );
  });

  it("parses opt-in boolean env flags", () => {
    assert.strictEqual(envFlagEnabled(undefined), false);
    assert.strictEqual(envFlagEnabled("0"), false);
    assert.strictEqual(envFlagEnabled("1"), true);
    assert.strictEqual(envFlagEnabled("true"), true);
  });

  it("escapes JSON before embedding it in the fixture script", () => {
    assert.strictEqual(
      jsonForHtmlScript(["https://example.test/a</script>b.js"]),
      '["https://example.test/a\\u003c/script>b.js"]',
    );
  });

  it("reads variant values only from well-formed template branches", () => {
    assert.strictEqual(
      readTemplateVariantStringFromSource(
        JSON.stringify({
          widget: {
            variants: {
              development: { applicationId: "Dev.app" },
              production: { applicationId: "Prod.app" },
            },
          },
        }),
        "production",
        "applicationId",
      ),
      "Prod.app",
    );
    assert.strictEqual(
      readTemplateVariantStringFromSource("{}", "production", "applicationId"),
      null,
    );
  });

  it("builds a live setup env from allowlisted source values and overrides", () => {
    const source = parseEnvAssignments(`
TAIZN_CERT_PASSWORD=cert
TAIZN_DIST_PASSWORD="dist value"
PUBLIC_PUTIO_API_URL=https://example.invalid
`);
    const result = buildLiveSetupEnv(
      { TAIZN_TARGET: "old-target:26101" },
      source,
      { profile: "fixture-profile", requireRemote: true, target: "192.0.2.10" },
      { TAIZN_SDB: "/opt/tizen/sdb" },
    );

    assert.strictEqual(result.values.TAIZN_CERT_PASSWORD, "cert");
    assert.strictEqual(result.values.TAIZN_DIST_PASSWORD, "dist value");
    assert.strictEqual(result.values.TAIZN_LIVE_PROFILE, "fixture-profile");
    assert.strictEqual(result.values.TAIZN_TARGET, "192.0.2.10:26101");
    assert.strictEqual(result.values.TAIZN_SDB, "/opt/tizen/sdb");
    assert.strictEqual(result.values.LIVE_TEST_REQUIRE_REMOTE, "1");
    assert.strictEqual(result.values.PUBLIC_PUTIO_API_URL, undefined);
    assert.deepStrictEqual(result.missing, []);
  });

  it("serializes live setup env values for Node loadEnvFile", () => {
    assert.strictEqual(
      serializeEnvAssignments({
        TAIZN_CERT_PASSWORD: "cert",
        TAIZN_DIST_PASSWORD: "dist value",
      }),
      'TAIZN_CERT_PASSWORD=cert\nTAIZN_DIST_PASSWORD="dist value"\n',
    );
  });

  it("reads source signing profiles and normalizes Tizen targets", () => {
    assert.strictEqual(
      readSigningProfileFromConfigSource(
        JSON.stringify({ signing: { profile: "source-profile" } }),
      ),
      "source-profile",
    );
    assert.strictEqual(normalizeTizenTarget("192.0.2.10"), "192.0.2.10:26101");
    assert.strictEqual(normalizeTizenTarget("192.0.2.10:26102"), "192.0.2.10:26102");
  });
});

function writeTemplate(
  template: unknown = {
    widget: {
      variants: {
        development: {
          applicationId: "TaiznLiveD.taizn",
          packageId: "TaiznLiveD",
        },
        production: {
          applicationId: "TaiznLiveP.taizn",
          packageId: "TaiznLiveP",
        },
      },
    },
  },
) {
  const dir = mkdtempSync(join(tmpdir(), "taizn-live-core-"));
  const templatePath = join(dir, "taizn.template.json");

  writeFileSync(templatePath, `${JSON.stringify(template)}\n`);

  return templatePath;
}
