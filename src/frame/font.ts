import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walk up from `startDir` looking for `assets/<relativePath>`. Bundled
 * assets live at the package root, but this module can be imported either
 * unbundled from `src/frame/` (tests, dev) or bundled flat into `dist/`
 * (the published package) — searching upward avoids hardcoding a specific
 * `../` depth that only one of those two layouts would satisfy.
 */
export function findAssetPath(
  relativePath: string,
  startDir: string,
  maxLevels = 5,
): string {
  let dir = startDir;
  for (let i = 0; i <= maxLevels; i++) {
    const candidate = join(dir, "assets", relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  throw new Error(
    `Could not locate bundled asset "assets/${relativePath}" starting from ${startDir}.`,
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));

export interface FontAsset {
  family: string;
  regularDataUri: string;
  boldDataUri: string;
}

/** v0 ships exactly one font; configSchema's `frame.font` enum (Task 2) keeps this in sync. */
const FONTS: Record<string, { regular: string; bold: string }> = {
  Inter: { regular: "Inter-Regular.woff2", bold: "Inter-Bold.woff2" },
};

function toDataUri(path: string): string {
  const base64 = readFileSync(path).toString("base64");
  return `data:font/woff2;base64,${base64}`;
}

/** Load a bundled font by name for SVG `@font-face` embedding. */
export function loadFont(name: string): FontAsset {
  const files = FONTS[name];
  if (!files) {
    throw new Error(
      `Unknown font "${name}". Bundled fonts: ${Object.keys(FONTS).join(", ")}.`,
    );
  }
  return {
    family: name,
    regularDataUri: toDataUri(findAssetPath(`fonts/${files.regular}`, HERE)),
    boldDataUri: toDataUri(findAssetPath(`fonts/${files.bold}`, HERE)),
  };
}
