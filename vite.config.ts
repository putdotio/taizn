import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    coverage: {
      // Coverage blind spot: a handful of CLI tests spawn the packaged
      // dist/taizn.mjs to prove real process-boundary behavior (boot, help,
      // stream separation, exit codes, inherited child stdio). V8 coverage
      // cannot attribute subprocess execution on vitest 4; the bin shim
      // src/taizn.ts is therefore uncovered by design. Everything else runs
      // the same entry in-process via runTaiznCli (src/main.ts). When
      // vite-plus ships vitest 5, coverage.autoAttachSubprocess can close
      // the remaining gap.
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
