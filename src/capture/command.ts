import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../config/load.js";
import type { Appearance, Config, ScreenConfig } from "../config/schema.js";
import { assertToolInstalled } from "../util/exec.js";
import { type CaptureResult, printSummary } from "../util/report.js";
import {
  assertMetroRunning,
  ensureApp,
  getNightMode,
  overrideMetroHost,
  resolveDevice,
  setNightMode,
  setupMetroReverse,
} from "./device.js";
import { runFlow } from "./maestro.js";

export interface CaptureOptions {
  /** Path to the config file (`--config`). */
  config?: string;
  /** Comma-separated screen ids (`--only`). */
  only?: string;
  /** Target device serial (`--serial`). */
  serial?: string;
  /** UI mode override (`--appearance`), beating the configured value. */
  appearance?: string;
  /** Empty the raw output directory before capturing (`--clean`). */
  clean?: boolean;
}

/**
 * Select the screens to capture, preserving config order. Throws if `--only`
 * references an unknown id. Pure — unit tested directly.
 */
export function selectScreens(
  screens: ScreenConfig[],
  only: string | undefined,
): ScreenConfig[] {
  if (!only) return screens;
  const wanted = only
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const known = new Set(screens.map((s) => s.id));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown screen id(s) in --only: ${unknown.join(", ")}. ` +
        `Known ids: ${[...known].join(", ")}.`,
    );
  }
  const wantedSet = new Set(wanted);
  return screens.filter((s) => wantedSet.has(s.id));
}

const APPEARANCES = ["light", "dark"] as const;

/**
 * Resolve the run's UI mode: the `--appearance` flag wins over the configured
 * value. Pure — unit tested directly.
 */
export function resolveAppearance(
  configured: Appearance,
  flag: string | undefined,
): Appearance {
  if (flag === undefined) return configured;
  const match = APPEARANCES.find((value) => value === flag);
  if (!match) {
    throw new Error(
      `Invalid --appearance "${flag}". Expected one of: ${APPEARANCES.join(
        ", ",
      )}.`,
    );
  }
  return match;
}

/**
 * Best-effort restore of the device's original night mode. Never throws: a
 * failure here must not mask a capture failure or change the exit code.
 */
async function restoreNightMode(
  serial: string,
  previous: string | undefined,
): Promise<void> {
  if (!previous) return;
  try {
    await setNightMode(serial, previous);
  } catch (error) {
    process.stderr.write(
      `\n⚠ Could not restore the device's night mode to "${previous}": ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
}

/**
 * Run the `capture` command. Returns a process exit code (0 = all captured).
 */
export async function runCapture(options: CaptureOptions): Promise<number> {
  const { config } = await loadConfig(options.config);

  // Validate the screen selection against config before touching any tooling.
  const screens = selectScreens(config.screens, options.only);
  if (screens.length === 0) {
    process.stdout.write("No screens selected.\n");
    return 0;
  }
  const appearance = resolveAppearance(config.appearance, options.appearance);

  await assertToolInstalled(
    "maestro",
    "Install Maestro: https://maestro.mobile.dev/getting-started/installing-maestro",
  );

  const serial = await resolveDevice({
    serial: options.serial,
    avd: config.device.avd,
  });
  await ensureApp(config.app, serial);

  // Dev builds load their JS bundle from Metro. Forward the port to the device
  // and make sure Metro is up, otherwise every capture is just the splash.
  if (config.device.devServer) {
    await setupMetroReverse(serial, config.device.metroPort);
    await overrideMetroHost(
      serial,
      config.app.packageName,
      config.device.metroPort,
    );
    await assertMetroRunning(config.device.metroPort);
  }

  // Put the device into the requested UI mode, remembering the previous one so
  // a device you also use by hand is left as it was found. This only changes
  // what's on screen if the app itself follows the system appearance.
  const previousNightMode = await getNightMode(serial);
  if (previousNightMode) {
    await setNightMode(serial, appearance === "dark" ? "yes" : "no");
  } else {
    process.stderr.write(
      "\n⚠ Could not read the device's current night mode (requires Android 10 / API 29+) — leaving it as-is and capturing in whatever mode the device is currently in.\n",
    );
  }

  const rawDir = resolve(config.screenshotsDir, "raw");
  const results: CaptureResult[] = [];

  if (options.clean) {
    if (options.only) {
      process.stderr.write(
        `\n⚠ --clean empties ${rawDir}, including screens outside --only that this run will not re-capture.\n`,
      );
    }
    await rm(rawDir, { recursive: true, force: true });
  }

  try {
    for (const screen of screens) {
      process.stdout.write(`\n▶ Capturing "${screen.id}" (${screen.flow})\n`);
      try {
        const path = await runFlow(screen, { rawDir, serial, appearance });
        results.push({ id: screen.id, status: "captured", path });
      } catch (error) {
        results.push({
          id: screen.id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await restoreNightMode(serial, previousNightMode);
  }

  const failures = printSummary(results);
  return failures > 0 ? 1 : 0;
}

// Re-export so callers can build a config without a second import.
export type { Config };
