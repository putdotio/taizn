import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonForHtmlScript, parseFetchUrls } from "../harness-core.ts";

const appDir = dirname(fileURLToPath(import.meta.url));
const beaconUrl = process.env.LIVE_TEST_BEACON_URL ?? "";
const fetchUrls = parseFetchUrls(process.env.LIVE_TEST_FETCH_URLS);
const source = readFileSync(join(appDir, "src", "index.html"), "utf8");

mkdirSync(join(appDir, "dist"), { recursive: true });
writeFileSync(
  join(appDir, "dist", "index.html"),
  source
    .replaceAll("__TAIZN_LIVE_BEACON_URL__", beaconUrl)
    .replaceAll("__TAIZN_LIVE_FETCH_URLS__", jsonForHtmlScript(fetchUrls)),
);
