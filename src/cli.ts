#!/usr/bin/env node
import { Command } from "commander";
import { runCapture } from "./capture/command.js";

const program = new Command();

program
  .name("vitrine")
  .description("Play Store screenshot pipeline: capture, frame, publish.")
  .version("0.1.0");

program
  .command("capture")
  .description(
    "Capture raw screenshots by running Maestro flows in config order.",
  )
  .option("-c, --config <path>", "path to the config file")
  .option("--only <ids>", "comma-separated screen ids to capture a subset")
  .option("--serial <device>", "target a specific adb device/emulator serial")
  .option(
    "--appearance <mode>",
    "capture in light or dark mode (overrides the config value)",
  )
  .action(async (opts) => {
    try {
      process.exitCode = await runCapture(opts);
    } catch (error) {
      process.stderr.write(
        `\n✗ ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(
    `\n✗ ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
