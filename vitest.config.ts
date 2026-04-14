import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extensions/index.test.ts"],
    typecheck: {
      include: ["**/*.test-d.ts"],
    },
  },
});