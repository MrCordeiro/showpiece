import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { Config, ScreenConfig } from "../config/schema.js";
import type { SharedTextSizes } from "./caption.js";
import type { ComposeFrameInput } from "./compositor.js";

export const MANIFEST_FILE = "manifest.json";

export type FrameInputs = Omit<ComposeFrameInput, "raw">;

export interface ManifestEntry {
  inputHash: string;
  outputHash: string;
}

export interface Manifest {
  schemaVersion: 1;
  /** Keyed by variant id: `<id>` or `<id>-dark`. */
  images: Record<string, ManifestEntry>;
}

/**
 * `frame` and `publish` must both build the inputs with this function. If
 * they differ, `publish` marks every framed image as stale.
 */
export function frameInputsFor(
  screen: ScreenConfig,
  frame: Config["frame"],
  textSizes: SharedTextSizes,
): FrameInputs {
  return {
    template: frame.template,
    background: screen.background ?? frame.background,
    textColor: screen.textColor ?? frame.textColor,
    caption: screen.caption,
    subtitle: screen.subtitle,
    font: frame.font,
    headlineSize: screen.subtitle
      ? textSizes.headlineSize
      : textSizes.soloHeadlineSize,
    subtitleSize: textSizes.subtitleSize,
  };
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * The array gives a fixed field order, so equal inputs always give an equal
 * hash. The vitrine version is included because a vitrine upgrade can change
 * the pixels that `frame` renders.
 */
export function inputHash(raw: Buffer, inputs: FrameInputs): string {
  return sha256(
    JSON.stringify([
      pkg.version,
      sha256(raw),
      inputs.template,
      inputs.background,
      inputs.textColor,
      inputs.caption,
      inputs.subtitle ?? null,
      inputs.font,
      inputs.headlineSize ?? null,
      inputs.subtitleSize ?? null,
    ]),
  );
}

function emptyManifest(): Manifest {
  return { schemaVersion: 1, images: {} };
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { schemaVersion?: unknown; images?: unknown };
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.images === "object" &&
    candidate.images !== null &&
    !Array.isArray(candidate.images)
  );
}

/** A missing or unreadable manifest is empty, so `publish` reports every framed image as stale. */
export async function readManifest(framedDir: string): Promise<Manifest> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(framedDir, MANIFEST_FILE), "utf8"),
    );
    return isManifest(parsed) ? parsed : emptyManifest();
  } catch {
    return emptyManifest();
  }
}

export async function writeManifest(
  framedDir: string,
  manifest: Manifest,
): Promise<void> {
  await writeFile(
    join(framedDir, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}
