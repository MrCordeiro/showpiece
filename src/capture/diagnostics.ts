import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Appearance } from "../config/schema.js";
import { run } from "../util/exec.js";
import { isProcessRunning } from "./device.js";

/**
 * Base filename (no extension) a screen's artifacts are keyed by. Dark-mode
 * runs get a `-dark` suffix so both appearances can coexist side by side.
 * Shared by the raw PNG name and the diagnostics directory name — the single
 * source of truth for the appearance convention.
 */
export function outputBaseName(id: string, appearance: Appearance): string {
  return appearance === "dark" ? `${id}-dark` : id;
}

/**
 * Wipe and recreate this screen's diagnostics directory so it always holds
 * exactly the latest attempt. Mirrors the `raw/` contract.
 */
export async function ensureScreenDiagnosticsDir(
  diagnosticsDir: string,
  baseName: string,
): Promise<string> {
  const dir = join(diagnosticsDir, baseName);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

export interface RunContext {
  id: string;
  appearance: Appearance;
  flow: string;
  serial: string;
  packageName: string;
  devServer: boolean;
  metroPort: number;
}

export interface ScreenContext extends RunContext {
  exitCode: number | null;
  status: "captured" | "failed";
  code?: string;
  error?: string;
  timestamp: string;
}

/**
 * Write `context.json` — showpiece's own view of the attempt, independent of
 * whatever Maestro artifacts did or didn't make it to disk. If a screen appears
 * in `last-run.json`, its diagnostics directory exists and contains at least
 * this file.
 */
export async function writeContext(
  screenDiagDir: string,
  context: ScreenContext,
): Promise<void> {
  await writeFile(
    join(screenDiagDir, "context.json"),
    `${JSON.stringify(context, null, 2)}\n`,
    "utf8",
  );
}

interface MaestroRunResult {
  /** null when maestro was terminated by a signal rather than exiting. */
  exitCode: number | null;
  output: string;
}

/**
 * Run `maestro test` with its debug output flattened directly into
 * `screenDiagDir`, and capture the combined stdout/stderr to
 * `maestro-stdout.log` so a failure produces real error text instead of a
 * bare exit code. Output still streams live to the terminal — execa's
 * `["inherit", "pipe"]` array form does both.
 */
async function runMaestroFlow(
  flowPath: string,
  options: { serial: string; cwd: string; screenDiagDir: string },
): Promise<MaestroRunResult> {
  const result = await run(
    "maestro",
    [
      "--device",
      options.serial,
      "test",
      "--debug-output",
      options.screenDiagDir,
      "--flatten-debug-output",
      flowPath,
    ],
    {
      cwd: options.cwd,
      stdout: ["inherit", "pipe"],
      stderr: ["inherit", "pipe"],
      reject: false,
    },
  );

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  await writeFile(
    join(options.screenDiagDir, "maestro-stdout.log"),
    `${output}\n`,
    "utf8",
  );
  return { exitCode: result.exitCode, output };
}

/**
 * Dump the device's current view hierarchy. This is state *after* the flow
 * ended — usually but not always the failing screen (a crash or teardown can
 * leave the launcher on screen instead); it's the selector-authoring
 * evidence, while `failure-screenshot.png` (from Maestro itself) is the
 * pixel evidence of the failing step. Maestro's own debug output does not
 * include this, so showpiece dumps it separately. Best-effort: never let a
 * hierarchy failure mask the real capture error.
 */
export async function dumpHierarchy(
  serial: string,
  screenDiagDir: string,
): Promise<void> {
  try {
    const result = await run("maestro", ["--device", serial, "hierarchy"], {
      reject: false,
    });
    await writeFile(
      join(screenDiagDir, "hierarchy.json"),
      `${result.stdout}\n`,
      "utf8",
    );
  } catch {
    // Best-effort — see docstring.
  }
}

/** Clear the device's logcat buffer so a post-run dump holds only this attempt's window. */
async function clearLogcat(serial: string): Promise<void> {
  await run("adb", ["-s", serial, "logcat", "-c"], { reject: false }).catch(
    () => undefined,
  );
}

const CRASH_SIGNAL_PATTERNS = [
  /Fatal signal/i,
  /Abort message/i,
  /AndroidRuntime/i,
  /has died/i,
  /libprocessgroup/i,
  /Running "main"/,
];

/**
 * Pull out the lines worth a first look from a full logcat dump: native
 * crash signals, Java crashes, process-death notices, and the JS
 * `Running "main"` marker that anchors when the bundle actually started
 * executing (a crash shortly after that line points at the JS/native
 * bridge, not the bundle transfer). `logcat.txt` sits alongside this for
 * anything these patterns miss.
 */
export function extractCrashSignals(logcatText: string): string[] {
  return logcatText
    .split(/\r?\n/)
    .filter((line) =>
      CRASH_SIGNAL_PATTERNS.some((pattern) => pattern.test(line)),
    );
}

/**
 * Dump the device's logcat since the last {@link clearLogcat} plus a
 * filtered `crash-signals.log` naming just the lines worth a first look.
 * Best-effort: never let a logcat failure mask the real capture error.
 * A stalled bundle fetch and a crashed process can produce an identical
 * Maestro-level failure (an assertion that never becomes true) — logcat is
 * the only place the difference actually shows up.
 */
async function dumpLogcat(
  serial: string,
  screenDiagDir: string,
): Promise<void> {
  try {
    const result = await run("adb", ["-s", serial, "logcat", "-d"], {
      reject: false,
    });
    await writeFile(
      join(screenDiagDir, "logcat.txt"),
      `${result.stdout}\n`,
      "utf8",
    );
    const signals = extractCrashSignals(result.stdout);
    await writeFile(
      join(screenDiagDir, "crash-signals.log"),
      signals.length > 0
        ? `${signals.join("\n")}\n`
        : "(no crash/death signals found in logcat.txt)\n",
      "utf8",
    );
  } catch {
    // Best-effort — see docstring.
  }
}

/**
 * Maestro's `--flatten-debug-output` names artifacts after the flow's own
 * basename with an embedded timestamp and a non-ASCII status marker, e.g.
 * `commands-(categories.yaml).json`, `screenshot-❌-1784900325975-(categories.yaml).png`.
 * Flow basenames don't track screen ids and the names aren't documentable as
 * a glob, so rename them to fixed ASCII names. Per-screen diagnostics
 * isolation (one flow run per directory) makes this unambiguous —
 * `maestro.log` is already a stable name and needs no rename.
 */
export async function normalizeArtifactNames(
  screenDiagDir: string,
): Promise<void> {
  const entries = await readdir(screenDiagDir);
  for (const entry of entries) {
    if (/^commands-.*\.json$/.test(entry)) {
      await rename(
        join(screenDiagDir, entry),
        join(screenDiagDir, "commands.json"),
      );
    } else if (/^screenshot-.*\.png$/.test(entry)) {
      await rename(
        join(screenDiagDir, entry),
        join(screenDiagDir, "failure-screenshot.png"),
      );
    }
  }
}

interface CommandStep {
  command?: Record<string, unknown>;
  metadata?: {
    status?: string;
    duration?: number;
    sequenceNumber?: number;
  };
}

/**
 * Find the first step, in execution order, whose status isn't `"COMPLETED"`,
 * from a parsed Maestro `commands.json` debug dump. The array itself is not
 * in execution order (Maestro appends as it goes) — sort by
 * `metadata.sequenceNumber` first. Returns undefined when every step
 * completed, or the input doesn't look like a commands dump.
 */
export function firstFailedCommand(
  steps: unknown,
): { description: string; status: string; durationMs?: number } | undefined {
  if (!Array.isArray(steps)) return undefined;

  const ordered = [...(steps as CommandStep[])].sort(
    (a, b) =>
      (a.metadata?.sequenceNumber ?? 0) - (b.metadata?.sequenceNumber ?? 0),
  );
  const failed = ordered.find(
    (step) => step.metadata?.status && step.metadata.status !== "COMPLETED",
  );
  if (!failed?.metadata?.status) return undefined;

  return {
    description: describeCommand(failed.command ?? {}),
    status: failed.metadata.status,
    durationMs: failed.metadata.duration,
  };
}

/** e.g. `{ assertVisibleCommand: { text: "Home" } }` -> `assertVisible: Home`. */
function describeCommand(command: Record<string, unknown>): string {
  const entry = Object.entries(command)[0];
  if (!entry) return "unknown step";
  const [key, value] = entry;
  const name = key.replace(/Command$/, "");
  const detail = summarizeValue(value);
  return detail ? `${name}: ${detail}` : name;
}

// `textRegex`/`idRegex` confirmed against a real failing `assertConditionCommand`
// (`{ condition: { visible: { textRegex: "Net Worth" } } }`) — Maestro's
// `assertVisible: "some text"` in a flow compiles to `textRegex`, not `text`,
// even for a plain string. `text`/`id`/`selector`/`appId`/`link` are kept as
// a defensive superset for command shapes not yet observed failing for real.
const SUMMARY_KEYS = [
  "text",
  "textRegex",
  "id",
  "idRegex",
  "selector",
  "appId",
  "link",
];

/**
 * Look for a human-meaningful field (`text`, `textRegex`, `id`, …) on a
 * command's payload. The only successful-run dump seen before this stage
 * (`launchAppCommand`, `applyConfigurationCommand`) nests one level (e.g.
 * `{ config: { appId } }`); a real assertion failure nests further still
 * (`{ condition: { visible: { textRegex } } }`, confirmed against a real app)
 * — search a few levels deep rather than assuming a flat shape.
 */
function summarizeValue(value: unknown, depth = 3): string | undefined {
  if (value == null || typeof value !== "object" || depth <= 0) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    if (typeof obj[key] === "string") return obj[key];
  }
  for (const nested of Object.values(obj)) {
    const found = summarizeValue(nested, depth - 1);
    if (found) return found;
  }
  return undefined;
}

