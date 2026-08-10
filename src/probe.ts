import { Console, Effect } from "effect";
import type { TaiznContext } from "./context.js";
import {
  extractAssetUrls,
  probeAssetUrls,
  readConfiguredIndexHtml,
  validateAssetUrls,
} from "./assets.js";
import { InvalidInput } from "./errors.js";
import { jsonForOutput, writeJsonArtifact } from "./io.js";

type ProbeOptions = {
  readonly artifact?: string;
  readonly dryRun?: boolean;
  readonly fields?: string;
  readonly json?: boolean;
};

export const probeHostedAssets = Effect.fn("probeHostedAssets")(function* (
  { config, env }: TaiznContext,
  urls: readonly string[],
  options: ProbeOptions = {},
) {
  const variant = config.widget.variants[env.variant];
  const discoveredUrls =
    urls.length > 0 ? [] : extractAssetUrls(yield* readConfiguredIndexHtml(config, variant));
  const selectedUrls = yield* validateAssetUrls(urls.length > 0 ? urls : discoveredUrls);
  const probes = options.dryRun ? [] : yield* probeAssetUrls(selectedUrls);
  const result = {
    dryRun: options.dryRun === true,
    source: urls.length > 0 ? "arguments" : "configured-index-html",
    urls: selectedUrls,
    variant: env.variant,
    probes,
  };

  if (options.artifact) {
    yield* writeJsonArtifact(options.artifact, result);
  }

  if (options.json) {
    yield* Console.log(yield* jsonForOutput(result, { fields: options.fields }));
    if (probes.some((probe) => !probe.ok)) {
      return yield* new InvalidInput({
        details: `${probes.filter((probe) => !probe.ok).length}/${probes.length} probes failed`,
        label: "hosted asset probe",
      });
    }
    return;
  }

  yield* Console.log(
    options.dryRun
      ? `Hosted asset probe dry-run: ${selectedUrls.length} URLs`
      : `Hosted asset probe: ${probes.filter((probe) => probe.ok).length}/${selectedUrls.length} URLs ok`,
  );
  if (options.artifact) {
    yield* Console.log(`Hosted asset artifact: ${options.artifact}`);
  }
  if (probes.some((probe) => !probe.ok)) {
    return yield* new InvalidInput({
      details: `${probes.filter((probe) => !probe.ok).length}/${probes.length} probes failed`,
      label: "hosted asset probe",
    });
  }
});
