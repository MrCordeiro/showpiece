import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Loaded as a JSON module (vitest/vite resolve this at build time, not
// through `node:fs`) so it survives the `node:fs`/`node:fs/promises` mocks
// below.
import failedCommandsFixture from "./fixtures/maestro-commands-failed.json" with {
  type: "json",
};

vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("node:fs/promises", () => ({
  rm: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  readdir: vi.fn(async (): Promise<string[]> => []),
  rename: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => "[]"),
}));
vi.mock("../src/util/exec.js", () => ({
  run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}));

describe("outputBaseName", () => {
  it("leaves light-mode ids unsuffixed", async () => {
    const { outputBaseName } = await import("../src/capture/diagnostics.js");
    expect(outputBaseName("home", "light")).toBe("home");
  });

  it("suffixes dark-mode ids with -dark", async () => {
    const { outputBaseName } = await import("../src/capture/diagnostics.js");
    expect(outputBaseName("home", "dark")).toBe("home-dark");
  });
});

describe("firstFailedCommand", () => {
  it("returns undefined for non-array input", async () => {
    const { firstFailedCommand } = await import(
      "../src/capture/diagnostics.js"
    );
    expect(firstFailedCommand({})).toBeUndefined();
    expect(firstFailedCommand(null)).toBeUndefined();
  });

  it("returns undefined when every step completed", async () => {
    const { firstFailedCommand } = await import(
      "../src/capture/diagnostics.js"
    );
    expect(
      firstFailedCommand([
        {
          command: { launchAppCommand: {} },
          metadata: { status: "COMPLETED", sequenceNumber: 1 },
        },
        {
          command: { defineVariablesCommand: {} },
          metadata: { status: "COMPLETED", sequenceNumber: 0 },
        },
      ]),
    ).toBeUndefined();
  });

  it("finds the first non-completed step in sequenceNumber order, not array order", async () => {
    const { firstFailedCommand } = await import(
      "../src/capture/diagnostics.js"
    );
    // The fixture's array order is NOT execution order (mirrors real Maestro
    // dumps: setup commands are appended highest-sequenceNumber-first). The
    // fixture itself is captured verbatim from a real failing cashzilla run
    // (2026-08-13) — `assertVisible: "Net Worth"` compiles to
    // assertConditionCommand/condition.visible.textRegex, not a top-level
    // `text` field.
    const failure = firstFailedCommand(failedCommandsFixture);
    expect(failure).toEqual({
      description: "assertCondition: Net Worth",
      status: "FAILED",
      durationMs: 90078,
    });
  });

  it("finds a detail nested several levels deep, not just at the top", async () => {
    const { firstFailedCommand } = await import(
      "../src/capture/diagnostics.js"
    );
    // Only launchAppCommand/applyConfigurationCommand have been observed for
    // real; an assertion's target may nest further (condition -> visible ->
    // text) — the extraction must not assume a flat shape.
    const failure = firstFailedCommand([
      {
        command: {
          assertConditionCommand: {
            condition: { visible: { text: "Home" } },
          },
        },
        metadata: { status: "FAILED", sequenceNumber: 0, duration: 500 },
      },
    ]);
    expect(failure?.description).toBe("assertCondition: Home");
  });

  it("falls back to the bare command name when nothing summarizable is found", async () => {
    const { firstFailedCommand } = await import(
      "../src/capture/diagnostics.js"
    );
    const failure = firstFailedCommand([
      {
        command: { someOpaqueCommand: { flag: true } },
        metadata: { status: "FAILED", sequenceNumber: 0 },
      },
    ]);
    expect(failure?.description).toBe("someOpaque");
  });
});

describe("ensureScreenDiagnosticsDir", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wipes then recreates the screen's own directory", async () => {
    const { ensureScreenDiagnosticsDir } = await import(
      "../src/capture/diagnostics.js"
    );
    const { rm, mkdir } = await import("node:fs/promises");

    const dir = await ensureScreenDiagnosticsDir("/diag", "home");

    expect(dir).toBe(join("/diag", "home"));
    expect(rm).toHaveBeenCalledWith(dir, { recursive: true, force: true });
    expect(mkdir).toHaveBeenCalledWith(dir, { recursive: true });
  });
});

describe("normalizeArtifactNames", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renames the flow-basename artifacts to fixed ASCII names", async () => {
    const { normalizeArtifactNames } = await import(
      "../src/capture/diagnostics.js"
    );
    const { readdir, rename } = await import("node:fs/promises");
    // `readdir`'s real ambient type is overloaded (string[] | Dirent[]
    // depending on options); the mock always returns string[] — cast to
    // pick that overload rather than fighting TS's overload resolution.
    const readdirMock = readdir as unknown as (
      path: string,
    ) => Promise<string[]>;
    vi.mocked(readdirMock).mockResolvedValueOnce([
      "commands-(home.yaml).json",
      "screenshot-❌-1784900325975-(home.yaml).png",
      "maestro.log", // already stable — must not be touched
    ]);

    await normalizeArtifactNames("/diag/home");

    expect(rename).toHaveBeenCalledWith(
      join("/diag/home", "commands-(home.yaml).json"),
      join("/diag/home", "commands.json"),
    );
    expect(rename).toHaveBeenCalledWith(
      join("/diag/home", "screenshot-❌-1784900325975-(home.yaml).png"),
      join("/diag/home", "failure-screenshot.png"),
    );
    expect(rename).toHaveBeenCalledTimes(2);
  });
});

