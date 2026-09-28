import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config/schema.js";

vi.mock("../src/config/load.js", () => ({ loadConfig: vi.fn() }));

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
      background: ["#1a1a2e", "#16213e"],
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
        caption: "Track everything",
      },
    ],
    ...overrides,
  };
}

async function writeSampleRaw(path: string): Promise<void> {
  const buffer = await sharp({
    create: { width: 400, height: 800, channels: 4, background: "#3b82f6" },
  })
    .png()
    .toBuffer();
  writeFileSync(path, buffer);
}

describe("runFrame", () => {
  let screenshotsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    screenshotsDir = mkdtempSync(join(tmpdir(), "vitrine-frame-"));
    mkdirSync(join(screenshotsDir, "raw"), { recursive: true });
  });

  it("frames the light raw screenshot into framed/<id>.png", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    await writeSampleRaw(join(screenshotsDir, "raw", "home.png"));
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ screenshotsDir }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runFrame } = await import("../src/frame/command.js");
    const exitCode = await runFrame({});

    expect(exitCode).toBe(0);
    expect(existsSync(join(screenshotsDir, "framed", "home.png"))).toBe(true);
  });

  it("frames both light and dark variants when both raw files exist", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    await writeSampleRaw(join(screenshotsDir, "raw", "home.png"));
    await writeSampleRaw(join(screenshotsDir, "raw", "home-dark.png"));
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ screenshotsDir }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runFrame } = await import("../src/frame/command.js");
    const exitCode = await runFrame({});

    expect(exitCode).toBe(0);
    expect(existsSync(join(screenshotsDir, "framed", "home.png"))).toBe(true);
    expect(existsSync(join(screenshotsDir, "framed", "home-dark.png"))).toBe(
      true,
    );
  });

  it("fails just that screen, with a clear message, when no raw file exists", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ screenshotsDir }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runFrame } = await import("../src/frame/command.js");
    const exitCode = await runFrame({});

    expect(exitCode).toBe(1);
    expect(existsSync(join(screenshotsDir, "framed"))).toBe(true); // dir still created
  });

  it("frames a screen with a raw file even when a sibling screen has none, and reports the missing one clearly", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    await writeSampleRaw(join(screenshotsDir, "raw", "home.png"));
    // "profile" has no raw file and should fail on its own, without
    // stopping "home" from framing successfully.
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({
        screenshotsDir,
        screens: [
          { id: "home", flow: "home.yaml", caption: "Track everything" },
          { id: "profile", flow: "profile.yaml", caption: "Your data" },
        ],
      }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const { runFrame } = await import("../src/frame/command.js");
    const exitCode = await runFrame({});

    const output = writeSpy.mock.calls.map((call) => String(call[0])).join("");
    writeSpy.mockRestore();

    expect(exitCode).toBe(1);
    expect(existsSync(join(screenshotsDir, "framed", "home.png"))).toBe(true);
    expect(existsSync(join(screenshotsDir, "framed", "profile.png"))).toBe(
      false,
    );
    expect(output).toContain("vitrine capture");
  });

  it("honors --only, skipping screens not selected", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    await writeSampleRaw(join(screenshotsDir, "raw", "home.png"));
    await writeSampleRaw(join(screenshotsDir, "raw", "profile.png"));
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({
        screenshotsDir,
        screens: [
          { id: "home", flow: "home.yaml", caption: "" },
          { id: "profile", flow: "profile.yaml", caption: "" },
        ],
      }),
      configPath: resolve(configDir, "vitrine.config.ts"),
      configDir,
    });

    const { runFrame } = await import("../src/frame/command.js");
    await runFrame({ only: "home" });

    expect(existsSync(join(screenshotsDir, "framed", "home.png"))).toBe(true);
    expect(existsSync(join(screenshotsDir, "framed", "profile.png"))).toBe(
      false,
    );
  });
});
