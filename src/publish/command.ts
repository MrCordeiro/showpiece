import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "../config/load.js";
import { sharedTextSizes } from "../frame/caption.js";
import { loadFont } from "../frame/font.js";
import { readManifest } from "../frame/manifest.js";
import { VitrineError } from "../util/errors.js";
import {
  type CheckedItem,
  checkListing,
  hasBlockingProblems,
  resolveListing,
} from "./listing.js";
import {
  type PlayClient,
  type ServiceAccountKey,
  createPlayClient,
  readServiceAccountKey,
} from "./play.js";
import { formatStoryTable } from "./story.js";

export interface PublishOptions {
  /** Path to the config file (`--config`). */
  config?: string;
  /** Validate, then delete the edit instead of committing it (`--dry-run`). */
  dryRun?: boolean;
  /** Commit without the confirmation question (`--yes`). */
  yes?: boolean;
}

/** Test seams. The defaults use the real Play API, stdin and stdout. */
export interface PublishDeps {
  createClient?: (key: ServiceAccountKey, packageName: string) => PlayClient;
  confirm?: (question: string) => Promise<boolean>;
  isInteractive?: boolean;
}

async function askYesNo(question: string): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return /^y(es)?$/i.test((await readline.question(question)).trim());
  } finally {
    readline.close();
  }
}

/**
 * Play ignores `deleteall` and `upload` for a language that the listing does
 * not have. Without the two checks below, a wrong `device.locale` commits an
 * edit that changes nothing.
 */
async function replaceScreenshots(
  client: PlayClient,
  editId: string,
  language: string,
  items: CheckedItem[],
): Promise<number> {
  if (!(await client.hasListing(editId, language))) {
    throw new VitrineError(
      "E_PUBLISH_LOCALE",
      `The Play store listing has no language "${language}". Play ignores uploads for a language that the listing does not have. Set device.locale to a language of the store listing, for example "en-US".`,
    );
  }
  const previous = await client.countScreenshots(editId, language);
  await client.deleteAllScreenshots(editId, language);
  for (const item of items) {
    process.stdout.write(`↑ ${item.position}. ${item.entry}\n`);
    await client.uploadScreenshot(editId, language, item.path);
  }
  const uploaded = await client.countScreenshots(editId, language);
  if (uploaded !== items.length) {
    throw new VitrineError(
      "E_PUBLISH_UPLOAD_COUNT",
      `Play has ${uploaded} phone screenshots for "${language}" after the upload, but vitrine uploaded ${items.length}.`,
    );
  }
  return previous;
}

async function deleteEditQuietly(
  client: PlayClient,
  editId: string,
): Promise<void> {
  try {
    await client.deleteEdit(editId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      `! vitrine could not delete the Play edit ${editId}: ${message}. Nothing was committed.\n`,
    );
  }
}

export async function runPublish(
  options: PublishOptions,
  deps: PublishDeps = {},
): Promise<number> {
  const { config, configDir } = await loadConfig(options.config);
  const check = await checkListing(resolveListing(config, configDir), {
    config,
    manifest: await readManifest(resolve(config.screenshotsDir, "framed")),
    textSizes: sharedTextSizes(config.screens, loadFont(config.frame.font)),
  });

  process.stdout.write(`\n${formatStoryTable(check.items)}`);
  for (const problem of check.listProblems) {
    process.stdout.write(`✗ ${problem}\n`);
  }
  if (hasBlockingProblems(check)) {
    process.stdout.write(
      "\nNothing was sent to Play. Fix the entries marked ✗ and run publish again.\n",
    );
    return 1;
  }

  const key = await readServiceAccountKey(config.publish.serviceAccountKeyPath);
  const packageName = config.publish.packageName ?? config.app.packageName;
  const count = check.items.length;

  if (!options.dryRun && !options.yes) {
    const interactive = deps.isInteractive ?? process.stdin.isTTY === true;
    if (!interactive) {
      throw new VitrineError(
        "E_PUBLISH_CONFIRM_REQUIRED",
        'publish asks for a confirmation before it commits, and this terminal cannot answer. Run "vitrine publish --yes" to commit without the question.',
      );
    }
    const confirm = deps.confirm ?? askYesNo;
    const accepted = await confirm(
      `\nCommit ${count} screenshots to ${packageName}? [y/N] `,
    );
    if (!accepted) {
      process.stdout.write("Cancelled. Nothing was sent to Play.\n");
      return 1;
    }
  }

  const client = (deps.createClient ?? createPlayClient)(key, packageName);
  const language = config.device.locale;
  const editId = await client.insertEdit();
  let previous: number;
  try {
    previous = await replaceScreenshots(client, editId, language, check.items);
    await client.validateEdit(editId);
    if (options.dryRun) {
      await client.deleteEdit(editId);
    } else {
      await client.commitEdit(editId);
    }
  } catch (error) {
    await deleteEditQuietly(client, editId);
    throw error;
  }

  if (options.dryRun) {
    process.stdout.write(
      `\n✓ Dry run: Play validated ${count} screenshots for "${language}". They would replace the ${previous} current screenshots. vitrine deleted the edit, so the listing did not change.\n`,
    );
    return 0;
  }
  process.stdout.write(
    [
      `\n✓ Committed ${count} screenshots for "${language}" to ${packageName}. Google reviews the change before it is live.`,
      "  Play Console: https://play.google.com/console (your app > Store presence > Main store listing)",
      `  Store page:   https://play.google.com/store/apps/details?id=${packageName}\n`,
    ].join("\n"),
  );
  return 0;
}
