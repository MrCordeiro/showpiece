import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import type { Appearance, ScreenConfig } from "../config/schema.js";
import { run } from "../util/exec.js";

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
 * Enforce the vitrine convention: the flow must call `takeScreenshot` with a
 * name equal to the screen id. Throws with an actionable message otherwise.
 */
export function assertFlowConvention(
  flowText: string,
  screen: ScreenConfig,
): void {
  const names = extractScreenshotNames(flowText);
  if (names.length === 0) {
    throw new Error(
      `Flow "${screen.flow}" has no takeScreenshot step. Add \`- takeScreenshot: ${screen.id}\`.`,
    );
  }
  if (!names.includes(screen.id)) {
    const found = names.join(", ");
    throw new Error(
      `Flow "${screen.flow}" takes screenshot(s) named [${found}] but screen id is "${screen.id}". The takeScreenshot name must match the screen id.`,
    );
  }
}

/**
 * Filename a screen's raw capture is stored under. Dark-mode runs get a
 * `-dark` suffix so both appearances can live side by side in one output dir.
 * This is the naming convention `frame` and `publish` read back.
 * Pure — unit tested directly.
 */
export function outputFileName(id: string, appearance: Appearance): string {
  return appearance === "dark" ? `${id}-dark.png` : `${id}.png`;
}

export interface RunFlowOptions {
  /** Directory that raw PNGs are written into (becomes Maestro's cwd). */
  rawDir: string;
  /** adb serial to target. */
  serial: string;
  /** UI mode this run captures in; decides the output filename. */
  appearance: Appearance;
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
 */
export async function runFlow(
  screen: ScreenConfig,
  options: RunFlowOptions,
): Promise<string> {
  const flowText = await readFile(screen.flow, "utf8");
  assertFlowConvention(flowText, screen);

  await mkdir(options.rawDir, { recursive: true });
  const stagingDir = await mkdtemp(join(options.rawDir, ".vitrine-"));

  const output = join(
    options.rawDir,
    outputFileName(screen.id, options.appearance),
  );

  try {
    await run("maestro", ["--device", options.serial, "test", screen.flow], {
      cwd: stagingDir,
      stdio: "inherit",
    });

    const captured = join(stagingDir, `${screen.id}.png`);
    if (!existsSync(captured)) {
      throw new Error(
        `Flow completed but ${screen.id}.png was not produced. ` +
          `Confirm the flow calls \`takeScreenshot: ${screen.id}\`.`,
      );
    }

    await rename(captured, output);
  } catch (error) {
    // A failed screen must not leave the previous run's PNG behind: `frame` and
    // `publish` read this directory by convention and would otherwise ship an
    // image that no successful capture produced. Only this screen's resolved
    // path is removed - the other appearance's file is untouched.
    await rm(output, { force: true });
    throw error;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }

  return output;
}
