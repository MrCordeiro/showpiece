import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Command tests must not write the invite state file in the real ~/.config.
    env: { SHOWPIECE_NO_INVITE: "1" },
    // Tests that run `runFrame` load sharp and fonts cold in parallel workers.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
