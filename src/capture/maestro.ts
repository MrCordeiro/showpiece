import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import type { Appearance, ScreenConfig } from "../config/schema.js";
import { ShowpieceError, errorInfo } from "../util/errors.js";
import {
  collectDiagnostics,
  ensureScreenDiagnosticsDir,
  outputBaseName,
  writeContext,
} from "./diagnostics.js";

/**
 * Extract every `takeScreenshot` name from a Maestro flow's text. Handles both
 * the shorthand (`takeScreenshot: home`) and object form
 * (`takeScreenshot: { path: home }`). Pure — unit tested directly.
 */
export function extractScreenshotNames(flowText: string): string[] {
  const names: string[] = [];
  for (const doc of parseAllDocuments(flowText)) {
    const value = doc.toJSON() as unknown;
    if (!Array.isArray(value)) continue; // skip the header document
    for (const step of value) {
      if (step && typeof step === "object" && "takeScreenshot" in step) {
        const target = (step as Record<string, unknown>).takeScreenshot;
        if (typeof target === "string") {
          names.push(stripPngExtension(target));
        } else if (
          target &&
          typeof target === "object" &&
          typeof (target as Record<string, unknown>).path === "string"
        ) {
          names.push(stripPngExtension((target as { path: string }).path));
        }
      }
    }
  }
  return names;
}

function stripPngExtension(name: string): string {
  return name.replace(/\.png$/i, "");
}

/**
 * Enforce the showpiece convention: the flow must call `takeScreenshot` with a
 * name equal to the screen id. Throws with an actionable message otherwise.
 */
export function assertFlowConvention(
  flowText: string,
  screen: ScreenConfig,
): void {
  const names = extractScreenshotNames(flowText);
  if (names.length === 0) {
    throw new ShowpieceError(
      "E_FLOW_CONVENTION",
      `Flow "${screen.flow}" has no takeScreenshot step. Add \`- takeScreenshot: ${screen.id}\`.`,
    );
  }
  if (!names.includes(screen.id)) {
    const found = names.join(", ");
    throw new ShowpieceError(
      "E_FLOW_CONVENTION",
      `Flow "${screen.flow}" takes screenshot(s) named [${found}] but screen id is "${screen.id}". The takeScreenshot name must match the screen id.`,
    );
  }
}

/**
 * Filename a screen's raw capture is stored under. Dark-mode runs get a
 * `-dark` suffix so both appearances can live side by side in one output dir.
 * This is the naming convention `frame` and `publish` read back.
 */
export function createOutputFileName(
  id: string,
  appearance: Appearance,
): string {
  return `${outputBaseName(id, appearance)}.png`;
}

export interface RunFlowOptions {
  /** Directory that raw PNGs are written into (becomes Maestro's cwd). */
  rawDir: string;
  /** Directory that per-screen troubleshooting evidence is written into. */
  diagnosticsDir: string;
  /** adb serial to target. */
  serial: string;
  /** UI mode this run captures in; decides the output filename. */
  appearance: Appearance;
  /** Recorded in context.json alongside the attempt. */
  packageName: string;
  devServer: boolean;
  metroPort: number;
}

/**
 * Run a single Maestro flow and return the path to the resulting PNG —
 * `<rawDir>/<id>.png`, or `<rawDir>/<id>-dark.png` on a dark run.
 *
 * Maestro always writes `takeScreenshot: <id>` as `<id>.png` relative to its
 * working directory, so we run it in a throwaway staging directory and move the
 * result to the appearance-specific output path.
 *
 * The staging dir lives inside `rawDir` so the final `rename` stays on one
 * filesystem (`os.tmpdir()` can be another volume, which fails with EXDEV).
 *
 * Every attempt — success, a flow-convention violation, or a Maestro failure —
 * leaves `<diagnosticsDir>/<id>[-dark]/context.json` behind (written in the
 * `finally`), so an agent always has somewhere to look. See
 * `src/capture/diagnostics.ts` for the evidence-collection details.
 */
export async function runFlow(
  screen: ScreenConfig,
  options: RunFlowOptions,
): Promise<string> {
  const baseName = outputBaseName(screen.id, options.appearance);
  const screenDiagDir = await ensureScreenDiagnosticsDir(
    options.diagnosticsDir,
    baseName,
  );
  const output = join(options.rawDir, `${baseName}.png`);

  let exitCode: number | null = null;
  let status: "captured" | "failed" = "failed";
  let errorCode: string | undefined;
  let errorMessage: string | undefined;

  try {
    const flowText = await readFile(screen.flow, "utf8");
    assertFlowConvention(flowText, screen);

    await mkdir(options.rawDir, { recursive: true });
    const stagingDir = await mkdtemp(join(options.rawDir, ".showpiece-"));

    try {
      const summary = await collectDiagnostics({
        flowPath: screen.flow,
        serial: options.serial,
        packageName: options.packageName,
        cwd: stagingDir,
        screenDiagDir,
      });
      exitCode = summary.exitCode;

      if (!summary.ok) {
        throw new ShowpieceError(
          summary.crashed ? "E_APP_CRASHED" : "E_FLOW_FAILED",
          summary.errorMessage ??
            `maestro exited with code ${
              exitCode ?? "null (terminated by signal)"
            }.`,
        );
      }

      const captured = join(stagingDir, `${screen.id}.png`);
      if (!existsSync(captured)) {
        throw new ShowpieceError(
          "E_SCREENSHOT_MISSING",
          `Flow completed but ${screen.id}.png was not produced. ` +
            `Confirm the flow calls \`takeScreenshot: ${screen.id}\`. ` +
            `See ${screenDiagDir} for diagnostics.`,
        );
      }

      await rename(captured, output);
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }

    status = "captured";
    return output;
  } catch (error) {
    // A failed screen must not leave the previous run's PNG behind: `frame` and
    // `publish` read this directory by convention and would otherwise ship an
    // image that no successful capture produced. Only this screen's resolved
    // path is removed - the other appearance's file is untouched.
    await rm(output, { force: true });
    const info = errorInfo(error);
    errorCode = info.code;
    errorMessage = info.message;
    throw error;
  } finally {
    // Best-effort: never let a diagnostics-write failure mask the real error.
    // It's surfaced (not swallowed) because last-run.json still names this
    // directory afterwards.
    await writeContext(screenDiagDir, {
      id: screen.id,
      appearance: options.appearance,
      flow: screen.flow,
      serial: options.serial,
      packageName: options.packageName,
      devServer: options.devServer,
      metroPort: options.metroPort,
      exitCode,
      status,
      code: errorCode,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    }).catch((writeError) => {
      process.stderr.write(
        `\n⚠ Could not write diagnostics context for "${screen.id}" to ${screenDiagDir}: ${
          writeError instanceof Error ? writeError.message : String(writeError)
        }\n`,
      );
    });
  }
}
