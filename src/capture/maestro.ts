import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
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
 * Maestro writes `takeScreenshot: <id>` relative to its working directory, so
 * we run it with `cwd = rawDir`; a correctly-named screenshot lands exactly
 * where we want it, and dark runs are renamed afterwards. We never run
 * `maestro test` on a directory.
 */
export async function runFlow(
  screen: ScreenConfig,
  options: RunFlowOptions,
): Promise<string> {
  const flowText = await readFile(screen.flow, "utf8");
  assertFlowConvention(flowText, screen);

  await mkdir(options.rawDir, { recursive: true });

  // Maestro always writes `<id>.png` — the flow's takeScreenshot name, which
  // we've just validated equals the screen id. Clear any leftover from a
  // previous run first, so the existence check below can't be satisfied by a
  // stale file and relabel it as this run's capture in the wrong appearance.
  // Also clear the resolved output path (e.g. `<id>-dark.png`) so a failed
  // run doesn't leave a stale file from a previous successful run behind.
  const captured = join(options.rawDir, `${screen.id}.png`);
  const output = join(
    options.rawDir,
    outputFileName(screen.id, options.appearance),
  );
  await rm(captured, { force: true });
  if (output !== captured) {
    await rm(output, { force: true });
  }

  await run("maestro", ["--device", options.serial, "test", screen.flow], {
    cwd: options.rawDir,
    stdio: "inherit",
  });

  if (!existsSync(captured)) {
    throw new Error(
      `Flow completed but ${screen.id}.png was not produced in ${options.rawDir}. ` +
        `Confirm the flow calls \`takeScreenshot: ${screen.id}\`.`,
    );
  }

  if (output !== captured) {
    await rename(captured, output);
  }
  return output;
}
