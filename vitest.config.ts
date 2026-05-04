import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules", ".next"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.config.*", "tests/**", ".next/**", "drizzle/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname),
      "@/lib": resolve(__dirname, "lib"),
      "@/app": resolve(__dirname, "app"),
      "@/components": resolve(__dirname, "components"),
      "@/tests": resolve(__dirname, "tests"),
    },
  },
});
