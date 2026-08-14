import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNightMode,
  isProcessRunning,
  parseAdbDevices,
  parseNightMode,
  parseProcessList,
  setNightMode,
} from "../src/capture/device.js";

// getNightMode/setNightMode shell out to adb; mock that boundary. `vi.mock` is
// hoisted above the imports above, so the static imports get the mock.
vi.mock("../src/util/exec.js", () => ({
  run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  assertToolInstalled: vi.fn(async () => undefined),
  delay: vi.fn(async () => undefined),
  waitFor: vi.fn(async () => true),
}));

describe("parseAdbDevices", () => {
  it("parses ready, offline, and unauthorized devices", () => {
    const stdout = [
      "List of devices attached",
      "emulator-5554\tdevice",
      "emulator-5556\toffline",
      "R58M12345\tunauthorized",
      "",
    ].join("\n");

    expect(parseAdbDevices(stdout)).toEqual([
      { serial: "emulator-5554", state: "device" },
      { serial: "emulator-5556", state: "offline" },
      { serial: "R58M12345", state: "unauthorized" },
    ]);
  });

  it("returns an empty list when no devices are attached", () => {
    expect(parseAdbDevices("List of devices attached\n\n")).toEqual([]);
  });

  it("ignores daemon notices and the header line anywhere", () => {
    const stdout = [
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "List of devices attached",
      "emulator-5554\tdevice",
    ].join("\n");
    expect(parseAdbDevices(stdout)).toEqual([
      { serial: "emulator-5554", state: "device" },
    ]);
  });
});

describe("parseNightMode", () => {
  it("reads the mode from `cmd uimode night` output", () => {
    expect(parseNightMode("Night mode: no\n")).toBe("no");
    expect(parseNightMode("Night mode: yes")).toBe("yes");
  });

  it("preserves modes beyond yes/no", () => {
    expect(parseNightMode("Night mode: custom_schedule")).toBe(
      "custom_schedule",
    );
  });

  it("returns undefined when the command is unsupported", () => {
    expect(parseNightMode("Unknown command: uimode")).toBeUndefined();
    expect(parseNightMode("")).toBeUndefined();
  });
});

describe("getNightMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the current mode from the given device", async () => {
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockResolvedValueOnce({
      stdout: "Night mode: yes",
      stderr: "",
      exitCode: 0,
    });

    await expect(getNightMode("emulator-5554")).resolves.toBe("yes");
    expect(run).toHaveBeenCalledWith(
      "adb",
      ["-s", "emulator-5554", "shell", "cmd", "uimode", "night"],
      expect.objectContaining({ reject: false }),
    );
  });

  it("returns undefined when the output cannot be parsed", async () => {
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockResolvedValueOnce({
      stdout: "Unknown command",
      stderr: "",
      exitCode: 0,
    });

    await expect(getNightMode("emulator-5554")).resolves.toBeUndefined();
  });
});

describe("parseProcessList", () => {
  it("finds a package that's running", () => {
    const stdout = [
      "USER  PID  PPID  ... NAME",
      "u0_a174 2073 307 13908024 215924 0 0 S com.pluckd.cashzilla.dev",
    ].join("\n");
    expect(parseProcessList(stdout, "com.pluckd.cashzilla.dev")).toBe(true);
  });

  it("returns false when the package isn't in the process list", () => {
    const stdout = [
      "USER  PID  PPID  ... NAME",
      "u0_a1 100 1 0 0 0 S com.other.app",
    ].join("\n");
    expect(parseProcessList(stdout, "com.example.app")).toBe(false);
  });

  it("doesn't false-positive on a package name that's a substring of another", () => {
    const stdout = "u0_a1 100 1 0 0 0 S com.example.app.dev";
    expect(parseProcessList(stdout, "com.example.app")).toBe(false);
  });

  it("returns false for empty output", () => {
    expect(parseProcessList("", "com.example.app")).toBe(false);
  });
});

describe("isProcessRunning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when the process list contains the package", async () => {
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockResolvedValueOnce({
      stdout: "u0_a174 2073 307 0 0 0 S com.example.app",
      stderr: "",
      exitCode: 0,
    });

    await expect(
      isProcessRunning("emulator-5554", "com.example.app"),
    ).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith(
      "adb",
      ["-s", "emulator-5554", "shell", "ps", "-A"],
      expect.objectContaining({ reject: false }),
    );
  });

  it("returns false when the process is gone", async () => {
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockResolvedValueOnce({
      stdout: "u0_a1 100 1 0 0 0 S com.other.app",
      stderr: "",
      exitCode: 0,
    });

    await expect(
      isProcessRunning("emulator-5554", "com.example.app"),
    ).resolves.toBe(false);
  });

  it("defaults to true (assume running) when the check itself fails", async () => {
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockRejectedValueOnce(new Error("device offline"));

    await expect(
      isProcessRunning("emulator-5554", "com.example.app"),
    ).resolves.toBe(true);
  });
});

describe("setNightMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets the requested mode on the given device", async () => {
    const { run } = await import("../src/util/exec.js");
    await setNightMode("emulator-5554", "yes");

    expect(run).toHaveBeenCalledWith("adb", [
      "-s",
      "emulator-5554",
      "shell",
      "cmd",
      "uimode",
      "night",
      "yes",
    ]);
  });

  it("throws an actionable error when the device rejects the command", async () => {
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockRejectedValueOnce(new Error("cmd: not found"));

    await expect(setNightMode("emulator-5554", "yes")).rejects.toThrow(
      /API 29/,
    );
  });
});
