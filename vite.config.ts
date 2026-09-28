import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    coverage: {
      // Coverage blind spot: a handful of CLI tests spawn the packaged
      // dist/taizn.mjs to prove real process-boundary behavior (boot, help,
      // stream separation, exit codes, inherited child stdio). Those
      // subprocesses are not attributed to coverage, so the bin shim
      // src/taizn.ts is uncovered by design. Everything else runs the same
      // entry in-process via runTaiznCli (src/main.ts). Vitest 5
      // coverage.autoAttachSubprocess can close the remaining gap.
      thresholds: {
        branches: 59,
        functions: 68,
        lines: 71,
        statements: 71,
      },
    },
    exclude: ["dist/**", "node_modules/**", ".repos/**"],
    include: ["test/**/*.test.ts"],
  },
});
