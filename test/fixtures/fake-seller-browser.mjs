#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const descendant = spawn(
  process.execPath,
  ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
  { stdio: "ignore" },
);

writeFileSync(
  process.env.TAIZN_TEST_BROWSER_PIDS,
  JSON.stringify({ descendant: descendant.pid, leader: process.pid }),
);
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
