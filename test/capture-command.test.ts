import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config/schema.js";

// runCapture drives config loading, device/maestro orchestration, and
// tool-presence checks; mock those boundaries so this test can focus purely
// on rawDir resolution.
vi.mock("../src/config/load.js", () => ({
  loadConfig: vi.fn(),
}));
vi.mock("../src/util/exec.js", () => ({
  assertToolInstalled: vi.fn(async () => undefined),
}));
vi.mock("../src/capture/device.js", () => ({
  resolveDevice: vi.fn(async () => "emulator-5554"),
  ensureApp: vi.fn(async () => undefined),
  setupMetroReverse: vi.fn(async () => undefined),
  overrideMetroHost: vi.fn(async () => undefined),
  assertMetroRunning: vi.fn(async () => undefined),
}));
vi.mock("../src/capture/maestro.js", () => ({
  runFlow: vi.fn(async () => "/some/raw/home.png"),
}));

const configDir = "C:/client/repo";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    app: { packageName: "com.example.app" },
    device: {
      avd: "Pixel_7_API_34",
      locale: "en-US",
      devServer: false,
      metroPort: 8081,
    },
    frame: {
      template: "gradient",
      background: "#101010",
      textColor: "#ffffff",
      font: "Inter",
    },
    publish: {
      serviceAccountKeyPath: resolve(configDir, "secrets/key.json"),
      track: "listing",
    },
    screenshotsDir: resolve(configDir, ".vitrine/screenshots"),
    appearance: "light",
    screens: [
      {
        id: "home",
        flow: resolve(configDir, ".vitrine/flows/home.yaml"),
        caption: "",
      },
    ],
    ...overrides,
  };
}

describe("runCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives rawDir from config.screenshotsDir, not process.cwd()", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { runFlow } = await import("../src/capture/maestro.js");
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig(),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runCapture } = await import("../src/capture/command.js");
    await runCapture({});

    expect(runFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "home" }),
      expect.objectContaining({
        rawDir: resolve(configDir, ".vitrine/screenshots/raw"),
      }),
    );
  });
});
