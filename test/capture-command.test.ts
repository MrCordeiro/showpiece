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
  getNightMode: vi.fn(async () => "no"),
  setNightMode: vi.fn(async () => undefined),
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

describe("resolveAppearance", () => {
  it("falls back to the configured appearance when no flag is given", async () => {
    const { resolveAppearance } = await import("../src/capture/command.js");
    expect(resolveAppearance("dark", undefined)).toBe("dark");
  });

  it("lets the flag override the config", async () => {
    const { resolveAppearance } = await import("../src/capture/command.js");
    expect(resolveAppearance("light", "dark")).toBe("dark");
  });

  it("throws on an unknown flag value", async () => {
    const { resolveAppearance } = await import("../src/capture/command.js");
    expect(() => resolveAppearance("light", "sepia")).toThrow(
      /Invalid --appearance "sepia"/,
    );
  });
});

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

  it("sets dark night mode and passes the appearance to runFlow", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { setNightMode } = await import("../src/capture/device.js");
    const { runFlow } = await import("../src/capture/maestro.js");
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ appearance: "dark" }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runCapture } = await import("../src/capture/command.js");
    await runCapture({});

    expect(setNightMode).toHaveBeenCalledWith("emulator-5554", "yes");
    expect(runFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "home" }),
      expect.objectContaining({ appearance: "dark" }),
    );
  });

  it("restores the device's previous night mode after capturing", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { getNightMode, setNightMode } = await import(
      "../src/capture/device.js"
    );
    vi.mocked(getNightMode).mockResolvedValueOnce("custom_schedule");
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ appearance: "dark" }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runCapture } = await import("../src/capture/command.js");
    await runCapture({});

    expect(setNightMode).toHaveBeenNthCalledWith(1, "emulator-5554", "yes");
    expect(setNightMode).toHaveBeenNthCalledWith(
      2,
      "emulator-5554",
      "custom_schedule",
    );
  });

  it("restores the previous night mode even when a flow fails", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { setNightMode } = await import("../src/capture/device.js");
    const { runFlow } = await import("../src/capture/maestro.js");
    vi.mocked(runFlow).mockRejectedValueOnce(new Error("maestro exploded"));
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ appearance: "dark" }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runCapture } = await import("../src/capture/command.js");
    const exitCode = await runCapture({});

    expect(exitCode).toBe(1);
    expect(setNightMode).toHaveBeenNthCalledWith(2, "emulator-5554", "no");
  });

  it("warns but does not fail the run when restoring night mode fails", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { setNightMode } = await import("../src/capture/device.js");
    vi.mocked(setNightMode)
      .mockResolvedValueOnce(undefined) // the initial forced set succeeds
      .mockRejectedValueOnce(new Error("adb: device offline")); // the restore fails
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ appearance: "dark" }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const { runCapture } = await import("../src/capture/command.js");
    const exitCode = await runCapture({});

    expect(exitCode).toBe(0);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not restore"),
    );
    stderrSpy.mockRestore();
  });

  it("does not force a night mode when the initial read fails", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { getNightMode, setNightMode } = await import(
      "../src/capture/device.js"
    );
    vi.mocked(getNightMode).mockResolvedValueOnce(undefined);
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ appearance: "dark" }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runCapture } = await import("../src/capture/command.js");
    await runCapture({});

    expect(setNightMode).not.toHaveBeenCalled();
  });

  it("lets --appearance override the configured appearance", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { setNightMode } = await import("../src/capture/device.js");
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ appearance: "light" }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runCapture } = await import("../src/capture/command.js");
    await runCapture({ appearance: "dark" });

    expect(setNightMode).toHaveBeenNthCalledWith(1, "emulator-5554", "yes");
  });
});
