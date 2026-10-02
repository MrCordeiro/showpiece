import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Tests that run `runFrame` load sharp and fonts cold in parallel workers.
    testTimeout: 20_000,
  },
});
