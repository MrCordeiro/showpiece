import { type Options, execa } from "execa";
import { VitrineError } from "./errors.js";

export interface RunResult {
  stdout: string;
  stderr: string;
  /** null when the process was terminated by a signal rather than exiting. */
  exitCode: number | null;
}

/**
 * Returns true if `command` can be spawned on this machine. A non-zero exit
 * still counts as "installed" — only a missing binary (ENOENT) means absent.
 */
export async function isToolInstalled(
  command: string,
  args: string[] = ["--version"],
): Promise<boolean> {
  try {
    // Do NOT pass reject:false here: we rely on the ENOENT spawn error being
    // thrown to detect a missing binary. A non-zero exit still means it exists.
    await execa(command, args, { stdio: "ignore" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    // Spawned but exited non-zero for another reason — the binary exists.
    return true;
  }
}

/** Throw an actionable error if a required external tool is missing. */
export async function assertToolInstalled(
  command: string,
  hint: string,
  args?: string[],
): Promise<void> {
  if (!(await isToolInstalled(command, args))) {
    throw new VitrineError(
      "E_TOOL_MISSING",
      `Required tool "${command}" was not found on PATH.\n  ${hint}`,
    );
  }
}

/**
 * Thin wrapper so call sites don't import execa directly, with stdout/stderr
 * normalized to strings regardless of the options passed.
 */
export async function run(
  command: string,
  args: string[],
  options?: Options,
): Promise<RunResult> {
  const result = await execa(command, args, options);
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    // A signal-killed process reports `undefined`, not 0 — preserve that
    // distinction as `null` rather than defaulting to "succeeded".
    exitCode: result.exitCode ?? null,
  };
}

/** Sleep for `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll `check` until it returns true or the timeout elapses.
 * @returns true if the condition was met, false on timeout.
 */
export async function waitFor(
  check: () => Promise<boolean>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let ok = await check();
  while (!ok) {
    if (Date.now() >= deadline) return false;
    await delay(intervalMs);
    ok = await check();
  }
  return true;
}
