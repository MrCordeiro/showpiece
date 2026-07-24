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
  // Real mkdtemp appends six random characters to the prefix; a fixed suffix
  // keeps the staged paths predictable here.
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}abc123`),
  rm: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
}));
vi.mock("../src/util/exec.js", () => ({
  run: vi.fn(async () => ({ stdout: "" })),
}));

const rawDir = "/tmp/raw";
const staging = `${join(rawDir, ".vitrine-")}abc123`;

describe("runFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs maestro in a staging dir, not the raw output dir", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { run } = await import("../src/util/exec.js");

    const out = await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "light",
    });

    expect(out).toBe(join(rawDir, "home.png"));
    expect(run).toHaveBeenCalledWith(
      "maestro",
      ["--device", "emulator-5554", "test", "flows/home.yaml"],
      expect.objectContaining({ cwd: staging }),
    );
  });

  it("moves the staged capture to the light output path", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rename } = await import("node:fs/promises");

    await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "light",
    });

    expect(rename).toHaveBeenCalledWith(
      join(staging, "home.png"),
      join(rawDir, "home.png"),
    );
  });

  it("moves the staged capture to a -dark path on a dark run", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rename } = await import("node:fs/promises");

    const out = await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "dark",
    });

    expect(out).toBe(join(rawDir, "home-dark.png"));
    expect(rename).toHaveBeenCalledWith(
      join(staging, "home.png"),
      join(rawDir, "home-dark.png"),
    );
  });

  it("never touches the light capture on a successful dark run", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rm } = await import("node:fs/promises");

    await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "dark",
    });

    expect(rm).not.toHaveBeenCalledWith(
      join(rawDir, "home.png"),
      expect.anything(),
    );
  });

  it("throws when the expected png was not produced", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    const { runFlow } = await import("../src/capture/maestro.js");

    await expect(
      runFlow(screen(), {
        rawDir,
        serial: "emulator-5554",
        appearance: "light",
      }),
    ).rejects.toThrow(/was not produced/);
  });

  it("removes only the failed screen's own output when the flow fails", async () => {
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockRejectedValueOnce(new Error("maestro exited 1"));
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rm } = await import("node:fs/promises");

    await expect(
      runFlow(screen(), {
        rawDir,
        serial: "emulator-5554",
        appearance: "dark",
      }),
    ).rejects.toThrow(/maestro exited 1/);

    // The failed dark capture is cleared so `frame`/`publish` can't ship a PNG
    // no successful run produced — but the light capture must survive.
    expect(rm).toHaveBeenCalledWith(join(rawDir, "home-dark.png"), {
      force: true,
    });
    expect(rm).not.toHaveBeenCalledWith(
      join(rawDir, "home.png"),
      expect.anything(),
    );
  });

  it("removes the output when the flow produced no png", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rm } = await import("node:fs/promises");

    await expect(
      runFlow(screen(), {
        rawDir,
        serial: "emulator-5554",
        appearance: "light",
      }),
    ).rejects.toThrow(/was not produced/);

    expect(rm).toHaveBeenCalledWith(join(rawDir, "home.png"), { force: true });
  });

  it("removes the staging dir after a successful run", async () => {
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rm } = await import("node:fs/promises");

    await runFlow(screen(), {
      rawDir,
      serial: "emulator-5554",
      appearance: "light",
    });

    expect(rm).toHaveBeenCalledWith(staging, { recursive: true, force: true });
  });

  it("removes the staging dir after a failed run", async () => {
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockRejectedValueOnce(new Error("maestro exited 1"));
    const { runFlow } = await import("../src/capture/maestro.js");
    const { rm } = await import("node:fs/promises");

    await expect(
      runFlow(screen(), {
        rawDir,
        serial: "emulator-5554",
        appearance: "light",
      }),
    ).rejects.toThrow();

    expect(rm).toHaveBeenCalledWith(staging, { recursive: true, force: true });
  });
});
