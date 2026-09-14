import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const alias = { "~": `${root}src` };
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"], environment: "node" }, resolve: { alias } },
      { test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 120_000, fileParallelism: false, setupFiles: ["tests/integration/setup.ts"] }, resolve: { alias } },
    ],
  },
});
