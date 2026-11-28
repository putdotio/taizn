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
      "quality/no-conditional-empty-object-spread": "off",
      "quality/no-known-value-widening": "off",
      "quality/no-reflect-get": "off",
      "quality/no-unknown-returns": "off",
      "quality/no-unsafe-dictionary-type": "off",
      "typescript/no-unsafe-argument": "off",
      "typescript/no-unsafe-assignment": "off",
      "typescript/no-unsafe-call": "off",
      "typescript/no-unsafe-return": "off",
      "typescript/no-unsafe-type-assertion": "off",
    },
    overrides: [
      {
        files: ["live-test/**"],
        rules: {
          "no-console": "off",
        },
      },
      {
        files: ["test/seller.test.ts"],
        rules: {
          "unicorn/prefer-structured-clone": "off",
        },
      },
    ],
  },
  test: {
    coverage: {
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