describe("writeContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes context.json as pretty JSON", async () => {
    const { writeContext } = await import("../src/capture/diagnostics.js");
    const { writeFile } = await import("node:fs/promises");

    await writeContext("/diag/home", {
      id: "home",
      appearance: "light",
      flow: "flows/home.yaml",
      serial: "emulator-5554",
      packageName: "com.example.app",
      devServer: true,
      metroPort: 8081,
      exitCode: 0,
      status: "captured",
      timestamp: "2026-08-13T00:00:00.000Z",
    });

    expect(writeFile).toHaveBeenCalledWith(
      join("/diag/home", "context.json"),
      expect.stringContaining('"status": "captured"'),
      "utf8",
    );
  });
});

describe("dumpHierarchy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the hierarchy dump", async () => {
    const { dumpHierarchy } = await import("../src/capture/diagnostics.js");
    const { run } = await import("../src/util/exec.js");
    const { writeFile } = await import("node:fs/promises");
    vi.mocked(run).mockResolvedValueOnce({
      stdout: '{"view":"root"}',
      stderr: "",
      exitCode: 0,
    });

    await dumpHierarchy("emulator-5554", "/diag/home");

    expect(run).toHaveBeenCalledWith(
      "maestro",
      ["--device", "emulator-5554", "hierarchy"],
      expect.objectContaining({ reject: false }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      join("/diag/home", "hierarchy.json"),
      expect.stringContaining('"view":"root"'),
      "utf8",
    );
  });

  it("never throws — a failed dump must not mask the real capture error", async () => {
    const { dumpHierarchy } = await import("../src/capture/diagnostics.js");
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockRejectedValueOnce(new Error("device offline"));

    await expect(
      dumpHierarchy("emulator-5554", "/diag/home"),
    ).resolves.toBeUndefined();
  });
});

/**
 * `run()` is mocked globally for this whole file; collectDiagnostics fans
 * out to several distinct adb/maestro invocations (the flow itself,
 * `hierarchy`, `logcat -c`, `logcat -d`, `ps -A`). Route each to a sensible
 * default — process running, empty logcat — so tests that aren't about
 * those specifically don't have to know about them, and let `maestroResult`
 * stand in for the one call each test actually cares about.
 */
function mockRunRouting(maestroResult: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}) {
  return async (command: string, args: readonly string[] = []) => {
    if (command === "adb" && args.includes("ps")) {
      return {
        stdout: "u0_a1 100 1 0 0 0 S com.example.app",
        stderr: "",
        exitCode: 0,
      };
    }
    if (command === "adb" && args.includes("logcat")) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (command === "maestro" && args.includes("hierarchy")) {
      return { stdout: "{}", stderr: "", exitCode: 0 };
    }
    return maestroResult;
  };
}

const baseOptions = {
  flowPath: "flows/home.yaml",
  serial: "emulator-5554",
  packageName: "com.example.app",
  cwd: "/staging",
  screenDiagDir: "/diag/home",
};

describe("extractCrashSignals", () => {
  it("keeps lines matching known crash/death patterns", async () => {
    const { extractCrashSignals } = await import(
      "../src/capture/diagnostics.js"
    );
    const logcat = [
      "D SomeTag: routine noise",
      "F libc: Fatal signal 6 (SIGABRT), code -1",
      "F libc: Abort message: 'assertion failed'",
      "I ActivityManager: Process com.example.app has died: fg TOP",
      "I libprocessgroup: Successfully killed process cgroup uid 10174",
      'I ReactNativeJS: Running "main" with {"rootTag":1}',
      "E AndroidRuntime: FATAL EXCEPTION: main",
      "D AnotherTag: more noise",
    ].join("\n");

    expect(extractCrashSignals(logcat)).toEqual([
      "F libc: Fatal signal 6 (SIGABRT), code -1",
      "F libc: Abort message: 'assertion failed'",
      "I ActivityManager: Process com.example.app has died: fg TOP",
      "I libprocessgroup: Successfully killed process cgroup uid 10174",
      'I ReactNativeJS: Running "main" with {"rootTag":1}',
      "E AndroidRuntime: FATAL EXCEPTION: main",
    ]);
  });

  it("returns an empty array for clean logcat", async () => {
    const { extractCrashSignals } = await import(
      "../src/capture/diagnostics.js"
    );
    expect(extractCrashSignals("D Tag: nothing interesting")).toEqual([]);
  });
});

