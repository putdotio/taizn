#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { runTaiznCli } from "./main.js";
import { TaiznSystem } from "./runtime.js";

const appLayer = Layer.mergeAll(NodeServices.layer, TaiznSystem.Live);

NodeRuntime.runMain(
  runTaiznCli(process.argv.slice(2)).pipe(
    Effect.map((exitCode) => {
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    }),
    Effect.provide(appLayer),
  ),
);
