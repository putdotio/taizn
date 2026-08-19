import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        branches: 22,
        functions: 23,
        lines: 26,
        statements: 26,
      },
    },
    exclude: ["dist/**", "node_modules/**", ".repos/**"],
    include: ["test/**/*.test.ts"],
  },
});
