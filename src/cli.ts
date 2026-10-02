#!/usr/bin/env node
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { runCapture } from "./capture/command.js";
import { runFrame } from "./frame/command.js";
import { runPublish } from "./publish/command.js";
import { runSkillInstall } from "./skill/command.js";

const program = new Command();

program
  .name("vitrine")
  .description("Play Store screenshot pipeline: capture, frame, publish.")
  .version(pkg.version);

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
  .option("--clean", "empty the raw output directory before capturing")
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

program
  .command("frame")
  .description("Composite raw screenshots into store-ready framed images.")
  .option("-c, --config <path>", "path to the config file")
  .option("--only <ids>", "comma-separated screen ids to frame a subset")
  .action(async (opts) => {
    try {
      process.exitCode = await runFrame(opts);
    } catch (error) {
      process.stderr.write(
        `\n✗ ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });

program
  .command("publish")
  .description(
    "Replace the Play listing's phone screenshots with publish.listing.",
  )
  .option("-c, --config <path>", "path to the config file")
  .option(
    "--dry-run",
    "upload and validate, then delete the edit instead of committing",
  )
  .option("-y, --yes", "commit without the confirmation question")
  .action(async (opts) => {
    try {
      process.exitCode = await runPublish({
        config: opts.config,
        dryRun: opts.dryRun,
        yes: opts.yes,
      });
    } catch (error) {
      process.stderr.write(
        `\n✗ ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });

const skill = program
  .command("skill")
  .description("Manage vitrine's bundled Claude Code skill.");

skill
  .command("install")
  .description(
    "Copy the bundled vitrine-flows skill into .claude/skills/ in this repo.",
  )
  .option("--force", "overwrite an already-installed copy")
  .action(async (opts) => {
    try {
      process.exitCode = await runSkillInstall({ force: opts.force });
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
