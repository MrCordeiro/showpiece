import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertFlowConvention,
  extractScreenshotNames,
  outputFileName,
} from "../src/capture/maestro.js";
import type { ScreenConfig } from "../src/config/schema.js";

const screen = (over: Partial<ScreenConfig> = {}): ScreenConfig => ({
  id: "home",
  flow: "flows/home.yaml",
  caption: "",
  ...over,
});

describe("extractScreenshotNames", () => {
  it("reads the shorthand form and ignores the header doc", () => {
    const flow = [
      "appId: com.example.myapp",
      "---",
      "- launchApp:",
      "    clearState: true",
      '- assertVisible: "Home"',
      "- takeScreenshot: home",
    ].join("\n");
    expect(extractScreenshotNames(flow)).toEqual(["home"]);
  });

  it("reads the object form and strips a .png extension", () => {
    const flow = [
      "appId: com.example.myapp",
      "---",
      "- takeScreenshot:",
      "    path: profile.png",
    ].join("\n");
    expect(extractScreenshotNames(flow)).toEqual(["profile"]);
  });

  it("returns an empty array when there is no takeScreenshot step", () => {
    const flow = ["appId: x", "---", '- assertVisible: "Home"'].join("\n");
    expect(extractScreenshotNames(flow)).toEqual([]);
  });
});

describe("assertFlowConvention", () => {
  it("passes when a takeScreenshot name matches the screen id", () => {
    const flow = "appId: x\n---\n- takeScreenshot: home";
    expect(() => assertFlowConvention(flow, screen())).not.toThrow();
  });

  it("throws when the flow has no takeScreenshot", () => {
    const flow = "appId: x\n---\n- assertVisible: Home";
    expect(() => assertFlowConvention(flow, screen())).toThrow(
      /no takeScreenshot/,
    );
  });

  it("throws when the name does not match the id", () => {
    const flow = "appId: x\n---\n- takeScreenshot: dashboard";
    expect(() => assertFlowConvention(flow, screen({ id: "home" }))).toThrow(
      /must match the screen id/,
    );
  });
});

describe("outputFileName", () => {
  it("leaves light-mode captures unsuffixed", () => {
    expect(outputFileName("home", "light")).toBe("home.png");
  });

  it("suffixes dark-mode captures with -dark", () => {
    expect(outputFileName("home", "dark")).toBe("home-dark.png");
  });
});

// runFlow drives the filesystem + maestro; mock those boundaries.
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => "appId: x\n---\n- takeScreenshot: home"),
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
}));
vi.mock("../src/util/exec.js", () => ({
  run: vi.fn(async () => ({ stdout: "" })),
}));

describe("runFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes maestro with the device and returns the raw png path", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { run } = await import("../src/util/exec.js");

    const rawDir = "/tmp/raw";
    const out = await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "light",
    });

    // Built via the same platform-native `join` the implementation uses —
    // path.join's separator is OS-dependent, so a hardcoded POSIX literal
    // here would fail on Windows even though the implementation is correct.
    expect(out).toBe(join(rawDir, "home.png"));
    expect(run).toHaveBeenCalledWith(
      "maestro",
      ["--device", "emulator-5554", "test", "flows/home.yaml"],
      expect.objectContaining({ cwd: rawDir }),
    );
  });

  it("throws when the expected png was not produced", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    const { runFlow } = await import("../src/capture/maestro.js");

    await expect(
      runFlow(screen(), {
        rawDir: "/tmp/raw",
        serial: "emulator-5554",
        appearance: "light",
      }),
    ).rejects.toThrow(/was not produced/);
  });

  it("renames the capture to a -dark path on a dark run", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rename } = await import("node:fs/promises");

    const rawDir = "/tmp/raw";
    const out = await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "dark",
    });

    expect(out).toBe(join(rawDir, "home-dark.png"));
    expect(rename).toHaveBeenCalledWith(
      join(rawDir, "home.png"),
      join(rawDir, "home-dark.png"),
    );
  });

  it("does not rename on a light run", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rename } = await import("node:fs/promises");

    await runFlow(screen(), {
      rawDir: "/tmp/raw",
      serial: "emulator-5554",
      appearance: "light",
    });

    expect(rename).not.toHaveBeenCalled();
  });

  it("removes a stale capture before running maestro", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rm } = await import("node:fs/promises");

    const rawDir = "/tmp/raw";
    await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "light",
    });

    expect(rm).toHaveBeenCalledWith(join(rawDir, "home.png"), { force: true });
  });

  it("removes both the bare and -dark stale captures before running maestro on a dark run", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rm } = await import("node:fs/promises");

    const rawDir = "/tmp/raw";
    await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "dark",
    });

    expect(rm).toHaveBeenCalledWith(join(rawDir, "home.png"), { force: true });
    expect(rm).toHaveBeenCalledWith(join(rawDir, "home-dark.png"), {
      force: true,
    });
  });
});
