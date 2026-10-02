import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp, { type Metadata } from "sharp";
import type { Config, ScreenConfig } from "../config/schema.js";
import type { SharedTextSizes } from "../frame/caption.js";
import { MAX_OUTPUT_BYTES } from "../frame/compositor.js";
import {
  type Manifest,
  frameInputsFor,
  inputHash,
  sha256,
} from "../frame/manifest.js";

/** Play's limits for phone screenshots in one language. */
export const MIN_LISTING = 2;
export const MAX_LISTING = 8;

const MIN_SIDE_PX = 320;
const MAX_SIDE_PX = 3840;

interface BaseItem {
  /** 1-based position in the store listing. */
  position: number;
  /** The entry as written in `publish.listing`. */
  entry: string;
  path: string;
}

export type ExternalItem = BaseItem & { kind: "external" };
export type FramedItem = BaseItem & {
  kind: "framed";
  screen: ScreenConfig;
  /** `<id>` or `<id>-dark`, which is also the manifest key. */
  variantId: string;
};
/** A bare name that is not `<id>.png` or `<id>-dark.png` for any screen. */
export type UnknownItem = BaseItem & { kind: "unknown" };
export type ListingItem = ExternalItem | FramedItem | UnknownItem;

export type ListingStatus =
  | "ok"
  | "stale"
  | "missing"
  | "too large"
  | "invalid";
export type CheckedItem = ListingItem & {
  status: ListingStatus;
  detail?: string;
};

export interface ListingCheck {
  items: CheckedItem[];
  /** Problems with the whole list, such as the entry count. */
  listProblems: string[];
}

export interface ListingCheckContext {
  config: Config;
  manifest: Manifest;
  /** Must be calculated over every screen in the config, the same as `frame` does. */
  textSizes: SharedTextSizes;
}

const BLOCKING: ReadonlySet<ListingStatus> = new Set([
  "missing",
  "too large",
  "invalid",
]);

export function isExternalEntry(entry: string): boolean {
  return /^\.{1,2}[\\/]/.test(entry);
}

function framedNames(
  screens: ScreenConfig[],
): Map<string, { screen: ScreenConfig; variantId: string }> {
  const names = new Map<string, { screen: ScreenConfig; variantId: string }>();
  for (const screen of screens) {
    for (const suffix of ["", "-dark"]) {
      const variantId = `${screen.id}${suffix}`;
      names.set(`${variantId}.png`, { screen, variantId });
    }
  }
  return names;
}

