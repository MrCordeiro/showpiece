import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StepResult } from "../src/util/report.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

describe("printSummary", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  // vi.spyOn on an already-spied method returns the SAME mock instance
  // (with its accumulated .mock.calls) rather than a fresh one — restore
  // fully so each test's beforeEach starts from a clean spy.
  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("defaults to the 'Capture summary' title", async () => {
    const { printSummary } = await import("../src/util/report.js");
    printSummary([{ id: "home", status: "captured", path: "/x/home.png" }]);
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Capture summary");
  });

  it("accepts a custom title", async () => {
    const { printSummary } = await import("../src/util/report.js");
    printSummary([{ id: "home", status: "captured", path: "/x/home.png" }], {
      title: "Frame summary",
    });
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("Frame summary");
    expect(output).not.toContain("Capture summary");
  });

  it("treats any non-failed status (e.g. frame's 'framed') as a success", async () => {
    const { printSummary } = await import("../src/util/report.js");
    const failures = printSummary(
      [
        { id: "home", status: "framed", path: "/x/home.png" },
        { id: "profile", status: "failed", error: "no raw file" },
      ],
      { title: "Frame summary" },
    );
    expect(failures).toBe(1);
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("no raw file");
  });

  it("prints the diagnostics path under a failed screen", async () => {
    const { printSummary } = await import("../src/util/report.js");
    const results: StepResult[] = [
      {
        id: "home",
        status: "failed",
        error: "boom",
        diagnosticsDir: "/diag/home",
      },
    ];
    printSummary(results, { cwd: "/" });
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("diagnostics:");
    expect(output).toContain(join("diag", "home"));
  });

  it("returns the failure count", async () => {
    const { printSummary } = await import("../src/util/report.js");
    const failures = printSummary([
      { id: "a", status: "captured", path: "/x/a.png" },
      { id: "b", status: "failed", error: "boom" },
    ]);
    expect(failures).toBe(1);
  });
});

describe("writeRunReport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes last-run.json under diagnosticsDir with a summary", async () => {
    const { writeRunReport } = await import("../src/util/report.js");
    const { mkdir, writeFile } = await import("node:fs/promises");

    const results: StepResult[] = [
      { id: "home", status: "captured", path: "/raw/home.png" },
      { id: "profile", status: "failed", error: "boom", code: "E_FLOW_FAILED" },
    ];

    const path = await writeRunReport({
      diagnosticsDir: "/diag",
      startedAt: "2026-08-13T00:00:00.000Z",
      finishedAt: "2026-08-13T00:00:05.000Z",
      appearance: "light",
      serial: "emulator-5554",
      configPath: "/repo/vitrine.config.ts",
      packageName: "com.example.app",
      results,
    });

    expect(path).toBe(join("/diag", "last-run.json"));
    expect(mkdir).toHaveBeenCalledWith("/diag", { recursive: true });

    const written = vi.mocked(writeFile).mock.calls[0];
    expect(written?.[0]).toBe(join("/diag", "last-run.json"));
    const report = JSON.parse(written?.[1] as string);
    expect(report.schemaVersion).toBe(1);
    expect(report.summary).toEqual({ total: 2, captured: 1, failed: 1 });
    expect(report.screens).toEqual(results);
  });
});
