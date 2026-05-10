#!/usr/bin/env node

import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import { command } from "./cli.js";
import { loadLocalEnv } from "./runtime.js";

const PackageJsonSchema = Schema.Struct({
  version: Schema.String,
});

loadLocalEnv();

const cli = Command.run(command, {
  name: "taizn",
  version: getPackageVersion(),
});

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);

function getPackageVersion() {
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(PackageJsonSchema))(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).version;
  } catch (error) {
    if (ParseResult.isParseError(error)) {
      return "0.0.0";
    }

    return "0.0.0";
  }
}