/** Build a readable failure message from the normalized `commands.json`. */
async function describeFlowFailure(
  screenDiagDir: string,
  rawOutput: string,
  exitCode: number | null,
): Promise<string> {
  const commandsPath = join(screenDiagDir, "commands.json");
  if (existsSync(commandsPath)) {
    try {
      const parsed = JSON.parse(await readFile(commandsPath, "utf8"));
      const failure = firstFailedCommand(parsed);
      if (failure) {
        const duration =
          failure.durationMs != null
            ? ` after ${(failure.durationMs / 1000).toFixed(1)}s`
            : "";
        return (
          `Step failed: ${failure.description}${duration} (${failure.status}). ` +
          `See ${screenDiagDir} for the failure screenshot, view hierarchy, and full log.`
        );
      }
    } catch {
      // Malformed/missing commands.json — fall through to the generic message.
    }
  }

  const trimmed = rawOutput.trim();
  if (trimmed) return `${trimmed}\nSee ${screenDiagDir} for diagnostics.`;
  return (
    `maestro exited with code ${exitCode ?? "null (terminated by signal)"}. ` +
    `See ${screenDiagDir} for diagnostics.`
  );
}

export interface CollectDiagnosticsOptions {
  flowPath: string;
  serial: string;
  packageName: string;
  /** Maestro's cwd — the staging dir `takeScreenshot` output lands in. */
  cwd: string;
  screenDiagDir: string;
}

