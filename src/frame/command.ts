import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { selectScreens } from "../capture/command.js";
import { loadConfig } from "../config/load.js";
import type { Config, ScreenConfig } from "../config/schema.js";
import { type StepResult, printSummary } from "../util/report.js";
import { type SharedTextSizes, sharedTextSizes } from "./caption.js";
import { assertWithinPlayLimit, composeFrame } from "./compositor.js";
import { loadFont } from "./font.js";
import {
  type Manifest,
  frameInputsFor,
  inputHash,
  readManifest,
  sha256,
  writeManifest,
} from "./manifest.js";

export interface FrameOptions {
  /** Path to the config file (`--config`). */
  config?: string;
  /** Comma-separated screen ids (`--only`). */
  only?: string;
}

/** Light and dark raw files share this suffix convention with `capture` (SPEC.md "Config Schema"). */
const APPEARANCE_SUFFIXES = ["", "-dark"] as const;

/**
 * Frame every variant (`<id>.png` and/or `<id>-dark.png`) that exists in
 * `rawDir` for `screen`. A screen with neither file produces a single
 * "failed" result rather than throwing, so one missing screen doesn't stop
 * the rest of the run.
 */
async function frameScreen(
  screen: ScreenConfig,
  rawDir: string,
  framedDir: string,
  frameConfig: Config["frame"],
  textSizes: SharedTextSizes,
  manifest: Manifest,
): Promise<StepResult[]> {
  const found = APPEARANCE_SUFFIXES.filter((suffix) =>
    existsSync(join(rawDir, `${screen.id}${suffix}.png`)),
  );
  if (found.length === 0) {
    return [
      {
        id: screen.id,
        status: "failed",
        error: `No raw screenshot found for "${screen.id}" — run "vitrine capture" first.`,
      },
    ];
  }

  const results: StepResult[] = [];
  for (const suffix of found) {
    const variantId = `${screen.id}${suffix}`;
    const rawPath = join(rawDir, `${variantId}.png`);
    const framedPath = join(framedDir, `${variantId}.png`);
    try {
      const raw = await readFile(rawPath);
      const inputs = frameInputsFor(screen, frameConfig, textSizes);
      const buffer = await composeFrame({ raw, ...inputs });
      assertWithinPlayLimit(buffer, variantId);
      await writeFile(framedPath, buffer);
      manifest.images[variantId] = {
        inputHash: inputHash(raw, inputs),
        outputHash: sha256(buffer),
      };
      results.push({ id: variantId, status: "framed", path: framedPath });
    } catch (error) {
      results.push({
        id: variantId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/** Run the `frame` command. Returns a process exit code (0 = every variant framed). */
export async function runFrame(options: FrameOptions): Promise<number> {
  const { config } = await loadConfig(options.config);

  const screens = selectScreens(config.screens, options.only);
  if (screens.length === 0) {
    process.stdout.write("No screens selected.\n");
    return 0;
  }

  const rawDir = resolve(config.screenshotsDir, "raw");
  const framedDir = resolve(config.screenshotsDir, "framed");
  await mkdir(framedDir, { recursive: true });
  const manifest = await readManifest(framedDir);

  // Sized over every configured screen, not only the selected ones, so a
  // `--only` run produces the same text sizes as a full run.
  const textSizes = sharedTextSizes(
    config.screens,
    loadFont(config.frame.font),
  );

  const results: StepResult[] = [];
  for (const screen of screens) {
    process.stdout.write(`\n▶ Framing "${screen.id}"\n`);
    results.push(
      ...(await frameScreen(
        screen,
        rawDir,
        framedDir,
        config.frame,
        textSizes,
        manifest,
      )),
    );
  }
  await writeManifest(framedDir, manifest);

  const failures = printSummary(results, { title: "Frame summary" });
  return failures > 0 ? 1 : 0;
}