describe("collectDiagnostics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports ok:true and does not build an error message on success", async () => {
    const { collectDiagnostics } = await import(
      "../src/capture/diagnostics.js"
    );
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockImplementation(
      mockRunRouting({ stdout: "", stderr: "", exitCode: 0 }) as never,
    );

    const summary = await collectDiagnostics(baseOptions);

    expect(summary).toEqual({ exitCode: 0, ok: true });
  });

  it("treats a null (signal-killed) exit code as a failure, not success", async () => {
    const { collectDiagnostics } = await import(
      "../src/capture/diagnostics.js"
    );
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockImplementation(
      mockRunRouting({ stdout: "", stderr: "", exitCode: null }) as never,
    );

    const summary = await collectDiagnostics(baseOptions);

    expect(summary.ok).toBe(false);
    expect(summary.exitCode).toBeNull();
  });

  it("builds the error message from commands.json when present", async () => {
    const { collectDiagnostics } = await import(
      "../src/capture/diagnostics.js"
    );
    const { run } = await import("../src/util/exec.js");
    const { readFile } = await import("node:fs/promises");
    vi.mocked(run).mockImplementation(
      mockRunRouting({ stdout: "", stderr: "", exitCode: 1 }) as never,
    );
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify(failedCommandsFixture),
    );

    const summary = await collectDiagnostics(baseOptions);

    expect(summary.ok).toBe(false);
    expect(summary.crashed).toBeUndefined();
    expect(summary.errorMessage).toContain("assertCondition: Net Worth");
    expect(summary.errorMessage).toContain("FAILED");
  });

  it("captured stdout+stderr is non-empty on a failing flow with no commands.json", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValueOnce(false); // no commands.json
    const { collectDiagnostics } = await import(
      "../src/capture/diagnostics.js"
    );
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockImplementation(
      mockRunRouting({
        stdout: "assertVisible: Home not found",
        stderr: "",
        exitCode: 1,
      }) as never,
    );

    const summary = await collectDiagnostics(baseOptions);

    expect(summary.ok).toBe(false);
    // This is the assumption the whole diagnostics stage rests on: if `run()`
    // silently coerced a non-string stdout to "", this would go blank.
    expect(summary.errorMessage).toContain("assertVisible: Home not found");
  });

  it("reports crashed:true and points at crash-signals.log when the app process is gone", async () => {
    const { collectDiagnostics } = await import(
      "../src/capture/diagnostics.js"
    );
    const { run } = await import("../src/util/exec.js");
    vi.mocked(run).mockImplementation(async (command, args = []) => {
      if (command === "adb" && (args as string[]).includes("ps")) {
        // Process table with no matching package — the app is gone.
        return {
          stdout: "u0_a1 100 1 0 0 0 S com.other.app",
          stderr: "",
          exitCode: 0,
        };
      }
      if (command === "adb" && (args as string[]).includes("logcat")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "maestro" && (args as string[]).includes("hierarchy")) {
        return { stdout: "{}", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    });

    const summary = await collectDiagnostics(baseOptions);

    expect(summary.ok).toBe(false);
    expect(summary.crashed).toBe(true);
    expect(summary.errorMessage).toContain("no longer running");
    expect(summary.errorMessage).toContain("crash-signals.log");
  });

  it("does not check process liveness on success", async () => {
    const { collectDiagnostics } = await import(
      "../src/capture/diagnostics.js"
    );
    const { run } = await import("../src/util/exec.js");
    const psCalls: unknown[] = [];
    vi.mocked(run).mockImplementation(async (command, args = []) => {
      if (command === "adb" && (args as string[]).includes("ps")) {
        psCalls.push(args);
      }
      return mockRunRouting({ stdout: "", stderr: "", exitCode: 0 })(
        command,
        args as string[],
      );
    });

    await collectDiagnostics(baseOptions);

    expect(psCalls).toHaveLength(0);
  });

  it("writes logcat.txt and crash-signals.log", async () => {
    const { collectDiagnostics } = await import(
      "../src/capture/diagnostics.js"
    );
    const { run } = await import("../src/util/exec.js");
    const { writeFile } = await import("node:fs/promises");
    vi.mocked(run).mockImplementation(async (command, args = []) => {
      if (command === "adb" && (args as string[]).includes("-d")) {
        return {
          stdout:
            "line one\nE AndroidRuntime: FATAL EXCEPTION: main\nline three",
          stderr: "",
          exitCode: 0,
        };
      }
      return mockRunRouting({ stdout: "", stderr: "", exitCode: 0 })(
        command,
        args as string[],
      );
    });

    await collectDiagnostics(baseOptions);

    expect(writeFile).toHaveBeenCalledWith(
      join("/diag/home", "logcat.txt"),
      expect.stringContaining("FATAL EXCEPTION"),
      "utf8",
    );
    expect(writeFile).toHaveBeenCalledWith(
      join("/diag/home", "crash-signals.log"),
      expect.stringContaining("AndroidRuntime"),
      "utf8",
    );
  });
});
