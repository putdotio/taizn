import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**", ".repos/**"],
    include: ["test/**/*.test.ts"],
  },
});
