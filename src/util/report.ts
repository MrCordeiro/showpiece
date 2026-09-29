import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export type StepStatus = "captured" | "framed" | "failed";

export interface StepResult {
  id: string;
  status: StepStatus;
  /** Absolute path to the output file when successful. */
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
  /** Defaults to "Capture summary" — `frame` passes its own title. */
  title?: string;
}

/** Print a per-item summary table. Returns the number of failures. */
export function printSummary(
  results: StepResult[],
  options: PrintSummaryOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const title = options.title ?? "Capture summary";
  const failures = results.filter((r) => r.status === "failed").length;
  const width = Math.max(2, ...results.map((r) => r.id.length));

  process.stdout.write(`\n${title}\n`);
  process.stdout.write(`${"-".repeat(title.length)}\n`);

  for (const result of results) {
    const mark = result.status === "failed" ? CROSS : CHECK;
    const id = result.id.padEnd(width);
    const detail =
      result.status === "failed"
        ? (result.error ?? "failed")
        : result.path
          ? relative(cwd, result.path)
          : "";
    process.stdout.write(`${mark} ${id}  ${detail}\n`);
    if (result.status === "failed" && result.diagnosticsDir) {
      process.stdout.write(
        `${" ".repeat(width + 2)}  → diagnostics: ${relative(cwd, result.diagnosticsDir)}\n`,
      );
    }
  }

  const succeeded = results.length - failures;
  process.stdout.write(
    `\n${results.length} screen(s) · ${succeeded} succeeded · ${failures} failed\n`,
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
  screens: StepResult[];
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
  results: StepResult[];
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
