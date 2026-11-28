import uinaf, { env, ignorePatterns } from "@uinaf/oxlint-config/effect/vite-plus";
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    extends: [uinaf],
    env,
    ignorePatterns,
    rules: {
      "@nkzw/no-instanceof": "off",
      "anti-slop-effect/no-manual-effect-error-tag": "off",
      "anti-slop-effect/no-manual-tag-comparison": "off",
      "anti-slop-effect/prefer-effect-match": "off",
      "anti-slop/no-runtime-typeof": "off",
      "anti-slop/no-unknown-parameters": "off",
      "anti-slop/require-safety-comment-for-type-assertion": "off",
      "array-callback-return": "off",
      "no-console": "off",
      "no-promise-executor-return": "off",
      "quality/no-conditional-empty-object-spread": "off",
      "quality/no-known-value-widening": "off",
      "quality/no-reflect-get": "off",
      "quality/no-unknown-returns": "off",
      "quality/no-unsafe-dictionary-type": "off",
      "react-hooks/rules-of-hooks": "off",
      "typescript/no-non-null-assertion": "off",
      "typescript/no-unsafe-argument": "off",
      "typescript/no-unsafe-assignment": "off",
      "typescript/no-unsafe-call": "off",
      "typescript/no-unsafe-return": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "uinaf/no-comments": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-hex-escape": "off",
      "unicorn/prefer-structured-clone": "off",
      "unicorn/prefer-top-level-await": "off",
    },
  },
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
