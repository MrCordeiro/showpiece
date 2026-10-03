import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config/schema.js";
import { INVITE_MARK, enableInvite } from "./invite-env.js";
import { makeTempDir } from "./temp-dir.js";

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
    screenshotsDir: resolve(configDir, ".showpiece/screenshots"),
    diagnosticsDir: resolve(configDir, ".showpiece/diagnostics"),
    appearance: "light",
    screens: [
      {
        id: "home",
        flow: resolve(configDir, ".showpiece/flows/home.yaml"),
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
    screenshotsDir = makeTempDir("showpiece-frame-");
    mkdirSync(join(screenshotsDir, "raw"), { recursive: true });
  });

  it("frames the light raw screenshot into framed/<id>.png", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    await writeSampleRaw(join(screenshotsDir, "raw", "home.png"));
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ screenshotsDir }),
      configPath: resolve(configDir, "showpiece.config.ts"),
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
      configPath: resolve(configDir, "showpiece.config.ts"),
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
      configPath: resolve(configDir, "showpiece.config.ts"),
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
      configPath: resolve(configDir, "showpiece.config.ts"),
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
    expect(output).toContain("showpiece capture");
  });

  it.each([
    ["a successful run", true],
    ["a failed run", false],
  ])("shows the interview invite only after %s", async (_, hasRaw) => {
    const { loadConfig } = await import("../src/config/load.js");
    if (hasRaw) await writeSampleRaw(join(screenshotsDir, "raw", "home.png"));
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({ screenshotsDir }),
      configPath: resolve(configDir, "showpiece.config.ts"),
      configDir,
    });
    const invite = enableInvite();
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    let output = "";
    try {
      const { runFrame } = await import("../src/frame/command.js");
      await runFrame({});
      output = writeSpy.mock.calls.map((call) => String(call[0])).join("");
    } finally {
      writeSpy.mockRestore();
      invite.restore();
    }

    expect(output.includes(INVITE_MARK)).toBe(hasRaw);
    expect(existsSync(invite.stateFile)).toBe(hasRaw);
  });

  it("sizes text over every configured screen, including ones --only skips", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { readFileSync } = await import("node:fs");
    await writeSampleRaw(join(screenshotsDir, "raw", "home.png"));
    const home = { id: "home", flow: "home.yaml", caption: "Short" };
    const profile = {
      id: "profile",
      flow: "profile.yaml",
      caption:
        "A much longer headline that needs a smaller size to fit in two lines",
    };
    const loadWith = (screens: Config["screens"]) =>
      vi.mocked(loadConfig).mockResolvedValue({
        config: makeConfig({ screenshotsDir, screens }),
        configPath: resolve(configDir, "showpiece.config.ts"),
        configDir,
      });

    const { runFrame } = await import("../src/frame/command.js");
    const homePath = join(screenshotsDir, "framed", "home.png");
    loadWith([home]);
    await runFrame({});
    const alone = readFileSync(homePath);
    loadWith([home, profile]);
    await runFrame({ only: "home" });
    expect(readFileSync(homePath).equals(alone)).toBe(false);
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
      configPath: resolve(configDir, "showpiece.config.ts"),
      configDir,
    });

    const { runFrame } = await import("../src/frame/command.js");
    await runFrame({ only: "home" });

    expect(existsSync(join(screenshotsDir, "framed", "home.png"))).toBe(true);
    expect(existsSync(join(screenshotsDir, "framed", "profile.png"))).toBe(
      false,
    );
  });

  it("keeps the manifest entries of screens that --only skips", async () => {
    const { loadConfig } = await import("../src/config/load.js");
    const { readManifest, writeManifest } = await import(
      "../src/frame/manifest.js"
    );
    await writeSampleRaw(join(screenshotsDir, "raw", "home.png"));
    const framedDir = join(screenshotsDir, "framed");
    mkdirSync(framedDir, { recursive: true });
    await writeManifest(framedDir, {
      schemaVersion: 1,
      images: { profile: { inputHash: "in", outputHash: "out" } },
    });
    vi.mocked(loadConfig).mockResolvedValue({
      config: makeConfig({
        screenshotsDir,
        screens: [
          { id: "home", flow: "home.yaml", caption: "" },
          { id: "profile", flow: "profile.yaml", caption: "" },
        ],
      }),
      configPath: resolve(configDir, "showpiece.config.ts"),
      configDir,
    });

    const { runFrame } = await import("../src/frame/command.js");
    await runFrame({ only: "home" });

    const manifest = await readManifest(framedDir);
    expect(manifest.images.profile).toEqual({
      inputHash: "in",
      outputHash: "out",
    });
    expect(manifest.images.home).toBeDefined();
  });
});