export interface DiagnosticsSummary {
  exitCode: number | null;
  ok: boolean;
  /** Human-readable cause, present when `ok` is false. */
  errorMessage?: string;
  /**
   * True when the app's process was gone at failure time. Set only on
   * failure — the caller uses this to pick `E_APP_CRASHED` over
   * `E_FLOW_FAILED`, so troubleshooting starts at logcat/crash-signals.log
   * instead of hunting for a selector bug that was never the cause.
   */
  crashed?: boolean;
}

/**
 * Run a flow with full evidence collection: piped+echoed output, a stable
 * `commands.json`/`maestro.log`/`failure-screenshot.png`, a post-run
 * `hierarchy.json`, and `logcat.txt`/`crash-signals.log`. On failure, also
 * checks whether the app process is still alive - a stalled bundle fetch
 * and a crashed process produce an identical Maestro-level failure
 * otherwise. Single entry point `runFlow` calls.
 */
export async function collectDiagnostics(
  options: CollectDiagnosticsOptions,
): Promise<DiagnosticsSummary> {
  await clearLogcat(options.serial);

  const { exitCode, output } = await runMaestroFlow(options.flowPath, {
    serial: options.serial,
    cwd: options.cwd,
    screenDiagDir: options.screenDiagDir,
  });

  await dumpHierarchy(options.serial, options.screenDiagDir);
  await dumpLogcat(options.serial, options.screenDiagDir);
  await normalizeArtifactNames(options.screenDiagDir);

  if (exitCode === 0) {
    return { exitCode, ok: true };
  }

  const stillRunning = await isProcessRunning(
    options.serial,
    options.packageName,
  );
  if (!stillRunning) {
    return {
      exitCode,
      ok: false,
      crashed: true,
      errorMessage:
        `App process "${options.packageName}" is no longer running:. It was likely a crash; not a real assertion failure. ` +
        `Check ${join(options.screenDiagDir, "crash-signals.log")} (native "Fatal signal"/"Abort message", or Java "AndroidRuntime"), ` +
        `then ${join(options.screenDiagDir, "logcat.txt")} for full context.`,
    };
  }

  const errorMessage = await describeFlowFailure(
    options.screenDiagDir,
    output,
    exitCode,
  );
  return { exitCode, ok: false, errorMessage };
}
