import { relative } from "node:path";

export type StepStatus = "captured" | "framed" | "failed";

export interface StepResult {
  id: string;
  status: StepStatus;
  /** Absolute path to the output file when successful. */
  path?: string;
  /** Error message when failed. */
  error?: string;
}

const CHECK = "✓"; // ✓
const CROSS = "✗"; // ✗

/** Print a per-item summary table under `${label} summary`. Returns the number of failures. */
export function printSummary(
  label: string,
  results: StepResult[],
  cwd: string = process.cwd(),
): number {
  const failures = results.filter((r) => r.status === "failed").length;
  const width = Math.max(2, ...results.map((r) => r.id.length));

  const title = `${label} summary`;
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
  }

  const succeeded = results.length - failures;
  process.stdout.write(
    `\n${results.length} screen(s) · ${succeeded} succeeded · ${failures} failed\n`,
  );
  return failures;
}
