import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export type CaptureStatus = "captured" | "failed";

export interface CaptureResult {
  id: string;
  status: CaptureStatus;
  /** Absolute path to the raw PNG when captured. */
  path?: string;
  /** Error message when failed. */
  error?: string;
  /** Machine-readable failure kind (see src/util/errors.ts). */
  code?: string;
  /** Per-screen troubleshooting evidence directory, when one was written. */
  diagnosticsDir?: string;
}

const CHECK = "✓"; // ✓
const CROSS = "✗"; // ✗

export interface PrintSummaryOptions {
  cwd?: string;
  /** Defaults to "Capture summary" — `frame` will want its own title. */
  title?: string;
}

/** Print a per-screen summary table. Returns the number of failures. */
export function printSummary(
  results: CaptureResult[],
  options: PrintSummaryOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const title = options.title ?? "Capture summary";
  const failures = results.filter((r) => r.status === "failed").length;
  const width = Math.max(2, ...results.map((r) => r.id.length));

  process.stdout.write(`\n${title}\n`);
  process.stdout.write(`${"-".repeat(title.length)}\n`);

  for (const result of results) {
    const mark = result.status === "captured" ? CHECK : CROSS;
    const id = result.id.padEnd(width);
    const detail =
      result.status === "captured"
        ? result.path
          ? relative(cwd, result.path)
          : ""
        : (result.error ?? "failed");
    process.stdout.write(`${mark} ${id}  ${detail}\n`);
    if (result.status === "failed" && result.diagnosticsDir) {
      process.stdout.write(
        `${" ".repeat(width + 2)}  → diagnostics: ${relative(cwd, result.diagnosticsDir)}\n`,
      );
    }
  }

  const captured = results.length - failures;
  process.stdout.write(
    `\n${results.length} screen(s) · ${captured} captured · ${failures} failed\n`,
  );
  return failures;
}

export interface RunReport {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string;
  appearance: string;
  serial: string;
  configPath: string;
  packageName: string;
  screens: CaptureResult[];
  summary: { total: number; captured: number; failed: number };
}

export interface WriteRunReportOptions {
  diagnosticsDir: string;
  startedAt: string;
  finishedAt: string;
  appearance: string;
  serial: string;
  configPath: string;
  packageName: string;
  results: CaptureResult[];
}

/**
 * Write `<diagnosticsDir>/last-run.json` — the agent's entry point. Always
 * written, unconditionally: a flag an agent might forget to pass is worse
 * than a file that's always there.
 */
export async function writeRunReport(
  options: WriteRunReportOptions,
): Promise<string> {
  const failed = options.results.filter((r) => r.status === "failed").length;
  const report: RunReport = {
    schemaVersion: 1,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    appearance: options.appearance,
    serial: options.serial,
    configPath: options.configPath,
    packageName: options.packageName,
    screens: options.results,
    summary: {
      total: options.results.length,
      captured: options.results.length - failed,
      failed,
    },
  };

  await mkdir(options.diagnosticsDir, { recursive: true });
  const path = join(options.diagnosticsDir, "last-run.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path;
}