export function resolveListing(
  config: Config,
  configDir: string,
): ListingItem[] {
  const framedDir = resolve(config.screenshotsDir, "framed");
  const names = framedNames(config.screens);
  const suffix = config.appearance === "dark" ? "-dark" : "";
  const entries =
    config.publish.listing ??
    config.screens.map((screen) => `${screen.id}${suffix}.png`);

  return entries.map((entry, index): ListingItem => {
    const position = index + 1;
    if (isExternalEntry(entry)) {
      // On macOS and Linux a backslash is a file name character, not a separator.
      const path = resolve(configDir, entry.replaceAll("\\", "/"));
      return { kind: "external", position, entry, path };
    }
    const path = join(framedDir, entry);
    const match = names.get(entry);
    return match
      ? { kind: "framed", position, entry, path, ...match }
      : { kind: "unknown", position, entry, path };
  });
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution =
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** A candidate more than 3 edits away is a different name, not a typo. */
export function suggestName(
  entry: string,
  candidates: string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = 4;
  for (const candidate of candidates) {
    const distance = editDistance(entry, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export async function playImageProblem(
  file: Buffer,
): Promise<{ status: "too large" | "invalid"; detail: string } | undefined> {
  if (file.length > MAX_OUTPUT_BYTES) {
    const mb = (file.length / (1024 * 1024)).toFixed(1);
    return { status: "too large", detail: `${mb} MB. Play allows 8 MB.` };
  }
  let meta: Metadata;
  try {
    meta = await sharp(file).metadata();
  } catch {
    return { status: "invalid", detail: "The file is not a readable image." };
  }
  if (meta.format !== "png" && meta.format !== "jpeg") {
    return {
      status: "invalid",
      detail: `The format is ${meta.format}. Play accepts PNG or JPEG.`,
    };
  }
  if (meta.hasAlpha) {
    return {
      status: "invalid",
      detail:
        "The image has an alpha channel. Play needs an image without transparency.",
    };
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < MIN_SIDE_PX || long > MAX_SIDE_PX) {
    return {
      status: "invalid",
      detail: `${width}×${height} px. Each side must be ${MIN_SIDE_PX} to ${MAX_SIDE_PX} px.`,
    };
  }
  if (long > 2 * short) {
    return {
      status: "invalid",
      detail: `${width}×${height} px. The long side must be at most twice the short side.`,
    };
  }
  return undefined;
}

async function staleness(
  item: FramedItem,
  framed: Buffer,
  context: ListingCheckContext,
): Promise<{ status: ListingStatus; detail?: string }> {
  const recorded = context.manifest.images[item.variantId];
  if (!recorded) {
    return {
      status: "stale",
      detail: 'vitrine has no record of this file. Run "vitrine frame".',
    };
  }
  if (recorded.outputHash !== sha256(framed)) {
    return {
      status: "stale",
      detail: 'The framed file changed after "vitrine frame" wrote it.',
    };
  }
  const rawPath = join(
    resolve(context.config.screenshotsDir, "raw"),
    `${item.variantId}.png`,
  );
  if (!existsSync(rawPath)) {
    return {
      status: "stale",
      detail:
        "The raw screenshot is missing, so vitrine cannot check this file.",
    };
  }
  const expected = inputHash(
    await readFile(rawPath),
    frameInputsFor(item.screen, context.config.frame, context.textSizes),
  );
  if (recorded.inputHash !== expected) {
    return {
      status: "stale",
      detail:
        'The raw screenshot or the config changed after framing. Run "vitrine frame".',
    };
  }
  return { status: "ok" };
}

async function checkItem(
  item: ListingItem,
  context: ListingCheckContext,
): Promise<{ status: ListingStatus; detail?: string }> {
  if (item.kind === "unknown") {
    const suggestion = suggestName(item.entry, [
      ...framedNames(context.config.screens).keys(),
    ]);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
    return {
      status: "missing",
      detail: `Not <id>.png or <id>-dark.png for a screen in the config.${hint}`,
    };
  }
  if (!existsSync(item.path)) {
    return {
      status: "missing",
      detail:
        item.kind === "external"
          ? `File not found: ${item.path}`
          : 'Not framed yet. Run "vitrine capture", then "vitrine frame".',
    };
  }
  const file = await readFile(item.path);
  const problem = await playImageProblem(file);
  if (problem) return problem;
  if (item.kind === "external") return { status: "ok" };
  return staleness(item, file, context);
}

function countProblems(count: number, usesDefault: boolean): string[] {
  if (count >= MIN_LISTING && count <= MAX_LISTING) return [];
  const problem = `Play needs ${MIN_LISTING} to ${MAX_LISTING} phone screenshots, and the listing has ${count}.`;
  return [
    usesDefault
      ? `${problem} Add publish.listing to the config to choose the screenshots.`
      : problem,
  ];
}

export async function checkListing(
  items: ListingItem[],
  context: ListingCheckContext,
): Promise<ListingCheck> {
  const checked: CheckedItem[] = [];
  for (const item of items) {
    checked.push({ ...item, ...(await checkItem(item, context)) });
  }
  return {
    items: checked,
    listProblems: countProblems(
      items.length,
      context.config.publish.listing === undefined,
    ),
  };
}

export function hasBlockingProblems(check: ListingCheck): boolean {
  return (
    check.listProblems.length > 0 ||
    check.items.some((item) => BLOCKING.has(item.status))
  );
}
